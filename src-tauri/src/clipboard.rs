//! Clipboard relay.
//!
//! Text snippets ride the exact same encrypted MLNK channel as files — there
//! is no second, weaker path. Inbound clipboard payloads are handled by
//! `transfer::handle_inbound` (a `Control::Clipboard` frame) and emitted to the
//! UI on `morse://clipboard-received`.

use std::sync::Arc;

use anyhow::Result;

use crate::model::ClipboardItem;
use crate::state::AppState;

/// Maximum snippet size — clipboard sharing is for text, not files.
pub const MAX_TEXT_BYTES: usize = 256 * 1024;

pub async fn send(state: Arc<AppState>, device_id: String, text: String) -> Result<ClipboardItem> {
    let trimmed = text.trim().to_string();
    anyhow::ensure!(!trimmed.is_empty(), "nothing to send");
    anyhow::ensure!(
        trimmed.len() <= MAX_TEXT_BYTES,
        "snippet too large ({} bytes) — send it as a file instead",
        trimmed.len()
    );
    crate::transfer::send_clipboard_text(state, device_id, trimmed).await
}

/// Fan-out helper used by "send to all trusted devices".
pub async fn broadcast(state: Arc<AppState>, text: String) -> Vec<ClipboardItem> {
    let ids = state.trusted.ids();
    let mut sent = Vec::new();
    for id in ids {
        if let Ok(item) = send(state.clone(), id, text.clone()).await {
            sent.push(item);
        }
    }
    sent
}
