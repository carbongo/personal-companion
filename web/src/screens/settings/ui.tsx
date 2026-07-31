/** Layout primitives shared by every settings panel. */
import { motion } from "motion/react";
import type { ReactNode } from "react";

export function SectionIntro({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-6">
      <h2 className="display text-[22px] text-ink">{title}</h2>
      <p className="mt-1.5 max-w-xl text-sm text-ink-dim">{blurb}</p>
      <div className="rune-line mt-4 w-full max-w-md" />
    </div>
  );
}

export function SubTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-0.5 border-b border-[var(--line)] pb-0">
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`relative px-3.5 py-3 text-[14px] transition-colors ${
              on ? "text-ink" : "text-ink-faint hover:text-ink-dim"
            }`}
          >
            {on && (
              <motion.span
                layoutId="subtab-active"
                className="absolute inset-x-0 -bottom-1 h-0.5 bg-cyan"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-black/15 p-4 sm:p-5">
      {title && <div className="eyebrow mb-4">{title}</div>}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

export function ToggleRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-black/10 px-4 py-3">
      <div>
        <div className="text-[14px] text-ink">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] text-ink-faint">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
