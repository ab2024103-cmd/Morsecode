/** Shared domain model — mirrors the serde structs in `src-tauri/src/*.rs`. */

export type Platform = 'windows' | 'macos' | 'linux';
export type LinkType = 'wifi' | 'ethernet';

export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: Platform;
  link: LinkType;
  /** 0–100, derived from mDNS response latency — drives radar ring placement. */
  signal: number;
  trusted: boolean;
  /** Short X25519 public-key fingerprint, shown in the consent modal. */
  fingerprint: string;
  lastSeen: number;
}

export type TransferStatus =
  | 'queued'
  | 'handshaking'
  | 'active'
  | 'paused'
  | 'done'
  | 'failed'
  | 'skipped';

export type Direction = 'send' | 'receive';

export interface TransferItem {
  id: string;
  name: string;
  /** Relative path when the item came from a dropped folder. */
  path: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  direction: Direction;
  deviceId: string;
  deviceName: string;
  /** Bytes per second, refreshed at least every 500ms. */
  speed: number;
  compressed: boolean;
  /** Last acknowledged byte offset — the resume point. */
  resumeOffset: number;
  startedAt: number | null;
  endedAt: number | null;
  error?: string;
}

export type HistoryStatus = 'sent' | 'received' | 'failed' | 'skipped';

export interface HistoryEntry {
  id: string;
  ts: number;
  deviceId: string;
  deviceName: string;
  fileName: string;
  size: number;
  durationMs: number;
  status: HistoryStatus;
}

export interface ClipboardItem {
  id: string;
  ts: number;
  text: string;
  deviceId: string;
  deviceName: string;
  direction: Direction;
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface LogEvent {
  id: string;
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
}

export interface ConsentRequest {
  id: string;
  device: Device;
  fileCount: number;
  totalBytes: number;
  preview: string[];
  ts: number;
  /** True when the payload is over the "confirm large transfers" threshold. */
  large: boolean;
}

export interface Settings {
  deviceName: string;
  downloadDir: string;
  /** Discovery */
  discoveryEnabled: boolean;
  mdnsEnabled: boolean;
  udpFallbackEnabled: boolean;
  scanIntervalMs: number;
  transferPort: number;
  /** Transfer */
  compression: boolean;
  concurrency: number;
  bandwidthLimitPct: number;
  resumeEnabled: boolean;
  /** Security */
  confirmLargeTransfers: boolean;
  largeTransferThresholdMb: number;
  /** System */
  minimizeToTray: boolean;
  nativeNotifications: boolean;
  showSystemLogClassic: boolean;
}

export type ToastKind = 'info' | 'success' | 'error' | 'request';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  ts: number;
  /** ms; 0 = sticky */
  ttl: number;
}

export type ScreenId =
  | 'discover'
  | 'send'
  | 'receive'
  | 'history'
  | 'clipboard'
  | 'trusted'
  | 'settings'
  | 'log';
