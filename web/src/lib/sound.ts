/**
 * The Slate's voice — a tiny WebAudio synth so the UI has soft, glassy chimes
 * with zero binary assets. Low-volume; every cue is a couple of
 * shaped oscillators. Muteable, persisted, and dead silent until the first user
 * gesture (browsers forbid audio before then).
 */
import { useSyncExternalStore } from "react";

type Cue = "hover" | "tap" | "toggle" | "open" | "close" | "send" | "receive" | "confirm" | "error";

const KEY = "companion.sound";
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Resume the audio graph on the first interaction, once.
if (typeof window !== "undefined") {
  const wake = () => {
    ensure();
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("keydown", wake);
  };
  window.addEventListener("pointerdown", wake, { once: true });
  window.addEventListener("keydown", wake, { once: true });
}

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; glideTo?: number; delay?: number } = {},
) {
  const ac = ensure();
  if (!ac || !master) return;
  const { type = "sine", gain = 0.08, glideTo, delay = 0 } = opts;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const cues: Record<Cue, () => void> = {
  hover: () => tone(1180, 0.05, { type: "triangle", gain: 0.014 }),
  tap: () => {
    tone(560, 0.07, { type: "sine", gain: 0.05, glideTo: 660 });
    tone(1320, 0.04, { type: "triangle", gain: 0.02 });
  },
  toggle: () => tone(720, 0.06, { type: "square", gain: 0.025, glideTo: 880 }),
  open: () => {
    tone(300, 0.22, { type: "sine", gain: 0.05, glideTo: 540 });
    tone(900, 0.18, { type: "triangle", gain: 0.018, delay: 0.03 });
  },
  close: () => tone(520, 0.2, { type: "sine", gain: 0.04, glideTo: 280 }),
  send: () => tone(620, 0.1, { type: "sine", gain: 0.05, glideTo: 980 }),
  receive: () => {
    tone(1318, 0.5, { type: "sine", gain: 0.035 });
    tone(1976, 0.42, { type: "triangle", gain: 0.012, delay: 0.02 });
  },
  confirm: () => {
    tone(587, 0.16, { type: "sine", gain: 0.05 });
    tone(880, 0.32, { type: "sine", gain: 0.045, delay: 0.1 });
  },
  error: () => tone(170, 0.18, { type: "sawtooth", gain: 0.04, glideTo: 120 }),
};

export const sfx = {
  play(cue: Cue) {
    if (!enabled) return;
    try {
      cues[cue]();
    } catch {
      /* audio is a nicety; never let it throw into the UI */
    }
  },
  isEnabled: () => enabled,
  set(on: boolean) {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
    if (on) cues.toggle();
    emit();
  },
  toggle() {
    this.set(!enabled);
  },
};

/** React binding so toggles re-render everywhere the state is shown. */
export function useSound() {
  const on = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
    () => true,
  );
  return { on, toggle: () => sfx.toggle(), play: (c: Cue) => sfx.play(c) };
}
