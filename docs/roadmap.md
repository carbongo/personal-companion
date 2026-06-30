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
- ✅ Sidecar actions: `<search>` / `<fetch>` (web). _Memory tags moved to the nightly
  roll-up's reconciliation pass — see the 2026-06-30 CHANGELOG entry._
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

## Phase 4 — Package & deploy ✅

- ✅ Docker/Compose polish: a `/health` healthcheck (image + compose), a fixed internal
  port so the mapping is unambiguous, and an **optional bundled Ollama** behind a compose
  profile (`docker compose --profile ollama up -d`).
- ✅ `init` CLI for bare installs (`bun run init`): scaffolds `.env` from the template
  (never clobbering an existing one), ensures the data directory, and prints next steps.
- ✅ Neutral presets (Companion / Sage / Pip / Coach) — delivered in Phase 1
  (`src/companion-core/presets.ts`); parameterized by name/owner, no fixed character.
- ✅ README polish: a "Deploy" section and an honest, prose first-run walkthrough.
  (Screenshots are owner-captured against a live model, so they're not committed here.)

## Phase 5 — Data import & adoption ✅

- ✅ One-off importer (`scripts/import.ts`, `bun run import`) for an existing single-user
  history, via a neutral, documented interchange format — decoupled from any source system.
  Preserves timestamps/day-buckets, validates records, runs in one transaction, and refuses
  to duplicate existing history without `--force`.
- ✅ Migration guide: [importing.md](./importing.md).

## Later (ideas, not committed)

- More channels (Discord, CLI, web push).
- Real tool-calling path for capable hosted models.
- Optional multi-profile (more than one companion per deployment).
- Additional context providers as plugins.

> Status lives here. When a phase item ships, check it off and log it in
> [CHANGELOG.md](./CHANGELOG.md).
