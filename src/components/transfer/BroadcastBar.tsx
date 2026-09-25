import type { Device } from '../../types';
import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';

interface BroadcastBarProps {
  devices: Device[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/** Multi-target selector — the same file set streams to every checked peer. */
export function BroadcastBar({ devices, selected, onToggle, onSelectAll, onClear }: BroadcastBarProps) {
  return (
    <div className="broadcast">
      <span className="chip accent">
        <Icon name="broadcast" size={11} /> broadcast
      </span>

      {devices.length === 0 && <span className="muted">No peers discovered yet.</span>}

      {devices.map((device) => {
        const on = selected.includes(device.id);
        return (
          <button key={device.id} type="button" className="bc-target" data-on={on} onClick={() => onToggle(device.id)}>
            <Icon name={on ? 'check' : 'monitor'} size={12} />
            {device.name}
            {device.trusted && <Icon name="shield" size={11} />}
          </button>
        );
      })}

      <span className="spacer" />
      <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={!devices.length}>
        All
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={!selected.length}>
        None
      </Button>
      <span className="chip">{selected.length} target{selected.length === 1 ? '' : 's'}</span>
    </div>
  );
}
