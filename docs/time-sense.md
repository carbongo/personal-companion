# Time sense

A model reads a message sent after two weeks of silence exactly like one sent a minute after
the last, so without help the companion picks stale threads up as if no time passed. The
engine measures the gaps from stored timestamps and states them; the operating prompt
(`## Time between you`, `persona.ts`) says how a person would act on them.

> Status: implemented in `src/companion-core/time.ts`.

| Signal | Where | When |
| ------ | ----- | ---- |
| `Time apart: …` line | per-turn `[context]` note | the current conversation began after ≥ 3 h of silence (repeated every turn of it), or ≥ 1 h since the last message |
| `[3 hours later]` marker | front of an owner message in history and roll-up transcripts | ≥ 1 h after the previous message, across midnight too |
| `(as of YYYY-MM-DD)` | each saved memory in context | always: `confirmed_at`, else `created_at` |

- **Conversation boundary:** a pause of `SITTING_GAP_MS` (3 h). Markers: `MARK_GAP_MS` (1 h).
  Both are named constants, not env vars.
- **Labels are coarse** (`spanLabel`): "5 hours", "about a day", "over a week", "about 2 months".
- **Nothing is stored.** Markers and the note are derived every turn, so the cached system
  prefix stays byte-stable (memory dates are absolute for the same reason).
- **Re-verification closes the loop:** when a later day shows a saved fact still holds, the
  roll-up emits `<keep>` and its `confirmed_at` moves to that day; a fact that moved on is
  edited as before (see [memory.md](./memory.md)).
