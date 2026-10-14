/**
 * Notification sounds — synthesized with the Web Audio API so the bundle
 * ships zero audio assets. Four distinct, deliberately LOUD chimes:
 *
 *   success  — bright rising major arpeggio (transfer finished)
 *   error    — harsh low double-buzz (transfer failed)
 *   request  — insistent doorbell ding-dong ×2 (incoming files)
 *   info     — clean double ping (everything else)
 *
 * `single` mode plays the info ping for every event; `off` is silent.
 */
import type { ToastKind } from '../types';

export type SoundMode = 'multi' | 'single' | 'off';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // Autoplay policies start contexts suspended until a user gesture.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Unlock the context on the first user gesture so later event-driven sounds
// (which happen outside any gesture) are allowed to play.
if (typeof window !== 'undefined') {
  const unlock = () => {
    ensureCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

interface ToneSpec {
  /** Start offset in seconds relative to the chime start. */
  at: number;
  freq: number;
  /** Glide to this frequency over the tone's duration. */
  to?: number;
  dur: number;
  type?: OscillatorType;
  /** Peak linear gain for this partial (pre-compressor). */
  gain?: number;
}

function schedule(ac: AudioContext, out: AudioNode, t0: number, tones: ToneSpec[]) {
  for (const t of tones) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const start = t0 + t.at;
    const peak = t.gain ?? 1;
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    // Fast attack, exponential release — percussive "chime" envelope.
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start + t.dur + 0.05);
  }
}

const CHIMES: Record<ToastKind, ToneSpec[]> = {
  // Rising C-major sparkle, doubled an octave up for brightness.
  success: [
    { at: 0.0, freq: 523.25, dur: 0.18, type: 'triangle', gain: 0.9 },
    { at: 0.09, freq: 659.25, dur: 0.18, type: 'triangle', gain: 0.9 },
    { at: 0.18, freq: 783.99, dur: 0.22, type: 'triangle', gain: 0.9 },
    { at: 0.3, freq: 1046.5, dur: 0.55, type: 'triangle', gain: 1.0 },
    { at: 0.3, freq: 2093.0, dur: 0.4, type: 'sine', gain: 0.35 },
  ],
  // Two low dissonant buzzes — unmistakably "something went wrong".
  error: [
    { at: 0.0, freq: 220, to: 164.8, dur: 0.28, type: 'sawtooth', gain: 0.8 },
    { at: 0.0, freq: 233, to: 174.6, dur: 0.28, type: 'square', gain: 0.4 },
    { at: 0.38, freq: 220, to: 138.6, dur: 0.42, type: 'sawtooth', gain: 0.9 },
    { at: 0.38, freq: 233, to: 146.8, dur: 0.42, type: 'square', gain: 0.45 },
  ],
  // Doorbell ding-dong, twice — someone is at the (transfer) door.
  request: [
    { at: 0.0, freq: 659.25, dur: 0.4, type: 'triangle', gain: 1.0 },
    { at: 0.0, freq: 1318.5, dur: 0.25, type: 'sine', gain: 0.3 },
    { at: 0.28, freq: 523.25, dur: 0.5, type: 'triangle', gain: 1.0 },
    { at: 0.28, freq: 1046.5, dur: 0.3, type: 'sine', gain: 0.3 },
    { at: 0.85, freq: 659.25, dur: 0.4, type: 'triangle', gain: 1.0 },
    { at: 0.85, freq: 1318.5, dur: 0.25, type: 'sine', gain: 0.3 },
    { at: 1.13, freq: 523.25, dur: 0.6, type: 'triangle', gain: 1.0 },
    { at: 1.13, freq: 1046.5, dur: 0.35, type: 'sine', gain: 0.3 },
  ],
  // Clean double ping.
  info: [
    { at: 0.0, freq: 880, dur: 0.22, type: 'triangle', gain: 0.9 },
    { at: 0.16, freq: 880, dur: 0.45, type: 'triangle', gain: 1.0 },
    { at: 0.16, freq: 1760, dur: 0.3, type: 'sine', gain: 0.3 },
  ],
};

/**
 * Play the chime for a notification. Safe to call from anywhere — silently
 * does nothing when the mode is `off` or audio is unavailable.
 */
export function playNotification(kind: ToastKind, mode: SoundMode): void {
  if (mode === 'off') return;
  const ac = ensureCtx();
  if (!ac || ac.state !== 'running') return;

  const chime = CHIMES[mode === 'single' ? 'info' : kind] ?? CHIMES.info;

  // Master chain: hot gain into a compressor so the chimes are loud without
  // clipping the output.
  const master = ac.createGain();
  master.gain.value = 1.4;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 18;
  comp.ratio.value = 10;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ac.destination);

  schedule(ac, master, ac.currentTime + 0.01, chime);

  // Free the per-chime nodes once the longest tone has finished.
  const total = Math.max(...chime.map((t) => t.at + t.dur)) + 0.3;
  window.setTimeout(() => {
    try {
      master.disconnect();
      comp.disconnect();
    } catch {
      /* already gone */
    }
  }, total * 1000);
}
