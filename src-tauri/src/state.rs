//! Shared application state + the event channels the UI listens on.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex, RwLock};

use crate::crypto::Identity;
use crate::history::HistoryStore;
use crate::model::*;
use crate::trusted::TrustedStore;

pub mod events {
    pub const DEVICE_UPSERTED: &str = "morse://device-upserted";
    pub const DEVICE_LOST: &str = "morse://device-lost";
    pub const TRANSFER_UPDATED: &str = "morse://transfer-updated";
    pub const TRANSFER_REMOVED: &str = "morse://transfer-removed";
    pub const CONSENT_REQUESTED: &str = "morse://consent-requested";
    pub const CONSENT_RESOLVED: &str = "morse://consent-resolved";
    pub const CLIPBOARD_RECEIVED: &str = "morse://clipboard-received";
    pub const HISTORY_APPENDED: &str = "morse://history-appended";
    pub const LOG: &str = "morse://log";
    pub const NOTIFY: &str = "morse://notify";
    pub const TRAY_ACTION: &str = "morse://tray-action";
}

/// The receiver's verdict for one inbound connection.
#[derive(Debug, Clone, Copy)]
pub struct Decision {
    pub accept: bool,
    pub trust: bool,
}

pub struct AppState {
    pub app: AppHandle,
    pub identity: Identity,
    pub settings: RwLock<Settings>,
    pub devices: RwLock<HashMap<String, Device>>,
    pub transfers: RwLock<HashMap<String, TransferItem>>,
    /// Consent requests waiting on the Accept/Reject modal.
    pub pending_consent: Mutex<HashMap<String, oneshot::Sender<Decision>>>,
    /// Transfer ids the user paused or cancelled; the streaming loops poll this.
    pub paused_items: RwLock<HashMap<String, bool>>,
    pub cancelled_items: RwLock<HashMap<String, bool>>,
    pub paused_all: AtomicBool,
    pub trusted: TrustedStore,
    pub history: HistoryStore,
    pub config_dir: PathBuf,
    pub discovery_running: AtomicBool,
    /// Mirror of `settings.minimize_to_tray` readable from sync contexts
    /// (the window close handler runs outside the async runtime).
    pub minimize_to_tray: AtomicBool,
}

impl AppState {
    /// Infallible on purpose: a missing config directory, an unwritable
    /// history file or a corrupt settings file must degrade, never prevent the
    /// app from opening its window.
    pub fn new(app: AppHandle) -> Arc<Self> {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| dirs::config_dir().unwrap_or_else(std::env::temp_dir))
            .to_path_buf();
        if let Err(err) = std::fs::create_dir_all(&config_dir) {
            crate::diag::log(
                "state",
                format!("config dir {} not writable: {err}", config_dir.display()),
            );
        }
        crate::diag::log("state", format!("config dir {}", config_dir.display()));

        let identity = load_identity(&config_dir);
        let settings = load_settings(&config_dir);
        let minimize_to_tray = settings.minimize_to_tray;
        let trusted = TrustedStore::load(config_dir.join("trusted.json"));
        let history = HistoryStore::open_or_memory(config_dir.join("history.sqlite"));

        std::fs::create_dir_all(&settings.download_dir).ok();

        Arc::new(Self {
            app,
            identity,
            settings: RwLock::new(settings),
            devices: RwLock::new(HashMap::new()),
            transfers: RwLock::new(HashMap::new()),
            pending_consent: Mutex::new(HashMap::new()),
            paused_items: RwLock::new(HashMap::new()),
            cancelled_items: RwLock::new(HashMap::new()),
            paused_all: AtomicBool::new(false),
            trusted,
            history,
            config_dir,
            discovery_running: AtomicBool::new(false),
            minimize_to_tray: AtomicBool::new(minimize_to_tray),
        })
    }

    // ── event helpers ────────────────────────────────────────────────────────
    pub fn log(&self, level: LogLevel, tag: &str, message: impl Into<String>) {
        let event = LogEvent {
            id: new_id("log"),
            ts: now_ms(),
            level,
            tag: tag.to_string(),
            message: message.into(),
        };
        let _ = self.app.emit(events::LOG, event);
    }

    pub fn notify(&self, kind: &str, title: &str, body: &str) {
        let _ = self.app.emit(
            events::NOTIFY,
            NotifyPayload {
                kind: kind.to_string(),
                title: title.to_string(),
                body: body.to_string(),
            },
        );
    }

    pub async fn upsert_device(&self, mut device: Device) {
        device.trusted = self.trusted.is_trusted(&device.id);
        self.devices
            .write()
            .await
            .insert(device.id.clone(), device.clone());
        let _ = self.app.emit(events::DEVICE_UPSERTED, device);
    }

    pub async fn drop_device(&self, id: &str) {
        self.devices.write().await.remove(id);
        let _ = self.app.emit(events::DEVICE_LOST, id.to_string());
    }

    pub async fn device(&self, id: &str) -> Option<Device> {
        self.devices.read().await.get(id).cloned()
    }

    pub async fn put_transfer(&self, item: TransferItem) {
        self.transfers
            .write()
            .await
            .insert(item.id.clone(), item.clone());
        let _ = self.app.emit(events::TRANSFER_UPDATED, item);
    }

    pub async fn remove_transfer(&self, id: &str) {
        self.transfers.write().await.remove(id);
        let _ = self.app.emit(events::TRANSFER_REMOVED, id.to_string());
    }

    pub async fn transfer(&self, id: &str) -> Option<TransferItem> {
        self.transfers.read().await.get(id).cloned()
    }

    /// Applies a mutation and re-emits the item to the UI.
    pub async fn update_transfer<F>(&self, id: &str, mutate: F)
    where
        F: FnOnce(&mut TransferItem),
    {
        let mut guard = self.transfers.write().await;
        if let Some(item) = guard.get_mut(id) {
            mutate(item);
            let snapshot = item.clone();
            drop(guard);
            let _ = self.app.emit(events::TRANSFER_UPDATED, snapshot);
        }
    }

    pub async fn record_history(&self, entry: HistoryEntry) {
        if let Err(err) = self.history.insert(&entry) {
            self.log(LogLevel::Error, "DB", format!("history insert failed: {err}"));
        }
        let _ = self.app.emit(events::HISTORY_APPENDED, entry);
    }

    pub fn is_paused(&self) -> bool {
        self.paused_all.load(Ordering::SeqCst)
    }

    pub async fn is_item_paused(&self, id: &str) -> bool {
        self.is_paused() || *self.paused_items.read().await.get(id).unwrap_or(&false)
    }

    pub async fn is_item_cancelled(&self, id: &str) -> bool {
        *self.cancelled_items.read().await.get(id).unwrap_or(&false)
    }

    pub async fn settings_snapshot(&self) -> Settings {
        self.settings.read().await.clone()
    }

    pub async fn persist_settings(&self, settings: &Settings) {
        let path = self.config_dir.join("settings.json");
        if let Ok(json) = serde_json::to_string_pretty(settings) {
            let _ = std::fs::write(path, json);
        }
    }

    pub async fn self_peer(&self) -> crate::protocol::PeerInfo {
        let settings = self.settings_snapshot().await;
        crate::protocol::PeerInfo {
            id: self.identity.id.clone(),
            name: settings.device_name,
            platform: format!("{:?}", Platform::current()).to_lowercase(),
            fingerprint: self.identity.fingerprint.clone(),
            port: settings.transfer_port,
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

fn load_identity(config_dir: &PathBuf) -> Identity {
    let path = config_dir.join("identity.bin");
    let seed = match std::fs::read(&path) {
        Ok(bytes) if bytes.len() == 32 => bytes,
        _ => {
            let seed = crate::crypto::random_seed();
            let _ = std::fs::write(&path, seed);
            seed.to_vec()
        }
    };
    Identity::from_seed(&seed)
}

fn load_settings(config_dir: &PathBuf) -> Settings {
    let path = config_dir.join("settings.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
}
