//! MorseCode core.
//!
//! Everything here runs locally: an mDNS/UDP discovery service, an encrypted
//! TCP transfer engine, a SQLite history log and a trusted-device store.
//! There is no HTTP client in the dependency graph — the app is fully
//! functional air-gapped (LAN only).

pub mod clipboard;
pub mod commands;
pub mod diag;
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

use tauri::{Manager, RunEvent, WindowEvent, WebviewUrl, WebviewWindowBuilder};

use crate::model::LogLevel;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diag::init();

    // `MorseCode --doctor` prints an environment report (webview, ports,
    // interfaces, firewall, log tail) and exits — one file to send when
    // something is wrong on a machine I cannot reach.
    if std::env::args().any(|arg| arg == "--doctor") {
        diag::run_doctor();
        return;
    }

    // The single most common silent-launch-failure on Windows: no Edge
    // WebView2 runtime, so the webview cannot be created and the process dies
    // before drawing anything. Check first and say so out loud.
    match diag::webview_available() {
        Ok(version) => diag::log("webview", format!("runtime {version}")),
        Err(err) => {
            diag::log("webview", format!("unavailable: {err}"));
            #[cfg(windows)]
            {
                diag::fatal(
                    "MorseCode needs the Microsoft Edge WebView2 runtime",
                    "MorseCode draws its interface with the Microsoft Edge WebView2 runtime, \
                     which is missing on this PC.\n\n\
                     Install \"Microsoft Edge WebView2 Runtime\" (Evergreen Standalone Installer) \
                     and start MorseCode again. On a machine with no internet access, download it \
                     on another PC and copy the installer across, or use the \
                     MorseCode setup build that bundles the runtime offline.",
                );
                return;
            }
        }
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            diag::log("setup", "begin");
            let handle = app.handle().clone();
            let state = AppState::new(handle.clone());
            app.manage(state.clone());
            diag::log("setup", "state ready");

            // The window must appear even if a background subsystem is broken,
            // so nothing below this point is allowed to abort startup.
            match app.get_webview_window("main") {
                Some(window) => {
                    let _ = window.show();
                    let _ = window.set_focus();
                    diag::log(
                        "setup",
                        format!(
                            "main window shown (visible={:?})",
                            window.is_visible().unwrap_or(false)
                        ),
                    );
                }
                None => {
                    diag::log("setup", "main window missing — creating it");
                    match WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("MorseCode")
                        .inner_size(1400.0, 900.0)
                        .min_inner_size(1100.0, 700.0)
                        .decorations(false)
                        .center()
                        .build()
                    {
                        Ok(_) => diag::log("setup", "fallback window created"),
                        Err(err) => diag::fatal(
                            "MorseCode could not open its window",
                            &format!("The application window failed to start: {err}"),
                        ),
                    }
                }
            }

            if let Err(err) = tray::setup(&handle) {
                // A missing tray is survivable; dying at launch is not.
                diag::log("tray", format!("tray unavailable: {err}"));
            } else {
                diag::log("setup", "tray ready");
            }

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

            diag::log("setup", "done");
            Ok(())
        })
        // If the UI bundle fails to load the window is blank rather than
        // absent — that looks identical to a crash from the outside, so record
        // it too.
        .on_page_load(|window, payload| {
            diag::log(
                "webview",
                format!("{:?} {} ({})", payload.event(), payload.url(), window.label()),
            );
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
            commands::diagnostics_log_path,
            commands::open_diagnostics_log,
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => {
            diag::log("run", "event loop starting");
            app.run(|_handle, event| match event {
                RunEvent::ExitRequested { .. } => diag::log("run", "exit requested"),
                RunEvent::Exit => diag::log("run", "exit"),
                _ => {}
            });
        }
        Err(err) => diag::fatal(
            "MorseCode failed to start",
            &format!("The application could not be initialised: {err}"),
        ),
    }
}
