import { useEffect, useRef, useState } from 'react';
import { useLogStore } from '../../store/useLogStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Panel } from '../shared/Panel';
import { IconButton } from '../shared/Button';
import { Icon } from '../shared/Icon';
import { formatTime } from '../../lib/format';

interface SystemLogProps {
  /** `rail` = compact ticker in the right rail, `screen` = full page view. */
  variant?: 'rail' | 'screen';
  maxHeight?: number;
}

/**
 * Real-time activity feed.
 * Required surface in HUD; in Classic it renders as an optional collapsible
 * panel governed by Settings → "Show activity feed".
 */
export function SystemLog({ variant = 'rail', maxHeight }: SystemLogProps) {
  const events = useLogStore((s) => s.events);
  const paused = useLogStore((s) => s.paused);
  const setPaused = useLogStore((s) => s.setPaused);
  const clear = useLogStore((s) => s.clear);
  const theme = useThemeStore((s) => s.theme);
  const showClassic = useSettingsStore((s) => s.settings.showSystemLogClassic);
  const [open, setOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant === 'screen' || theme === 'hud') setOpen(true);
  }, [theme, variant]);

  useEffect(() => {
    const el = scroller.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [events, open]);

  if (variant === 'rail' && theme === 'classic' && !showClassic) return null;

  const body = (
    <div
      className="log"
      ref={scroller}
      style={maxHeight ? { ['--log-h' as string]: `${maxHeight}px` } : undefined}
    >
      {events.length === 0 && <div className="muted">waiting for events…</div>}
      {events.map((event) => (
        <div className="log-line" key={event.id} data-level={event.level}>
          <span className="log-ts">{formatTime(event.ts)}</span>
          <span className="log-tag">{event.tag}</span>
          <span className="log-msg">{event.message}</span>
        </div>
      ))}
    </div>
  );

  const actions = (
    <>
      <span className="chip">{events.length}</span>
      <IconButton
        icon={paused ? 'play' : 'pause'}
        label={paused ? 'Resume feed' : 'Pause feed'}
        onClick={() => setPaused(!paused)}
      />
      <IconButton icon="trash" label="Clear log" onClick={clear} />
      {variant === 'rail' && theme === 'classic' && (
        <IconButton
          icon="chevron"
          label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        />
      )}
    </>
  );

  return (
    <Panel title="System Log" actions={actions} flush>
      {open ? (
        body
      ) : (
        <div
          className="log-collapse"
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
        >
          <Icon name="terminal" size={14} />
          <span className="mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {events.at(-1)?.message ?? 'no events yet'}
          </span>
          <span className="spacer" />
          <span className="chip">show</span>
        </div>
      )}
    </Panel>
  );
}
