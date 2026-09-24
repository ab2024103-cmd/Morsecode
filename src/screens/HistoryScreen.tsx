import { useMemo } from 'react';
import { Panel } from '../components/shared/Panel';
import { HistoryFilters } from '../components/history/HistoryFilters';
import { HistoryTable } from '../components/history/HistoryTable';
import { useHistoryStore, filterHistory } from '../store/useHistoryStore';
import { formatBytes } from '../lib/format';

export function HistoryScreen() {
  const entries = useHistoryStore((s) => s.entries);
  const tab = useHistoryStore((s) => s.tab);
  const query = useHistoryStore((s) => s.query);

  const rows = useMemo(() => filterHistory(entries, tab, query), [entries, tab, query]);
  const totals = useMemo(
    () => ({
      sent: entries.filter((e) => e.status === 'sent').reduce((sum, e) => sum + e.size, 0),
      received: entries.filter((e) => e.status === 'received').reduce((sum, e) => sum + e.size, 0),
      failed: entries.filter((e) => e.status === 'failed').length,
    }),
    [entries],
  );

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">History</h1>
          <p className="screen-sub">Local SQLite log — timestamp, device, file, size, duration, status.</p>
        </div>
        <div className="row">
          <span className="chip accent">↑ {formatBytes(totals.sent)}</span>
          <span className="chip ok">↓ {formatBytes(totals.received)}</span>
          <span className="chip err">{totals.failed} failed</span>
        </div>
      </div>

      <Panel>
        <HistoryFilters count={rows.length} />
      </Panel>

      <Panel flush>
        <HistoryTable entries={rows} />
      </Panel>
    </div>
  );
}
