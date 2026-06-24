# Bounded, guarded web access

Status: Accepted — 2026-06-24

## Context

A purely offline companion can't answer "what's happening with X today?" or read a link
you share. But unrestricted egress from an LLM-driven loop is a safety and cost risk.

## Decision

Web access is **optional, off-by-config-able, and bounded.** The companion requests the web
only via `<search>`/`<fetch>` sidecar tags; the engine runs them, feeds results back, and
lets it answer for real — a small loop capped by `WEB_STEPS`. Search uses keyless
DuckDuckGo by default, or Tavily with a key. Page reads pass through an **SSRF guard** that
blocks localhost, private/loopback/link-local ranges, and internal hostnames. Failures
degrade to a short note, never an exception.

## Consequences

- Most turns make zero web calls; the loop fires only when the model reaches for it.
- The brain stays local even when web access is on — only the lookup leaves, not the
  conversation.
- A shared link can't be used to reach internal services (including the local model).
- Set `WEB_ACCESS=false` for a fully no-egress companion.

## Alternatives considered

- **Always-on browsing / unbounded loop** — rejected: cost and safety risk, and small
  models loop poorly.
- **No web at all** — rejected as the default: too limiting; made a clean toggle instead.
