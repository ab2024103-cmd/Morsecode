import logoUrl from '../../assets/logo.png';
import { Icon, type IconName } from '../shared/Icon';
import type { ScreenId } from '../../types';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useTransfers } from '../../store/useTransferStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useHostInfo } from '../../hooks/useHostInfo';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: IconName;
  group: 'transfer' | 'data' | 'system';
}

const NAV: NavItem[] = [
  { id: 'discover', label: 'Discover', icon: 'radar', group: 'transfer' },
  { id: 'send', label: 'Send / Broadcast', icon: 'send', group: 'transfer' },
  { id: 'receive', label: 'Receive', icon: 'receive', group: 'transfer' },
  { id: 'history', label: 'History', icon: 'history', group: 'data' },
  { id: 'clipboard', label: 'Clipboard Share', icon: 'clipboard', group: 'data' },
  { id: 'trusted', label: 'Trusted Devices', icon: 'shield', group: 'data' },
  { id: 'log', label: 'System Log', icon: 'terminal', group: 'system' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'system' },
];

const GROUP_LABEL: Record<NavItem['group'], string> = {
  transfer: 'Transfer',
  data: 'Data',
  system: 'System',
};

interface SidebarProps {
  screen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
}

export function Sidebar({ screen, onNavigate }: SidebarProps) {
  const peers = useDeviceStore((s) => Object.keys(s.devices).length);
  const transfers = useTransfers();
  const deviceName = useSettingsStore((s) => s.settings.deviceName);
  const host = useHostInfo();

  const counts: Partial<Record<ScreenId, number>> = {
    discover: peers,
    send: transfers.filter((t) => t.direction === 'send' && t.status !== 'done').length,
    receive: transfers.filter((t) => t.direction === 'receive' && t.status !== 'done').length,
  };

  let lastGroup: NavItem['group'] | null = null;

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <span className="mark">
          <img src={logoUrl} alt="MorseCode" className="app-logo" />
        </span>
        <span className="sb-logo-text">
          <strong>MorseCode</strong>
          <span>Local · Fast · Offline</span>
        </span>
      </div>

      <nav className="sb-nav">
        {NAV.map((item) => {
          const header = item.group !== lastGroup ? GROUP_LABEL[item.group] : null;
          lastGroup = item.group;
          const count = counts[item.id];
          return (
            <div key={item.id}>
              {header && <div className="sb-section">{header}</div>}
              <button
                type="button"
                className="sb-item"
                aria-current={screen === item.id ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <span className="sb-ico">
                  <Icon name={item.icon} size={17} />
                </span>
                {item.label}
                {!!count && <span className="sb-count">{count}</span>}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="sb-foot">
        <div className="sb-me">
          <span className="avatar">{deviceName.slice(0, 2).toUpperCase()}</span>
          <span>
            {deviceName}
            <small>
              {host.ip} · {host.runtime === 'tauri' ? host.platform : 'preview'}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}
