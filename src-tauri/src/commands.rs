//! Tauri command surface — the exact mirror of `src/ipc/commands.ts`.
//!
//! Tauri v2 converts camelCase JS arguments to snake_case Rust parameters, so
//! `invoke('manual_connect', { ip, port })` lands here unchanged.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::model::*;
use crate::state::{AppState, Decision};
use crate::{discovery, transfer};

type Shared<'a> = State<'a, Arc<AppState>>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn start_core(state: Shared<'_>) -> Result<(), String> {
    let inner = state.inner().clone();
    inner.log(LogLevel::Info, "CORE", "frontend attached to the Rust core");
    discovery::start(inner).await.map_err(err)
}

#[tauri::command]
pub async fn start_discovery(state: Shared<'_>) -> Result<(), String> {
    let inner = state.inner().clone();
    inner.discovery_running.store(false, Ordering::SeqCst); // force a restart
    discovery::start(inner).await.map_err(err)
}

#[tauri::command]
pub async fn stop_discovery(state: Shared<'_>) -> Result<(), String> {
    discovery::stop(state.inner());
    Ok(())
}

#[tauri::command]
pub async fn list_devices(state: Shared<'_>) -> Result<Vec<Device>, String> {
    Ok(state.devices.read().await.values().cloned().collect())
}

#[tauri::command]
pub async fn manual_connect(state: Shared<'_>, ip: String, port: u16) -> Result<Device, String> {
    discovery::probe(state.inner().clone(), ip, port)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn stat_paths(paths: Vec<String>) -> Result<Vec<PickedFile>, String> {
    Ok(transfer::stat_paths(paths))
}

#[tauri::command]
pub async fn enqueue_send(
    state: Shared<'_>,
    device_ids: Vec<String>,
    files: Vec<PickedFile>,
) -> Result<Vec<String>, String> {
    transfer::enqueue_send(state.inner().clone(), device_ids, files)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn list_transfers(state: Shared<'_>) -> Result<Vec<TransferItem>, String> {
    Ok(state.transfers.read().await.values().cloned().collect())
}

#[tauri::command]
pub async fn pause_transfer(state: Shared<'_>, id: String) -> Result<(), String> {
    state.paused_items.write().await.insert(id.clone(), true);
    state
        .update_transfer(&id, |t| {
            t.status = TransferStatus::Paused;
            t.speed = 0.0;
        })
        .await;
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer(state: Shared<'_>, id: String) -> Result<(), String> {
    state.paused_items.write().await.insert(id.clone(), false);
    match state.transfer(&id).await {
        // A failed item has no live session left polling the pause flag —
        // setting it back to "queued" would leave it stuck forever. Spawn a
        // fresh session instead; the receiver's .mcpart offsets resume it.
        Some(item) if matches!(item.status, TransferStatus::Failed) => {
            if matches!(item.direction, Direction::Send) {
                transfer::retry_send(state.inner().clone(), id)
                    .await
                    .map_err(err)
            } else {
                state.log(
                    LogLevel::Warn,
                    "RX",
                    "a failed download can only be retried from the sending device",
                );
                Ok(())
            }
        }
        // Paused with a live session: the streaming loop picks it up.
        _ => {
            state
                .update_transfer(&id, |t| t.status = TransferStatus::Queued)
                .await;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn cancel_transfer(state: Shared<'_>, id: String) -> Result<(), String> {
    state.cancelled_items.write().await.insert(id.clone(), true);
    state.remove_transfer(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn pause_all(state: Shared<'_>) -> Result<(), String> {
    state.paused_all.store(true, Ordering::SeqCst);
    state.log(LogLevel::Warn, "TX", "all transfers paused");
    Ok(())
}

#[tauri::command]
pub async fn resume_all(state: Shared<'_>) -> Result<(), String> {
    state.paused_all.store(false, Ordering::SeqCst);
    state.paused_items.write().await.clear();
    state.log(LogLevel::Info, "TX", "transfers resumed");
    Ok(())
}

#[tauri::command]
pub async fn clear_completed(state: Shared<'_>) -> Result<(), String> {
    let finished: Vec<String> = state
        .transfers
        .read()
        .await
        .values()
        .filter(|t| {
            matches!(
                t.status,
                TransferStatus::Done | TransferStatus::Failed | TransferStatus::Skipped
            )
        })
        .map(|t| t.id.clone())
        .collect();
    for id in finished {
        state.remove_transfer(&id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn respond_consent(
    state: Shared<'_>,
    request_id: String,
    accept: bool,
    trust: bool,
) -> Result<(), String> {
    let sender = state.pending_consent.lock().await.remove(&request_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(Decision { accept, trust });
            Ok(())
        }
        None => Err("consent request already resolved or expired".into()),
    }
}

#[tauri::command]
pub async fn list_trusted(state: Shared<'_>) -> Result<Vec<String>, String> {
    Ok(state.trusted.ids())
}

#[tauri::command]
pub async fn trust_device(state: Shared<'_>, device_id: String) -> Result<(), String> {
    let device = state.device(&device_id).await.ok_or("unknown device")?;
    state
        .trusted
        .trust(&device.id, &device.name, &device.fingerprint);
    state
        .upsert_device(Device { trusted: true, ..device.clone() })
        .await;
    state.log(LogLevel::Ok, "TRUST", format!("{} trusted", device.name));
    Ok(())
}

#[tauri::command]
pub async fn revoke_trust(state: Shared<'_>, device_id: String) -> Result<(), String> {
    state.trusted.revoke(&device_id);
    if let Some(device) = state.device(&device_id).await {
        state
            .upsert_device(Device { trusted: false, ..device.clone() })
            .await;
        state.log(LogLevel::Warn, "TRUST", format!("{} revoked", device.name));
    }
    Ok(())
}

#[tauri::command]
pub async fn send_clipboard(
    state: Shared<'_>,
    device_id: String,
    text: String,
) -> Result<ClipboardItem, String> {
    crate::clipboard::send(state.inner().clone(), device_id, text)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn list_history(state: Shared<'_>) -> Result<Vec<HistoryEntry>, String> {
    state.history.list(1000).map_err(err)
}

#[tauri::command]
pub async fn clear_history(state: Shared<'_>) -> Result<(), String> {
    state.history.clear().map_err(err)?;
    state.log(LogLevel::Warn, "DB", "transfer history cleared");
    Ok(())
}

#[tauri::command]
pub async fn export_history_csv(state: Shared<'_>, csv: String) -> Result<String, String> {
    let dir = std::path::PathBuf::from(state.settings_snapshot().await.download_dir);
    let path = state.history.export_csv(&csv, &dir).map_err(err)?;
    state.log(
        LogLevel::Ok,
        "DB",
        format!("history exported to {}", path.display()),
    );
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn load_settings(state: Shared<'_>) -> Result<Settings, String> {
    Ok(state.settings_snapshot().await)
}

#[tauri::command]
pub async fn save_settings(state: Shared<'_>, settings: Settings) -> Result<(), String> {
    let restart_discovery = {
        let current = state.settings.read().await;
        current.scan_interval_ms != settings.scan_interval_ms
            || current.mdns_enabled != settings.mdns_enabled
            || current.udp_fallback_enabled != settings.udp_fallback_enabled
            || current.discovery_enabled != settings.discovery_enabled
    };

    std::fs::create_dir_all(&settings.download_dir).ok();
    state
        .minimize_to_tray
        .store(settings.minimize_to_tray, Ordering::SeqCst);
    *state.settings.write().await = settings.clone();
    state.persist_settings(&settings).await;

    if restart_discovery {
        discovery::stop(state.inner());
        if settings.discovery_enabled {
            let _ = discovery::start(state.inner().clone()).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn host_info(state: Shared<'_>) -> Result<HostInfo, String> {
    let settings = state.settings_snapshot().await;
    Ok(HostInfo {
        hostname: settings.device_name,
        ip: discovery::local_ip(),
        platform: format!("{:?}", Platform::current()).to_lowercase(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        runtime: "tauri".into(),
    })
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Debug helper mirrored by the browser mock — emits a synthetic consent
/// request so the modal can be exercised without a second machine.
#[tauri::command]
pub async fn simulate_incoming(state: Shared<'_>) -> Result<(), String> {
    use tauri::Emitter;
    let device = state
        .devices
        .read()
        .await
        .values()
        .next()
        .cloned()
        .ok_or("no peers discovered yet")?;
    let request = ConsentRequest {
        id: new_id("consent"),
        device,
        file_count: 1,
        total_bytes: 184 * 1024 * 1024,
        preview: vec!["field-recording-04.wav".into()],
        ts: now_ms(),
        large: false,
    };
    let (tx, _rx) = tokio::sync::oneshot::channel::<Decision>();
    state
        .pending_consent
        .lock()
        .await
        .insert(request.id.clone(), tx);
    state
        .app
        .emit(crate::state::events::CONSENT_REQUESTED, request)
        .map_err(err)
}

/// Absolute path of the startup/diagnostics log, shown in Settings.
#[tauri::command]
pub async fn diagnostics_log_path() -> Result<String, String> {
    Ok(crate::diag::log_path().to_string_lossy().to_string())
}

/// Opens the diagnostics log in the OS file manager / default text editor.
#[tauri::command]
pub async fn open_diagnostics_log(app: AppHandle) -> Result<(), String> {
    let path = crate::diag::log_path();
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|err| format!("could not open {}: {err}", path.display()))
}

/// Reveals the download folder in the OS file manager.
#[tauri::command]
pub async fn reveal_downloads(app: AppHandle, state: Shared<'_>) -> Result<(), String> {
    let dir = state.settings_snapshot().await.download_dir;
    let _ = app.opener().reveal_item_in_dir(dir);
    Ok(())
}
