import { useEffect, useRef, useState } from "react";
import { Field, TextArea, Toggle } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { api, type ChatMessage, type DailySummary, type Memory } from "../../lib/api.ts";
import { formatTime, renderMarkdown } from "../../lib/format.tsx";
import { sfx } from "../../lib/sound.ts";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

/** One day in the chronicle: the companion's own summary, expandable to read the
 *  actual conversation behind it (loaded on demand). */
function DayEntry({
  summary,
  owner,
  name,
}: {
  summary: DailySummary;
  owner: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [showConvo, setShowConvo] = useState(false);
  const [convo, setConvo] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadConvo = async () => {
    if (showConvo) {
      setShowConvo(false);
      return;
    }
    setShowConvo(true);
    if (convo) return;
    setLoading(true);
    try {
      const r = await api.messages(summary.day);
      setConvo(r.messages);
    } catch {
      setConvo([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--line)] bg-black/15">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          sfx.play("tap");
        }}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-amber/80">{summary.day}</span>
        <Icon name="chevron" size={15} className={`text-ink-faint transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <div className="text-[13.5px] leading-relaxed text-ink-dim">{renderMarkdown(summary.summary)}</div>
          <button
            type="button"
            onClick={loadConvo}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-cyan/80 transition hover:text-cyan"
          >
            <Icon name="chat" size={14} />
            {showConvo ? "Hide that day's conversation" : "Read that day's conversation"}
          </button>
          {showConvo && (
            <div className="mt-2 flex max-h-[260px] flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--line)] bg-black/20 p-3">
              {loading && <div className="text-center text-[12px] text-ink-faint">Loading…</div>}
              {!loading && convo && convo.length === 0 && (
                <div className="text-center text-[12px] text-ink-faint">No messages stored for this day.</div>
              )}
              {!loading &&
                convo?.map((m) => (
                  <div key={m.id} className="text-[12.5px] leading-relaxed">
                    <span className={`font-mono text-[10.5px] ${m.role === "user" ? "text-cyan/70" : "text-amber/70"}`}>
                      {m.role === "user" ? owner || "You" : name || "Companion"} · {formatTime(m.createdAt)}
                    </span>
                    <div className="text-ink-dim">{renderMarkdown(m.content)}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MemorySection({ form, set, toast }: SectionProps) {
  const [core, setCore] = useState("");
  const [coreDirty, setCoreDirty] = useState(false);
  const [savingCore, setSavingCore] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [newMem, setNewMem] = useState("");
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [rolling, setRolling] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.getCore().then((r) => setCore(r.contentMd)).catch(() => {});
    api.summaries().then((r) => setSummaries(r.summaries)).catch(() => {});
  }, []);

  const loadMemories = (q: string) =>
    api.memories(q).then((r) => setMemories(r.memories)).catch(() => {});

  useEffect(() => {
    loadMemories("");
  }, []);

  const onSearch = (q: string) => {
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => loadMemories(q), 220);
  };

  const saveCore = async () => {
    setSavingCore(true);
    try {
      await api.setCore(core);
      setCoreDirty(false);
      toast("Core inscribed.", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingCore(false);
    }
  };

  const addMem = async () => {
    const content = newMem.trim();
    if (!content) return;
    try {
      const { memory } = await api.addMemory(content);
      setMemories((m) => [memory, ...m]);
      setNewMem("");
      sfx.play("confirm");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const delMem = async (id: number) => {
    try {
      await api.deleteMemory(id);
      setMemories((m) => m.filter((x) => x.id !== id));
      sfx.play("tap");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const rollup = async () => {
    setRolling(true);
    try {
      const { summarized } = await api.rollup();
      const r = await api.summaries();
      setSummaries(r.summaries);
      toast(summarized ? `Chronicled ${summarized} day(s).` : "Nothing new to chronicle.", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRolling(false);
    }
  };

  return (
    <div>
      <SectionIntro
        title="Memory"
        blurb="What the companion holds onto. The Core is the always-present brief; memories are durable facts; the chronicle is each day distilled."
      />
      <div className="flex flex-col gap-5">
        <Card title="Self-managed memory">
          <ToggleRow
            title="Let the nightly roll-up curate memory"
            desc="As it distils each day, also mine it for lasting facts to save — who they are, their work, the people in their life — and drop ones the day made wrong. Off: the roll-up only writes the daily summary, and memory is yours alone to edit here."
          >
            <Toggle checked={form.memoryRollupExtract} onChange={(v) => set("memoryRollupExtract", v)} />
          </ToggleRow>
          <ToggleRow
            title="Weekly consolidation"
            desc="A weekly pass steps back over the last week to firm up consistent habits, merge duplicates, drop one-offs, and fix what changed — things one day alone can't show. Needs the curate switch above."
          >
            <Toggle
              checked={form.memoryWeekly}
              disabled={!form.memoryRollupExtract}
              onChange={(v) => set("memoryWeekly", v)}
            />
          </ToggleRow>
        </Card>

        <Card title="Core — always in mind">
          <TextArea
            value={core}
            onChange={(v) => {
              setCore(v);
              setCoreDirty(true);
            }}
            rows={8}
            mono
            placeholder="The standing brief the companion always sees…"
          />
          <div>
            <button className="btn" onClick={saveCore} disabled={!coreDirty || savingCore}>
              <Icon name="check" size={16} />
              {savingCore ? "Inscribing…" : "Inscribe core"}
            </button>
          </div>
        </Card>

        <Card title="Memories">
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              className="field pl-9"
              placeholder="Search memories…"
              value={query}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="Add a memory…"
              value={newMem}
              onChange={(e) => setNewMem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMem()}
            />
            <button className="btn shrink-0" onClick={addMem} disabled={!newMem.trim()}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
            {memories.length === 0 && (
              <div className="py-6 text-center text-[13px] text-ink-faint">No memories{query ? " match." : " yet."}</div>
            )}
            {memories.map((m) => (
              <div
                key={m.id}
                className="group flex items-start gap-3 rounded-xl border border-[var(--line)] bg-black/15 px-3.5 py-2.5"
              >
                <div className="flex-1 text-[13.5px] leading-relaxed text-ink-dim">
                  {m.content}
                  {m.tags && <span className="ml-2 font-mono text-[11px] text-cyan/70">#{m.tags}</span>}
                </div>
                <button
                  onClick={() => delMem(m.id)}
                  className="shrink-0 text-ink-faint opacity-0 transition hover:text-danger group-hover:opacity-100"
                  aria-label="Forget"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card title="The Chronicle — daily summaries">
          <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-faint">
            Each past day distilled in the companion's own words. Open a day to read the full
            summary — and the conversation it came from.
          </p>
          <div>
            <button className="btn ghost" onClick={rollup} disabled={rolling}>
              <Icon name={rolling ? "restart" : "sparkle"} size={16} className={rolling ? "animate-spin" : ""} />
              {rolling ? "Distilling…" : "Roll up the day"}
            </button>
          </div>
          <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
            {summaries.length === 0 && (
              <div className="py-4 text-center text-[13px] text-ink-faint">No chronicle yet.</div>
            )}
            {summaries.map((s) => (
              <DayEntry key={s.day} summary={s} owner={form.owner} name={form.name} />
            ))}
          </div>
        </Card>

        <Card title="Tuning">
          <Grid>
            <Field
              label="Context days recalled"
              value={String(form.memoryContextDays)}
              onChange={(v) => set("memoryContextDays", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
            <Field
              label="Memories injected"
              value={String(form.memoryLimit)}
              onChange={(v) => set("memoryLimit", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
          </Grid>
          <Field
            label="Nightly roll-up schedule (cron)"
            value={form.memorySummaryCron}
            onChange={(v) => set("memorySummaryCron", v)}
            placeholder="0 3 * * *"
            mono
            help="When the companion distills the day on its own."
          />
          <Field
            label="Weekly consolidation schedule (cron)"
            value={form.memoryWeeklyCron}
            onChange={(v) => set("memoryWeeklyCron", v)}
            placeholder="0 4 * * 1"
            mono
            help="When it steps back over the week to firm up memory. Used only when weekly consolidation is on."
          />
        </Card>
      </div>
    </div>
  );
}
