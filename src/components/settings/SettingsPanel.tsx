import { useEffect, useState } from 'react';

import { Panel } from '../shared/Panel';
import { Toggle } from '../shared/Toggle';
import { Slider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Icon } from '../shared/Icon';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useDeviceStore, useDeviceList } from '../../store/useDeviceStore';
import { useToastStore } from '../../store/useToastStore';
import {
  diagnosticsLogPath,
  openDiagnosticsLog,
  startDiscovery,
  stopDiscovery,
} from '../../ipc/commands';
import { useHostInfo } from '../../hooks/useHostInfo';

export function SettingsPanel({ onManageTrusted }: { onManageTrusted: () => void }) {
  const { settings, update, reset } = useSettingsStore();
  const { theme, mode, setTheme, setMode } = useThemeStore();
  const devices = useDeviceList();
  const revoke = useDeviceStore((s) => s.revoke);
  const toast = useToastStore((s) => s.push);
  const host = useHostInfo();
  const trusted = devices.filter((d) => d.trusted);
  const [logPath, setLogPath] = useState('');

  useEffect(() => {
    let alive = true;
    void diagnosticsLogPath().then((path) => {
      if (alive) setLogPath(path);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="grid-2">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel title="Identity">
          <div className="field">
            <span className="field-label">Device name (broadcast on the LAN)</span>
            <input
              className="input"
              value={settings.deviceName}
              onChange={(e) => update('deviceName', e.target.value)}
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <span className="field-label">Download folder</span>
            <input
              className="input mono"
              value={settings.downloadDir}
              onChange={(e) => update('downloadDir', e.target.value)}
            />
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Host</span>
            <strong>
              {host.hostname} · {host.ip}
            </strong>
          </div>
          <div className="kv">
            <span>Runtime</span>
            <strong>
              {host.runtime === 'tauri' ? `Tauri v2 · ${host.platform}` : 'browser preview (mock core)'}
            </strong>
          </div>
        </Panel>

        <Panel title="Network & Discovery">
          <Toggle
            checked={settings.discoveryEnabled}
            onChange={(v) => {
              update('discoveryEnabled', v);
              void (v ? startDiscovery() : stopDiscovery());
            }}
            title="Enable discovery"
            description="Announce this device and browse for peers on the local subnet."
          />
          <Toggle
            checked={settings.mdnsEnabled}
            onChange={(v) => update('mdnsEnabled', v)}
            title="mDNS (primary)"
            description="_morsecode._tcp.local. — zero-configuration Bonjour/Avahi discovery."
            disabled={!settings.discoveryEnabled}
          />
          <Toggle
            checked={settings.udpFallbackEnabled}
            onChange={(v) => update('udpFallbackEnabled', v)}
            title="UDP broadcast fallback"
            description="Port 33457 beacon for networks where multicast is filtered."
            disabled={!settings.discoveryEnabled}
          />
          <div style={{ marginTop: 12 }}>
            <Slider
              value={settings.scanIntervalMs}
              min={400}
              max={5000}
              step={100}
              onChange={(v) => update('scanIntervalMs', v)}
              format={(v) => `${v} ms`}
              label="Scan interval"
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <span className="field-label">Transfer port (TCP)</span>
            <input
              className="input mono"
              value={settings.transferPort}
              onChange={(e) => update('transferPort', Number(e.target.value) || 33456)}
            />
          </div>
        </Panel>

        <Panel title="Appearance">
          <div className="row wrap" style={{ gap: 18 }}>
            <div className="field">
              <span className="field-label">Theme</span>
              <div className="pill-switch">
                <button aria-pressed={theme === 'classic'} onClick={() => setTheme('classic')}>
                  Classic
                </button>
                <button aria-pressed={theme === 'hud'} onClick={() => setTheme('hud')}>
                  HUD
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">Mode</span>
              <div className="pill-switch">
                <button aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>
                  Dark
                </button>
                <button aria-pressed={mode === 'light'} onClick={() => setMode('light')}>
                  Light
                </button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <Toggle
              checked={settings.showSystemLogClassic}
              onChange={(v) => update('showSystemLogClassic', v)}
              title="Show activity feed in Classic"
              description="The system log is always on in HUD; in Classic it is an optional collapsible panel."
            />
          </div>
        </Panel>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Panel title="Transfer">
          <Slider
            value={settings.bandwidthLimitPct}
            min={1}
            max={100}
            onChange={(v) => update('bandwidthLimitPct', v)}
            label="Bandwidth limit (% of available throughput)"
          />
          <div style={{ marginTop: 12 }}>
            <Slider
              value={settings.concurrency}
              min={1}
              max={16}
              onChange={(v) => update('concurrency', v)}
              format={(v) => `${v} chunks`}
              label="Parallel chunk streams"
            />
          </div>
          <div style={{ marginTop: 6 }}>
            <Toggle
              checked={settings.compression}
              onChange={(v) => update('compression', v)}
              title="On-the-fly compression"
              description="Applied only to compressible types (text, csv, json, logs…)."
            />
            <Toggle
              checked={settings.resumeEnabled}
              onChange={(v) => update('resumeEnabled', v)}
              title="Resume interrupted transfers"
              description="Persist the last acknowledged offset per file and continue after a reconnect."
            />
          </div>
        </Panel>

        <Panel title="Security">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="chip ok">
              <Icon name="lock" size={11} /> AES-256-GCM always on
            </span>
            <span className="chip ok">X25519 per session</span>
          </div>
          <Toggle
            checked
            onChange={() => toast('info', 'Encryption is mandatory', 'Payload encryption cannot be disabled.')}
            title="Encrypt every byte"
            description="Non-negotiable: the handshake derives a fresh session key for every connection."
          />
          <Toggle
            checked={settings.confirmLargeTransfers}
            onChange={(v) => update('confirmLargeTransfers', v)}
            title="Confirm large transfers"
            description="Re-prompt for incoming payloads over the threshold, even from trusted devices."
          />
          <div style={{ marginTop: 12 }}>
            <Slider
              value={settings.largeTransferThresholdMb}
              min={50}
              max={5000}
              step={50}
              onChange={(v) => update('largeTransferThresholdMb', v)}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : `${v} MB`)}
              label="Large transfer threshold"
            />
          </div>
        </Panel>

        <Panel
          title="Trusted Devices"
          actions={
            <Button size="sm" variant="ghost" icon="shield" onClick={onManageTrusted}>
              Manage
            </Button>
          }
        >
          {trusted.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              No trusted devices. Every incoming connection will prompt for consent.
            </span>
          ) : (
            trusted.map((device) => (
              <div className="kv" key={device.id}>
                <span>{device.name}</span>
                <span className="row" style={{ gap: 8 }}>
                  <strong className="mono" style={{ fontSize: 11 }}>
                    {device.ip}
                  </strong>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void revoke(device.id);
                      toast('info', 'Trust revoked', device.name);
                    }}
                  >
                    Revoke
                  </Button>
                </span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="System">
          <Toggle
            checked={settings.minimizeToTray}
            onChange={(v) => update('minimizeToTray', v)}
            title="Minimize to system tray"
            description="Keep running in the background; the tray icon pulses during active transfers."
          />
          <Toggle
            checked={settings.nativeNotifications}
            onChange={(v) => update('nativeNotifications', v)}
            title="Native OS notifications"
            description="Mirror in-app toasts to the desktop notification centre."
          />
          <div className="toggle">
            <div className="toggle-copy">
              <strong>Diagnostics log</strong>
              <span>
                Every startup stage is written here — the first place to look if the app ever fails
                to open.
              </span>
              <span className="mono" style={{ fontSize: 10, opacity: 0.72, wordBreak: 'break-all' }}>
                {logPath}
              </span>
            </div>
            <Button size="sm" icon="folder" onClick={() => void openDiagnosticsLog()}>
              Open
            </Button>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <Button
              variant="danger"
              icon="refresh"
              onClick={() => {
                reset();
                toast('info', 'Settings restored to defaults');
              }}
            >
              Reset to defaults
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
