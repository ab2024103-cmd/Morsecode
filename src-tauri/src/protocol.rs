//! MorseCode wire protocol.
//!
//! Framing (identical in both directions):
//!
//! ```text
//! [4B magic "MLNK"] [4B seq u32 BE] [4B len u32 BE] [payload len bytes] [4B CRC32 BE]
//! ```
//!
//! `payload` is the AES-256-GCM sealed blob produced by [`crate::crypto::Session`]
//! for every frame after the handshake; the two handshake frames carry plain
//! X25519 public keys (which are public by definition).

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const MAGIC: [u8; 4] = *b"MLNK";
/// 256 KiB payload chunks — big enough to saturate gigabit, small enough that
/// nothing is ever fully buffered in memory.
pub const CHUNK_SIZE: usize = 256 * 1024;
/// Hard cap so a malicious peer cannot make us allocate arbitrarily.
pub const MAX_FRAME: usize = CHUNK_SIZE * 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub fingerprint: String,
    pub port: u16,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOffer {
    /// Stable id used for resume matching.
    pub file_id: String,
    pub name: String,
    /// Path relative to the dropped folder root ("" for loose files).
    pub rel_path: String,
    pub size: u64,
    pub compressed: bool,
}

/// Control messages. Data chunks travel as [`Control::Chunk`] headers followed
/// by a raw sealed payload frame, so the JSON layer never carries file bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Control {
    Hello {
        peer: PeerInfo,
    },
    HelloAck {
        peer: PeerInfo,
    },
    Offer {
        files: Vec<FileOffer>,
        total_bytes: u64,
    },
    /// Receiver's verdict — mirrors the Accept/Reject modal.
    Decision {
        accept: bool,
        reason: Option<String>,
    },
    /// Receiver reports what it already has, per file id, so the sender seeks.
    ResumeState {
        offsets: Vec<(String, u64)>,
    },
    FileStart {
        file_id: String,
        offset: u64,
    },
    /// Header for the sealed data frame that immediately follows.
    Chunk {
        file_id: String,
        offset: u64,
        len: u32,
        compressed: bool,
    },
    /// Periodic acknowledgement with the last byte safely on disk.
    Ack {
        file_id: String,
        offset: u64,
    },
    FileDone {
        file_id: String,
        crc32: u32,
    },
    Clipboard {
        text: String,
    },
    Bye,
}

pub fn encode_control(control: &Control) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(control)?)
}

pub fn decode_control(bytes: &[u8]) -> Result<Control> {
    Ok(serde_json::from_slice(bytes)?)
}

pub async fn write_frame<W>(writer: &mut W, seq: u32, payload: &[u8]) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    if payload.len() > MAX_FRAME {
        return Err(anyhow!("frame too large: {} bytes", payload.len()));
    }
    let crc = crc32fast::hash(payload);
    let mut header = Vec::with_capacity(12);
    header.extend_from_slice(&MAGIC);
    header.extend_from_slice(&seq.to_be_bytes());
    header.extend_from_slice(&(payload.len() as u32).to_be_bytes());

    writer.write_all(&header).await?;
    writer.write_all(payload).await?;
    writer.write_all(&crc.to_be_bytes()).await?;
    writer.flush().await?;
    Ok(())
}

pub struct Frame {
    pub seq: u32,
    pub payload: Vec<u8>,
}

pub async fn read_frame<R>(reader: &mut R) -> Result<Frame>
where
    R: AsyncReadExt + Unpin,
{
    let mut header = [0u8; 12];
    reader.read_exact(&mut header).await?;
    if header[..4] != MAGIC {
        return Err(anyhow!("bad magic — not a MorseCode stream"));
    }
    let seq = u32::from_be_bytes(header[4..8].try_into().unwrap());
    let len = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
    if len > MAX_FRAME {
        return Err(anyhow!("declared frame length {len} exceeds limit"));
    }

    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await?;

    let mut crc_bytes = [0u8; 4];
    reader.read_exact(&mut crc_bytes).await?;
    let expected = u32::from_be_bytes(crc_bytes);
    let actual = crc32fast::hash(&payload);
    if expected != actual {
        return Err(anyhow!("CRC32 mismatch: expected {expected:08x}, got {actual:08x}"));
    }

    Ok(Frame { seq, payload })
}

/// Types the sender compresses on the fly when the setting is enabled.
pub fn is_compressible(name: &str) -> bool {
    const EXT: [&str; 18] = [
        "txt", "csv", "tsv", "json", "xml", "svg", "log", "md", "yml", "yaml", "sql", "html",
        "css", "js", "ts", "c", "rs", "parquet",
    ];
    name.rsplit('.')
        .next()
        .map(|ext| EXT.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
