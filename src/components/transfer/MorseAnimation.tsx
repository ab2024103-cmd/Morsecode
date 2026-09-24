import logoUrl from '../../assets/logo.png';
import type { Direction } from '../../types';

interface MorseAnimationProps {
  fromLabel: string;
  toLabel: string;
  direction: Direction;
  active: boolean;
  /** 0–100, speeds the pattern up as throughput rises. */
  intensity?: number;
}

/** Morse pattern travelling along the link — "-- --- .-. ... ." (MORSE). */
const PATTERN: Array<'dot' | 'dash'> = [
  'dash', 'dash', 'dot', 'dash', 'dash', 'dash', 'dot', 'dash', 'dash', 'dot',
  'dot', 'dot', 'dot', 'dot',
];

export function MorseAnimation({ fromLabel, toLabel, direction, active, intensity = 50 }: MorseAnimationProps) {
  const duration = 3.6 - Math.min(2.2, (intensity / 100) * 2.2);
  return (
    <div className="morse" data-direction={direction} data-idle={!active}>
      <div className="morse-node">
        <span className="avatar">
          {direction === 'send' ? <img src={logoUrl} alt="" style={{ width: '70%' }} /> : fromLabel.slice(0, 2).toUpperCase()}
        </span>
        <span>{fromLabel}</span>
      </div>

      <div className="morse-track">
        {PATTERN.map((kind, i) => (
          <i
            key={`${kind}-${i}`}
            className="morse-unit"
            data-kind={kind}
            style={{
              ['--delay' as string]: `${(i * duration) / PATTERN.length}s`,
              ['--dur' as string]: `${duration}s`,
            }}
          />
        ))}
      </div>

      <div className="morse-node">
        <span className="avatar">
          {direction === 'receive' ? <img src={logoUrl} alt="" style={{ width: '70%' }} /> : toLabel.slice(0, 2).toUpperCase()}
        </span>
        <span>{toLabel}</span>
      </div>
    </div>
  );
}
