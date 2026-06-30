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
   open threads, the little things. You edit it in the web UI.

3. **Saved memories (`memories`).** Discrete durable facts. They come from two places: you
   add or remove them in the web UI, and the **nightly roll-up** mines each day for new ones
   and drops ones the day made wrong (see below). The most recent `MEMORY_LIMIT` ride along
   in context. The companion does **not** change memory mid-conversation — that proved
   unreliable on small local models, so all management now happens in the roll-up. The
   operating prompt tells it never to claim it saved, changed, or forgot something on the
   spot, and that the ambient `[context]` note (date/weather) is never the owner's words and
   never something to "remember".

4. **Daily summaries (`daily_summaries`).** Each night a roll-up compresses the day's
   messages into one short summary in the companion's own voice. Past days live on as
   their summary, not as raw transcript — so context stays bounded. The same roll-up also
   **reconciles saved memories against the day** — saving lasting facts that surfaced and
   dropping ones that changed — so something durable that came up in passing — _"works at a
   school as a software developer"_, a person, a standing preference — still gets kept the
   night it's mentioned, and a fact that's no longer true is let go.

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

**Reconciling memory.** Right after summarizing a day, the roll-up also reconciles long-term
memory against it (when `MEMORY_ROLLUP_EXTRACT` is on, the default). A second, focused
generation is shown the day's transcript and the current memories, and asked — in the same
`<remember>` / `<forget>` vocabulary used elsewhere — for genuinely new durable facts and for
any saved memory the day made wrong. New facts are de-duplicated against what's already
stored; drops go through the conservative content matcher (exact wording, else the closest
substring, else strong word-overlap — so a `<forget>` that matches nothing is a no-op). Both
directions are capped per run so one odd day can't flood or gut memory. It's best-effort:
trouble here never undoes the summary just saved or stalls the run, and the day is mined once
(a day that already has a summary is skipped on later runs).

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

## The weekly consolidation

The daily reconcile is **myopic** — it sees one day, so it can't tell a one-off from a habit
or notice what's *consistent*. A weekly pass (`MEMORY_WEEKLY`, default on; gated by
`MEMORY_ROLLUP_EXTRACT`) steps back over the **last week of daily summaries** — cheap, already
compressed — plus the current memories, and tidies the set: **strengthen** a pattern that
recurred into a confident fact (many morning runs → "usually runs in the morning"), **merge**
near-duplicates into one precise memory, **drop** a one-off that never became a pattern, and
**fix** a fact the week shows changed. It's deliberately conservative — absence from the week
is never a reason to forget, and anything the owner explicitly asked to keep is left alone —
and it uses the same `<remember>`/`<forget>` machinery as the daily pass.

It runs on its own cron (`MEMORY_WEEKLY_CRON`, default Monday 04:00 in `TZ`) and survives
downtime the same way the nightly roll-up does: an overdue weekly pass (a week or more since it
last ran, tracked in a settings key) is caught up on boot and on the periodic safety tick.

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

**Who manages memory.** The companion does not edit memory mid-conversation; all automatic
management is the roll-up's. `MEMORY_ROLLUP_EXTRACT` (default on; the *"Let the nightly
roll-up curate memory"* switch in **Memory** settings) is the single toggle for it. Turn it
off and the roll-up only writes the daily summary — memory becomes yours alone to edit, while
injection into context and the daily summaries keep working. It mirrors the `WEB_ACCESS`
switch for web access.
