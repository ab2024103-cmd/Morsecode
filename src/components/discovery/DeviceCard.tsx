import type { Device } from '../../types';
import { Icon } from '../shared/Icon';
import { relativeTime } from '../../lib/format';

interface DeviceCardProps {
  device: Device;
  selected?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
}

function SignalBars({ value }: { value: number }) {
  const bars = [6, 9, 12, 16];
  const lit = Math.ceil((value / 100) * bars.length);
  return (
    <span className="signal" title={`Signal ${value}%`}>
      {bars.map((h, i) => (
        <i key={h} className={i < lit ? 'on' : ''} style={{ height: h }} />
      ))}
    </span>
  );
}

export function DeviceCard({ device, selected, onClick, trailing }: DeviceCardProps) {
  return (
    // A div (not a <button>) so action buttons can live inside the card.
    <div
      className="device"
      data-selected={!!selected}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={onClick ? undefined : { cursor: 'default' }}
    >
      <span className="device-ico">
        <Icon name="monitor" size={19} />
      </span>
      <span className="device-main">
        <span className="device-name">
          {device.name}
          {device.trusted && (
            <span className="chip ok">
              <Icon name="shield" size={10} /> trusted
            </span>
          )}
        </span>
        <span className="device-meta">
          <span>
            {device.ip}:{device.port}
          </span>
          <span>{device.platform}</span>
          <span>{relativeTime(device.lastSeen)}</span>
        </span>
      </span>
      <span className="row" style={{ gap: 10 }}>
        <Icon name={device.link === 'wifi' ? 'wifi' : 'ethernet'} size={15} />
        <SignalBars value={device.signal} />
        {trailing}
      </span>
    </div>
  );
}
