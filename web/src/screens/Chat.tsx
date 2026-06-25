import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useToast } from "../components/Toast.tsx";
import { api, type AppState, type ChatMessage } from "../lib/api.ts";
import { formatTime, greeting, renderMarkdown } from "../lib/format.tsx";
import { sfx } from "../lib/sound.ts";

/** A delivery state for the messages you send, mirrored on the bubble like a
 *  messenger: one tick = queued (batching, not sent yet, or it errored), two
 *  ticks = the whole burst was batched and delivered. */
type Status = "queued" | "sent";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  mediaUrls: string[];
  createdAt: string;
  /** Assistant placeholder while the model gathers itself. */
  pending?: boolean;
  /** Delivery state, on your own messages only. */
  status?: Status;
}

/** One queued outgoing message awaiting the batch flush. */
interface Queued {
  id: string;
  text: string;
  images: string[];
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** Mirror of the server's growing idle window (batcher.ts): wait longer for the
 *  next message the more a burst grows, capped at `maxMs`. */
function idleWindow(count: number, idleMs: number, stepMs: number, maxMs: number): number {
  return Math.min(idleMs + stepMs * Math.max(0, count - 1), maxMs);
}

/** Split a finished reply into paragraph blocks (same rule as the server). */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1)); // strip data: prefix
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function Ticks({ status }: { status: Status }) {
  const sent = status === "sent";
  return (
    <span
      className={`transition-colors ${sent ? "text-cyan" : "text-ink-faint"}`}
      title={sent ? "Batched & delivered" : "Queued — not sent yet"}
    >
      <Icon name={sent ? "checks" : "check"} size={13} strokeWidth={2} />
    </span>
  );
}

function Bubble({ m }: { m: Bubble }) {
  const mine = m.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className={`group max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`relative rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed ${
            mine
              ? "rounded-br-md border border-cyan/25 bg-gradient-to-br from-cyan/15 to-cyan/[0.04] text-ink"
              : "glass framed rounded-bl-md text-ink"
          }`}
        >
          {m.mediaUrls.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {m.mediaUrls.map((u) => (
                <img key={u} src={u} alt="" className="max-h-52 rounded-lg border border-[var(--line)]" />
              ))}
            </div>
          )}
          {m.pending ? (
            <span className="thinking font-medium">thinking…</span>
          ) : (
            <div className="whitespace-pre-wrap break-words">{renderMarkdown(m.content)}</div>
          )}
        </div>
        <span className="flex items-center gap-1 px-1 font-mono text-[10.5px] text-ink-faint">
          <span className="opacity-0 transition group-hover:opacity-100">{formatTime(m.createdAt)}</span>
          {mine && m.status && <Ticks status={m.status} />}
        </span>
      </div>
    </motion.div>
  );
}

export function Chat({ state }: { state: AppState }) {
  const toast = useToast();
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ b64: string; preview: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Batching state: a queue of unsent messages and the debounce timer. A flush
  // folds the whole queue into one turn (like Telegram), so a burst gets a
  // single reply. inflight guards against starting a second stream at once.
  const queueRef = useRef<Queued[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflightRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }, []);

  useEffect(() => {
    api
      .messages()
      .then((r) => setMessages(historyToBubbles(r.messages)))
      .then(() => scrollToBottom(false))
      .catch(() => {});
  }, [scrollToBottom]);

  // Auto-grow the composer.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  }, [text]);

  // Drop the pending timer on unmount.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const armTimer = () => {
    clearTimeout(timerRef.current);
    const wait = idleWindow(
      Math.max(1, queueRef.current.length),
      state.chat.batchIdleMs,
      state.chat.batchStepMs,
      state.chat.batchMaxMs,
    );
    timerRef.current = setTimeout(() => flushRef.current(), wait);
  };

  const flush = async () => {
    if (inflightRef.current) return; // a stream is running; finish it first
    const batch = queueRef.current.slice();
    if (!batch.length) return;

    const ids = new Set(batch.map((b) => b.id));
    const combinedText = batch
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n");
    const payloadImages = batch.flatMap((b) => b.images);

    inflightRef.current = true;
    const thinkingId = uid("think");
    setMessages((m) => [
      ...m,
      { id: thinkingId, role: "assistant", content: "", mediaUrls: [], createdAt: nowIso(), pending: true },
    ]);
    scrollToBottom();

    let paraCount = 0;
    const onParagraph = (p: string) => {
      paraCount += 1;
      if (paraCount === 1) {
        setMessages((m) =>
          m.map((x) => (x.id === thinkingId ? { ...x, content: p, pending: false, createdAt: nowIso() } : x)),
        );
      } else {
        setMessages((m) => [
          ...m,
          { id: `${thinkingId}-${paraCount}`, role: "assistant", content: p, mediaUrls: [], createdAt: nowIso() },
        ]);
      }
      sfx.play("receive");
      scrollToBottom();
    };

    let ok = false;
    try {
      await api.sendStream(
        {
          text: combinedText,
          images: payloadImages.length ? payloadImages : undefined,
          kind: payloadImages.length ? "photo" : "text",
        },
        onParagraph,
      );
      ok = true;
      // Mark the whole burst delivered (double ticks) and drop it from the queue.
      setMessages((m) =>
        m
          .filter((x) => !(x.id === thinkingId && x.pending)) // no paragraphs? clear placeholder
          .map((x) => (ids.has(x.id) ? { ...x, status: "sent" as Status } : x)),
      );
      queueRef.current = queueRef.current.filter((it) => !ids.has(it.id));
    } catch (e) {
      // Leave the burst queued (single tick) so the next send re-includes it.
      setMessages((m) => m.filter((x) => x.id !== thinkingId));
      toast((e as Error).message || "The companion couldn't reply.", "error");
    } finally {
      inflightRef.current = false;
      scrollToBottom();
      // Anything queued during the stream (or a fresh send) goes next; an errored
      // burst waits for the next message rather than hammering a down model.
      if (ok && queueRef.current.length) armTimer();
    }
  };
  // Always schedule the latest flush from the (possibly stale) idle timer.
  flushRef.current = () => void flush();

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const next: { b64: string; preview: string }[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith("image/")) continue;
      next.push({ b64: await fileToBase64(f), preview: URL.createObjectURL(f) });
    }
    if (next.length) {
      setImages((p) => [...p, ...next].slice(0, 4));
      sfx.play("tap");
    }
  };

  // Queue a message into the current burst (it sends after the idle window).
  const queue = () => {
    const bodyText = text.trim();
    if (!bodyText && images.length === 0) return;
    const id = uid("msg");
    queueRef.current = [...queueRef.current, { id, text: bodyText, images: images.map((i) => i.b64) }];
    setMessages((m) => [
      ...m,
      {
        id,
        role: "user",
        content: bodyText,
        mediaUrls: images.map((i) => i.preview),
        createdAt: nowIso(),
        status: "queued",
      },
    ]);
    setText("");
    setImages([]);
    sfx.play("send");
    scrollToBottom();
    armTimer();
  };

  const toggleRecord = async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        for (const t of stream.getTracks()) t.stop();
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) return;
        try {
          const { text: said } = await api.transcribe(blob);
          setText((t) => (t ? `${t} ${said}` : said));
          sfx.play("confirm");
          taRef.current?.focus();
        } catch (e) {
          toast((e as Error).message || "Couldn't transcribe.", "error");
        }
      };
      rec.start();
      setRecording(true);
      sfx.play("open");
    } catch {
      toast("Microphone unavailable.", "error");
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-5">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-6">
        {empty ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <div className="eyebrow mb-3">{greeting()}, {state.app.owner || "traveler"}</div>
            <h1 className="display text-3xl text-ink">{state.app.name}</h1>
            <div className="rune-line mx-auto mt-6 w-56" />
            <p className="mt-6 max-w-sm text-sm text-ink-dim">
              {state.companionConfigured
                ? "The slate is awake. Speak, and it will answer."
                : "No model is attuned yet. Open the Slate to choose one."}
            </p>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="shrink-0 pb-4 pt-2">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((im, i) => (
              <div key={im.preview} className="relative">
                <img src={im.preview} alt="" className="h-16 w-16 rounded-lg border border-[var(--line)] object-cover" />
                <button
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-[var(--line-strong)] bg-bg-0 text-ink-dim hover:text-danger"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="glass framed flex items-end gap-2 rounded-2xl p-2">
          <label
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl text-ink-faint transition hover:bg-white/5 hover:text-cyan"
            title="Attach image"
            onPointerEnter={() => sfx.play("hover")}
          >
            <Icon name="image" size={19} />
            <input type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} />
          </label>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                queue();
              }
            }}
            rows={1}
            placeholder={`Message ${state.app.name}…`}
            className="max-h-[168px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />

          {state.chat.voice && (
            <button
              onClick={toggleRecord}
              onPointerEnter={() => sfx.play("hover")}
              className={`grid h-10 w-10 place-items-center rounded-xl transition ${
                recording
                  ? "bg-danger/15 text-danger shadow-[0_0_16px_rgba(217,89,76,.4)]"
                  : "text-ink-faint hover:bg-white/5 hover:text-cyan"
              }`}
              title={recording ? "Stop & transcribe" : "Hold a thought aloud"}
            >
              {recording ? (
                <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                  <Icon name="mic" size={19} />
                </motion.span>
              ) : (
                <Icon name="mic" size={19} />
              )}
            </button>
          )}

          <button
            onClick={queue}
            disabled={!text.trim() && images.length === 0}
            onPointerEnter={() => sfx.play("hover")}
            className="btn grid h-10 w-10 !rounded-xl !p-0"
            title="Send"
          >
            <Icon name="send" size={19} />
          </button>
        </div>
        <div className="mt-1.5 px-2 text-center font-mono text-[10.5px] text-ink-faint">
          Enter to send · Shift+Enter for a new line · bursts batch into one reply
        </div>
      </div>
    </div>
  );
}

/** Turn stored history into bubbles: your messages show as delivered; the
 *  companion's replies are split back into the paragraphs they were sent as. */
function historyToBubbles(rows: ChatMessage[]): Bubble[] {
  const out: Bubble[] = [];
  for (const m of rows) {
    if (m.role === "user") {
      out.push({
        id: `m${m.id}`,
        role: "user",
        content: m.content,
        mediaUrls: m.mediaUrls,
        createdAt: m.createdAt,
        status: "sent",
      });
    } else {
      const paras = splitParagraphs(m.content);
      const blocks = paras.length ? paras : [m.content];
      blocks.forEach((p, i) => {
        out.push({
          id: `m${m.id}-${i}`,
          role: "assistant",
          content: p,
          mediaUrls: i === 0 ? m.mediaUrls : [],
          createdAt: m.createdAt,
        });
      });
    }
  }
  return out;
}
