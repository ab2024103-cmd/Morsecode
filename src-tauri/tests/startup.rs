//! Startup regression tests.
//!
//! v1.0.0 shipped with `plugins.dialog = {}` in tauri.conf.json. The dialog
//! plugin's config type is a unit, so deserialization failed, plugin
//! initialization returned an error, and the app exited before drawing a
//! window — invisibly, because a GUI-subsystem binary has no console.
//!
//! These tests build the real application (real config, real plugins) on a
//! mock runtime, so any configuration or plugin-init regression fails in CI
//! instead of on a user's desktop.

use tauri::test::{mock_builder, MockRuntime};
use tauri::Builder;

fn app() -> Builder<MockRuntime> {
    mock_builder()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
}

#[test]
fn application_initialises_with_the_shipped_configuration() {
    let app = app()
        .build(tauri::generate_context!())
        .expect("the app must initialise with the bundled tauri.conf.json");
    drop(app);
}

#[test]
fn every_ipc_command_is_registered() {
    // Keep the handler list and the TypeScript bridge from drifting apart.
    let source = include_str!("../src/lib.rs");
    for command in [
        "start_core",
        "start_discovery",
        "list_devices",
        "manual_connect",
        "enqueue_send",
        "respond_consent",
        "trust_device",
        "send_clipboard",
        "list_history",
        "export_history_csv",
        "load_settings",
        "save_settings",
        "host_info",
        "quit_app",
        "diagnostics_log_path",
        "open_diagnostics_log",
    ] {
        assert!(
            source.contains(&format!("commands::{command},")),
            "`{command}` is missing from the invoke_handler list"
        );
    }
}
