import { useEffect, useState } from 'react';
import logoUrl from '../../assets/logo.png';
import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';
import { Checkbox } from '../shared/Toggle';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useToastStore } from '../../store/useToastStore';
import { formatBytes, formatTime } from '../../lib/format';

/**
 * Hard gate: every connection from an untrusted device lands here first.
 * No pairing codes, no QR — an explicit human Accept/Reject, plus an optional
 * "trust this device" that persists to the local trusted-devices store.
 */
export function ConsentModal() {
  const request = useDeviceStore((s) => s.consent);
  const respond = useDeviceStore((s) => s.respondConsent);
  const toast = useToastStore((s) => s.push);
  const [trust, setTrust] = useState(false);

  useEffect(() => {
    setTrust(false);
  }, [request?.id]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void handle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, trust]);

  if (!request) return null;

  async function handle(accept: boolean) {
    const name = request!.device.name;
    await respond(accept, trust);
    toast(accept ? 'success' : 'info', accept ? 'Transfer accepted' : 'Transfer rejected', name);
  }

  const { device } = request;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Incoming transfer request">
      <div className="modal">
        <header className="modal-head">
          <span className="mark" style={{ width: 34, height: 34 }}>
            <img src={logoUrl} alt="MorseCode" className="app-logo" />
          </span>
          <div>
            <strong style={{ fontSize: 14 }}>Incoming transfer request</strong>
            <div className="muted mono" style={{ fontSize: 11 }}>
              {formatTime(request.ts)} · awaiting your decision
            </div>
          </div>
          <span className="spacer" />
          {request.large && (
            <span className="chip warnc">
              <Icon name="alert" size={11} /> large
            </span>
          )}
          <span className={device.trusted ? 'chip ok' : 'chip warnc'}>
            {device.trusted ? 'trusted' : 'untrusted'}
          </span>
        </header>

        <div className="modal-body">
          <div className="device" style={{ cursor: 'default' }}>
            <span className="device-ico">
              <Icon name="monitor" size={19} />
            </span>
            <span className="device-main">
              <span className="device-name">{device.name}</span>
              <span className="device-meta">
                <span>
                  {device.ip}:{device.port}
                </span>
                <span>{device.platform}</span>
                <span>{device.link}</span>
              </span>
            </span>
          </div>

          <div>
            <div className="kv">
              <span>Files</span>
              <strong>{request.fileCount}</strong>
            </div>
            <div className="kv">
              <span>Total size</span>
              <strong>{formatBytes(request.totalBytes)}</strong>
            </div>
            <div className="kv">
              <span>Key fingerprint</span>
              <strong>{device.fingerprint}</strong>
            </div>
            <div className="kv">
              <span>Encryption</span>
              <strong>X25519 → AES-256-GCM</strong>
            </div>
          </div>

          <div>
            <span className="field-label">Payload preview</span>
            <div className="mono t2" style={{ fontSize: 11.5, marginTop: 6, display: 'grid', gap: 3 }}>
              {request.preview.map((name) => (
                <div key={name} className="row" style={{ gap: 7 }}>
                  <Icon name="file" size={12} />
                  {name}
                </div>
              ))}
            </div>
          </div>

          <Checkbox checked={trust} onChange={setTrust} label="Trust this device — skip this prompt next time" />
        </div>

        <footer className="modal-foot">
          <Button variant="danger" icon="x" onClick={() => void handle(false)}>
            Reject
          </Button>
          <Button variant="primary" icon="check" onClick={() => void handle(true)}>
            Accept transfer
          </Button>
        </footer>
      </div>
    </div>
  );
}
