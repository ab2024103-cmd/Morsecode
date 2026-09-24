import type { Direction, TransferItem } from '../../types';
import { Panel, EmptyState } from '../shared/Panel';
import { Button } from '../shared/Button';
import { TransferRow } from './TransferRow';
import { useTransferStore } from '../../store/useTransferStore';
import { formatBytes } from '../../lib/format';

interface TransferQueueProps {
  items: TransferItem[];
  direction: Direction;
  title?: string;
}

export function TransferQueue({ items, direction, title }: TransferQueueProps) {
  const clearCompleted = useTransferStore((s) => s.clearCompleted);
  const pauseAll = useTransferStore((s) => s.pauseAll);
  const total = items.reduce((sum, t) => sum + t.size, 0);
  const completed = items.filter((t) => t.status === 'done').length;

  return (
    <Panel
      title={title ?? (direction === 'send' ? 'Transfer Queue' : 'Incoming Queue')}
      flush
      actions={
        <>
          <span className="chip">
            {completed}/{items.length} · {formatBytes(total)}
          </span>
          <Button size="sm" variant="ghost" icon="pause" onClick={() => void pauseAll()} disabled={!items.length}>
            Pause
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => void clearCompleted()} disabled={!completed}>
            Clear done
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          title={direction === 'send' ? 'Queue is empty' : 'Nothing incoming'}
          body={
            direction === 'send'
              ? 'Pick one or more peers, then drop files to start a transfer. Items are processed sequentially per device.'
              : 'Incoming requests appear here after you accept them. Trusted devices skip the prompt.'
          }
        />
      ) : (
        <div className="queue">
          {items.map((item) => (
            <TransferRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </Panel>
  );
}
