import type { HistoryEntry, HistoryStatus } from '../../types';
import { EmptyState } from '../shared/Panel';
import { formatBytes, formatDateTime, formatDuration, formatSpeed } from '../../lib/format';

const CHIP: Record<HistoryStatus, string> = {
  sent: 'chip accent',
  received: 'chip ok',
  failed: 'chip err',
  skipped: 'chip',
};

export function HistoryTable({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) {
    return <EmptyState title="No matching transfers" body="History is written locally to SQLite — nothing ever leaves this machine." />;
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Device</th>
            <th>File</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Avg speed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="mono">{formatDateTime(entry.ts)}</td>
              <td>{entry.deviceName}</td>
              <td title={entry.fileName} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.fileName}
              </td>
              <td className="mono">{formatBytes(entry.size)}</td>
              <td className="mono">{formatDuration(entry.durationMs)}</td>
              <td className="mono">
                {entry.durationMs > 0 ? formatSpeed(entry.size / (entry.durationMs / 1000)) : '—'}
              </td>
              <td>
                <span className={CHIP[entry.status]}>{entry.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
