# Writing first

The companion sometimes messages the owner first, as a friend does: only after a real
quiet, only in waking hours, never twice without an answer, and only with a reason.
Opt-in (`REACH_OUT`, default off). Telegram only — the web chat has nobody to push to.

> Status: implemented in `src/companion-core/reach-out.ts` (when),
> `engine.draftReachOut` (what), Telegram `sendToOwner` (delivery).

## When it considers writing

Every 30 min (`TICK_MS`), all of these must hold, then a 25% roll (`CONSIDER_CHANCE`) so the
moment varies:

| Rule | Setting |
| ---- | ------- |
| there was a conversation before (never a cold open) | — |
| quiet for at least N hours since the last message | `REACH_OUT_AFTER_HOURS` (24) |
| its last first-message has been answered | — |
| 12 h since it last decided there was nothing to say | `PASS_COOLDOWN_MS` |
| local hour inside the window (end exclusive; may wrap midnight) | `REACH_OUT_HOURS` (`10-21`, in `TZ`) |

## What it says

`draftReachOut` builds the normal prompt (persona, memory, today, time apart) plus a private
instruction: write only for a real reason — something that should have happened by now,
something today brushes against, an interest, or missing them — one short message, at most
one question; `<speak>…</speak>` sends it as a voice note (when TTS works); `<pass/>` means
nothing to say. Nothing is stored until delivery succeeds; then it is logged as an assistant
turn. A day that opens with it shows the owner's side as `[you messaged first]`
(`engine.WROTE_FIRST`), so the reply has context.

## At a time the owner named

When the owner gives a specific time ("up at four"), a reply may end with
`<later at="YYYY-MM-DD HH:MM">why</later>` (or a bare `HH:MM` = next occurrence; local `TZ`;
never shown). `engine.keepPlan` stores it in setting `reach_out_plan` (one plan, newest
wins; ≤ 7 days ahead). `src/companion-core/later.ts` holds the rules; a 1-min tick
(`PLAN_TICK_MS`) drafts with the reason at that time, skipping the quiet, hours and chance
rules — it may still `<pass/>`. Dropped when the owner writes ≥ 3 h after the plan was made,
wrote < 30 min ago at fire time, or it is 2 h stale. The persona's `## Getting back to them`
section asks for the tag only when `REACH_OUT` is on.

Delivery goes to the first `TELEGRAM_ALLOWED_USER_IDS` entry (a private chat's id is the
user's). Telegram bots can't place calls, so a voice note is the closest thing to one.
