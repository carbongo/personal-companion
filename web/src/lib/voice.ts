/**
 * Playback for spoken replies. The server synthesizes a reply paragraph by
 * paragraph and hands back a `/uploads/…` clip per paragraph, so playback is a
 * plain queue: clips play back to back through one <audio> element, and a clip
 * that hasn't arrived yet is simply waited for — the queue never restarts.
 *
 * One element is reused for everything on purpose. Browsers only let audio play
 * after a user gesture, and that permission attaches to the element — priming it
 * on the send click (`unlock`) is what lets later paragraphs, which land long
 * after the click, play by themselves.
 */
import { useSyncExternalStore } from "react";

/** A 0-sample wav: enough to satisfy the gesture requirement, silent. */
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

let el: HTMLAudioElement | null = null;
let queue: string[] = [];
let playing: string | null = null;
let unlocked = false;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function ensure(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.preload = "auto";
    el.addEventListener("ended", () => advance());
    // A clip that won't decode shouldn't strand the rest of the reply.
    el.addEventListener("error", () => advance());
  }
  return el;
}

/** Start the next queued clip, or fall idle when there's nothing waiting. */
function advance() {
  const a = ensure();
  if (!a) return;
  const url = queue.shift();
  if (!url) {
    playing = null;
    emit();
    return;
  }
  playing = url;
  emit();
  a.src = url;
  void a.play().catch(() => {
    // Refused (no gesture) or unreachable — drop the rest rather than spin;
    // the reply is on screen as text either way.
    queue = [];
    playing = null;
    emit();
  });
}

export const voice = {
  /**
   * Prime playback from inside a user gesture (the send click / Enter press), so
   * the paragraphs that arrive seconds later are allowed to play on their own.
   */
  unlock() {
    if (unlocked || playing) return;
    const a = ensure();
    if (!a) return;
    a.src = SILENCE;
    void a
      .play()
      .then(() => {
        unlocked = true;
      })
      .catch(() => {});
  },

  /** Queue a clip; it plays as soon as whatever is ahead of it finishes. */
  enqueue(url: string) {
    queue.push(url);
    if (!playing) advance();
  },

  /** Play a finished reply's clips in order, replacing anything in flight. */
  play(urls: string[]) {
    if (!urls.length) return;
    const a = ensure();
    if (a) a.pause();
    queue = urls.slice();
    playing = null;
    advance();
  },

  /** Silence everything now (the tap target on the speaking indicator). */
  stop() {
    queue = [];
    const a = ensure();
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    playing = null;
    emit();
  },

  /** The clip playing right now, if any. */
  current: () => playing,
};

/** React binding: the URL currently playing, or null. */
export function usePlayingVoice(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => playing,
    () => null,
  );
}
