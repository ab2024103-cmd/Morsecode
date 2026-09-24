//! Serde types shared with the React frontend.
//!
//! Every struct here is mirrored 1:1 by an interface in `src/types.ts`; the
//! `camelCase` rename keeps the wire format idiomatic on the TypeScript side.

use serde::{Deserialize, Serialize};

pub const DEFAULT_TRANSFER_PORT: u16 = 33456;
pub const DISCOVERY_PORT: u16 = 33457;
pub const SERVICE_TYPE: &str = "_morsecode._tcp.local.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            Platform::Linux
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkType {
    Wifi,
    Ethernet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub platform: Platform,
    pub link: LinkType,
    /// 0–100, derived from mDNS/beacon round-trip latency.
    pub signal: u8,
    pub trusted: bool,
    /// Short fingerprint of the peer's X25519 public key.
    pub fingerprint: String,
    pub last_seen: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Queued,
    Handshaking,
    Active,
    Paused,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Send,
    Receive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub transferred: u64,
    pub status: TransferStatus,
    pub direction: Direction,
    pub device_id: String,
    pub device_name: String,
    /// Bytes per second.
    pub speed: f64,
    pub compressed: bool,
    /// Last acknowledged byte offset — the resume point.
    pub resume_offset: u64,
    pub started_at: Option<u64>,
    pub ended_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HistoryStatus {
    Sent,
    Received,
    Failed,
    Skipped,
}

impl HistoryStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            HistoryStatus::Sent => "sent",
            HistoryStatus::Received => "received",
            HistoryStatus::Failed => "failed",
            HistoryStatus::Skipped => "skipped",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "sent" => HistoryStatus::Sent,
            "received" => HistoryStatus::Received,
            "skipped" => HistoryStatus::Skipped,
            _ => HistoryStatus::Failed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub ts: u64,
    pub device_id: String,
    pub device_name: String,
    pub file_name: String,
    pub size: u64,
    pub duration_ms: u64,
    pub status: HistoryStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub ts: u64,
    pub text: String,
    pub device_id: String,
    pub device_name: String,
    pub direction: Direction,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Ok,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub id: String,
    pub ts: u64,
    pub level: LogLevel,
    pub tag: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRequest {
    pub id: String,
    pub device: Device,
    pub file_count: usize,
    pub total_bytes: u64,
    pub preview: Vec<String>,
    pub ts: u64,
    /// Payload exceeds the "confirm large transfers" threshold.
    pub large: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub device_name: String,
    pub download_dir: String,
    pub discovery_enabled: bool,
    pub mdns_enabled: bool,
    pub udp_fallback_enabled: bool,
    pub scan_interval_ms: u64,
    pub transfer_port: u16,
    pub compression: bool,
    pub concurrency: u8,
    pub bandwidth_limit_pct: u8,
    pub resume_enabled: bool,
    pub confirm_large_transfers: bool,
    pub large_transfer_threshold_mb: u64,
    pub minimize_to_tray: bool,
    pub native_notifications: bool,
    pub show_system_log_classic: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let downloads = dirs::download_dir()
            .map(|p| p.join("MorseCode"))
            .unwrap_or_else(|| std::path::PathBuf::from("./MorseCode"));
        Self {
            device_name: gethostname::gethostname().to_string_lossy().to_string(),
            download_dir: downloads.to_string_lossy().to_string(),
            discovery_enabled: true,
            mdns_enabled: true,
            udp_fallback_enabled: true,
            scan_interval_ms: 1200,
            transfer_port: DEFAULT_TRANSFER_PORT,
            compression: true,
            concurrency: 8,
            bandwidth_limit_pct: 100,
            resume_enabled: true,
            confirm_large_transfers: true,
            large_transfer_threshold_mb: 500,
            minimize_to_tray: true,
            native_notifications: true,
            show_system_log_classic: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub hostname: String,
    pub ip: String,
    pub platform: String,
    pub version: String,
    pub runtime: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    pub kind: String,
    pub title: String,
    pub body: String,
}

/// Wall-clock milliseconds — the unit the UI expects for every timestamp.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}
