# Changelog

Newest first. Every major action (feature, schema, dependency, env var, decision, or
ops change) gets an entry here — see the working agreement in [AGENTS.md](../AGENTS.md).

## 2026-06-30

- **Weekly memory consolidation.** Added a weekly pass that steps back over the last week of
  daily summaries (cheap — already compressed) plus the current memories and tidies the set:
  strengthen a pattern that recurred into a confident fact (many morning runs → "usually runs
  in the morning"), merge near-duplicates, drop one-offs, fix shifts — the consistency the
  myopic per-day reconcile can't see. Conservative: absence from the week never forgets, and
  explicit "remember this" facts are left alone. New code: `weeklyConsolidate` /
  `runWeeklyConsolidation` / `backfillWeeklyConsolidation` in `memory/rollup.ts` (sharing the
  daily pass's `applyReconcile`); the `RollupScheduler` now drives a second cron with the same
  survive-downtime catch-up (overdue pass tracked in a settings key, caught up on boot + the
  safety tick). New env: `MEMORY_WEEKLY` (default on, gated by `MEMORY_ROLLUP_EXTRACT`) and
  `MEMORY_WEEKLY_CRON` (default `0 4 * * 1`), wired through config, the setup API/state, and the
  SPA settings form (`Toggle` gained a `disabled` prop). `scripts/reconcile-history.ts` still
  covers retroactive per-day reconciliation.

- **Memory management moved to the nightly roll-up; inline tags retired.** The mid-conversation
  approach from 2026-06-29 (below) didn't hold up — the default small local model almost never
  emitted `<remember>` at the right moment, so memory effectively never persisted. Two changes:
  - *The roll-up now reconciles long-term memory.* Right after it summarizes a finished day, a
    second focused generation is shown the day's transcript and the current memories and asked
    (in the same `<remember>` / `<forget>` vocabulary) for genuinely new durable facts and for any
    saved memory the day made wrong — e.g. _"Alex works at a school as a software developer"_, or
    dropping a job that ended. New facts are de-duplicated; drops use the conservative content
    matcher; both directions are capped per run; the whole step is best-effort (never undoes the
    summary). New code: `reconcileMemories` in `memory/rollup.ts`, reusing `parseActions`.
  - *Inline memory management removed.* The companion no longer acts on `<remember>`/`<core>`/
    `<forget>` mid-conversation; the operating prompt's memory section now tells it that what
    matters is gathered overnight and it can't save/forget on the spot. `applyActions` is gone
    (the engine only strips stray tags); `MEMORY_WRITES`/`config.memory.writesEnabled` and the
    "Let the companion manage its own memory" switch are **removed**.
  - *New toggle.* `MEMORY_ROLLUP_EXTRACT` (`config.memory.rollupExtract`, default `true`) — the
    "Let the nightly roll-up curate memory" switch in **Memory** settings, mirroring `WEB_ACCESS`.
    Off: the roll-up writes only the daily summary and memory is yours alone to edit. Wired through
    config, the engine/persona (`buildOperating` now takes `autoMemory` instead of `memory`), the
    setup API/state, and the SPA settings form.

## 2026-06-29

- **Memory writes: stronger prompting + an on/off switch.** _(Superseded 2026-06-30 — see above.)_
  Two changes to how the companion manages its own memory:
  - *Reworked the memory prompt.* The operating block's memory section now leads with "memory
    is not automatic" (narrating a save does nothing without the tag), names concrete triggers,
    carries a worked example, leans toward saving when unsure, and instructs the model to convert
    relative times ("next weekend") into absolute calendar dates before saving so a memory still
    reads correctly weeks later. The old "use sparingly" framing left `<remember>`/`<core>`
    almost never firing in practice.
  - *New `MEMORY_WRITES` env var* (`config.memory.writesEnabled`, default `true`) — the "Let the
    companion manage its own memory" switch in **Memory** settings, mirroring `WEB_ACCESS`. Off
    makes memory read-only: the `<remember>`/`<core>`/`<forget>` instructions are dropped from
    the prompt and any emitted tags are stripped rather than applied; context injection and the
    nightly roll-up are unaffected. Wired through config, the engine (`commitActions`), the setup
    API/state, and the SPA settings form. `buildOperating` now takes a `memory` flag.

## 2026-06-25

- **UI sounds recover after the AudioContext is suspended.** The web UI's chimes resumed the
  audio graph only on the *first* interaction (`{once:true}`); once a browser suspended the
  context (tab switch, system sleep, idle) they went silent for good. Now resume runs on *every*
  pointer/key gesture (a no-op when already running) plus on `visibilitychange` — so sounds
  self-heal. (Default stays on; the speaker toggle in the top bar still mutes/persists.)
- **Web chat: keepalives so the streamed reply survives the "thinking" pause + the message
  persists immediately (the real "had to refresh" fix).** With thinking on, the model can stay
  silent for ~15–20s before any token — and Bun's ~10s idle timeout was dropping the streaming
  socket mid-think (`ECONNRESET`), so the browser got nothing and you refreshed. Now `POST
  /api/chat/stream` sends a `{type:"ping"}` **keepalive every 4s** (writes serialized so lines
  never interleave; the client ignores pings) and the server's Bun `idleTimeout` is raised to
  255s. The engine also **persists the incoming message before generation** (right after the
  history is read for the prompt) instead of after, so reloading mid-reply no longer makes the
  message you just sent vanish. `LLM_THINK` stays **on** by default. (Image turns still run with
  thinking off — it's flaky with vision.) The earlier same-day "thinking off by default" change
  is reverted.
- **Vision: image turns can route to a dedicated model; the companion never fakes sight.**
  New optional **`LLM_VISION_MODEL`** (`config.llm.visionModel`, a "Vision model" field in
  the Mind settings). When a turn includes an image, the engine routes that one generation to
  the vision model; with no vision model set, it uses the main model only if it advertises
  vision (Ollama `/api/show` `capabilities`, cached). Image turns always run with **thinking
  off** — thinking + vision is flaky on local models (it can burn the whole budget and return
  nothing) and a picture rarely needs deliberation. If neither can see, the image is dropped and
  the model is told to say so plainly — fixing the old failure where a text-only model silently
  ignored the image and "recalled" an unrelated one. New `LLMProvider.supportsVision?()`; both
  providers accept a per-call `model` override (`GenerateOptions.model`). The default
  `LLM_MODEL=gemma4:12b` (GGUF) is itself vision-capable, so it needs no separate vision model;
  the MLX build `gemma4:12b-mlx` is text-only (no projector). +cap-detection wiring.
- **Web chat reaches Telegram parity: burst batching with read-style ticks, and live
  paragraph streaming.** Outgoing replies now **stream paragraph-by-paragraph** the instant the
  model finishes each one (new `respondStream()` + provider `chatStream?()` over Ollama NDJSON /
  OpenAI SSE; new NDJSON endpoint `POST /api/chat/stream`; new pure `takeParagraphs()` splitter).
  Incoming messages **batch client-side** into one turn using the shared `CHAT_BATCH_*` window,
  shown on each of your bubbles as **one tick = queued / not-yet-sent / errored**, **two ticks =
  the whole burst was delivered**; an errored burst stays queued and rides along with your next
  send. History reload splits stored replies back into their paragraph bubbles. +tests
  (`takeParagraphs`).
- **Memory honesty + a real `<forget>` action.** The companion can now actually drop a saved
  memory with a new **`<forget>…</forget>`** sidecar tag (matched by content in the store —
  exact, else closest substring, else strong word-overlap; conservative). The operating prompt
  now states the tags are the *only* way memory changes — so it must not claim to have saved,
  changed, or forgotten anything without the matching tag this turn — and clarifies that the
  `[context]` note (date/weather) is ambient, never the owner's words and never something to
  "remember". Fixes both the mis-referenced "remember that" (it grabbed the weather) and the
  phantom "I removed/added that" with nothing actually changing. +tests (`forgetMemory`,
  `<forget>` parsing).
- **Chronicle is readable + browsable (and was silently blank).** `GET /api/summaries` now
  returns `summary` (the DB column is `summaryMd`) so daily summaries actually render — they
  were blank due to a field mismatch. Each day in the Memory section is now expandable, renders
  the summary as markdown, and can open the actual conversation behind it (new `GET /api/days`,
  and `GET /api/messages?day=YYYY-MM-DD`).
- **Premium web client — a built Vite/React SPA (the Nocturne design system).** The web UI
  is reborn as a polished, highly adaptive, animated single-page app under `web/` (Vite +
  React 19 + Tailwind v4 + Motion; self-hosted fonts, no runtime CDN). Dark-slate surface
  with cyan/amber "energy", runic detailing, lush transitions, ambient motion, and muteable
  WebAudio chimes (no binary assets) — all honoring `prefers-reduced-motion`. Two surfaces:
  **Converse** (chat with markdown, image attach, voice-to-text, optimistic send) and the
  **Slate**, a categorised game-like settings menu (Persona · Mind · Memory · Channels ·
  Voice · The Sight · The Sky · Atmosphere · The Realm) that unifies the old setup wizard
  and memory admin, with a live model "Attune" test, a geocoding location picker, and an
  unsaved-changes save bar that can re-attune (restart) the process. **This supersedes the
  no-build decision** ([web-ui-premium-spa.md](./decisions/web-ui-premium-spa.md)). The
  client talks only to the existing JSON API; the only server change is `auth.enabled` on
  `/api/state`. Built with `bun run web:build` → `web/dist`, served by the same Bun process
  (content-hashed assets, `immutable`); the Dockerfile builds it in a separate stage. **The
  server gracefully falls back** to the original server-rendered pages when `web/dist` is
  absent, so a bare `bun start` still works; the login page stays server-rendered (re-themed
  to match). New root scripts `web:install` / `web:dev` / `web:build`; `web/` excluded from
  root Biome/tsc. No new server runtime dependency. Server `check` + `typecheck` + 94 tests
  green; the client typechecks and builds clean.
- **Batching is now a dynamic, growing idle window (no hard total cap).** Replaced the
  fixed-debounce-plus-hard-cap model. The idle window starts at `CHAT_BATCH_IDLE_MS` after the
  first message and grows by the new `CHAT_BATCH_STEP_MS` with each further message, capped at
  `CHAT_BATCH_MAX_MS` — so an active typist gets more breathing room (up to the ceiling) while
  a one-off message still flushes fast. The old per-burst total cap is gone; the growing
  ceiling is the only bound. `Batcher` reworked (`idleWindow()` pure helper, single timer);
  the web client mirrors it. New `Chat` settings field for the step. Defaults 3s/2s/12s
  (→ 3, 5, 7, 9, 11, 12, 12…). +tests (idleWindow + growth/cap behaviour).
- **Batching moved to a shared “Chat” category (it was always shared).** The two batch
  timers drive both the web chat and Telegram (the web chat already read them via
  `/api/state`), but they were named/filed under Telegram. New env vars **`CHAT_BATCH_IDLE_MS`
  / `CHAT_BATCH_MAX_MS`** with a `config.chat` section; the Telegram channel and `/api/state`
  now read `config.chat.*`. The old `TELEGRAM_BATCH_*` names still work as a fallback (no
  breakage). Settings gains a **Chat** section (between Model and Telegram) holding the two
  knobs with a plain-language explanation; they're removed from the Telegram section. +1 test.
- **Settings page revamp: every field explained + purpose-built selectors.** Each control
  now has an inline hint describing what it does and the trade-off. New `Field` helper in
  `pages.tsx`; raw inputs replaced where a better control exists: a searchable **timezone
  picker** (SSR from `Intl.supportedValuesOf` + "detect from browser"), a **temperature
  slider** with live readout, **cron presets** plus a plain-language schedule description, a
  **model** suggestions datalist, provider-aware **speech-to-text** fields (only the chosen
  backend's inputs show), and — the headline — a **real location search** for weather: type a
  city, pick it, and it fills latitude/longitude/name and matches your timezone. Geocoding
  goes through a new keyless **`GET /api/geocode`** that proxies Open-Meteo server-side
  (consistent with the weather provider; egress stays off the browser).
- **Auto-restart on save (`AUTO_RESTART_ON_SAVE`, default off).** With it on (toggle in App &
  access), saving Settings relaunches the app so the new `.env` applies with no manual step:
  the process exits and a supervisor (launchd `KeepAlive`, Docker `restart:`, systemd
  `Restart=`) brings it back; the Settings page polls `/health` and reloads itself once it's
  up. Off by default — only safe when the process is supervised.
- **Attachments are now real (`media_url` wired end-to-end).** Previously `media_url` was
  dead plumbing: no channel set it and nothing served `/uploads`. New
  `src/companion-core/media.ts` saves chat images under `DATA_DIR/uploads` and the auth-gated
  `GET /uploads/:file` route (in `server/web/index.tsx`) serves them back (path-traversal
  guarded, immutable-cached). Web `POST /api/chat` persists uploaded/pasted images and the
  Telegram photo handler saves the JPEG; `GET /api/messages` returns `mediaUrls[]` and the web
  chat redisplays the thumbnails on reload. A turn's `mediaUrl` now holds one or more
  newline-separated `/uploads/…` paths. +9 tests (`media.test.ts`).
- **`LLM_THINK` now takes effect on the openai-compatible provider.** It was read but never
  sent. Effort levels (`minimal`/`low`/`medium`/`high`) map to the standard `reasoning_effort`
  field (honored by OpenAI o-series/GPT-5 and OpenRouter; ignored elsewhere); `true`/`false`
  defer to the endpoint default to avoid 400s on non-reasoning models. +3 tests
  (`openai-compat.test.ts`).
- **Removed the `<note>` feature.** Note bodies were write-only — saved but never read back
  (only titles were ever surfaced), so the feature was dropped rather than completed. Gone: the
  `<note>` sidecar tag, the `notes` table (migration `0001` drops it), `createNote`/
  `listNoteTitles`, the `MEMORY_NOTE_TITLES` env var + its Settings field, and `notes.json`
  importer support. `<remember>` and `<core>` are unchanged.

## 2026-06-24

- **Roll-up scheduler — the nightly summary is now actually driven (and downtime-resilient).**
  Until now nothing called `runDailyRollup` automatically (only the web button did);
  `MEMORY_SUMMARY_CRON` was read and shown in Settings but never acted on. New
  `src/companion-core/memory/scheduler.ts` runs in-process: a once-a-minute tick matches the
  cron (dependency-free 5-field matcher, in `TZ`) and wraps the day that's ending. Resilient
  to a laptop that's asleep/off at the scheduled minute — it backfills missed days **on boot**
  and on a **periodic safety tick (~30 min)**, so "yesterday" gets summarized the moment the
  box is back up; the in-progress day is never wrapped early. `rollup.ts` split into
  `runDailyRollup()` (includes today) and `backfillPastDays()` (finished days only). Wired in
  `server/index.ts` (no-op when no model is configured). +21 tests (scheduler + rollup).
- **Local speech-to-text via whisper.cpp (`STT_PROVIDER=local`).** A fourth STT backend that
  shells out to `whisper-cli` with `ffmpeg` normalizing the audio — no daemon, no network,
  nothing leaves the box (and nothing to restart after a reboot). New env
  `STT_LOCAL_MODEL` / `STT_LOCAL_BIN` / `STT_FFMPEG_BIN` / `STT_LANGUAGE`; surfaced in
  Settings. `sttConfigured()` reports ready only when the model file exists, so voice degrades
  gracefully to "text me instead". Pure arg-builders + an injected runner keep it unit-tested.
- **Web chat reaches Telegram parity: batching, images, voice.** The browser chat now folds a
  burst of quick messages into one turn (client-side debounce using the same
  `batchIdleMs`/`batchMaxMs`, now exposed on `/api/state`), shows a typing bubble, attaches or
  pastes **images** (sent as base64 to vision models), and records from the **mic** / uploads
  **audio** which POSTs to the new `POST /api/transcribe` (shared STT backend). `POST /api/chat`
  now accepts `images`. Telegram gains a `[telegram] batched N messages into one turn` log so
  the batching is observable.

- **Web UI: the Settings page now exposes the full `.env` configuration.** The nav item and
  page are renamed **Settings** (the heading already read "Settings" after first run; the
  `/setup` route is unchanged). Every variable in `.env.example` is now editable in the
  browser, grouped to match the file: app & access (`TZ`, `DATA_DIR`, `PORT`,
  `WEB_AUTH_PASSWORD`), LLM tuning (`LLM_TEMPERATURE`, `LLM_NUM_CTX`, `LLM_MAX_TOKENS`,
  `LLM_THINK`, `LLM_TIMEOUT_MS`, `LLM_HISTORY_LIMIT`), Telegram batching
  (`TELEGRAM_REPLY_SPLIT`, `TELEGRAM_BATCH_IDLE_MS`, `TELEGRAM_BATCH_MAX_MS`), memory
  (`MEMORY_*`), web access (`WEB_ACCESS`, `WEB_SEARCH_PROVIDER`, `TAVILY_API_KEY`,
  `WEB_STEPS`/`WEB_RESULTS`/`WEB_PAGE_CHARS`/timeouts/`WEB_MAX_REQS`), speech-to-text
  (`STT_*`), and weather (`WEATHER_*`). Fields prefill from the live config; secrets stay
  write-only (shown only as "set"); an empty optional field is left untouched so saving never
  wipes an existing value. Touches `setup-state.ts`, `pages.tsx`, `assets.ts`, `api.ts` — no
  schema change, all writes go through the existing `.env` merge writer.

- **Web UI: setup doubles as a settings editor, and memory renders Markdown.** The setup
  page now prefills from the live configuration so it can be re-opened to edit settings, not
  just run once: the persona field falls back to the `persona/persona.md` file when no DB
  override is set (so an existing persona is visible/editable), and the Telegram
  **allowed-user-IDs** field is prefilled (`src/server/web/setup-state.ts`, `pages.tsx`). The
  bot token stays write-only (never echoed) with a "token already set" indicator. The Memory
  admin now renders Markdown: the **Core** has an Edit/Preview toggle, and **saved memories**
  and **daily summaries** display formatted. Rendering is a small, dependency-free,
  HTML-escaped (XSS-safe) Markdown function in `assets.ts`; editing stays via the textareas.

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
