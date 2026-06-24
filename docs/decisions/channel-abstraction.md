# Channel abstraction (the engine seam)

Status: Accepted — 2026-06-24

## Context

People should reach the companion in more than one way (Telegram, a browser, later maybe
Discord or a CLI) without each surface re-implementing memory and prompting.

## Decision

Define one seam: `engine.respond(turn) -> { reply, actions }`, where a `turn` is
channel-neutral (`{ text, images?, transcript? }`). Channels are thin adapters that build a
turn, call the engine, and render the result. The engine knows nothing about any channel.

## Consequences

- New channels are additive — no core changes.
- Channel-specific behaviour (Telegram batching, reply-split, typing indicators) lives in
  the adapter, not the engine.
- The built-in web chat and Telegram share identical memory and prompting because they
  share the seam.

## Alternatives considered

- **Telegram-coupled core** — rejected; would make the web chat and future channels a
  rewrite.
- **A heavy plugin framework** — rejected as over-built for a handful of adapters.
