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
| `LLM_PROVIDER`            | `ollama`             | `ollama` \| `openai-compatible` \| `claude-cli` \| `anthropic` (planned — not yet implemented; use `claude-cli` or `openai-compatible` against an Anthropic-compatible gateway). |
| `LLM_MODEL`               | `gemma4:12b`         | Model name for the chosen provider (recommended local default). |
| `LLM_VISION_MODEL`        | (empty)              | Optional. Model for image turns when `LLM_MODEL` can't see (e.g. a text-only model). Leave empty if `LLM_MODEL` is vision-capable. Ollama example: `qwen2.5vl:7b`. |
| `LLM_OLLAMA_URL`          | `http://localhost:11434` | Local Ollama endpoint. |
| `LLM_API_KEY` / `LLM_BASE_URL` | (empty)         | For hosted providers. |
| `LLM_CLAUDE_BIN`          | `claude`             | The Claude CLI command (provider `claude-cli`); resolved on `PATH` if bare. |
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
  is planned; until then, reach Anthropic models through the Claude CLI below or an
  OpenAI-compatible gateway such as OpenRouter.) `LLM_THINK` effort levels
  (`minimal`/`low`/`medium`/`high`) are sent as the standard `reasoning_effort` field —
  honored by reasoning models (OpenAI o-series/GPT-5, OpenRouter) and ignored elsewhere;
  `true`/`false` defer to the endpoint's own default.
- **Claude CLI:** set `LLM_PROVIDER=claude-cli` and `LLM_MODEL` to a Claude alias or full
  name (`haiku`, `sonnet`, `claude-haiku-4-5`). **No API key and no URL** — it spawns the
  `claude` command already installed and signed in on this machine
  (`LLM_CLAUDE_BIN` if it isn't on `PATH`). See [the CLI as a brain](#the-claude-cli-as-a-brain).

See [decisions/llm-provider-abstraction.md](./decisions/llm-provider-abstraction.md).

### The Claude CLI as a brain

This is the pragmatic option for an **always-on host**. If your companion runs on a laptop
with a local model, it goes quiet whenever the lid is shut — which is exactly when texting it
from your phone matters. Move the deployment to a machine that stays up, and if that machine
already has the Claude CLI signed in, it already has a brain: nothing to provision, no key to
store, no model to download.

Each turn spawns `claude -p` once and reads back one reply. The CLI is stripped to a plain
chat model — `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, so it can't read
files, run commands, or pick up the host's settings, hooks, MCP servers, or `CLAUDE.md` — and
your persona is passed as `--system-prompt`, replacing Claude Code's own prompt entirely.
Streaming and images both work as usual.

Setup on the host, in full:

```bash
claude            # once, interactively, to sign in
# then in .env:
LLM_PROVIDER="claude-cli"
LLM_MODEL="haiku"
LLM_THINK="medium"
```

Worth knowing:

- **Usage is billed to whatever the CLI is signed in as.** On a subscription, companion chat
  draws on the same allowance as your coding. Haiku turns are cheap, but this is not local and
  not free — stay on Ollama if you want zero egress.
- **`LLM_THINK` maps to `--effort`** (`low`/`medium`/`high`, plus `xhigh`/`max`). The CLI has
  no off switch, so `false` becomes `low`.
- **`LLM_TEMPERATURE`, `LLM_NUM_CTX` and `LLM_MAX_TOKENS` are ignored** — the CLI exposes no
  equivalents, and reasoning tokens share the output budget, so a cap would truncate replies
  rather than shorten them. Ask for brevity in the persona instead.
- **`LLM_MODEL` must be a Claude name.** An Ollama-style tag like `gemma4:12b` is refused with
  a clear error rather than a cryptic CLI failure — a common slip when switching providers.

See [decisions/claude-cli-provider.md](./decisions/claude-cli-provider.md) for the trade-offs.

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

Message **batching** is configured under [Chat](#chat-batching) below — it's shared with the
web chat, not Telegram-specific.

See [channels.md](./channels.md) for how the adapter maps onto the engine seam.

## Chat (batching)

When you fire off several short messages in a row, the companion folds that burst into a
single turn and answers the whole thought at once — instead of replying to each line
mid-sentence. This applies to **both the web chat and Telegram** (the web chat batches in the
browser; Telegram batches on the server), so the knobs live here rather than under a channel.

The wait is **dynamic**: it pauses `CHAT_BATCH_IDLE_MS` after your first message, then grows
by `CHAT_BATCH_STEP_MS` with each further one (you're clearly mid-thought), up to a ceiling of
`CHAT_BATCH_MAX_MS`. So a one-off message flushes quickly while a flurry gets room to breathe.
The burst flushes once you go quiet for the **current** window — and that growing ceiling is
the *only* bound, there is no separate cap on total elapsed time.

| Var                  | Default | What it does |
| -------------------- | ------- | ------------ |
| `CHAT_BATCH_IDLE_MS` | `3000`  | The wait after the **first** message — the snappy case when you send just one thing. |
| `CHAT_BATCH_STEP_MS` | `2000`  | How much longer it waits for **each further** message in the burst. `0` makes it a plain fixed window. |
| `CHAT_BATCH_MAX_MS`  | `12000` | The **ceiling**: the window never grows past this, so it can't wait forever. |

With the defaults, the gap it will tolerate between messages goes `3s → 5s → 7s → 9s → 11s →
12s → 12s…`.

> The previous `TELEGRAM_BATCH_IDLE_MS` / `TELEGRAM_BATCH_MAX_MS` names still work as a
> fallback when the `CHAT_*` ones are unset, so existing `.env` files keep working.

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

### Speaking (text-to-speech)

Replies can be spoken back — pick a backend with `TTS_PROVIDER`:

- `off` — no audio is synthesized, only text goes out.
- `openai` — the hosted OpenAI speech API; set `TTS_API_KEY` (and optionally `TTS_MODEL`,
  default `tts-1`, and `TTS_VOICE`).
- `http` — any OpenAI-compatible `/audio/speech`-style endpoint (e.g. a local speaches
  server); set `TTS_API_URL` (and `TTS_API_KEY`/`TTS_MODEL`/`TTS_VOICE` if it needs them).
- `local` (**default**) — [Piper](https://github.com/rhasspy/piper) run on this machine.
  No daemon and no network — nothing leaves the box, and Piper's small ONNX voice models
  synthesize a short paragraph well under the latency a round-trip would cost. Set
  `TTS_LOCAL_MODEL` to a Piper `.onnx` voice file; the `piper` CLI must be on `PATH`
  (override with `TTS_LOCAL_BIN`). Piper is the only local engine — chosen over
  higher-fidelity options like Kokoro for latency, matching this project's local-first
  default. See
  [decisions/local-tts-and-speaking-modes.md](./decisions/local-tts-and-speaking-modes.md).

Whether a given reply is actually spoken is controlled separately, by **three independent
triggers** — any one being true is enough (they're OR'd, not a single mode):

| Var                     | Default | Speaks when… |
| ----------------------- | ------- | ------------ |
| `TTS_SPEAK_MIRROR`      | `true`  | the owner's turn was itself a voice note — audio answers audio. |
| `TTS_SPEAK_ON_REQUEST`  | `true`  | the channel flagged this turn as wanting a spoken reply (the web chat's composer toggle; not yet reachable from Telegram). |
| `TTS_SPEAK_SOMETIMES`   | `false` | the companion itself decides, wrapping the worth-saying part of its reply in a `<speak>` tag. Off by default so the model can't produce unsolicited audio. |

The same gate and backend serve every channel: the web chat plays synthesized audio back
per streamed paragraph, and Telegram sends a voice note for the whole reply. See
[channels.md](./channels.md).

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

Pick one in the wizard and tweak from there. Each preset carries its own **interests**
alongside its identity. See
[decisions/persona-as-configuration.md](./decisions/persona-as-configuration.md).

### Interests

What the companion is into *apart from you* — the material it steers toward when a thread
has run out, so the conversation moves instead of circling back to whatever you last
mentioned. Edit it in **Settings → Persona → Interests**; it is persisted to the
`settings` table as `interests` and applies immediately, with `{{name}}` / `{{owner}}`
interpolated.

Left empty, the chosen preset's interests are used — but only when the preset is also
supplying the identity. If you wrote a custom persona, it defines the whole character and
no stock archetype's tastes are bolted onto it; put the interests in the persona text, or
fill this field. See [conversation-dynamics.md](./conversation-dynamics.md).

## Context providers

Beyond persona and memory, the companion can be fed live context. Built-in providers:
date/time (always) and weather (Open-Meteo, keyless — set `WEATHER_LAT`/`WEATHER_LON`).
Additional providers are a documented extension point (see
[architecture.md](./architecture.md)).
