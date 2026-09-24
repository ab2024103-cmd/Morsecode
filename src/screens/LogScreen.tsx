import { SystemLog } from '../components/log/SystemLog';
import { Panel } from '../components/shared/Panel';
import { useLogStore } from '../store/useLogStore';
import type { LogLevel } from '../types';

const LEVELS: LogLevel[] = ['info', 'ok', 'warn', 'error'];

export function LogScreen() {
  const events = useLogStore((s) => s.events);
  const counts = LEVELS.map((level) => ({
    level,
    count: events.filter((e) => e.level === level).length,
  }));

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">System Log</h1>
          <p className="screen-sub">
            Live internal event ticker — discovery, handshakes, transfers, trust changes and errors.
          </p>
        </div>
        <div className="row">
          {counts.map(({ level, count }) => (
            <span
              key={level}
              className={
                level === 'error' ? 'chip err' : level === 'warn' ? 'chip warnc' : level === 'ok' ? 'chip ok' : 'chip'
              }
            >
              {level} {count}
            </span>
          ))}
        </div>
      </div>

      <SystemLog variant="screen" maxHeight={560} />

      <Panel title="Event tags">
        <div className="row wrap" style={{ gap: 8 }}>
          {['CORE', 'MDNS', 'NET', 'CRYPTO', 'TX', 'RX', 'TRUST', 'CLIP', 'DB'].map((tag) => (
            <span key={tag} className="chip accent">
              {tag}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
