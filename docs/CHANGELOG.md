# Changelog

Newest first. Every major action (feature, schema, dependency, env var, decision, or
ops change) gets an entry here — see the working agreement in [AGENTS.md](../AGENTS.md).

## 2026-06-24

- **Web chat: multi-paragraph replies render as separate bubbles.** The built-in web chat now
  splits an assistant reply on blank lines and shows each paragraph as its own message bubble —
  the same texting feel the Telegram reply-split produces. Purely presentational (the reply is
  still stored as one assistant message); applied to both live replies and history on reload.
  Client-side only (`src/server/web/assets.ts`); no API or schema change.

- **Phase 5 — Data import & adoption.** A way to bring an existing companion's history in:
  - *Importer* (`scripts/import.ts`, `bun run import`) — loads messages, the Core doc,
    memories, daily summaries, and notes into the schema from a neutral, documented
    **interchange format** (a directory: `core.md`, `messages.jsonl`, `memories.json`,
    `daily-summaries.json`, `notes.json`). Decoupled from any source system, so the project
    ships only the importer and the spec — never another system's schema.
  - Preserves original timestamps and day-buckets (deriving `day` from `createdAt` when
    absent), validates each record (`--strict` to abort, otherwise skip + report), writes in
    a single transaction, and **refuses to duplicate** existing history without `--force`
    (daily summaries upsert by day; the Core is only overwritten with `--force`). `--dry-run`
    validates and reports without writing.
  - *Migration guide*: new [importing.md](./importing.md). The `./import` staging directory
    is now gitignored alongside `*.db`/`persona/`, so imported personal data never leaves the
    machine. No new dependency; **62 tests** (was 53 — +9 for the importer).

- **Phase 4 — Package & deploy.** Made the project easy to stand up, by Docker or bare Bun:
  - *`init` CLI* (`scripts/init.ts`, `bun run init`) — first-run bootstrap for a bare
    install: copies `.env.example` → `.env` (never clobbering an existing `.env`), ensures
    the data directory, and prints next steps. Idempotent, dependency-free.
  - *Docker/Compose polish* — a `/health` healthcheck in both the `Dockerfile` and
    `docker-compose.yml`; the container's internal port is pinned to `8080` so the host
    mapping (`PORT` in `.env` → `8080`) is unambiguous.
  - *Optional bundled Ollama* — the commented-out service is now a real `ollama` service
    behind a compose **profile**: `docker compose up -d` runs the app alone;
    `docker compose --profile ollama up -d` adds Ollama (named volume for pulled models,
    set `LLM_OLLAMA_URL=http://ollama:11434`).
  - *Neutral presets* (Companion / Sage / Pip / Coach) — confirmed shipped in Phase 1
    (`src/companion-core/presets.ts`); no change needed.
  - *README polish* — a "Deploy" section and an honest, prose first-run walkthrough.
    No new dependency; tests unchanged at 53.

- **Phase 3 — Web interface.** A full browser UI served by the same Bun process, with no
  front-end build step (`src/server/web/`, mounted via `mountWeb(app)`):
  - *Built-in chat* — `POST /api/chat` builds a `turn` and calls `engine.respond`, the same
    seam Telegram uses, so the web chat shares one conversation and memory with every channel.
  - *Memory admin* (`/memory`) — view/edit the Core, add/search/delete memories, read daily
    summaries, and trigger the roll-up on demand, over a small JSON API (`api.ts`).
  - *First-run setup wizard* (`/setup`) — name/owner, persona (preset or custom), owner
    facts, and a model choice with a **live connection test**, plus an optional Telegram
    token. Persona + facts apply immediately (DB); model/name/channel choices are written to
    `.env` via a merge-in-place writer (`env-file.ts`) and apply on restart.
  - *Web auth* (`auth.ts`) — `WEB_AUTH_PASSWORD` gates pages + API behind an `httpOnly`
    session cookie (HMAC-derived, constant-time check); a no-op when unset (trusted network).
  - Rendered with **Hono JSX** — `tsconfig.json` gains `jsx`/`jsxImportSource`; one
    stylesheet + three dependency-free scripts served as routes (`assets.ts`). No new
    runtime dependency. New ADR:
    [web-ui-server-rendered-no-build](./decisions/web-ui-server-rendered-no-build.md)
    (supersedes the earlier React+Vite+Tailwind+shadcn SPA sketch in `tech-stack.md`).
  - New `settings` key `setup_complete`. Tests now total 53 (added `.env`-writer and
    session-token units); verified end-to-end over HTTP (read/write API, auth flow,
    setup save, asset serving).

- **Phase 2 — Telegram channel.** First real channel over the `engine.respond` seam:
  - grammY long-polling adapter (`src/channels/telegram/`): numeric-ID allowlist (others
    silently ignored), text + photo (forwarded as images) + voice notes.
  - *Incoming batching* (`batcher.ts`): a burst of quick messages debounces into one turn
    (`TELEGRAM_BATCH_IDLE_MS` idle window, `TELEGRAM_BATCH_MAX_MS` hard cap).
  - *Outgoing reply-split* (`split.ts`): long replies sent as paragraph-sized messages with
    a typing indicator; always hard-wrapped under Telegram's 4096-char limit
    (`TELEGRAM_REPLY_SPLIT`).
  - Pluggable speech-to-text (`src/channels/stt.ts`): `off` / `openai` / `whisper-http`
    (`STT_PROVIDER`, `STT_API_URL`, `STT_API_KEY`, `STT_MODEL`).
  - Wired into the server boot (enabled only when `TELEGRAM_BOT_TOKEN` is set; failures are
    caught so the web process stays up). Added dependency: `grammy`.
  - Tests now total 42 (added reply-split, batcher, and Telegram/STT config parsing).
  - Simplified the batch knobs to `TELEGRAM_BATCH_IDLE_MS` + `TELEGRAM_BATCH_MAX_MS`
    (replacing the earlier window/step/max sketch in `.env.example`).

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
