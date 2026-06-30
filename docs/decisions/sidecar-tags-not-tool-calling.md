# Acting via sidecar tags, not an API tool-calling loop

Status: Accepted — 2026-06-24

## Context

The companion needs to act — save a memory, update its Core, look something
up — but the default brain is a small local model. Small models drive multi-round API
tool-calling unreliably, and re-sending context every round is wasteful.

## Decision

The model **acts by emitting small sidecar tags** in its reply, which the engine parses,
applies, and strips before the user sees the text:

- web: `<search>…</search>`, `<fetch>…</fetch>` (see
  [bounded-web-access](./bounded-web-access.md))

Context (memory, date, weather) is **injected** rather than fetched via tools. This keeps
turns to a single generation in the common case and stays within a small model's
reliability envelope. Capable hosted models may later opt into real tool-calling as an
enhancement, but the sidecar path is the portable default.

### Update (2026-06-30): memory tags retired from the live conversation

Mid-conversation memory tags (`<remember>` / `<core>` / `<forget>`) were dropped: in
practice the default small local model almost never emitted them at the right moment, so
memory effectively didn't persist (see the `MEMORY_WRITES` experiment in the CHANGELOG).
Memory management moved entirely to the **nightly roll-up** (`MEMORY_ROLLUP_EXTRACT`), which
reconciles saved memories against the finished day in a *focused, single-shot* generation —
a much better fit for a small model than judging save-worthiness inline, every turn. That
roll-up still uses the same `<remember>` / `<forget>` vocabulary and the same tolerant
parser; only the *trigger* changed (a dedicated nightly pass, not the live reply). The web
sidecar tags above are unchanged.

## Consequences

- Reliable on small local models; no brittle tool-loop.
- Tag parsing is tolerant — malformed or absent tags simply leave the reply untouched.
- Tags must always be stripped so they never leak to the user.

## Alternatives considered

- **API tool-calling loop** — rejected as the default: unreliable on small models, slower,
  re-sends context each round.
- **Replaying full history for context** — rejected: unbounded growth; injected
  Core/memories/summaries are bounded.
