//! Chunked, encrypted, resumable TCP transfer engine.
//!
//! * One TCP connection per (sender → receiver) session, framed with `MLNK`.
//! * X25519 handshake, then every frame is AES-256-GCM sealed.
//! * Files are streamed in 256 KiB chunks — never loaded into memory whole.
//! * A bounded pipeline of `settings.concurrency` prepared chunks keeps the
//!   socket saturated while compression/sealing happens on other tasks.
//! * The receiver ACKs the last byte written to disk; that offset is persisted
//!   so an interrupted transfer resumes exactly where it stopped.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use crate::crypto::{quick_file_id, Handshake, Role, Session};
use crate::model::*;
use crate::protocol::*;
use crate::state::{events, AppState, Decision};

const PART_SUFFIX: &str = ".mcpart";
const ACK_EVERY_BYTES: u64 = 2 * 1024 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// Assumed link ceiling used as the 100% reference for the bandwidth slider.
const REFERENCE_BPS: f64 = 125.0 * 1024.0 * 1024.0; // ~1 Gbps

// ── bandwidth limiter ───────────────────────────────────────────────────────

struct Throttle {
    target_bps: f64,
    window_start: Instant,
    window_bytes: u64,
}

impl Throttle {
    fn new(pct: u8) -> Self {
        Self {
            target_bps: if pct >= 100 {
                f64::INFINITY
            } else {
                REFERENCE_BPS * (pct.max(1) as f64 / 100.0)
            },
            window_start: Instant::now(),
            window_bytes: 0,
        }
    }

    async fn consume(&mut self, bytes: u64) {
        if !self.target_bps.is_finite() {
            return;
        }
        self.window_bytes += bytes;
        let elapsed = self.window_start.elapsed().as_secs_f64();
        let allowed = self.target_bps * elapsed.max(0.001);
        if (self.window_bytes as f64) > allowed {
            let excess = self.window_bytes as f64 - allowed;
            let sleep = (excess / self.target_bps).min(0.25);
            tokio::time::sleep(Duration::from_secs_f64(sleep)).await;
        }
        if elapsed > 1.0 {
            self.window_start = Instant::now();
            self.window_bytes = 0;
        }
    }
}

// ── handshake ───────────────────────────────────────────────────────────────

async fn handshake(
    stream: &mut TcpStream,
    state: &AppState,
    role: Role,
) -> Result<(Session, PeerInfo)> {
    let hs = Handshake::new()?;
    let me = state.self_peer().await;

    let (session, peer) = match role {
        Role::Initiator => {
            // seq 0/1 carry the public keys in the clear (they are public).
            write_frame(stream, 0, &hs.public_bytes()).await?;
            let hello = encode_control(&Control::Hello { peer: me })?;
            write_frame(stream, 1, &hello).await?;

            let peer_key = read_frame(stream).await?.payload;
            let session = hs.into_session(&peer_key, role)?;
            let ack = read_frame(stream).await?;
            match decode_control(&session.open(&ack.payload)?)? {
                Control::HelloAck { peer } => (session, peer),
                other => return Err(anyhow!("unexpected handshake reply: {other:?}")),
            }
        }
        Role::Responder => {
            let peer_key = read_frame(stream).await?.payload;
            let hello = read_frame(stream).await?;
            let peer = match decode_control(&hello.payload)? {
                Control::Hello { peer } => peer,
                other => return Err(anyhow!("unexpected handshake opener: {other:?}")),
            };
            write_frame(stream, 0, &hs.public_bytes()).await?;
            let session = hs.into_session(&peer_key, role)?;
            let ack = session.seal(&encode_control(&Control::HelloAck { peer: me })?)?;
            write_frame(stream, 1, &ack).await?;
            (session, peer)
        }
    };

    state.log(
        LogLevel::Ok,
        "CRYPTO",
        format!(
            "X25519 ECDH with {} — AES-256-GCM session key derived (fp {})",
            peer.name, peer.fingerprint
        ),
    );
    Ok((session, peer))
}

async fn send_control(
    stream: &mut TcpStream,
    session: &Session,
    seq: u32,
    control: &Control,
) -> Result<()> {
    let sealed = session.seal(&encode_control(control)?)?;
    write_frame(stream, seq, &sealed).await
}

async fn recv_control(stream: &mut TcpStream, session: &Session) -> Result<Control> {
    let frame = read_frame(stream).await?;
    decode_control(&session.open(&frame.payload)?)
}

// ── outbound ────────────────────────────────────────────────────────────────

/// Probe used by "manual connect": handshake, read the peer card, hang up.
pub async fn probe_peer(state: Arc<AppState>, ip: &str, port: u16) -> Result<PeerInfo> {
    let mut stream = tokio::time::timeout(
        Duration::from_secs(4),
        TcpStream::connect(format!("{ip}:{port}")),
    )
    .await
    .map_err(|_| anyhow!("connection to {ip}:{port} timed out"))??;
    stream.set_nodelay(true)?;
    let (session, peer) = handshake(&mut stream, &state, Role::Initiator).await?;
    let _ = send_control(&mut stream, &session, 2, &Control::Bye).await;
    Ok(peer)
}

/// Queues a file set for one or more devices (broadcast = one task per device).
pub async fn enqueue_send(
    state: Arc<AppState>,
    device_ids: Vec<String>,
    files: Vec<PickedFile>,
) -> Result<Vec<String>> {
    let mut created = Vec::new();
    for device_id in device_ids {
        let Some(device) = state.device(&device_id).await else {
            continue;
        };
        let mut items = Vec::new();
        for file in &files {
            let item = TransferItem {
                id: new_id("tx"),
                name: file.name.clone(),
                path: file.path.clone(),
                size: file.size,
                transferred: 0,
                status: TransferStatus::Queued,
                direction: Direction::Send,
                device_id: device.id.clone(),
                device_name: device.name.clone(),
                speed: 0.0,
                compressed: false,
                resume_offset: 0,
                started_at: None,
                ended_at: None,
                error: None,
            };
            created.push(item.id.clone());
            items.push(item.clone());
            state.put_transfer(item).await;
        }

        let task_state = state.clone();
        let task_device = device.clone();
        tokio::spawn(async move {
            if let Err(err) = run_send_session(task_state.clone(), task_device.clone(), items.clone()).await {
                task_state.log(
                    LogLevel::Error,
                    "TX",
                    format!("session with {} failed: {err}", task_device.name),
                );
                for item in items {
                    task_state
                        .update_transfer(&item.id, |t| {
                            t.status = TransferStatus::Failed;
                            t.speed = 0.0;
                            t.error = Some(err.to_string());
                        })
                        .await;
                    task_state
                        .record_history(HistoryEntry {
                            id: new_id("h"),
                            ts: now_ms(),
                            device_id: task_device.id.clone(),
                            device_name: task_device.name.clone(),
                            file_name: item.name.clone(),
                            size: item.size,
                            duration_ms: 0,
                            status: HistoryStatus::Failed,
                        })
                        .await;
                }
                task_state.notify("error", "Transfer failed", &task_device.name);
            }
        });
    }
    Ok(created)
}

async fn run_send_session(
    state: Arc<AppState>,
    device: Device,
    items: Vec<TransferItem>,
) -> Result<()> {
    let settings = state.settings_snapshot().await;

    for item in &items {
        state
            .update_transfer(&item.id, |t| t.status = TransferStatus::Handshaking)
            .await;
    }

    let mut stream = TcpStream::connect(format!("{}:{}", device.ip, device.port)).await?;
    stream.set_nodelay(true)?;
    let (session, peer) = handshake(&mut stream, &state, Role::Initiator).await?;

    // Build the offer — file ids are content-derived so resume can match them.
    let mut offers = Vec::new();
    let mut by_file_id: HashMap<String, TransferItem> = HashMap::new();
    for item in &items {
        let file_id = file_identity(Path::new(&item.path), &item.name, item.size).await?;
        let compressed = settings.compression && is_compressible(&item.name);
        offers.push(FileOffer {
            file_id: file_id.clone(),
            name: item.name.clone(),
            rel_path: relative_path(&item.path, &item.name),
            size: item.size,
            compressed,
        });
        by_file_id.insert(file_id, item.clone());
    }
    let total_bytes: u64 = offers.iter().map(|f| f.size).sum();

    send_control(
        &mut stream,
        &session,
        2,
        &Control::Offer {
            files: offers.clone(),
            total_bytes,
        },
    )
    .await?;
    state.log(
        LogLevel::Info,
        "TX",
        format!(
            "offered {} file(s) ({}) to {} — awaiting consent",
            offers.len(),
            human_bytes(total_bytes),
            peer.name
        ),
    );

    // Receiver's Accept/Reject verdict.
    match recv_control(&mut stream, &session).await? {
        Control::Decision { accept: true, .. } => {}
        Control::Decision { accept: false, reason } => {
            let why = reason.unwrap_or_else(|| "rejected by peer".into());
            for item in &items {
                state
                    .update_transfer(&item.id, |t| {
                        t.status = TransferStatus::Skipped;
                        t.error = Some(why.clone());
                    })
                    .await;
            }
            state.log(LogLevel::Warn, "TX", format!("{} rejected the transfer", peer.name));
            state.notify("info", "Transfer rejected", &peer.name);
            return Ok(());
        }
        other => return Err(anyhow!("expected Decision, got {other:?}")),
    }

    // Resume offsets reported by the receiver.
    let resume: HashMap<String, u64> = match recv_control(&mut stream, &session).await? {
        Control::ResumeState { offsets } => offsets.into_iter().collect(),
        other => return Err(anyhow!("expected ResumeState, got {other:?}")),
    };

    let mut seq: u32 = 10;
    for offer in &offers {
        let item = by_file_id.get(&offer.file_id).expect("offer maps to an item");
        if state.is_item_cancelled(&item.id).await {
            continue;
        }
        let start_offset = if settings.resume_enabled {
            *resume.get(&offer.file_id).unwrap_or(&0)
        } else {
            0
        };
        if start_offset > 0 {
            state.log(
                LogLevel::Info,
                "TX",
                format!("resuming {} at {}", offer.name, human_bytes(start_offset)),
            );
        }

        send_control(
            &mut stream,
            &session,
            seq,
            &Control::FileStart {
                file_id: offer.file_id.clone(),
                offset: start_offset,
            },
        )
        .await?;
        seq += 1;

        let started = now_ms();
        state
            .update_transfer(&item.id, |t| {
                t.status = TransferStatus::Active;
                t.compressed = offer.compressed;
                t.transferred = start_offset;
                t.resume_offset = start_offset;
                t.started_at = Some(started);
            })
            .await;

        seq = stream_file(
            &state,
            &mut stream,
            &session,
            seq,
            item,
            offer,
            start_offset,
            &settings,
        )
        .await?;

        let duration = now_ms().saturating_sub(started);
        state
            .update_transfer(&item.id, |t| {
                t.status = TransferStatus::Done;
                t.transferred = t.size;
                t.speed = 0.0;
                t.ended_at = Some(now_ms());
            })
            .await;
        state
            .record_history(HistoryEntry {
                id: new_id("h"),
                ts: now_ms(),
                device_id: device.id.clone(),
                device_name: device.name.clone(),
                file_name: item.name.clone(),
                size: item.size,
                duration_ms: duration,
                status: HistoryStatus::Sent,
            })
            .await;
        state.log(LogLevel::Ok, "TX", format!("{} sent · CRC32 verified", item.name));
        state.notify("success", "Transfer complete", &format!("{} → {}", item.name, device.name));
    }

    send_control(&mut stream, &session, seq, &Control::Bye).await?;
    crate::tray::refresh_activity(&state).await;
    Ok(())
}

/// One prepared unit in the send pipeline.
enum Prepared {
    Chunk {
        offset: u64,
        payload: Vec<u8>,
        compressed: bool,
    },
    /// Emitted once the whole file has been read; carries the CRC32 of the
    /// *plaintext, uncompressed* bytes so the receiver can verify what it
    /// actually wrote to disk (including any resumed prefix).
    Eof { crc32: u32 },
}

#[allow(clippy::too_many_arguments)]
async fn stream_file(
    state: &Arc<AppState>,
    stream: &mut TcpStream,
    session: &Session,
    mut seq: u32,
    item: &TransferItem,
    offer: &FileOffer,
    start_offset: u64,
    settings: &Settings,
) -> Result<u32> {
    let mut file = File::open(&item.path).await?;

    // Prepared-chunk pipeline: reading + compressing runs up to
    // `concurrency` chunks ahead of the socket.
    let (tx, mut rx) = mpsc::channel::<Result<Prepared>>(settings.concurrency.max(1) as usize);
    let compress = offer.compressed;
    tokio::spawn(async move {
        let mut hasher = crc32fast::Hasher::new();
        let mut buffer = vec![0u8; CHUNK_SIZE];

        // Hash (but do not send) the prefix the receiver already has, so the
        // final CRC covers the complete file even on a resumed transfer.
        let mut consumed = 0u64;
        while consumed < start_offset {
            let want = (start_offset - consumed).min(CHUNK_SIZE as u64) as usize;
            match file.read(&mut buffer[..want]).await {
                Ok(0) => break,
                Ok(read) => {
                    hasher.update(&buffer[..read]);
                    consumed += read as u64;
                }
                Err(err) => {
                    let _ = tx.send(Err(anyhow!(err))).await;
                    return;
                }
            }
        }

        let mut offset = start_offset;
        loop {
            match file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(read) => {
                    let raw = &buffer[..read];
                    hasher.update(raw);
                    let (payload, did_compress) = if compress {
                        match zstd::encode_all(raw, 1) {
                            Ok(packed) if packed.len() < read => (packed, true),
                            _ => (raw.to_vec(), false),
                        }
                    } else {
                        (raw.to_vec(), false)
                    };
                    if tx
                        .send(Ok(Prepared::Chunk { offset, payload, compressed: did_compress }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                    offset += read as u64;
                }
                Err(err) => {
                    let _ = tx.send(Err(anyhow!(err))).await;
                    return;
                }
            }
        }
        let _ = tx.send(Ok(Prepared::Eof { crc32: hasher.finalize() })).await;
    });

    let mut throttle = Throttle::new(settings.bandwidth_limit_pct);
    let mut last_emit = Instant::now();
    let mut window_bytes = 0u64;
    let mut window_start = Instant::now();
    let mut file_crc = 0u32;

    while let Some(prepared) = rx.recv().await {
        match prepared? {
            Prepared::Eof { crc32 } => {
                file_crc = crc32;
                break;
            }
            Prepared::Chunk { offset, payload, compressed } => {
                if state.is_item_cancelled(&item.id).await {
                    return Err(anyhow!("cancelled by user"));
                }
                while state.is_item_paused(&item.id).await {
                    state
                        .update_transfer(&item.id, |t| {
                            t.status = TransferStatus::Paused;
                            t.speed = 0.0;
                        })
                        .await;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    if state.is_item_cancelled(&item.id).await {
                        return Err(anyhow!("cancelled while paused"));
                    }
                }

                send_control(
                    stream,
                    session,
                    seq,
                    &Control::Chunk {
                        file_id: offer.file_id.clone(),
                        offset,
                        len: payload.len() as u32,
                        compressed,
                    },
                )
                .await?;
                seq += 1;

                let sealed = session.seal(&payload)?;
                write_frame(stream, seq, &sealed).await?;
                seq += 1;

                let wire_len = payload.len() as u64;
                window_bytes += wire_len;
                throttle.consume(wire_len).await;

                if last_emit.elapsed() >= PROGRESS_EVERY {
                    let secs = window_start.elapsed().as_secs_f64().max(0.001);
                    let speed = window_bytes as f64 / secs;
                    // `offset` counts plaintext bytes, which is what the UI shows.
                    let transferred = (offset + CHUNK_SIZE as u64).min(item.size);
                    state
                        .update_transfer(&item.id, |t| {
                            t.status = TransferStatus::Active;
                            t.transferred = transferred;
                            t.speed = speed;
                        })
                        .await;
                    last_emit = Instant::now();
                    window_start = Instant::now();
                    window_bytes = 0;
                }
            }
        }
    }

    send_control(
        stream,
        session,
        seq,
        &Control::FileDone { file_id: offer.file_id.clone(), crc32: file_crc },
    )
    .await?;
    seq += 1;

    // Wait for the receiver's final ACK so "done" means "on their disk".
    loop {
        match recv_control(stream, session).await? {
            Control::Ack { offset, .. } if offset >= item.size => break,
            Control::Ack { offset, .. } => {
                state
                    .update_transfer(&item.id, |t| t.resume_offset = offset)
                    .await;
            }
            Control::Bye => break,
            _ => {}
        }
    }

    Ok(seq)
}

// ── inbound ─────────────────────────────────────────────────────────────────

/// Binds the TCP listener and serves inbound sessions until the app exits.
pub async fn serve(state: Arc<AppState>) -> Result<()> {
    let port = state.settings_snapshot().await.transfer_port;
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    state.log(
        LogLevel::Ok,
        "NET",
        format!("listening on 0.0.0.0:{port} (TCP, MLNK framing)"),
    );

    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(value) => value,
            Err(err) => {
                state.log(LogLevel::Error, "NET", format!("accept failed: {err}"));
                continue;
            }
        };
        let conn_state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_inbound(conn_state.clone(), stream, addr.to_string()).await {
                conn_state.log(
                    LogLevel::Error,
                    "RX",
                    format!("session with {addr} ended: {err}"),
                );
            }
        });
    }
}

async fn handle_inbound(state: Arc<AppState>, mut stream: TcpStream, addr: String) -> Result<()> {
    stream.set_nodelay(true)?;
    let ip = addr.split(':').next().unwrap_or("0.0.0.0").to_string();
    state.log(LogLevel::Info, "NET", format!("inbound connection from {addr}"));

    let (session, peer) = handshake(&mut stream, &state, Role::Responder).await?;

    let device = Device {
        id: peer.id.clone(),
        name: peer.name.clone(),
        ip: ip.clone(),
        port: peer.port,
        platform: match peer.platform.as_str() {
            "windows" => Platform::Windows,
            "macos" => Platform::Macos,
            _ => Platform::Linux,
        },
        link: LinkType::Ethernet,
        signal: 90,
        trusted: state
            .trusted
            .is_trusted_with_fingerprint(&peer.id, &peer.fingerprint),
        fingerprint: peer.fingerprint.clone(),
        last_seen: now_ms(),
    };
    state.upsert_device(device.clone()).await;

    // A bare probe (manual connect) hangs up right after the handshake.
    let offer = match recv_control(&mut stream, &session).await? {
        Control::Offer { files, total_bytes } => (files, total_bytes),
        Control::Clipboard { text } => {
            let item = ClipboardItem {
                id: new_id("clip"),
                ts: now_ms(),
                text,
                device_id: device.id.clone(),
                device_name: device.name.clone(),
                direction: Direction::Receive,
            };
            state.log(
                LogLevel::Ok,
                "CLIP",
                format!("received {} chars from {}", item.text.len(), device.name),
            );
            use tauri::Emitter;
            let _ = state.app.emit(events::CLIPBOARD_RECEIVED, item);
            return Ok(());
        }
        Control::Bye => return Ok(()),
        other => return Err(anyhow!("expected Offer, got {other:?}")),
    };
    let (files, total_bytes) = offer;

    // ── consent gate ────────────────────────────────────────────────────────
    let settings = state.settings_snapshot().await;
    let large = settings.confirm_large_transfers
        && total_bytes > settings.large_transfer_threshold_mb * 1024 * 1024;
    let trusted = state
        .trusted
        .is_trusted_with_fingerprint(&peer.id, &peer.fingerprint);

    let decision = if trusted && !large {
        state.log(
            LogLevel::Ok,
            "TRUST",
            format!("{} is trusted — consent prompt skipped", device.name),
        );
        state.trusted.touch(&peer.id);
        Decision { accept: true, trust: true }
    } else {
        request_consent(&state, &device, &files, total_bytes, large).await?
    };

    if !decision.accept {
        send_control(
            &mut stream,
            &session,
            2,
            &Control::Decision {
                accept: false,
                reason: Some("rejected by user".into()),
            },
        )
        .await?;
        for file in &files {
            state
                .record_history(HistoryEntry {
                    id: new_id("h"),
                    ts: now_ms(),
                    device_id: device.id.clone(),
                    device_name: device.name.clone(),
                    file_name: file.name.clone(),
                    size: file.size,
                    duration_ms: 0,
                    status: HistoryStatus::Skipped,
                })
                .await;
        }
        state.log(LogLevel::Warn, "TRUST", format!("rejected transfer from {}", device.name));
        return Ok(());
    }

    if decision.trust {
        state
            .trusted
            .trust(&peer.id, &peer.name, &peer.fingerprint);
        state.upsert_device(Device { trusted: true, ..device.clone() }).await;
    }

    send_control(
        &mut stream,
        &session,
        2,
        &Control::Decision { accept: true, reason: None },
    )
    .await?;

    // ── resume negotiation ──────────────────────────────────────────────────
    let download_dir = PathBuf::from(&settings.download_dir);
    tokio::fs::create_dir_all(&download_dir).await.ok();

    let mut offsets = Vec::new();
    let mut items: HashMap<String, TransferItem> = HashMap::new();
    for file in &files {
        let part = part_path(&download_dir, &file.name);
        let have = if settings.resume_enabled {
            tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        offsets.push((file.file_id.clone(), have));

        let item = TransferItem {
            id: new_id("rx"),
            name: file.name.clone(),
            path: download_dir.join(&file.name).to_string_lossy().to_string(),
            size: file.size,
            transferred: have,
            status: TransferStatus::Queued,
            direction: Direction::Receive,
            device_id: device.id.clone(),
            device_name: device.name.clone(),
            speed: 0.0,
            compressed: file.compressed,
            resume_offset: have,
            started_at: None,
            ended_at: None,
            error: None,
        };
        state.put_transfer(item.clone()).await;
        items.insert(file.file_id.clone(), item);
    }

    send_control(&mut stream, &session, 3, &Control::ResumeState { offsets }).await?;

    // ── receive loop ────────────────────────────────────────────────────────
    let mut seq: u32 = 100;
    let mut current: Option<(String, File, u64, crc32fast::Hasher, u64, Instant, u64, Instant)> = None;
    // (file_id, handle, written, hasher, last_ack, last_emit, window_bytes, window_start)

    loop {
        let control = match recv_control(&mut stream, &session).await {
            Ok(control) => control,
            Err(err) => {
                // A dropped connection is normal — the offsets on disk let the
                // sender resume later.
                if let Some((file_id, _, written, _, _, _, _, _)) = current.take() {
                    if let Some(item) = items.get(&file_id) {
                        state
                            .update_transfer(&item.id, |t| {
                                t.status = TransferStatus::Paused;
                                t.speed = 0.0;
                                t.resume_offset = written;
                            })
                            .await;
                    }
                }
                return Err(err);
            }
        };

        match control {
            Control::FileStart { file_id, offset } => {
                let Some(item) = items.get(&file_id) else { continue };
                let part = part_path(&download_dir, &item.name);
                let mut handle = OpenOptions::new()
                    .create(true)
                    .read(true)
                    .write(true)
                    .open(&part)
                    .await?;
                handle.set_len(offset).await.ok();
                handle.seek(std::io::SeekFrom::Start(offset)).await?;

                // Re-hash what we already have so the final CRC still matches.
                let mut hasher = crc32fast::Hasher::new();
                if offset > 0 {
                    let mut replay = File::open(&part).await?;
                    let mut buffer = vec![0u8; CHUNK_SIZE];
                    let mut remaining = offset;
                    while remaining > 0 {
                        let want = remaining.min(CHUNK_SIZE as u64) as usize;
                        let read = replay.read(&mut buffer[..want]).await?;
                        if read == 0 {
                            break;
                        }
                        hasher.update(&buffer[..read]);
                        remaining -= read as u64;
                    }
                }

                state
                    .update_transfer(&item.id, |t| {
                        t.status = TransferStatus::Active;
                        t.started_at = Some(now_ms());
                        t.transferred = offset;
                    })
                    .await;
                state.log(
                    LogLevel::Info,
                    "RX",
                    format!("receiving {} from {} at offset {}", item.name, device.name, offset),
                );
                current = Some((
                    file_id,
                    handle,
                    offset,
                    hasher,
                    offset,
                    Instant::now(),
                    0,
                    Instant::now(),
                ));
            }

            Control::Chunk { file_id, offset, len: _, compressed } => {
                let frame = read_frame(&mut stream).await?;
                let payload = session.open(&frame.payload)?;
                let bytes = if compressed {
                    zstd::decode_all(payload.as_slice())?
                } else {
                    payload
                };

                let Some((cur_id, handle, written, hasher, last_ack, last_emit, window_bytes, window_start)) =
                    current.as_mut()
                else {
                    continue;
                };
                if *cur_id != file_id {
                    continue;
                }
                if offset != *written {
                    handle.seek(std::io::SeekFrom::Start(offset)).await?;
                    *written = offset;
                }

                handle.write_all(&bytes).await?;
                hasher.update(&bytes);
                *written += bytes.len() as u64;
                *window_bytes += bytes.len() as u64;

                if *written - *last_ack >= ACK_EVERY_BYTES {
                    handle.flush().await?;
                    send_control(
                        &mut stream,
                        &session,
                        seq,
                        &Control::Ack { file_id: file_id.clone(), offset: *written },
                    )
                    .await?;
                    seq += 1;
                    *last_ack = *written;
                }

                if last_emit.elapsed() >= PROGRESS_EVERY {
                    if let Some(item) = items.get(&file_id) {
                        let secs = window_start.elapsed().as_secs_f64().max(0.001);
                        let speed = *window_bytes as f64 / secs;
                        let transferred = *written;
                        state
                            .update_transfer(&item.id, |t| {
                                t.transferred = transferred;
                                t.resume_offset = transferred;
                                t.speed = speed;
                                t.status = TransferStatus::Active;
                            })
                            .await;
                    }
                    *last_emit = Instant::now();
                    *window_start = Instant::now();
                    *window_bytes = 0;
                }
            }

            Control::FileDone { file_id, crc32 } => {
                let Some((cur_id, mut handle, written, hasher, _, _, _, _)) = current.take() else {
                    continue;
                };
                if cur_id != file_id {
                    continue;
                }
                handle.flush().await?;
                drop(handle);

                let actual = hasher.finalize();
                let Some(item) = items.get(&file_id).cloned() else { continue };
                let part = part_path(&download_dir, &item.name);
                let final_path = unique_path(&download_dir, &item.name).await;

                if actual != crc32 {
                    state.log(
                        LogLevel::Error,
                        "RX",
                        format!("{} CRC mismatch — keeping partial for resume", item.name),
                    );
                    state
                        .update_transfer(&item.id, |t| {
                            t.status = TransferStatus::Failed;
                            t.error = Some("CRC32 mismatch".into());
                            t.speed = 0.0;
                        })
                        .await;
                    state
                        .record_history(HistoryEntry {
                            id: new_id("h"),
                            ts: now_ms(),
                            device_id: device.id.clone(),
                            device_name: device.name.clone(),
                            file_name: item.name.clone(),
                            size: item.size,
                            duration_ms: 0,
                            status: HistoryStatus::Failed,
                        })
                        .await;
                    continue;
                }

                tokio::fs::rename(&part, &final_path).await?;
                send_control(
                    &mut stream,
                    &session,
                    seq,
                    &Control::Ack { file_id: file_id.clone(), offset: written },
                )
                .await?;
                seq += 1;

                let duration = now_ms().saturating_sub(item.started_at.unwrap_or(now_ms()));
                state
                    .update_transfer(&item.id, |t| {
                        t.status = TransferStatus::Done;
                        t.transferred = t.size.max(written);
                        t.speed = 0.0;
                        t.ended_at = Some(now_ms());
                        t.path = final_path.to_string_lossy().to_string();
                    })
                    .await;
                state
                    .record_history(HistoryEntry {
                        id: new_id("h"),
                        ts: now_ms(),
                        device_id: device.id.clone(),
                        device_name: device.name.clone(),
                        file_name: item.name.clone(),
                        size: item.size,
                        duration_ms: duration,
                        status: HistoryStatus::Received,
                    })
                    .await;
                state.log(LogLevel::Ok, "RX", format!("{} received · CRC32 ok", item.name));
                state.notify("success", "File received", &format!("{} ← {}", item.name, device.name));
                crate::tray::refresh_activity(&state).await;
            }

            Control::Bye => break,
            _ => {}
        }
    }

    Ok(())
}

async fn request_consent(
    state: &Arc<AppState>,
    device: &Device,
    files: &[FileOffer],
    total_bytes: u64,
    large: bool,
) -> Result<Decision> {
    use tauri::Emitter;

    let request = ConsentRequest {
        id: new_id("consent"),
        device: device.clone(),
        file_count: files.len(),
        total_bytes,
        preview: files.iter().take(8).map(|f| f.name.clone()).collect(),
        ts: now_ms(),
        large,
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<Decision>();
    state
        .pending_consent
        .lock()
        .await
        .insert(request.id.clone(), tx);

    let _ = state.app.emit(events::CONSENT_REQUESTED, request.clone());
    state.notify(
        "request",
        "Incoming transfer request",
        &format!("{} wants to send {} file(s)", device.name, files.len()),
    );
    state.log(
        LogLevel::Warn,
        "TRUST",
        format!("consent required for {} ({})", device.name, human_bytes(total_bytes)),
    );

    // No answer within two minutes = reject, so a forgotten prompt can't hold
    // a socket open forever.
    let decision = match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(decision)) => decision,
        _ => Decision { accept: false, trust: false },
    };
    state.pending_consent.lock().await.remove(&request.id);
    let _ = state.app.emit(events::CONSENT_RESOLVED, request.id);
    Ok(decision)
}

// ── clipboard relay ─────────────────────────────────────────────────────────

pub async fn send_clipboard_text(
    state: Arc<AppState>,
    device_id: String,
    text: String,
) -> Result<ClipboardItem> {
    let device = state
        .device(&device_id)
        .await
        .ok_or_else(|| anyhow!("unknown device {device_id}"))?;

    let mut stream = TcpStream::connect(format!("{}:{}", device.ip, device.port)).await?;
    stream.set_nodelay(true)?;
    let (session, _peer) = handshake(&mut stream, &state, Role::Initiator).await?;
    send_control(&mut stream, &session, 2, &Control::Clipboard { text: text.clone() }).await?;
    let _ = send_control(&mut stream, &session, 3, &Control::Bye).await;

    state.log(
        LogLevel::Ok,
        "CLIP",
        format!("sent {} chars to {} (encrypted)", text.len(), device.name),
    );

    Ok(ClipboardItem {
        id: new_id("clip"),
        ts: now_ms(),
        text,
        device_id: device.id,
        device_name: device.name,
        direction: Direction::Send,
    })
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn part_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{PART_SUFFIX}"))
}

/// Never silently overwrite: `report.pdf` → `report (1).pdf`.
async fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if tokio::fs::metadata(&candidate).await.is_err() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) => (stem.to_string(), format!(".{ext}")),
        None => (name.to_string(), String::new()),
    };
    for n in 1..1000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if tokio::fs::metadata(&candidate).await.is_err() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}{ext}", now_ms()))
}

fn relative_path(path: &str, name: &str) -> String {
    path.strip_suffix(name)
        .map(|prefix| prefix.trim_end_matches(['/', '\\']).to_string())
        .unwrap_or_default()
}

/// Content-derived id: name + size + first/last 1 MiB. Cheap, and stable
/// enough to match "the same file" across a reconnect.
async fn file_identity(path: &Path, name: &str, size: u64) -> Result<String> {
    let sample = (1024 * 1024).min(size as usize);
    let mut head = vec![0u8; sample];
    let mut tail = vec![0u8; sample];

    if let Ok(mut file) = File::open(path).await {
        let _ = file.read_exact(&mut head).await;
        if size > sample as u64 {
            file.seek(std::io::SeekFrom::End(-(sample as i64))).await.ok();
            let _ = file.read_exact(&mut tail).await;
        }
    }
    Ok(quick_file_id(name, size, &head, &tail))
}

pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/// `stat` for paths chosen in the native file dialog (expands directories).
pub fn stat_paths(paths: Vec<String>) -> Vec<PickedFile> {
    let mut out = Vec::new();
    for raw in paths {
        let path = PathBuf::from(&raw);
        if path.is_dir() {
            collect_dir(&path, &path, &mut out);
        } else if let Ok(meta) = std::fs::metadata(&path) {
            out.push(PickedFile {
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or(raw.clone()),
                path: raw,
                size: meta.len(),
            });
        }
    }
    out
}

fn collect_dir(root: &Path, dir: &Path, out: &mut Vec<PickedFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_dir(root, &path, out);
        } else if let Ok(meta) = entry.metadata() {
            let rel = path
                .strip_prefix(root.parent().unwrap_or(root))
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            out.push(PickedFile {
                name: rel,
                path: path.to_string_lossy().to_string(),
                size: meta.len(),
            });
        }
    }
}
