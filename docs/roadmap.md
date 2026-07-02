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

---

_Phases 6–9 are planned, sorted easy → hard. Phases 8–9 stand on two shared foundations —
a **generic Job Engine** (F1) and a **Proactive Delivery** primitive (F2) — built once in
Phase 8 and reused in Phase 9. Today the companion is purely reactive: it only speaks in
reply to an inbound message, and the scheduler runs memory roll-ups only._

## Phase 6 — Capabilities settings ⏳ (easy · frontend-only)

Regroup the capability-related settings under one **Capabilities** rail entry in
`web/src/screens/Settings.tsx`, driven by a nested `CATEGORIES` config with a horizontal
sub-tab bar (memory · listening · speaking · internet · location · actions).

- ⏳ Nest the existing sections under Capabilities and rename to the capability vocabulary:
  Listening ← `settings/Voice.tsx` (STT), Internet ← `settings/Web.tsx` ("The Sight"),
  Location ← `settings/Weather.tsx` ("The Sky"); Memory unchanged.
- ⏳ Keep Persona · The Mind · Channels · Atmosphere · The Realm as top-level rail items.
- ⏳ Ship **Speaking** and **Actions** as "coming soon" stubs so the information architecture
  lands before Phases 7–9 fill them. Reuse the `settings/ui.tsx` primitives.

## Phase 7 — Speaking (TTS) ⏳ (medium · symmetric to STT)

Give the companion a voice, mirroring the existing STT layer in `src/channels/stt.ts`.

- ⏳ New `src/channels/tts.ts` (`off` / `openai-compatible` / `local` [Piper/Kokoro]),
  `synthesize(text) → bytes`; a `TtsConfig` in `src/config/index.ts` + `.env` keys mapped in
  `src/server/web/api.ts` the same way as the STT keys.
- ⏳ Persist audio to `/uploads` and play it back in assistant bubbles in `web/src/screens/Chat.tsx`
  (the schema already carries `kind:"voice"` + `mediaUrl`); synthesize per-paragraph off the
  existing `ParagraphSink` stream to hide latency.
- ⏳ `<speak>…</speak>` sidecar tag (parsed in `actions.ts`/`engine.ts`), gated by a
  **speaking mode** the engine enforces — three independent triggers: _mirror voice_ (reply
  in voice when the user sent voice), _on request_, and _sometimes_ (model decides via the tag).
- ⏳ Fill the **Speaking** sub-tab (provider + mode toggles), using `Voice.tsx` as a template.
- **Decision to lock:** local (Piper/Kokoro, matches the local-first ethos) vs hosted TTS;
  the three-toggle mode vs a single mode enum.

## Phase 8 — Planning (self-scheduled tasks) ⏳ (harder · builds the shared foundations)

The model schedules future tasks; the user reviews them in settings. Introduces the two
foundations reused by Phase 9.

- ⏳ **Job Engine (F1):** generalize `src/companion-core/memory/scheduler.ts` from
  memory-only into a job tick over a new `scheduled_tasks` table (cron _or_ `runAt`,
  instruction, capability hint, `status` proposed|active|paused|done, `createdBy` llm|user,
  next/last run, last result); keep the boot-backfill + safety-tick semantics. An executor
  runs due tasks through the engine with the allowed capabilities (reusing the `web.ts`
  search/fetch loop).
- ⏳ **Proactive Delivery (F2):** a `deliver(msg, {media, voice})` primitive that pushes an
  _unprompted_ message — the missing "companion initiates contact" primitive. Telegram push
  is trivial (grammY already connected); web = store + surface the message, optional web push.
- ⏳ `<schedule when="…">task</schedule>` sidecar tag → stored as `proposed`.
  **Decision:** proposed-then-approved by default (safer for a small local model), with an
  optional "auto-run my plans" toggle.
- ⏳ **Actions → Planning** sub-panel + `/api/tasks` CRUD: list prepared crons (instruction,
  next run, source), with approve / pause / delete. Validate cron expressions and cap the
  number of active tasks.

## Phase 9 — Seeking & Sharing (autonomous proactivity) ⏳ (hardest · off by default)

The companion wakes on its own, keeps a pulse on things it knows the owner cares about, and
shares a link with a "take a look — wdyt?" note. Reuses F1 + F2 + the internet capability.

- ⏳ **Triggers:** idle detection (no messages for _N_ hours) plus optional scheduled pulse
  windows, both via the Job Engine.
- ⏳ **Seek → share loop:** pick a topic from `memories`/`core` → search/fetch → judge worth
  sharing and **dedup against an already-shared store** → compose link + "wdyt?" →
  `deliver()`.
- ⏳ **Guardrails (most of the work):** on/off + frequency, max shares/day, quiet hours, a
  shared-URL dedup table, and an Internet-capability gate. Ships **off by default** with
  conservative limits and an easy kill switch — not being annoying is the real problem here.
- ⏳ **Actions → Seeking & Sharing** sub-panel: enable, frequency, idle threshold, quiet
  hours, and a log of what it has shared.

_Dependencies: Phases 6 and 7 are independent and can ship in any order; Phase 9 is gated on
Phase 8's Job Engine + Proactive Delivery._

## Later (ideas, not committed)

- More channels (Discord, CLI).
- Real tool-calling path for capable hosted models.
- Optional multi-profile (more than one companion per deployment).
- Additional context providers as plugins.

> Status lives here. When a phase item ships, check it off and log it in
> [CHANGELOG.md](./CHANGELOG.md).
