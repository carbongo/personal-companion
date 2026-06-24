# Changelog

Newest first. Every major action (feature, schema, dependency, env var, decision, or
ops change) gets an entry here — see the working agreement in [AGENTS.md](../AGENTS.md).

## 2026-06-24

- **Phase 1 — generic engine.** The companion now works end-to-end (verified against a
  local Ollama via `bun run chat`):
  - SQLite schema + Drizzle migrations (tables: `messages`, `core`, `memories`,
    `daily_summaries`, `notes`, `settings`); migrations applied on first open.
  - Memory layer (`src/companion-core/memory/`): daily log, Core, memories, daily
    summaries, and the nightly roll-up.
  - Persona from configuration with neutral presets (Sage / Pip / Coach / Companion) and a
    generic OPERATING block; no hardcoded character.
  - Context providers: date/time + weather (Open-Meteo, keyless).
  - Sidecar actions (`<remember>`/`<core>`/`<note>`) and bounded web access
    (`<search>`/`<fetch>`) with the SSRF guard, ported generically.
  - LLM provider abstraction (`src/llm/`): Ollama + OpenAI-compatible (`anthropic`
    planned). The `engine.respond(turn)` seam ties it together.
  - Tests: 28 across config, actions, web/SSRF, persona, and the in-memory store. New
    `bun run chat` REPL and `bun run db:generate` script.
  - **Recommended local model is now `gemma4:12b`** (was `gemma3:12b`); added
    `MEMORY_NOTE_TITLES` and the advanced `WEB_*` timeout/limit env vars.

- **Phase 0 — project scaffold.** New repository `personal-companion`: MIT license,
  Bun + TypeScript toolchain (Biome, tsc, `bun test`), a bootable Hono server with
  `/health`, typed config loader (`src/config/`), Dockerfile + Compose, GitHub Actions CI
  (check / typecheck / test / docker build), a complete `.env.example` configuration
  reference, the full docs wiki, and `AGENTS.md`.
- **Project established.** Extracted as a generic, self-hostable AI companion from a
  proven single-user companion design. No persona-specific code or data — personality is
  configuration. Seeded the founding decision records under `decisions/`.
