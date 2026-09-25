//! Trusted-device store — a small JSON file in the app config directory.
//!
//! Trust is pinned to the peer's identity fingerprint, not to its IP, so a
//! device keeps its trust across DHCP changes and loses it if the key changes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::model::now_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub last_connected: u64,
}

pub struct TrustedStore {
    path: PathBuf,
    entries: RwLock<HashMap<String, TrustedDevice>>,
}

impl TrustedStore {
    pub fn load(path: PathBuf) -> Self {
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<TrustedDevice>>(&raw).ok())
            .map(|list| {
                list.into_iter()
                    .map(|device| (device.id.clone(), device))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            path,
            entries: RwLock::new(entries),
        }
    }

    fn flush(&self) {
        let list: Vec<TrustedDevice> = self
            .entries
            .read()
            .map(|guard| guard.values().cloned().collect())
            .unwrap_or_default();
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn is_trusted(&self, id: &str) -> bool {
        self.entries
            .read()
            .map(|guard| guard.contains_key(id))
            .unwrap_or(false)
    }

    /// Verifies the pinned fingerprint — a mismatch means the identity key
    /// changed and the device must go through consent again.
    pub fn is_trusted_with_fingerprint(&self, id: &str, fingerprint: &str) -> bool {
        self.entries
            .read()
            .map(|guard| {
                guard
                    .get(id)
                    .map(|device| device.fingerprint == fingerprint)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    pub fn trust(&self, id: &str, name: &str, fingerprint: &str) {
        if let Ok(mut guard) = self.entries.write() {
            guard.insert(
                id.to_string(),
                TrustedDevice {
                    id: id.to_string(),
                    name: name.to_string(),
                    fingerprint: fingerprint.to_string(),
                    last_connected: now_ms(),
                },
            );
        }
        self.flush();
    }

    pub fn touch(&self, id: &str) {
        if let Ok(mut guard) = self.entries.write() {
            if let Some(device) = guard.get_mut(id) {
                device.last_connected = now_ms();
            }
        }
        self.flush();
    }

    pub fn revoke(&self, id: &str) {
        if let Ok(mut guard) = self.entries.write() {
            guard.remove(id);
        }
        self.flush();
    }

    pub fn list(&self) -> Vec<TrustedDevice> {
        self.entries
            .read()
            .map(|guard| guard.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn ids(&self) -> Vec<String> {
        self.entries
            .read()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default()
    }
}
