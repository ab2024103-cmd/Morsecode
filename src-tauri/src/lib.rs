//! MorseCode core.
//!
//! Everything here runs locally: an mDNS/UDP discovery service, an encrypted
//! TCP transfer engine, a SQLite history log and a trusted-device store.
//! There is no HTTP client in the dependency graph — the app is fully
//! functional air-gapped (LAN only).

pub mod clipboard;
pub mod commands;
pub mod crypto;
pub mod discovery;
pub mod history;
pub mod model;
pub mod protocol;
pub mod state;
pub mod transfer;
pub mod trusted;
pub mod tray;

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::{Manager, WindowEvent};

use crate::model::LogLevel;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = AppState::new(handle.clone())?;
            app.manage(state.clone());

            tray::setup(&handle)?;

            state.log(LogLevel::Info, "CORE", "MorseCode core starting");
            state.log(
                LogLevel::Info,
                "CORE",
                format!("identity {} · fingerprint {}", state.identity.id, state.identity.fingerprint),
            );

            // TCP listener for inbound transfers and clipboard pushes.
            let serve_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = transfer::serve(serve_state.clone()).await {
                    serve_state.log(LogLevel::Error, "NET", format!("listener stopped: {err}"));
                }
            });

            // LAN discovery (mDNS + UDP broadcast).
            let discovery_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if discovery_state.settings_snapshot().await.discovery_enabled {
                    if let Err(err) = discovery::start(discovery_state.clone()).await {
                        discovery_state.log(LogLevel::Error, "MDNS", format!("discovery failed: {err}"));
                    }
                }
            });

            // Tray activity indicator refresh.
            let tray_state = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(900)).await;
                    tray::refresh_activity(&tray_state).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the core alive in the tray (when the
            // user has that enabled) so transfers continue in the background.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let minimize_to_tray = app
                    .try_state::<Arc<AppState>>()
                    .map(|state| state.minimize_to_tray.load(Ordering::SeqCst))
                    .unwrap_or(true);
                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_core,
            commands::start_discovery,
            commands::stop_discovery,
            commands::list_devices,
            commands::manual_connect,
            commands::stat_paths,
            commands::enqueue_send,
            commands::list_transfers,
            commands::pause_transfer,
            commands::resume_transfer,
            commands::cancel_transfer,
            commands::pause_all,
            commands::resume_all,
            commands::clear_completed,
            commands::respond_consent,
            commands::list_trusted,
            commands::trust_device,
            commands::revoke_trust,
            commands::send_clipboard,
            commands::list_history,
            commands::clear_history,
            commands::export_history_csv,
            commands::load_settings,
            commands::save_settings,
            commands::host_info,
            commands::quit_app,
            commands::simulate_incoming,
            commands::reveal_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MorseCode");
}
