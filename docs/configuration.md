# Configuration

There are three layers, in order of precedence (later overrides earlier):

1. **Defaults** — sensible built-ins, so it runs with almost no config.
2. **Environment** (`.env`) — operational settings and secrets.
   See the fully-commented [`.env.example`](../.env.example).
3. **Persona** — *who the companion is*: a file (and, once the UI lands, editable in the
   browser and persisted to the `settings` table).

> The full personality is **configuration, never code.** The repo ships neutral presets;
> you adapt one or write your own. Your filled-in `.env` and `persona/` are gitignored —
> keep real-person data out of git (see [AGENTS.md](../AGENTS.md)).

## Environment (the essentials)

All vars are documented in [`.env.example`](../.env.example). The ones you'll usually touch:

| Var                       | Default              | What it does |
| ------------------------- | -------------------- | ------------ |
| `COMPANION_NAME`          | `Companion`          | Display name it goes by. |
| `COMPANION_OWNER`         | `friend`             | What it calls you. |
| `TZ`                      | `UTC`                | Timezone for days, summaries, the date it sees. |
| `DATA_DIR`                | `./data`             | Where the SQLite DB and uploads live. |
| `PORT`                    | `8080`               | Web interface port. |
| `WEB_AUTH_PASSWORD`       | (empty)              | Protects the web UI. Set it unless behind a trusted network. |
| `LLM_PROVIDER`            | `ollama`             | `ollama` \| `openai-compatible` \| `anthropic`. |
| `LLM_MODEL`               | `gemma4:12b`         | Model name for the chosen provider (recommended local default). |
| `LLM_OLLAMA_URL`          | `http://localhost:11434` | Local Ollama endpoint. |
| `LLM_API_KEY` / `LLM_BASE_URL` | (empty)         | For hosted providers. |
| `TELEGRAM_BOT_TOKEN`      | (empty)              | Enables the Telegram channel; empty = web chat only. |
| `TELEGRAM_ALLOWED_USER_IDS` | (empty)            | Comma-separated allowlist of Telegram user IDs. |

## Choosing a brain (provider)

- **Local (default):** install [Ollama](https://ollama.com), `ollama pull gemma4:12b`
  (or another model), set `LLM_PROVIDER=ollama` and `LLM_MODEL`. Nothing leaves your
  machine.
- **Hosted:** set `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, and `LLM_API_KEY`.
  Works with OpenAI, OpenRouter, Groq, LM Studio, vLLM, and similar. (Native `anthropic`
  is planned; until then, reach Anthropic models through an OpenAI-compatible gateway such
  as OpenRouter.)

See [decisions/llm-provider-abstraction.md](./decisions/llm-provider-abstraction.md).

## Talking over Telegram (optional)

The companion runs a [grammY](https://grammy.dev) bot over long-polling — no public URL
needed. To enable it:

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token into
   `TELEGRAM_BOT_TOKEN`. (Empty token = Telegram off; use the built-in web chat instead.)
2. Get your numeric ID from [@userinfobot](https://t.me/userinfobot) and put it in
   `TELEGRAM_ALLOWED_USER_IDS` (comma-separated for more than one). **Only listed IDs are
   answered** — everyone else is silently ignored. An empty allowlist ignores everyone.

Behaviour knobs (all optional, sensible defaults):

| Var                       | Default | What it does |
| ------------------------- | ------- | ------------ |
| `TELEGRAM_REPLY_SPLIT`    | `true`  | Send a long reply as paragraph-sized messages, like texting. |
| `TELEGRAM_BATCH_IDLE_MS`  | `2500`  | Flush a burst of quick messages into one turn after this silence. |
| `TELEGRAM_BATCH_MAX_MS`   | `15000` | Hard cap: never hold a batch open longer than this. |

See [channels.md](./channels.md) for how the adapter maps onto the engine seam.

### Voice notes (speech-to-text)

Voice notes are transcribed before they reach the engine — pick a backend with
`STT_PROVIDER`:

- `off` (default) — voice notes get a polite "text me instead" reply.
- `openai` — the hosted Whisper API; set `STT_API_KEY` (and optionally `STT_MODEL`,
  default `whisper-1`).
- `whisper-http` — any OpenAI-compatible `/audio/transcriptions` endpoint (e.g. a local
  faster-whisper server); set `STT_API_URL` (and `STT_API_KEY`/`STT_MODEL` if it needs
  them). Keeps voice local-first.

Photos are forwarded as images to vision-capable models regardless of STT.

## The persona

The persona defines identity, relationship, tone, interests, language, and hard style
rules. It is assembled into the system prompt at runtime. You set it by:

- **Setup wizard** (Phase 3): a first-run flow in the web UI that asks the key questions
  and writes the persona for you, including a "test your model connection" step.
- **Persona file** (advanced): edit `persona/` directly.
- **Web UI** (Phase 3): edit persona and owner facts in the browser; persisted to the
  `settings` table, overlaying file/env.

### Presets

Neutral, original archetypes ship as starting points (none is a fixed character):

- **Sage** — calm, curious mentor.
- **Pip** — upbeat, warm friend.
- **Coach** — blunt, accountability-focused.
- **Companion** — neutral default.

Pick one in the wizard and tweak from there. See
[decisions/persona-as-configuration.md](./decisions/persona-as-configuration.md).

## Context providers

Beyond persona and memory, the companion can be fed live context. Built-in providers:
date/time (always) and weather (Open-Meteo, keyless — set `WEATHER_LAT`/`WEATHER_LON`).
Additional providers are a documented extension point (see
[architecture.md](./architecture.md)).
