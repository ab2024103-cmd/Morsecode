import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';
import { useHistoryStore, type HistoryTab } from '../../store/useHistoryStore';

const TABS: Array<{ id: HistoryTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
  { id: 'failed', label: 'Failed' },
];

export function HistoryFilters({ count }: { count: number }) {
  const { tab, setTab, query, setQuery, exportCsv, clear } = useHistoryStore();

  return (
    <div className="row wrap" style={{ gap: 10 }}>
      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            className="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ flex: 1, minWidth: 200, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 11, opacity: 0.55, pointerEvents: 'none', display: 'grid' }}>
          <Icon name="search" size={14} />
        </span>
        <input
          className="input"
          style={{ paddingLeft: 32 }}
          value={query}
          placeholder="Search file, device or status…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <span className="chip">{count} rows</span>
      <Button size="sm" icon="download" onClick={() => void exportCsv()} disabled={!count}>
        Export CSV
      </Button>
      <Button size="sm" variant="danger" icon="trash" onClick={() => void clear()} disabled={!count}>
        Clear
      </Button>
    </div>
  );
}
