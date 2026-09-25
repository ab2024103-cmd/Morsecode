import logoUrl from '../../assets/logo.png';
import { Icon } from '../shared/Icon';
import { useTransferStore, useSessionStats } from '../../store/useTransferStore';
import { useToastStore } from '../../store/useToastStore';
import { windowAction } from '../../ipc/commands';
import { formatSpeed } from '../../lib/format';

/**
 * In-app rendering of the native tray menu.
 *
 * The real menu is built in Rust (`src-tauri/src/tray.rs`) with the same items;
 * this popover mirrors it so the flow is reviewable inside the window and in
 * the browser preview.
 */
export function TrayMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stats = useSessionStats();
  const pauseAll = useTransferStore((s) => s.pauseAll);
  const resumeAll = useTransferStore((s) => s.resumeAll);
  const paused = useTransferStore((s) => s.paused);
  const toast = useToastStore((s) => s.push);

  if (!open) return null;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 64 }} onClick={onClose} role="presentation" />
      <div className="tray-pop" role="menu">
        <div className="tray-head">
          <span className="mark" style={{ width: 22, height: 22 }}>
            <img src={logoUrl} alt="" className="app-logo" />
          </span>
          <div style={{ lineHeight: 1.2 }}>
            <strong style={{ fontSize: 12 }}>MorseCode</strong>
            <div className="muted mono" style={{ fontSize: 10 }}>
              {stats.activeCount ? `${formatSpeed(stats.speed)} · ${stats.activeCount} active` : 'idle · listening'}
            </div>
          </div>
        </div>

        <button
          className="tray-item"
          onClick={() => {
            void windowAction('show');
            onClose();
          }}
        >
          <Icon name="radar" size={14} /> Open MorseCode
        </button>

        <button
          className="tray-item"
          onClick={() => {
            void (paused ? resumeAll() : pauseAll());
            toast('info', paused ? 'Transfers resumed' : 'All transfers paused');
            onClose();
          }}
        >
          <Icon name={paused ? 'play' : 'pause'} size={14} />
          {paused ? 'Resume all transfers' : 'Pause all transfers'}
        </button>

        <button
          className="tray-item sep"
          onClick={() => {
            void windowAction('quit');
            toast('info', 'Quit requested', 'In the browser preview the window stays open.');
            onClose();
          }}
        >
          <Icon name="power" size={14} /> Quit
        </button>
      </div>
    </>
  );
}
