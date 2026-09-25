import type { Device } from '../../types';
import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';
import { relativeTime } from '../../lib/format';

interface TrustedDeviceCardProps {
  device: Device;
  lastTransfer?: string;
  onRevoke: () => void;
  onSend: () => void;
}

export function TrustedDeviceCard({ device, lastTransfer, onRevoke, onSend }: TrustedDeviceCardProps) {
  return (
    <div className="panel" style={{ padding: 15 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="device-ico">
          <Icon name="shield" size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="device-name">{device.name}</div>
          <div className="device-meta">
            <span>
              {device.ip}:{device.port}
            </span>
          </div>
        </div>
      </div>

      <div className="kv">
        <span>Platform</span>
        <strong>{device.platform}</strong>
      </div>
      <div className="kv">
        <span>Fingerprint</span>
        <strong style={{ fontSize: 11 }}>{device.fingerprint}</strong>
      </div>
      <div className="kv">
        <span>Last seen</span>
        <strong>{relativeTime(device.lastSeen)}</strong>
      </div>
      <div className="kv">
        <span>Last transfer</span>
        <strong style={{ fontSize: 11 }}>{lastTransfer ?? 'never'}</strong>
      </div>

      <div className="row" style={{ marginTop: 13 }}>
        <Button size="sm" icon="send" onClick={onSend}>
          Send files
        </Button>
        <span className="spacer" />
        <Button size="sm" variant="danger" icon="x" onClick={onRevoke}>
          Revoke
        </Button>
      </div>
    </div>
  );
}
