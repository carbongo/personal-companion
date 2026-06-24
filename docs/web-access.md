# Web access

By default the brain has no internet. Web access is a **deliberate, bounded, optional**
exception: the companion can look something up or read a link you shared, and only then
write its real reply.

> Status: implemented (Phase 1) in `src/companion-core/web.ts`. Toggle with `WEB_ACCESS`.

## How it works

The companion reaches the web the same way it acts on memory — through small sidecar
tags. It may end a draft reply with:

- `<search>query</search>` — look something up, or
- `<fetch>https://example.com/page</fetch>` — read a specific page.

The engine runs the requests, feeds the results back, and lets it answer for real. This
is a small **bounded loop** (`WEB_STEPS`, default 3) that only fires when it actually
reaches for the net — most turns make zero web calls.

## Search backends

- **DuckDuckGo (default, keyless):** works out of the box.
- **Tavily (optional, sharper):** set `TAVILY_API_KEY` and `WEB_SEARCH_PROVIDER=tavily`.
  Falls back to DuckDuckGo if a keyed search errors.

Page reads are a direct fetch plus an HTML→text extract (no headless browser). Everything
degrades to a short note rather than throwing, so a flaky lookup never breaks the
conversation. Results are capped (`WEB_RESULTS`, `WEB_PAGE_CHARS`).

## Safety

Page reads pass through an **SSRF guard** that blocks `localhost`, private/loopback/
link-local ranges, and common internal hostnames — so a shared link can't poke services
on your network (including your own Ollama). See [security.md](./security.md) and
[decisions/bounded-web-access.md](./decisions/bounded-web-access.md).

## Turning it off

Set `WEB_ACCESS="false"` for a fully no-egress companion (local model + no web). Tags are
then ignored and stripped.
