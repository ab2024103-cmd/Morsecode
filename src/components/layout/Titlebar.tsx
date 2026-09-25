import { useEffect, useState } from 'react';
import logoUrl from '../../assets/logo.png';
import { Icon } from '../shared/Icon';
import { useThemeStore } from '../../store/useThemeStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useSessionStats } from '../../store/useTransferStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { windowAction } from '../../ipc/commands';
import { formatSpeed, toMorse } from '../../lib/format';

interface TitlebarProps {
  onToggleTray: () => void;
}

export function Titlebar({ onToggleTray }: TitlebarProps) {
  const { theme, mode, setTheme, setMode } = useThemeStore();
  const peers = useDeviceStore((s) => Object.keys(s.devices).length);
  const stats = useSessionStats();
  const settings = useSettingsStore((s) => s.settings);
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTicker((t) => t + 1), 900);
    return () => window.clearInterval(id);
  }, []);

  const morse = toMorse('morsecode');
  const offset = ticker % morse.length;

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-brand" data-tauri-drag-region>
        <span className="mark">
          <img src={logoUrl} alt="MorseCode" className="app-logo" />
        </span>
        <span className="tb-name">MorseCode</span>
        <span className="tb-tag hud-only mono">{(morse.slice(offset) + morse.slice(0, offset)).slice(0, 18)}</span>
      </div>

      <div className="tb-center" data-tauri-drag-region>
        <span className="tb-status">
          <i className={`dot${peers ? '' : ' idle'}`} />
          {peers} peer{peers === 1 ? '' : 's'} on LAN
        </span>
        <span className="tb-status">
          <Icon name="lock" size={12} />
          AES-256-GCM
        </span>
        <span className="tb-status">
          <i className={`dot${stats.activeCount ? '' : ' idle'}`} />
          {stats.activeCount ? formatSpeed(stats.speed) : `idle · :${settings.transferPort}`}
        </span>
      </div>

      <div className="tb-right">
        {/* Toggle 1 — theme skin */}
        <div className="pill-switch no-drag" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === 'classic'} onClick={() => setTheme('classic')}>
            Classic
          </button>
          <button type="button" aria-pressed={theme === 'hud'} onClick={() => setTheme('hud')}>
            HUD
          </button>
        </div>

        {/* Toggle 2 — colour mode */}
        <div className="pill-switch no-drag" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>
            Dark
          </button>
          <button type="button" aria-pressed={mode === 'light'} onClick={() => setMode('light')}>
            Light
          </button>
        </div>

        <div className="win-btns">
          <button className="win-btn" title="Tray menu" aria-label="Tray menu" onClick={onToggleTray}>
            <Icon name="radar" size={14} />
          </button>
          <button className="win-btn" title="Minimize" aria-label="Minimize" onClick={() => void windowAction('minimize')}>
            <Icon name="minus" size={14} />
          </button>
          <button className="win-btn" title="Maximize" aria-label="Maximize" onClick={() => void windowAction('maximize')}>
            <Icon name="square" size={13} />
          </button>
          <button
            className="win-btn danger"
            title={settings.minimizeToTray ? 'Close to tray' : 'Close'}
            aria-label="Close"
            onClick={() => void windowAction(settings.minimizeToTray ? 'hide' : 'close')}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
