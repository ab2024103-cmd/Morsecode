//! System tray: quick actions (Open / Pause all / Quit), background operation
//! and a subtle activity indicator while transfers are running.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::model::{LogLevel, TransferStatus};
use crate::state::{events, AppState};

pub const TRAY_ID: &str = "morsecode-tray";

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "Open MorseCode", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "tray-pause", "Pause all transfers", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "tray-resume", "Resume all transfers", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &resume,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("MorseCode — idle");

    // The tray mark is the app logo, generated from logo.png.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main(app),
            "tray-pause" => {
                let _ = app.emit(events::TRAY_ACTION, "pause-all");
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.paused_all.store(true, Ordering::SeqCst);
                    state.log(LogLevel::Warn, "TRAY", "all transfers paused");
                }
            }
            "tray-resume" => {
                let _ = app.emit(events::TRAY_ACTION, "resume-all");
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.paused_all.store(false, Ordering::SeqCst);
                    state.log(LogLevel::Info, "TRAY", "transfers resumed");
                }
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Reflects live transfer activity in the tray tooltip (and, on platforms that
/// support it, the tray title) — the "subtle activity indicator".
pub async fn refresh_activity(state: &Arc<AppState>) {
    let transfers = state.transfers.read().await;
    let active: Vec<_> = transfers
        .values()
        .filter(|t| t.status == TransferStatus::Active)
        .collect();
    let speed: f64 = active.iter().map(|t| t.speed).sum();
    let tooltip = if active.is_empty() {
        "MorseCode — idle".to_string()
    } else {
        format!(
            "MorseCode — {} transfer(s) · {:.1} MB/s",
            active.len(),
            speed / (1024.0 * 1024.0)
        )
    };
    drop(transfers);

    if let Some(tray) = state.app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&tooltip));
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(Some(if tooltip.contains("idle") { "" } else { "●" }));
    }
}
