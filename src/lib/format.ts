export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0.0 MB/s';
  const mb = bytesPerSecond / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatEta(remainingBytes: number, speed: number): string {
  if (speed <= 0) return '—';
  return formatDuration((remainingBytes / speed) * 1000);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' })} ${d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 45_000) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Deterministic morse rendering of a short string — used as decorative texture. */
const MORSE: Record<string, string> = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

export function toMorse(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => (ch === ' ' ? '/' : MORSE[ch] ?? ''))
    .filter(Boolean)
    .join(' ');
}
