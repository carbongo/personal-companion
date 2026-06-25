import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useToast } from "../components/Toast.tsx";
import { api, type AppState, type SetupValues } from "../lib/api.ts";
import { panelVariants } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";
import { AppearanceSection } from "./settings/Appearance.tsx";
import { ChannelsSection } from "./settings/Channels.tsx";
import { MemorySection } from "./settings/Memory.tsx";
import { MindSection } from "./settings/Mind.tsx";
import { PersonaSection } from "./settings/Persona.tsx";
import { SystemSection } from "./settings/System.tsx";
import { bodyFromForm, type Form, formFromValues, type SectionProps } from "./settings/types.ts";
import { VoiceSection } from "./settings/Voice.tsx";
import { WebSection } from "./settings/Web.tsx";
import { WeatherSection } from "./settings/Weather.tsx";

interface Category {
  id: string;
  label: string;
  glyph: string;
  icon: IconName;
  render: (p: SectionProps) => ReactNode;
}

const CATEGORIES: Category[] = [
  { id: "persona", label: "Persona", glyph: "Who they are", icon: "persona", render: (p) => <PersonaSection {...p} /> },
  { id: "mind", label: "The Mind", glyph: "Model & temperament", icon: "brain", render: (p) => <MindSection {...p} /> },
  { id: "memory", label: "Memory", glyph: "Core & chronicle", icon: "memory", render: (p) => <MemorySection {...p} /> },
  { id: "channels", label: "Channels", glyph: "Telegram & reach", icon: "channels", render: (p) => <ChannelsSection {...p} /> },
  { id: "voice", label: "Voice", glyph: "Speech to text", icon: "voice", render: (p) => <VoiceSection {...p} /> },
  { id: "web", label: "The Sight", glyph: "Web access", icon: "web", render: (p) => <WebSection {...p} /> },
  { id: "weather", label: "The Sky", glyph: "Location & weather", icon: "weather", render: (p) => <WeatherSection {...p} /> },
  { id: "atmosphere", label: "Atmosphere", glyph: "Sound & motion", icon: "appearance", render: () => <AppearanceSection /> },
  { id: "realm", label: "The Realm", glyph: "Access & host", icon: "security", render: (p) => <SystemSection {...p} /> },
];

function Reattuning() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center bg-bg-0/85 backdrop-blur-md"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-cyan/25 border-t-cyan shadow-[0_0_28px_rgba(88,199,214,.4)]" />
        <div className="display text-lg tracking-widest text-ink">Re-attuning</div>
        <div className="text-sm text-ink-dim">The slate is taking on its new configuration…</div>
      </div>
    </motion.div>
  );
}

export function Settings({ state }: { state: AppState }) {
  const toast = useToast();
  const [values, setValues] = useState<SetupValues | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef("");
  const [active, setActive] = useState("persona");
  const [saving, setSaving] = useState(false);
  const [reattuning, setReattuning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getSetup()
      .then((r) => {
        setValues(r.values);
        const f = formFromValues(r.values);
        setForm(f);
        baseline.current = JSON.stringify(f);
        if (!r.setupComplete) setActive("persona");
      })
      .catch(() => toast("Couldn't load settings.", "error"));
  }, [toast]);

  const dirty = useMemo(() => (form ? JSON.stringify(form) !== baseline.current : false), [form]);

  const set: SectionProps["set"] = (k, v) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const navigate = (id: string) => {
    if (id === active) return;
    setActive(id);
    sfx.play("tap");
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await api.saveSetup(bodyFromForm(form));
      baseline.current = JSON.stringify(form);
      setForm((f) => (f ? { ...f } : f)); // re-derive dirty=false
      if (res.restarting) {
        setReattuning(true);
        const start = Date.now();
        const poll = async () => {
          try {
            const r = await fetch("/health", { cache: "no-store" });
            if (r.ok) {
              window.location.reload();
              return;
            }
          } catch {
            /* still down */
          }
          if (Date.now() - start < 30000) setTimeout(poll, 700);
          else window.location.reload();
        };
        setTimeout(poll, 1500);
      } else {
        toast("Settings saved. Some changes apply after a restart.", "ok");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!form || !values) {
    return (
      <div className="grid h-full place-items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-cyan/25 border-t-cyan" />
      </div>
    );
  }

  const current = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];
  const props: SectionProps = { form, set, values, toast };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-0 px-2 sm:flex-row sm:gap-6 sm:px-5">
      {/* Rail */}
      <nav className="flex shrink-0 gap-2 overflow-x-auto py-3 sm:w-60 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:py-6">
        {!state.setupComplete && (
          <div className="mb-2 hidden rounded-xl border border-amber/30 bg-amber/5 px-3.5 py-2.5 text-[12.5px] text-amber-soft sm:block">
            First attunement — set the Persona and the Mind, then save.
          </div>
        )}
        {CATEGORIES.map((c) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              onClick={() => navigate(c.id)}
              onPointerEnter={() => sfx.play("hover")}
              className={`relative flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                on ? "text-ink" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {on && (
                <motion.span
                  layoutId="rail-active"
                  className="absolute inset-0 rounded-xl border border-cyan/35 bg-cyan/10 shadow-[0_0_22px_rgba(88,199,214,.18)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon name={c.icon} size={19} className={`relative ${on ? "text-cyan" : ""}`} />
              <span className="relative">
                <span className="block text-[14px] leading-tight">{c.label}</span>
                <span className="hidden text-[11.5px] text-ink-faint sm:block">{c.glyph}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto pb-28 pt-3 sm:pt-6">
        <AnimatePresence mode="wait">
          <motion.div key={active} variants={panelVariants} initial="initial" animate="enter" exit="exit">
            {current.render(props)}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Save bar */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4"
          >
            <div className="glass framed pointer-events-auto flex items-center gap-4 rounded-2xl px-4 py-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink-dim">
                <span className="dot amber" /> Unsaved changes
              </span>
              <button
                className="btn ghost"
                onClick={() => {
                  setForm(formFromValues(values));
                  baseline.current = JSON.stringify(formFromValues(values));
                  sfx.play("close");
                }}
              >
                Revert
              </button>
              <button className="btn amber" onClick={save} disabled={saving}>
                <Icon name={saving ? "restart" : "check"} size={16} className={saving ? "animate-spin" : ""} />
                {saving ? "Saving…" : "Attune & save"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {reattuning && <Reattuning />}
    </div>
  );
}
