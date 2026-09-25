import { Panel } from '../components/shared/Panel';
import { Button } from '../components/shared/Button';
import { TransferQueue } from '../components/transfer/TransferQueue';
import { MorseAnimation } from '../components/transfer/MorseAnimation';
import { ProgressBar } from '../components/shared/ProgressBar';
import { EmptyState } from '../components/shared/Panel';
import { useTransfersByDirection } from '../store/useTransferStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { simulateIncoming } from '../ipc/commands';
import { formatBytes, formatSpeed, pct } from '../lib/format';

export function ReceiveScreen() {
  const items = useTransfersByDirection('receive');
  const settings = useSettingsStore((s) => s.settings);
  const active = items.find((t) => t.status === 'active');

  const received = items.reduce((sum, t) => sum + t.transferred, 0);
  const total = items.reduce((sum, t) => sum + t.size, 0);
  const speed = items.filter((t) => t.status === 'active').reduce((sum, t) => sum + t.speed, 0);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Receive</h1>
          <p className="screen-sub">
            Listening on 0.0.0.0:{settings.transferPort}. Files land in{' '}
            <span className="mono">{settings.downloadDir}</span>.
          </p>
        </div>
        <div className="row">
          <span className="chip accent">{formatSpeed(speed)}</span>
          <Button size="sm" variant="ghost" icon="bell" onClick={() => void simulateIncoming()}>
            Simulate inbound
          </Button>
        </div>
      </div>

      <Panel title="Inbound link" flush>
        {items.length === 0 ? (
          <EmptyState
            title="No inbound transfers"
            body="When a peer sends you something, the consent modal appears first — unless that device is already trusted."
          />
        ) : (
          <>
            <MorseAnimation
              fromLabel={active?.deviceName ?? items[0].deviceName}
              toLabel={settings.deviceName}
              direction="receive"
              active={!!active}
              intensity={Math.min(100, (speed / (100 * 1024 * 1024)) * 100)}
            />
            <div className="panel-b" style={{ paddingTop: 0 }}>
              <ProgressBar value={pct(received, total)} />
              <div className="row mono muted" style={{ fontSize: 10.5, marginTop: 7 }}>
                <span>{active ? `receiving ${active.name}` : 'awaiting stream'}</span>
                <span className="spacer" />
                <span>
                  {formatBytes(received)} / {formatBytes(total)}
                </span>
              </div>
            </div>
          </>
        )}
      </Panel>

      <TransferQueue items={items} direction="receive" />

      <Panel title="Receive rules">
        <div className="kv">
          <span>Consent required</span>
          <strong>every untrusted device</strong>
        </div>
        <div className="kv">
          <span>Confirm large transfers</span>
          <strong>
            {settings.confirmLargeTransfers ? `> ${settings.largeTransferThresholdMb} MB` : 'off'}
          </strong>
        </div>
        <div className="kv">
          <span>Resume</span>
          <strong>{settings.resumeEnabled ? 'last ACK offset persisted' : 'disabled'}</strong>
        </div>
        <div className="kv">
          <span>Integrity</span>
          <strong>CRC32 per frame · AES-256-GCM tag per chunk</strong>
        </div>
      </Panel>
    </div>
  );
}
