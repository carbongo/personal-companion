/** Glassy, self-dismissing notices anchored bottom-center. */
import { AnimatePresence, motion } from "motion/react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { sfx } from "../lib/sound.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type Tone = "ok" | "info" | "error";
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ICON: Record<Tone, IconName> = { ok: "check", info: "sparkle", error: "close" };
const ACCENT: Record<Tone, string> = {
  ok: "text-jade",
  info: "text-cyan",
  error: "text-danger",
};

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: Tone = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, tone, text }]);
    sfx.play(tone === "error" ? "error" : tone === "ok" ? "confirm" : "tap");
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="glass pointer-events-auto flex max-w-[90vw] items-center gap-2.5 px-4 py-2.5 text-sm"
            >
              <Icon name={ICON[t.tone]} size={16} className={ACCENT[t.tone]} />
              <span className="text-ink">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
