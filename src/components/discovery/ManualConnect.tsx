import { useState } from 'react';
import { Button } from '../shared/Button';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useLogStore } from '../../store/useLogStore';
import { useToastStore } from '../../store/useToastStore';

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function ManualConnect() {
  const connectManual = useDeviceStore((s) => s.connectManual);
  const connecting = useDeviceStore((s) => s.connecting);
  const pushLog = useLogStore((s) => s.local);
  const toast = useToastStore((s) => s.push);
  const [ip, setIp] = useState('192.168.1.');
  const [port, setPort] = useState('33456');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!IP_RE.test(ip.trim())) {
      setError('Enter a valid IPv4 address');
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be 1–65535');
      return;
    }
    setError(null);
    pushLog('info', 'NET', `Manual connect requested → ${ip}:${portNum}`);
    await connectManual(ip.trim(), portNum);
    toast('info', 'Connection attempted', `${ip}:${portNum}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2 }}>
          <span className="field-label">IP address</span>
          <input
            className="input mono"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="192.168.1.42"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <div className="field" style={{ width: 110 }}>
          <span className="field-label">Port</span>
          <input
            className="input mono"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <Button variant="primary" icon="zap" onClick={() => void submit()} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
      {error ? (
        <span className="chip err">{error}</span>
      ) : (
        <span className="muted" style={{ fontSize: 11.5 }}>
          Use this when mDNS is blocked by the network. The peer still has to accept the request.
        </span>
      )}
    </div>
  );
}
