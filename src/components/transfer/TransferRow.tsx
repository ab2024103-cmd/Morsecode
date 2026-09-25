import type { TransferItem } from '../../types';
import { Icon } from '../shared/Icon';
import { IconButton } from '../shared/Button';
import { ProgressBar } from '../shared/ProgressBar';
import { useTransferStore } from '../../store/useTransferStore';
import { formatBytes, formatEta, formatSpeed, pct } from '../../lib/format';

const STATUS_CHIP: Record<TransferItem['status'], string> = {
  queued: 'chip',
  handshaking: 'chip warnc',
  active: 'chip accent',
  paused: 'chip warnc',
  done: 'chip ok',
  failed: 'chip err',
  skipped: 'chip',
};

const STATUS_LABEL: Record<TransferItem['status'], string> = {
  queued: 'queued',
  handshaking: 'handshake',
  active: 'transferring',
  paused: 'paused',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

export function TransferRow({ item }: { item: TransferItem }) {
  const pause = useTransferStore((s) => s.pause);
  const resume = useTransferStore((s) => s.resume);
  const cancel = useTransferStore((s) => s.cancel);
  const progress = pct(item.transferred, item.size);
  const done = item.status === 'done';

  return (
    <div className="txrow">
      <span className="txrow-ico">
        <Icon name={item.direction === 'send' ? 'send' : 'download'} size={16} />
      </span>

      <div style={{ minWidth: 0 }}>
        <div className="txrow-top">
          <span className="txrow-name" title={item.path || item.name}>
            {item.name}
          </span>
          <span className={STATUS_CHIP[item.status]}>{STATUS_LABEL[item.status]}</span>
        </div>

        <div style={{ marginTop: 7 }}>
          <ProgressBar value={progress} indeterminate={item.status === 'handshaking'} />
        </div>

        <div className="txrow-sub">
          <span>
            {formatBytes(item.transferred)} / {formatBytes(item.size)}
          </span>
          <span>{Math.round(progress)}%</span>
          {item.status === 'active' && <span>{formatSpeed(item.speed)}</span>}
          {item.status === 'active' && <span>eta {formatEta(item.size - item.transferred, item.speed)}</span>}
          {item.status === 'paused' && <span>resume @ {formatBytes(item.resumeOffset)}</span>}
          {item.compressed && <span>zstd</span>}
          <span className="spacer" />
          <span>{item.deviceName}</span>
        </div>
      </div>

      <div className="txrow-actions">
        {!done && item.status !== 'paused' && (
          <IconButton icon="pause" label="Pause" onClick={() => void pause(item.id)} />
        )}
        {item.status === 'paused' && (
          <IconButton icon="play" label="Resume" onClick={() => void resume(item.id)} />
        )}
        <IconButton icon="x" label="Remove" onClick={() => void cancel(item.id)} />
      </div>
    </div>
  );
}
