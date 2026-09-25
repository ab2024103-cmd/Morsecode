import { Panel } from '../components/shared/Panel';
import { DropZone } from '../components/transfer/DropZone';
import { BroadcastBar } from '../components/transfer/BroadcastBar';
import { TransferQueue } from '../components/transfer/TransferQueue';
import { MorseAnimation } from '../components/transfer/MorseAnimation';
import { ProgressBar } from '../components/shared/ProgressBar';
import { useDeviceStore, useDeviceList, useSelectedDevices } from '../store/useDeviceStore';
import { useTransferStore, useTransfersByDirection, useSessionStats } from '../store/useTransferStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useToastStore } from '../store/useToastStore';
import { useLogStore } from '../store/useLogStore';
import { formatBytes, formatSpeed, pct } from '../lib/format';

export function SendScreen() {
  const devices = useDeviceList();
  const selected = useSelectedDevices();
  const toggleSelected = useDeviceStore((s) => s.toggleSelected);
  const clearSelection = useDeviceStore((s) => s.clearSelection);
  const send = useTransferStore((s) => s.send);
  const items = useTransfersByDirection('send');
  const stats = useSessionStats();
  const deviceName = useSettingsStore((s) => s.settings.deviceName);
  const toast = useToastStore((s) => s.push);
  const pushLog = useLogStore((s) => s.local);

  const active = items.find((t) => t.status === 'active');
  const targets = selected.length ? selected : devices[0] ? [devices[0].id] : [];
  const targetNames = devices.filter((d) => targets.includes(d.id)).map((d) => d.name);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Send / Broadcast</h1>
          <p className="screen-sub">
            Drop a payload, pick one or many peers. Each stream is chunked, encrypted and resumable.
          </p>
        </div>
        <div className="row">
          <span className="chip accent">{formatSpeed(stats.speed)}</span>
          <span className="chip">
            {formatBytes(stats.transferredBytes)} / {formatBytes(stats.totalBytes)}
          </span>
        </div>
      </div>

      <Panel flush>
        <BroadcastBar
          devices={devices}
          selected={selected}
          onToggle={toggleSelected}
          onSelectAll={() => devices.forEach((d) => !selected.includes(d.id) && toggleSelected(d.id))}
          onClear={clearSelection}
        />
      </Panel>

      <DropZone
        disabled={!targets.length}
        hint={
          targets.length
            ? `Streaming to ${targetNames.join(', ')} · parallel chunk streams per peer`
            : 'Select at least one peer on Discover first'
        }
        onFiles={(files) => {
          if (!targets.length) {
            toast('error', 'No target selected', 'Choose a peer before dropping files.');
            return;
          }
          void send(targets, files);
          pushLog(
            'info',
            'TX',
            `Enqueued ${files.length} item(s) → ${targetNames.join(', ')} (${formatBytes(
              files.reduce((sum, f) => sum + f.size, 0),
            )})`,
          );
          toast('info', 'Added to queue', `${files.length} item(s) → ${targetNames.length} device(s)`);
        }}
      />

      <Panel title="Link" flush>
        <MorseAnimation
          fromLabel={deviceName}
          toLabel={targetNames[0] ?? 'no peer'}
          direction="send"
          active={!!active}
          intensity={Math.min(100, (stats.speed / (100 * 1024 * 1024)) * 100)}
        />
        <div className="panel-b" style={{ paddingTop: 0 }}>
          <ProgressBar value={stats.progress} />
          <div className="row mono muted" style={{ fontSize: 10.5, marginTop: 7 }}>
            <span>{active ? `sending ${active.name}` : 'link idle'}</span>
            <span className="spacer" />
            <span>
              {active ? `${Math.round(pct(active.transferred, active.size))}%` : '—'} · session{' '}
              {Math.round(stats.progress)}%
            </span>
          </div>
        </div>
      </Panel>

      <TransferQueue items={items} direction="send" />
    </div>
  );
}
