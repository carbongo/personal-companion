import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useToast } from "../components/Toast.tsx";
import { api, type AppState, type ChatMessage } from "../lib/api.ts";
import { formatTime, greeting, renderMarkdown } from "../lib/format.tsx";
import { sfx } from "../lib/sound.ts";

interface Pending {
  id: number;
  role: "user" | "assistant";
  content: string;
  mediaUrls: string[];
  createdAt: string;
  pending?: boolean;
}

function nowIso() {
  return new Date().toISOString();
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

function Bubble({ m }: { m: Pending }) {
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
        <span className="px-1 font-mono text-[10.5px] text-ink-faint opacity-0 transition group-hover:opacity-100">
          {formatTime(m.createdAt)}
        </span>
      </div>
    </motion.div>
  );
}

export function Chat({ state }: { state: AppState }) {
  const toast = useToast();
  const [messages, setMessages] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ b64: string; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
      .then((r) =>
        setMessages(
          r.messages.map((m: ChatMessage) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
            mediaUrls: m.mediaUrls,
            createdAt: m.createdAt,
          })),
        ),
      )
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

  const send = async () => {
    const body = text.trim();
    if ((!body && images.length === 0) || busy) return;
    const userMsg: Pending = {
      id: -Date.now(),
      role: "user",
      content: body,
      mediaUrls: images.map((i) => i.preview),
      createdAt: nowIso(),
    };
    const thinkingId = -Date.now() - 1;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: thinkingId, role: "assistant", content: "", mediaUrls: [], createdAt: nowIso(), pending: true },
    ]);
    const payloadImages = images.map((i) => i.b64);
    setText("");
    setImages([]);
    setBusy(true);
    sfx.play("send");
    scrollToBottom();
    try {
      const { reply } = await api.send({
        text: body,
        images: payloadImages.length ? payloadImages : undefined,
        kind: payloadImages.length ? "photo" : "text",
      });
      setMessages((m) =>
        m.map((x) => (x.id === thinkingId ? { ...x, content: reply, pending: false, createdAt: nowIso() } : x)),
      );
      sfx.play("receive");
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== thinkingId));
      toast((e as Error).message || "The companion couldn't reply.", "error");
    } finally {
      setBusy(false);
      scrollToBottom();
    }
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
                send();
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
            onClick={send}
            disabled={busy || (!text.trim() && images.length === 0)}
            onPointerEnter={() => sfx.play("hover")}
            className="btn grid h-10 w-10 !rounded-xl !p-0"
            title="Send"
          >
            <Icon name="send" size={19} />
          </button>
        </div>
        <div className="mt-1.5 px-2 text-center font-mono text-[10.5px] text-ink-faint">
          Enter to send · Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}
