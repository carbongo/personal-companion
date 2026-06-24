# Roadmap

Phased plan. Each phase is a usable increment; the docs stay in sync as each lands.

## Phase 0 — Scaffold ✅

Repo, license, CI, Docker, `.env.example`, the docs wiki, `AGENTS.md`, and a bootable
Bun + Hono server with `/health`.

## Phase 1 — Generic engine ✅

- ✅ SQLite schema + Drizzle migrations (see [data-model.md](./data-model.md)).
- ✅ Memory layer: live day, Core, memories, daily summaries, nightly roll-up.
- ✅ Persona assembled from configuration + neutral presets (no hardcoded character).
- ✅ Context providers: date/time + weather (Open-Meteo).
- ✅ Sidecar actions: `<remember>` / `<core>` / `<note>`.
- ✅ Bounded web access: `<search>` / `<fetch>` with the SSRF guard.
- ✅ **LLM provider abstraction**: Ollama + OpenAI-compatible (`anthropic` planned).
- ✅ The `engine.respond(turn)` seam, with unit + integration tests. A terminal REPL
  (`bun run chat`) exercises it end-to-end.

## Phase 2 — Telegram channel ✅

- ✅ grammY long-polling adapter (`src/channels/telegram/`): allowlist, text/voice/photo,
  incoming batching, outgoing reply-split, typing indicator.
- ✅ Pluggable STT for voice notes (off / OpenAI / whisper-http) in `src/channels/stt.ts`.
- ✅ Pure, unit-tested reply-splitter and incoming batcher; wired into the server boot.
- ⏳ Live end-to-end on a throwaway bot needs a BotFather token (owner-supplied); boot and
  graceful-failure paths are verified.

## Phase 3 — Web interface ✅

- ✅ Built-in browser chat (no Telegram required), over the same `engine.respond` seam.
- ✅ Memory admin (`src/server/web/`): view/edit Core, add/search/delete memories, read
  daily summaries, and trigger the roll-up on demand.
- ✅ First-run **setup wizard**: name/owner, persona (preset or custom), owner facts, and
  a model choice with a live **connection test**, plus an optional Telegram token. Persona
  and facts apply immediately; model/name/channel changes are written to `.env`.
- ✅ Web auth (`WEB_AUTH_PASSWORD`): a shared-password session cookie gating pages + API;
  a no-op on a trusted network when unset.
- ✅ Server-rendered with **Hono JSX, no build step** (no SPA bundler) — see
  [decisions/web-ui-server-rendered-no-build.md](./decisions/web-ui-server-rendered-no-build.md).

## Phase 4 — Package & deploy

- Docker/Compose polish; optional bundled Ollama.
- `init` CLI for bare installs.
- Neutral presets (Sage / Pip / Coach / Companion).
- README polish: screenshots / a short demo.

## Phase 5 — Data import & adoption

- One-off importer for an existing single-user companion's history.
- Migration guide.

## Later (ideas, not committed)

- More channels (Discord, CLI, web push).
- Real tool-calling path for capable hosted models.
- Optional multi-profile (more than one companion per deployment).
- Additional context providers as plugins.

> Status lives here. When a phase item ships, check it off and log it in
> [CHANGELOG.md](./CHANGELOG.md).
