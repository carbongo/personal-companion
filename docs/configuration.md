# Configuration

There are three layers, in order of precedence (later overrides earlier):

1. **Defaults** — sensible built-ins, so it runs with almost no config.
2. **Environment** (`.env`) — operational settings and secrets.
   See the fully-commented [`.env.example`](../.env.example).
3. **Persona** — *who the companion is*: editable in the browser (setup wizard) and
   persisted to the `settings` table, or a `persona/persona.md` file, or a preset.

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
| `DATA_DIR`                | `./data`             | Where the SQLite DB lives (and, by convention, local models under `data/models/`). |
| `PORT`                    | `8080`               | Web interface port. |
| `WEB_AUTH_PASSWORD`       | (empty)              | Protects the web UI. Set it unless behind a trusted network. |
| `LLM_PROVIDER`            | `ollama`             | `ollama` \| `openai-compatible` \| `anthropic` (planned — not yet implemented; use `openai-compatible` against an Anthropic-compatible gateway). |
| `LLM_MODEL`               | `gemma4:12b`         | Model name for the chosen provider (recommended local default). |
| `LLM_OLLAMA_URL`          | `http://localhost:11434` | Local Ollama endpoint. |
| `LLM_API_KEY` / `LLM_BASE_URL` | (empty)         | For hosted providers. |
| `TELEGRAM_BOT_TOKEN`      | (empty)              | Enables the Telegram channel; empty = web chat only. |
| `TELEGRAM_ALLOWED_USER_IDS` | (empty)            | Comma-separated allowlist of Telegram user IDs. |

## The web interface

The app serves a browser UI on `PORT` (default `8080`): the built-in **chat**, a **memory
admin**, and a **Settings** page (`/setup`) that runs first-time setup and, after that,
edits the whole configuration. There is nothing to build or install — it is rendered
server-side and served straight from the Bun process.

- **First run:** with no setup saved yet, the root path redirects to `/setup`. Fill it in,
  test your model, and finish. It writes a `.env` for you, so subsequent edits live there
  (or back in **Settings**).
- **Settings:** re-open `/setup` any time to edit every variable from `.env.example`
  through the browser — grouped to match the file (identity, model + tuning, Telegram,
  memory, web access, speech-to-text, weather, app & access). Every field carries an inline
  explanation, and the controls are purpose-built: a **searchable timezone picker** (with a
  "detect from browser" button), a **real location search** for weather (type a city — it
  fills latitude/longitude/name and can match your timezone, via Open-Meteo's keyless
  geocoder, proxied through the server), a **temperature slider**, **cron presets** with a
  plain-language description of the schedule, a **model suggestions** list, and
  provider-aware speech-to-text fields that show only what the chosen backend needs. Fields
  prefill from the live config; secrets are write-only (shown only as "set"); blank optional
  fields are left untouched so a save never wipes an existing value. Persona and owner facts
  apply immediately; everything else is written to `.env`.
- **Applying changes:** most settings take effect on restart. Set `AUTO_RESTART_ON_SAVE=true`
  (or toggle it in **App & access**) and a save relaunches the app for you — it exits and a
  supervisor brings it back with the new `.env`, and the page reloads itself once it's up.
  Only enable it where something supervises the process (launchd `KeepAlive`, Docker
  `restart:`, systemd `Restart=`); otherwise the app would simply stop on save.
- **Auth:** set `WEB_AUTH_PASSWORD` to require a password (a session cookie gates the whole
  interface and API). Leave it empty only behind a trusted network (a tailnet, localhost) —
  see [security.md](./security.md).

## Choosing a brain (provider)

- **Local (default):** install [Ollama](https://ollama.com), `ollama pull gemma4:12b`
  (or another model), set `LLM_PROVIDER=ollama` and `LLM_MODEL`. Nothing leaves your
  machine.
- **Hosted:** set `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, and `LLM_API_KEY`.
  Works with OpenAI, OpenRouter, Groq, LM Studio, vLLM, and similar. (Native `anthropic`
  is planned; until then, reach Anthropic models through an OpenAI-compatible gateway such
  as OpenRouter.) `LLM_THINK` effort levels (`minimal`/`low`/`medium`/`high`) are sent as
  the standard `reasoning_effort` field — honored by reasoning models (OpenAI o-series/GPT-5,
  OpenRouter) and ignored elsewhere; `true`/`false` defer to the endpoint's own default.

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
- `local` — [whisper.cpp](https://github.com/ggerganov/whisper.cpp) run on this machine,
  with `ffmpeg` normalizing the audio first. No daemon and no network — nothing leaves the
  box, and there is no second service to bring back up after a reboot. Set `STT_LOCAL_MODEL`
  to a ggml/gguf model file (e.g. `./data/models/ggml-base.bin`); `whisper-cli` and `ffmpeg`
  must be on `PATH` (override with `STT_LOCAL_BIN` / `STT_FFMPEG_BIN`). `STT_LANGUAGE`
  hints the spoken language (`auto` detects). On macOS: `brew install whisper-cpp ffmpeg`,
  then download a model, e.g.
  `curl -L -o data/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`.

The same backend serves every channel: Telegram voice notes, and the web chat's mic
recording / audio-file upload (which POST to `/api/transcribe`).

Photos are forwarded as images to vision-capable models regardless of STT — on Telegram
and in the web chat (attach button / paste). Attached images are saved under
`DATA_DIR/uploads`, served back through the auth-gated `/uploads/` route, and redisplayed
in the chat history.

## The persona

The persona defines identity, relationship, tone, interests, language, and hard style
rules. It is assembled into the system prompt at runtime, resolved in this order of
precedence: a **settings override saved in the web UI**, then a **`persona/persona.md`
file**, then the chosen **preset**. You set it by:

- **Settings page** (`/setup`): on first run it asks the key questions — name, what it
  calls you, a preset or a custom persona, a few facts about you, and your model — including
  a live "test your model connection" step. Persona and facts take effect immediately;
  everything else is written to your `.env` and applies on restart.
- **Web UI** (`/setup` again any time): the same page doubles as the settings screen and
  exposes every `.env.example` variable. Persona is persisted to the `settings` table
  (overlaying the file/preset) and the facts seed the Core.
- **Persona file** (advanced): edit `persona/persona.md` directly. `{{name}}` / `{{owner}}`
  placeholders are interpolated.

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
