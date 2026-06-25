import { motion } from "motion/react";
import type { AppState } from "../lib/api.ts";
import { sfx, useSound } from "../lib/sound.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type Route = "chat" | "settings";

function Sigil() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" className="drop-shadow-[0_0_8px_rgba(88,199,214,.55)]">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-cyan)" strokeWidth="1.2" opacity="0.55" />
      <path d="M12 4.5c3 3.2 3 12 0 15-3-3-3-11.8 0-15z" fill="none" stroke="var(--color-cyan)" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="2.1" fill="var(--color-cyan)" />
    </svg>
  );
}

const TABS: { id: Route; label: string; icon: IconName }[] = [
  { id: "chat", label: "Converse", icon: "chat" },
  { id: "settings", label: "Slate", icon: "settings" },
];

export function TopBar({
  state,
  route,
  onNavigate,
  authEnabled,
}: {
  state: AppState;
  route: Route;
  onNavigate: (r: Route) => void;
  authEnabled: boolean;
}) {
  const sound = useSound();
  return (
    <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-4 px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Sigil />
        <div className="leading-none">
          <div className="display text-[17px] tracking-[0.16em] text-ink">{state.app.name}</div>
          <div className="mt-1 hidden font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-faint sm:block">
            {state.brain.model || "no model"}
          </div>
        </div>
      </div>

      <nav className="ml-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-black/25 p-1 backdrop-blur-md">
        {TABS.map((t) => {
          const active = route === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                if (!active) {
                  onNavigate(t.id);
                  sfx.play("open");
                }
              }}
              onPointerEnter={() => sfx.play("hover")}
              className={`relative flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors sm:px-4 ${
                active ? "text-ink" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full border border-cyan/40 bg-cyan/10 shadow-[0_0_18px_rgba(88,199,214,.25)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon name={t.icon} size={16} className="relative" />
              <span className="relative hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <button
        onClick={() => sound.toggle()}
        onPointerEnter={() => sfx.play("hover")}
        className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-black/25 text-ink-dim transition hover:border-cyan/40 hover:text-cyan"
        aria-label={sound.on ? "Mute interface sounds" : "Enable interface sounds"}
        title={sound.on ? "Sound on" : "Sound off"}
      >
        <Icon name={sound.on ? "sound" : "mute"} size={18} />
      </button>

      {authEnabled && (
        <a
          href="/logout"
          onPointerEnter={() => sfx.play("hover")}
          className="hidden h-9 items-center rounded-full border border-[var(--line)] bg-black/25 px-3 text-[13px] text-ink-faint transition hover:border-danger/40 hover:text-danger sm:flex"
        >
          Seal
        </a>
      )}
    </header>
  );
}
