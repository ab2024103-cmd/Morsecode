/**
 * Browser mock engine.
 *
 * The Rust core is only present inside the Tauri shell. When the UI is opened
 * in a plain browser (`npm run dev` / live preview / design review) this module
 * plays the part of the backend: it discovers fake LAN peers, performs the same
 * handshake → consent → chunked-transfer state machine, streams progress at
 * 250ms and writes the same history/log/clipboard events.
 *
 * It emits on exactly the channels listed in `events.ts`, so no component or
 * store knows which backend it is talking to.
 */
import { EVENTS, bus } from './events';
import type {
  ClipboardItem,
  ConsentRequest,
  Device,
  HistoryEntry,
  LogEvent,
  LogLevel,
  Settings,
  TransferItem,
} from '../types';
import { uid } from '../lib/format';

const MB = 1024 * 1024;

const CATALOG: Array<Omit<Device, 'lastSeen' | 'trusted'>> = [
  { id: 'dev_orion', name: 'ORION-WS', ip: '192.168.1.24', port: 33456, platform: 'windows', link: 'ethernet', signal: 94, fingerprint: '7F:2A:91:C4:0E:5B' },
  { id: 'dev_atlas', name: "Atlas MacBook Pro", ip: '192.168.1.31', port: 33456, platform: 'macos', link: 'wifi', signal: 76, fingerprint: 'A1:44:D9:6E:B2:10' },
  { id: 'dev_nyx', name: 'nyx-linux-box', ip: '192.168.1.57', port: 33456, platform: 'linux', link: 'ethernet', signal: 88, fingerprint: '3C:8E:57:AA:19:F0' },
  { id: 'dev_vega', name: 'VEGA-STUDIO', ip: '192.168.1.63', port: 33456, platform: 'windows', link: 'wifi', signal: 52, fingerprint: 'D4:07:6B:23:9C:81' },
  { id: 'dev_pixel', name: 'lab-nuc-02', ip: '192.168.1.88', port: 33456, platform: 'linux', link: 'wifi', signal: 41, fingerprint: '5B:E1:30:77:CD:2F' },
];

const SAMPLE_INCOMING = [
  { name: 'field-recording-04.wav', size: 184 * MB },
  { name: 'render_final_v3.mp4', size: 1290 * MB },
  { name: 'schematics.zip', size: 62 * MB },
  { name: 'dataset-partition-a.parquet', size: 512 * MB },
];

const DEFAULT_SETTINGS: Settings = {
  deviceName: 'THIS-MACHINE',
  downloadDir: '~/Downloads/MorseCode',
  discoveryEnabled: true,
  mdnsEnabled: true,
  udpFallbackEnabled: true,
  scanIntervalMs: 1200,
  transferPort: 33456,
  compression: true,
  concurrency: 8,
  bandwidthLimitPct: 100,
  resumeEnabled: true,
  confirmLargeTransfers: true,
  largeTransferThresholdMb: 500,
  minimizeToTray: true,
  nativeNotifications: true,
  showSystemLogClassic: true,
};

function log(level: LogLevel, tag: string, message: string) {
  const event: LogEvent = { id: uid('log'), ts: Date.now(), level, tag, message };
  bus.emit(EVENTS.log, event);
}

export class MockBackend {
  private devices = new Map<string, Device>();
  private transfers = new Map<string, TransferItem>();
  private history: HistoryEntry[] = [];
  private trusted = new Set<string>(['dev_orion']);
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private pendingConsent = new Map<string, ConsentRequest>();
  /** Transfers held until the remote peer accepts. */
  private awaitingRemote = new Map<string, string[]>();
  private discoveryTimer: number | null = null;
  private tickTimer: number | null = null;
  private incomingTimer: number | null = null;
  /** Exposed so a hot-reload can tear the simulation down cleanly. */
  stop() {
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    if (this.incomingTimer !== null) window.clearInterval(this.incomingTimer);
    this.tickTimer = null;
    this.incomingTimer = null;
    this.stopDiscovery();
    this.started = false;
  }
  private lastTick = Date.now();
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    log('info', 'CORE', 'MorseCode core online — browser simulation backend');
    log('info', 'NET', `Listening on 0.0.0.0:${this.settings.transferPort} (TCP) · mDNS _morsecode._tcp.local.`);
    this.startDiscovery();
    this.tickTimer = window.setInterval(() => this.tick(), 250);
    this.incomingTimer = window.setInterval(() => this.maybeIncoming(), 21_000);
    window.setTimeout(() => this.maybeIncoming(true), 9_000);
  }

  // ── discovery ─────────────────────────────────────────────────────────────
  startDiscovery() {
    if (this.discoveryTimer !== null) return;
    log('ok', 'MDNS', 'Browsing _morsecode._tcp.local. — scan interval 1200ms');
    let index = 0;
    const sweep = () => {
      if (!this.settings.discoveryEnabled) return;
      // Reveal catalog entries progressively, then jitter their signal.
      if (index < CATALOG.length) {
        const base = CATALOG[index++];
        const device: Device = { ...base, trusted: this.trusted.has(base.id), lastSeen: Date.now() };
        this.devices.set(device.id, device);
        bus.emit(EVENTS.deviceUpserted, device);
        log('ok', 'MDNS', `Peer found — ${device.name} @ ${device.ip}:${device.port} (${device.link})`);
      } else {
        for (const device of this.devices.values()) {
          const drift = Math.round((Math.random() - 0.5) * 6);
          const next: Device = {
            ...device,
            signal: Math.max(24, Math.min(99, device.signal + drift)),
            lastSeen: Date.now(),
            trusted: this.trusted.has(device.id),
          };
          this.devices.set(next.id, next);
          bus.emit(EVENTS.deviceUpserted, next);
        }
      }
    };
    sweep();
    this.discoveryTimer = window.setInterval(sweep, this.settings.scanIntervalMs);
  }

  stopDiscovery() {
    if (this.discoveryTimer !== null) {
      window.clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
      log('warn', 'MDNS', 'Discovery stopped');
    }
  }

  listDevices(): Device[] {
    return [...this.devices.values()];
  }

  manualConnect(ip: string, port: number): Device {
    const id = `dev_manual_${ip.replace(/\./g, '_')}`;
    const device: Device = {
      id,
      name: `manual@${ip}`,
      ip,
      port,
      platform: 'linux',
      link: 'ethernet',
      signal: 70,
      trusted: this.trusted.has(id),
      fingerprint: uid('fp').slice(3, 15).toUpperCase().match(/.{1,2}/g)!.join(':'),
      lastSeen: Date.now(),
    };
    this.devices.set(id, device);
    bus.emit(EVENTS.deviceUpserted, device);
    log('ok', 'NET', `Manual connect → ${ip}:${port} — X25519 handshake complete`);
    return device;
  }

  // ── transfers ─────────────────────────────────────────────────────────────
  enqueueSend(deviceIds: string[], files: Array<{ name: string; path: string; size: number }>) {
    const created: string[] = [];
    for (const deviceId of deviceIds) {
      const device = this.devices.get(deviceId);
      if (!device) continue;
      const ids: string[] = [];
      for (const file of files) {
        const item: TransferItem = {
          id: uid('tx'),
          name: file.name,
          path: file.path,
          size: file.size,
          transferred: 0,
          status: 'handshaking',
          direction: 'send',
          deviceId: device.id,
          deviceName: device.name,
          speed: 0,
          compressed: this.settings.compression && /\.(txt|csv|json|log|xml|svg|parquet|sql|md)$/i.test(file.name),
          resumeOffset: 0,
          startedAt: null,
          endedAt: null,
        };
        this.transfers.set(item.id, item);
        bus.emit(EVENTS.transferUpdated, item);
        ids.push(item.id);
        created.push(item.id);
      }
      log('info', 'TX', `Queued ${files.length} item(s) → ${device.name}`);
      log('info', 'CRYPTO', `X25519 ECDH with ${device.name} — deriving AES-256-GCM session key`);
      const delay = device.trusted ? 700 : 1800;
      this.awaitingRemote.set(device.id, ids);
      window.setTimeout(() => {
        const accepted = true; // remote peer accepts in the simulation
        if (!accepted) return;
        log('ok', 'CRYPTO', `Session key established with ${device.name} · AES-256-GCM`);
        for (const id of this.awaitingRemote.get(device.id) ?? []) {
          const t = this.transfers.get(id);
          if (!t) continue;
          this.transfers.set(id, { ...t, status: 'queued' });
          bus.emit(EVENTS.transferUpdated, this.transfers.get(id)!);
        }
        this.awaitingRemote.delete(device.id);
      }, delay);
    }
    return created;
  }

  setTransferStatus(id: string, status: TransferItem['status']) {
    const t = this.transfers.get(id);
    if (!t) return;
    const next = { ...t, status, speed: status === 'active' ? t.speed : 0 };
    this.transfers.set(id, next);
    bus.emit(EVENTS.transferUpdated, next);
  }

  pauseAll() {
    for (const t of this.transfers.values()) {
      if (t.status === 'active' || t.status === 'queued') this.setTransferStatus(t.id, 'paused');
    }
    log('warn', 'TX', 'All transfers paused');
  }

  resumeAll() {
    for (const t of this.transfers.values()) {
      if (t.status === 'paused') {
        log('info', 'TX', `Resuming ${t.name} at offset ${t.resumeOffset}`);
        this.setTransferStatus(t.id, 'queued');
      }
    }
  }

  cancel(id: string) {
    const t = this.transfers.get(id);
    if (!t) return;
    this.transfers.delete(id);
    bus.emit(EVENTS.transferRemoved, id);
    log('warn', 'TX', `Cancelled ${t.name}`);
  }

  clearCompleted() {
    for (const t of [...this.transfers.values()]) {
      if (t.status === 'done' || t.status === 'failed' || t.status === 'skipped') {
        this.transfers.delete(t.id);
        bus.emit(EVENTS.transferRemoved, t.id);
      }
    }
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    const active = [...this.transfers.values()].filter((t) => t.status === 'active');
    // Sequential per device, but broadcast keeps one active stream per peer.
    const busyDevices = new Set(active.map((t) => t.deviceId));
    for (const t of this.transfers.values()) {
      if (t.status === 'queued' && !busyDevices.has(t.deviceId)) {
        busyDevices.add(t.deviceId);
        const started: TransferItem = { ...t, status: 'active', startedAt: t.startedAt ?? now };
        this.transfers.set(t.id, started);
        bus.emit(EVENTS.transferUpdated, started);
        log('info', t.direction === 'send' ? 'TX' : 'RX', `${t.direction === 'send' ? 'Sending' : 'Receiving'} ${t.name} · ${this.settings.concurrency} parallel chunks`);
      }
    }

    for (const t of [...this.transfers.values()]) {
      if (t.status !== 'active') continue;
      const device = this.devices.get(t.deviceId);
      const linkCeiling = (device?.link === 'ethernet' ? 112 : 58) * MB;
      const quality = (device?.signal ?? 70) / 100;
      const limit = this.settings.bandwidthLimitPct / 100;
      const compressionBoost = t.compressed ? 1.35 : 1;
      const jitter = 0.86 + Math.random() * 0.28;
      const speed = linkCeiling * quality * limit * compressionBoost * jitter;
      const transferred = Math.min(t.size, t.transferred + speed * dt);
      const next: TransferItem = {
        ...t,
        transferred,
        speed,
        resumeOffset: Math.floor(transferred),
      };
      if (transferred >= t.size) {
        next.status = 'done';
        next.endedAt = now;
        next.speed = 0;
        this.transfers.set(t.id, next);
        bus.emit(EVENTS.transferUpdated, next);
        this.appendHistory({
          id: uid('h'),
          ts: now,
          deviceId: t.deviceId,
          deviceName: t.deviceName,
          fileName: t.name,
          size: t.size,
          durationMs: now - (t.startedAt ?? now),
          status: t.direction === 'send' ? 'sent' : 'received',
        });
        log('ok', t.direction === 'send' ? 'TX' : 'RX', `${t.name} complete · CRC32 verified`);
        bus.emit(EVENTS.notify, {
          kind: 'success',
          title: t.direction === 'send' ? 'Transfer complete' : 'File received',
          body: `${t.name} · ${t.deviceName}`,
        });
      } else {
        this.transfers.set(t.id, next);
        bus.emit(EVENTS.transferUpdated, next);
      }
    }
  }

  // ── incoming / consent ────────────────────────────────────────────────────
  maybeIncoming(force = false) {
    const pool = [...this.devices.values()];
    if (!pool.length) return;
    if (!force && Math.random() > 0.55) return;
    if (this.pendingConsent.size) return;
    // A forced (user-triggered) simulation prefers an untrusted peer so the
    // consent flow is the one being demonstrated.
    const candidates = force ? pool.filter((d) => !d.trusted) : pool;
    const from = candidates.length ? candidates : pool;
    const device = from[Math.floor(Math.random() * from.length)];
    const files = SAMPLE_INCOMING.slice(0, 1 + Math.floor(Math.random() * 2));
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    log('info', 'NET', `Inbound connection from ${device.ip} — MLNK frame accepted`);
    log('info', 'CRYPTO', `X25519 key exchange with ${device.name} · fingerprint ${device.fingerprint}`);

    const large = this.settings.confirmLargeTransfers && totalBytes > this.settings.largeTransferThresholdMb * MB;
    if (device.trusted && !large) {
      log('ok', 'TRUST', `${device.name} is trusted — consent prompt skipped`);
      this.acceptIncoming(device, files);
      return;
    }

    const request: ConsentRequest = {
      id: uid('consent'),
      device,
      fileCount: files.length,
      totalBytes,
      preview: files.map((f) => f.name),
      ts: Date.now(),
      large,
    };
    this.pendingConsent.set(request.id, request);
    bus.emit(EVENTS.consentRequested, request);
    bus.emit(EVENTS.notify, {
      kind: 'request',
      title: 'Incoming transfer request',
      body: `${device.name} wants to send ${files.length} file(s)`,
    });
  }

  respondConsent(requestId: string, accept: boolean, trust: boolean) {
    const request = this.pendingConsent.get(requestId);
    if (!request) return;
    this.pendingConsent.delete(requestId);
    bus.emit(EVENTS.consentResolved, requestId);
    if (trust) this.trustDevice(request.device.id);
    if (!accept) {
      log('warn', 'TRUST', `Rejected transfer from ${request.device.name}`);
      this.appendHistory({
        id: uid('h'),
        ts: Date.now(),
        deviceId: request.device.id,
        deviceName: request.device.name,
        fileName: request.preview[0] ?? '—',
        size: request.totalBytes,
        durationMs: 0,
        status: 'skipped',
      });
      return;
    }
    log('ok', 'TRUST', `Accepted transfer from ${request.device.name}`);
    this.acceptIncoming(
      request.device,
      request.preview.map((name, i) => ({ name, size: i === 0 ? request.totalBytes : 0 })).filter((f) => f.size > 0),
    );
  }

  private acceptIncoming(device: Device, files: Array<{ name: string; size: number }>) {
    for (const file of files) {
      const item: TransferItem = {
        id: uid('rx'),
        name: file.name,
        path: `${this.settings.downloadDir}/${file.name}`,
        size: file.size,
        transferred: 0,
        status: 'queued',
        direction: 'receive',
        deviceId: device.id,
        deviceName: device.name,
        speed: 0,
        compressed: false,
        resumeOffset: 0,
        startedAt: null,
        endedAt: null,
      };
      this.transfers.set(item.id, item);
      bus.emit(EVENTS.transferUpdated, item);
    }
  }

  // ── clipboard ─────────────────────────────────────────────────────────────
  sendClipboard(deviceId: string, text: string): ClipboardItem {
    const device = this.devices.get(deviceId);
    const item: ClipboardItem = {
      id: uid('clip'),
      ts: Date.now(),
      text,
      deviceId,
      deviceName: device?.name ?? 'unknown',
      direction: 'send',
    };
    log('ok', 'CLIP', `Sent ${text.length} chars → ${item.deviceName} (encrypted)`);
    // Simulate an occasional reply from the peer.
    if (device && Math.random() > 0.45) {
      window.setTimeout(() => {
        const reply: ClipboardItem = {
          id: uid('clip'),
          ts: Date.now(),
          text: `ack: ${text.slice(0, 48)}${text.length > 48 ? '…' : ''}`,
          deviceId,
          deviceName: device.name,
          direction: 'receive',
        };
        bus.emit(EVENTS.clipboardReceived, reply);
        log('info', 'CLIP', `Received ${reply.text.length} chars ← ${device.name}`);
      }, 1400 + Math.random() * 1600);
    }
    return item;
  }

  // ── persistence ───────────────────────────────────────────────────────────
  private appendHistory(entry: HistoryEntry) {
    this.history = [entry, ...this.history].slice(0, 500);
    bus.emit(EVENTS.historyAppended, entry);
  }

  listHistory(): HistoryEntry[] {
    return this.history;
  }

  seedHistory(entries: HistoryEntry[]) {
    this.history = entries;
  }

  clearHistory() {
    this.history = [];
    log('warn', 'DB', 'Transfer history cleared');
  }

  listTrusted(): string[] {
    return [...this.trusted];
  }

  trustDevice(id: string) {
    this.trusted.add(id);
    const device = this.devices.get(id);
    if (device) {
      const next = { ...device, trusted: true };
      this.devices.set(id, next);
      bus.emit(EVENTS.deviceUpserted, next);
      log('ok', 'TRUST', `${device.name} added to trusted devices`);
    }
  }

  revokeTrust(id: string) {
    this.trusted.delete(id);
    const device = this.devices.get(id);
    if (device) {
      const next = { ...device, trusted: false };
      this.devices.set(id, next);
      bus.emit(EVENTS.deviceUpserted, next);
      log('warn', 'TRUST', `Trust revoked for ${device.name}`);
    }
  }

  getSettings(): Settings {
    return this.settings;
  }

  saveSettings(next: Settings) {
    const prevInterval = this.settings.scanIntervalMs;
    const prevDiscovery = this.settings.discoveryEnabled;
    this.settings = next;
    if (!next.discoveryEnabled && prevDiscovery) this.stopDiscovery();
    if (next.discoveryEnabled && (!prevDiscovery || prevInterval !== next.scanIntervalMs)) {
      this.stopDiscovery();
      this.startDiscovery();
    }
  }
}

export const mockBackend = new MockBackend();
