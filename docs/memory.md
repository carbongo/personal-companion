# Memory

Memory is what makes it a companion rather than a chatbot: it carries continuity instead
of starting fresh each conversation. There are four moving parts, all in SQLite (see
[data-model.md](./data-model.md)).

> Status: lands in Phase 1.

## The four parts

1. **The live day (`messages`).** Today's conversation is the working memory, bucketed by
   local day. It is sent (up to `LLM_HISTORY_LIMIT` messages) on each turn.

2. **Core (`core`).** A single living Markdown doc — the spine of who the companion is
   *with you*: relationship state, mood over time, active projects, settled decisions,
   open threads, the little things. It updates in real time as you talk (via the `<core>`
   sidecar tag) and you can edit it in the web UI.

3. **Saved memories (`memories`).** Discrete facts the companion keeps on its own (via
   `<remember>`), or that you add. The most recent `MEMORY_LIMIT` ride along in context.

4. **Daily summaries (`daily_summaries`).** Each night a roll-up compresses the day's
   messages into one short summary in the companion's own voice. Past days live on as
   their summary, not as raw transcript — so context stays bounded.

## How a new day opens

A fresh day starts from: the **Core**, the **saved memories**, and the **recent daily
summaries** (`MEMORY_CONTEXT_DAYS`). It does not replay full history — that would grow
without limit. This is the same frugal model that lets a small local model keep up.

## The nightly roll-up

On `MEMORY_SUMMARY_CRON` (default `55 23 * * *`, in `TZ`), the engine summarizes the day
that's ending and **backfills** any earlier day that has messages but no summary yet
(e.g. a night the box was off). The roll-up runs in-process; if the model is unreachable
it pauses and catches up on the next run.

## Token frugality

The prompt is split so a local model's KV cache is reused across turns:

- a **stable cached system prefix** — persona + semi-stable knowledge (Core, memories,
  recent summaries) — changes only when that knowledge changes;
- a small **per-turn delta** (date, weather) rides on the latest message only and is
  never stored, so the cached prefix stays byte-stable.

See [architecture.md](./architecture.md) and
[decisions/sidecar-tags-not-tool-calling.md](./decisions/sidecar-tags-not-tool-calling.md).

## Editing memory

The web interface (Phase 3) shows the Core, the saved memories, and the daily summaries,
and lets you edit them and trigger a roll-up by hand.
