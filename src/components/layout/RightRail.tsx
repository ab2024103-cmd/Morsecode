import { Panel } from '../shared/Panel';
import { ProgressBar } from '../shared/ProgressBar';
import { Slider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Icon } from '../shared/Icon';
import { SystemLog } from '../log/SystemLog';
import { useTransferStore, useSessionStats, useTransfers } from '../../store/useTransferStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useDeviceList } from '../../store/useDeviceStore';
import { formatBytes, formatEta, formatSpeed, pct } from '../../lib/format';

export function RightRail() {
  const stats = useSessionStats();
  const transfers = useTransfers();
  const pauseAll = useTransferStore((s) => s.pauseAll);
  const resumeAll = useTransferStore((s) => s.resumeAll);
  const paused = useTransferStore((s) => s.paused);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const peers = useDeviceList();

  const active = transfers.filter((t) => t.status === 'active');
  const remaining = stats.totalBytes - stats.transferredBytes;

  return (
    <aside className="rightrail">
      <Panel title="Session">
        <div className="row" style={{ alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
          <span className="stat-big">{formatSpeed(stats.speed).replace(/\s?(MB|KB)\/s/, '')}</span>
          <span className="stat-unit">{stats.speed >= 1024 * 1024 || stats.speed === 0 ? 'MB/s' : 'KB/s'}</span>
          <span className="spacer" />
          <span className="chip accent">{active.length} active</span>
        </div>

        <ProgressBar value={stats.progress} />

        <div style={{ marginTop: 12 }}>
          <div className="kv">
            <span>Transferred</span>
            <strong>
              {formatBytes(stats.transferredBytes)} / {formatBytes(stats.totalBytes)}
            </strong>
          </div>
          <div className="kv">
            <span>Queued</span>
            <strong>{stats.queuedCount}</strong>
          </div>
          <div className="kv">
            <span>Completed</span>
            <strong>{stats.doneCount}</strong>
          </div>
          <div className="kv">
            <span>ETA</span>
            <strong>{active.length ? formatEta(remaining, stats.speed) : '—'}</strong>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          {paused ? (
            <Button icon="play" size="sm" onClick={() => void resumeAll()} block>
              Resume all
            </Button>
          ) : (
            <Button icon="pause" size="sm" onClick={() => void pauseAll()} block disabled={!transfers.length}>
              Pause all
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Bandwidth">
        <Slider
          value={settings.bandwidthLimitPct}
          min={1}
          max={100}
          onChange={(v) => update('bandwidthLimitPct', v)}
          label="Throughput cap"
        />
        <div className="kv">
          <span>Parallel chunks</span>
          <strong>{settings.concurrency}</strong>
        </div>
        <div className="kv">
          <span>Compression</span>
          <strong>{settings.compression ? 'on' : 'off'}</strong>
        </div>
        <div className="kv">
          <span>Resume</span>
          <strong>{settings.resumeEnabled ? 'enabled' : 'off'}</strong>
        </div>
      </Panel>

      <Panel title="Live Queue" flush>
        {active.length === 0 ? (
          <div className="panel-b muted" style={{ fontSize: 12 }}>
            No active streams. Queue is idle.
          </div>
        ) : (
          active.slice(0, 4).map((item) => (
            <div key={item.id} className="panel-b" style={{ paddingBottom: 12, paddingTop: 12 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Icon name={item.direction === 'send' ? 'send' : 'receive'} size={13} />
                <span className="nowrap" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name}
                </span>
                <span className="spacer" />
                <span className="mono" style={{ fontSize: 10.5 }}>
                  {Math.round(pct(item.transferred, item.size))}%
                </span>
              </div>
              <ProgressBar value={pct(item.transferred, item.size)} />
              <div className="row mono muted" style={{ fontSize: 10, marginTop: 5 }}>
                <span>{item.deviceName}</span>
                <span className="spacer" />
                <span>{formatSpeed(item.speed)}</span>
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Network">
        <div className="kv">
          <span>Listening</span>
          <strong>0.0.0.0:{settings.transferPort}</strong>
        </div>
        <div className="kv">
          <span>mDNS</span>
          <strong>{settings.mdnsEnabled ? '_morsecode._tcp' : 'off'}</strong>
        </div>
        <div className="kv">
          <span>UDP fallback</span>
          <strong>{settings.udpFallbackEnabled ? '33457' : 'off'}</strong>
        </div>
        <div className="kv">
          <span>Peers</span>
          <strong>{peers.length}</strong>
        </div>
        <div className="kv">
          <span>Trusted</span>
          <strong>{peers.filter((p) => p.trusted).length}</strong>
        </div>
      </Panel>

      <SystemLog variant="rail" maxHeight={200} />
    </aside>
  );
}
