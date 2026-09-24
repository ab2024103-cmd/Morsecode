/**
 * Typed wrappers around the Tauri `invoke()` surface exposed by the Rust core.
 *
 * Every function has two implementations: the real IPC call, and a delegation
 * to the browser mock engine so `npm run dev` in a plain browser behaves like
 * the packaged app. Nothing else in the codebase may import `@tauri-apps/*`.
 */
import { EVENTS, bus } from './events';
import { mockBackend } from './mock';
import type {
  ClipboardItem,
  Device,
  HistoryEntry,
  Settings,
  TransferItem,
} from '../types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** Bridges native Tauri events onto the local bus (no-op in the browser). */
export async function initBackend(): Promise<void> {
  if (!isTauri) {
    mockBackend.start();
    return;
  }
  const { listen } = await import('@tauri-apps/api/event');
  await Promise.all(
    Object.values(EVENTS).map((name) =>
      listen(name, (event) => bus.emit(name, event.payload as unknown)),
    ),
  );
  await invoke('start_core');
}

export const subscribe = (event: string, handler: (payload: never) => void) =>
  bus.on(event, handler as (payload: unknown) => void);

// ── discovery ───────────────────────────────────────────────────────────────
export async function startDiscovery(): Promise<void> {
  if (!isTauri) return mockBackend.startDiscovery();
  await invoke('start_discovery');
}

export async function stopDiscovery(): Promise<void> {
  if (!isTauri) return mockBackend.stopDiscovery();
  await invoke('stop_discovery');
}

export async function listDevices(): Promise<Device[]> {
  if (!isTauri) return mockBackend.listDevices();
  return invoke<Device[]>('list_devices');
}

export async function manualConnect(ip: string, port: number): Promise<Device> {
  if (!isTauri) return mockBackend.manualConnect(ip, port);
  return invoke<Device>('manual_connect', { ip, port });
}

// ── file selection ──────────────────────────────────────────────────────────
export interface PickedFile {
  name: string;
  path: string;
  size: number;
}

export async function pickFiles(directory = false): Promise<PickedFile[]> {
  if (!isTauri) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selection = await open({ multiple: true, directory });
  if (!selection) return [];
  const paths = Array.isArray(selection) ? selection : [selection];
  return invoke<PickedFile[]>('stat_paths', { paths });
}

// ── transfer ────────────────────────────────────────────────────────────────
export async function enqueueSend(deviceIds: string[], files: PickedFile[]): Promise<string[]> {
  if (!isTauri) return mockBackend.enqueueSend(deviceIds, files);
  return invoke<string[]>('enqueue_send', { deviceIds, files });
}

export async function pauseTransfer(id: string): Promise<void> {
  if (!isTauri) return mockBackend.setTransferStatus(id, 'paused');
  await invoke('pause_transfer', { id });
}

export async function resumeTransfer(id: string): Promise<void> {
  if (!isTauri) return mockBackend.setTransferStatus(id, 'queued');
  await invoke('resume_transfer', { id });
}

export async function cancelTransfer(id: string): Promise<void> {
  if (!isTauri) return mockBackend.cancel(id);
  await invoke('cancel_transfer', { id });
}

export async function pauseAll(): Promise<void> {
  if (!isTauri) return mockBackend.pauseAll();
  await invoke('pause_all');
}

export async function resumeAll(): Promise<void> {
  if (!isTauri) return mockBackend.resumeAll();
  await invoke('resume_all');
}

export async function clearCompleted(): Promise<void> {
  if (!isTauri) return mockBackend.clearCompleted();
  await invoke('clear_completed');
}

export async function listTransfers(): Promise<TransferItem[]> {
  if (!isTauri) return [];
  return invoke<TransferItem[]>('list_transfers');
}

// ── consent / trust ─────────────────────────────────────────────────────────
export async function respondConsent(requestId: string, accept: boolean, trust: boolean): Promise<void> {
  if (!isTauri) return mockBackend.respondConsent(requestId, accept, trust);
  await invoke('respond_consent', { requestId, accept, trust });
}

export async function listTrusted(): Promise<string[]> {
  if (!isTauri) return mockBackend.listTrusted();
  return invoke<string[]>('list_trusted');
}

export async function trustDevice(deviceId: string): Promise<void> {
  if (!isTauri) return mockBackend.trustDevice(deviceId);
  await invoke('trust_device', { deviceId });
}

export async function revokeTrust(deviceId: string): Promise<void> {
  if (!isTauri) return mockBackend.revokeTrust(deviceId);
  await invoke('revoke_trust', { deviceId });
}

// ── clipboard ───────────────────────────────────────────────────────────────
export async function sendClipboard(deviceId: string, text: string): Promise<ClipboardItem> {
  if (!isTauri) return mockBackend.sendClipboard(deviceId, text);
  return invoke<ClipboardItem>('send_clipboard', { deviceId, text });
}

// ── history ─────────────────────────────────────────────────────────────────
export async function listHistory(): Promise<HistoryEntry[]> {
  if (!isTauri) return mockBackend.listHistory();
  return invoke<HistoryEntry[]>('list_history');
}

export async function clearHistory(): Promise<void> {
  if (!isTauri) return mockBackend.clearHistory();
  await invoke('clear_history');
}

/** Rust writes the CSV to disk; the browser build falls back to a data URL. */
export async function exportHistoryCsv(csv: string): Promise<string | null> {
  if (!isTauri) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morsecode-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return a.download;
  }
  return invoke<string | null>('export_history_csv', { csv });
}

// ── settings ────────────────────────────────────────────────────────────────
export async function loadSettings(): Promise<Settings | null> {
  if (!isTauri) return mockBackend.getSettings();
  return invoke<Settings | null>('load_settings');
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!isTauri) return mockBackend.saveSettings(settings);
  await invoke('save_settings', { settings });
}

// ── system ──────────────────────────────────────────────────────────────────
export interface HostInfo {
  hostname: string;
  ip: string;
  platform: string;
  version: string;
  runtime: 'tauri' | 'browser';
}

export async function hostInfo(): Promise<HostInfo> {
  if (!isTauri) {
    return {
      hostname: mockBackend.getSettings().deviceName,
      ip: '192.168.1.17',
      platform: navigator.platform || 'browser',
      version: '1.0.4',
      runtime: 'browser',
    };
  }
  return invoke<HostInfo>('host_info');
}

/** Absolute path of the startup/diagnostics log written by the Rust core. */
export async function diagnosticsLogPath(): Promise<string> {
  if (!isTauri) return 'Diagnostics log is only written by the desktop build.';
  return invoke<string>('diagnostics_log_path');
}

/** Opens the folder containing the diagnostics log. */
export async function openDiagnosticsLog(): Promise<void> {
  if (!isTauri) return;
  await invoke('open_diagnostics_log');
}

export async function nativeNotify(title: string, body: string): Promise<void> {
  if (!isTauri) return;
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  if (granted) sendNotification({ title, body });
}

export async function windowAction(action: 'minimize' | 'maximize' | 'close' | 'hide' | 'show' | 'quit'): Promise<void> {
  if (!isTauri) return;
  if (action === 'quit') {
    await invoke('quit_app');
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (action === 'minimize') await win.minimize();
  if (action === 'maximize') await win.toggleMaximize();
  if (action === 'close') await win.close();
  if (action === 'hide') await win.hide();
  if (action === 'show') {
    await win.show();
    await win.setFocus();
  }
}

/** Demo hook — lets the UI provoke an inbound request while reviewing designs. */
export async function simulateIncoming(): Promise<void> {
  if (!isTauri) {
    mockBackend.maybeIncoming(true);
    return;
  }
  await invoke('simulate_incoming');
}
