# Memory

Memory is what makes it a companion rather than a chatbot: it carries continuity instead
of starting fresh each conversation. There are four moving parts, all in SQLite (see
[data-model.md](./data-model.md)).

> Status: implemented (Phase 1) in `src/companion-core/memory/`.

## The four parts

1. **The live day (`messages`).** Today's conversation is the working memory, bucketed by
   local day. It is sent (up to `LLM_HISTORY_LIMIT` messages) on each turn.

2. **Core (`core`).** A single living Markdown doc — the spine of who the companion is
   *with you*: relationship state, mood over time, active projects, settled decisions,
   open threads, the little things. It updates in real time as you talk (via the `<core>`
   sidecar tag) and you can edit it in the web UI.

3. **Saved memories (`memories`).** Discrete facts the companion keeps on its own (via
   `<remember>`), or that you add. The most recent `MEMORY_LIMIT` ride along in context. The
   companion can also drop one it got wrong with `<forget>…</forget>` — matched by content in
   the store (exact wording, else the closest substring, else strong word-overlap; deliberately
   conservative so it removes one memory, not a sweep). These tags are the **only** way memory
   changes: the operating prompt tells the companion never to claim it saved, changed, or forgot
   something unless the matching tag is in that very message, and that the ambient `[context]`
   note (date/weather) is never the owner's words and never something to "remember".

4. **Daily summaries (`daily_summaries`).** Each night a roll-up compresses the day's
   messages into one short summary in the companion's own voice. Past days live on as
   their summary, not as raw transcript — so context stays bounded.

## How a new day opens

A fresh day starts from: the **Core**, the **saved memories**, and the **recent daily
summaries** (`MEMORY_CONTEXT_DAYS`). It does not replay full history — that would grow
without limit. This is the same frugal model that lets a small local model keep up.

## The nightly roll-up

A scheduler runs in-process (`src/companion-core/memory/scheduler.ts`) — no external cron.
On a once-a-minute tick it matches `MEMORY_SUMMARY_CRON` (default `55 23 * * *`, in `TZ`,
via a small dependency-free 5-field matcher) and summarizes the day that's ending. Every
run also **backfills** any earlier day that has messages but no summary yet. If the model
is unreachable it pauses and catches up on the next run.

**Resilient to downtime.** A laptop is often asleep or shut down at the scheduled minute,
so the schedule alone isn't enough. Two safety nets cover that without any "wake the box"
trickery:

- **on boot** — the scheduler immediately backfills any finished past day that has no
  summary, so "yesterday" is wrapped the moment the box is back up;
- **a periodic safety tick** — every ~30 minutes it backfills past days again, covering the
  case where the box slept straight through the nightly minute and never restarted.

The in-progress day is never summarized early — backfill only touches finished past days;
the nightly run is the only one that wraps *today*, as the day closes. The new day begins on
its own: messages are bucketed by the live local day (`TZ`), so the first message after
midnight simply lands in the new day's bucket.

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
