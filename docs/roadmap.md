# Roadmap

Phased plan. Each phase is a usable increment; the docs stay in sync as each lands.

## Phase 0 — Scaffold ✅ (in progress)

Repo, license, CI, Docker, `.env.example`, the docs wiki, `AGENTS.md`, and a bootable
Bun + Hono server with `/health`. No companion behaviour yet.

## Phase 1 — Generic engine

- SQLite schema + Drizzle migrations (see [data-model.md](./data-model.md)).
- Memory layer: live day, Core, memories, daily summaries, nightly roll-up.
- Persona assembled from configuration (no hardcoded character).
- Context providers: date/time + weather.
- Sidecar actions: `<remember>` / `<core>` / `<note>`.
- Bounded web access: `<search>` / `<fetch>` with the SSRF guard.
- **LLM provider abstraction**: Ollama + OpenAI-compatible.
- The `engine.respond(turn)` seam, with unit tests.

## Phase 2 — Telegram channel

- grammY long-polling adapter: allowlist, text/voice/photo, incoming batching, outgoing
  reply-split.
- Pluggable STT for voice notes (off / OpenAI / whisper-http).
- End-to-end on a throwaway bot with a neutral preset.

## Phase 3 — Web interface

- Built-in browser chat (no Telegram required).
- Memory admin: view/edit Core + memories + summaries, trigger roll-up.
- First-run **setup wizard**: persona, owner facts, model choice + connection test,
  optional Telegram token.
- Web auth (`WEB_AUTH_PASSWORD`).

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
