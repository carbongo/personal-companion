# Architecture

A single long-lived **Bun** process runs everything: the web interface, the Telegram
channel, and the nightly memory roll-up. Layers are arranged so the companion logic is
independent of *how* you talk to it and *which* model is behind it.

## Layers

```
channels/          how you talk to it (Telegram, built-in web chat)
   │  turns in, replies out
   ▼
companion-core/    the engine — channel- and provider-agnostic
   ├─ persona      assemble the system prompt from configuration
   ├─ context      pluggable providers (datetime, weather, …)
   ├─ memory       Core, saved memories, daily summaries, roll-up
   ├─ actions      parse <remember>/<core>/<note> sidecar tags
   ├─ web          bounded <search>/<fetch> egress
   └─ engine       respond(turn) -> { reply }   ← the seam
   │
   ▼
llm/               provider abstraction: chat(messages, opts) -> text
   ├─ ollama          local (default)
   ├─ openai-compat   OpenAI / OpenRouter / Groq / LM Studio / vLLM
   └─ anthropic       native Claude (optional)

db/                SQLite via Drizzle (data lives in DATA_DIR)
config/            the only place env is read; hands a typed object around
server/            Bun + Hono entry point; boots the channels and the web layer
   └─ web/         server-rendered pages (Hono JSX) + JSON API + auth (no build step)
```

## The engine seam

The whole design hinges on one function:

```ts
engine.respond(turn) -> { reply }
```

A `turn` is channel-neutral: `{ text, images?, kind?, mediaUrl? }` (a voice note arrives as
text once the channel transcribes it). Both the Telegram adapter and the web chat build a
turn and call `respond`; neither knows anything about the model or the memory. Sidecar
actions are applied inside the engine, so the channel only handles the returned `reply`. This is what lets new channels and new providers drop in without touching
the core. (See [decisions/channel-abstraction.md](./decisions/channel-abstraction.md)
and [decisions/llm-provider-abstraction.md](./decisions/llm-provider-abstraction.md).)

## How a turn flows

1. A **channel** receives input (a Telegram message, or a web-chat POST), normalizes it
   to a `turn`, and calls `engine.respond`.
2. The engine builds the prompt: a **stable cached system prefix** (persona +
   semi-stable knowledge: Core, memories, recent summaries) plus a small **per-turn
   delta** (date, weather) on the latest message. This keeps local-model KV cache reuse
   high and tokens low. (See [memory.md](./memory.md).)
3. The **LLM provider** generates a reply.
4. If web access is on and the reply contains `<search>`/`<fetch>` tags, the engine runs
   them, feeds results back, and regenerates — a small bounded loop.
   (See [web-access.md](./web-access.md).)
5. **Sidecar actions** (`<remember>`, `<core>`, `<note>`) are parsed out, applied to
   memory, and stripped from the user-facing text.
6. The channel sends the reply (Telegram splits it into paragraph-sized messages).

## Why no API tool-calling loop

Small local models drive multi-round tool loops unreliably, and re-sending context every
round is wasteful. Instead, context is **injected** and the model **acts via tiny sidecar
tags** that the engine parses. Hosted providers may use real tool-calling later as an
opt-in, but the sidecar path is the portable default. (See
[decisions/sidecar-tags-not-tool-calling.md](./decisions/sidecar-tags-not-tool-calling.md).)

## The web layer

`server/web/` mounts the whole browser-facing surface onto the same Hono app via one
`mountWeb(app)` call:

- **Pages** (`pages.tsx`) are server-rendered with Hono JSX — chat, memory admin, setup
  wizard, login. No SPA bundler; interactivity is a stylesheet and three small scripts
  served as routes from `assets.ts`. (See
  [decisions/web-ui-server-rendered-no-build.md](./decisions/web-ui-server-rendered-no-build.md).)
- **JSON API** (`api.ts`) is the seam those scripts call. The built-in chat (`POST /api/chat`)
  builds a `turn` and calls `engine.respond` — the exact same path Telegram uses — so the
  web chat shares one conversation and memory with every other channel.
- **Auth** (`auth.ts`) gates pages and API behind a `WEB_AUTH_PASSWORD` session cookie, and
  is a no-op when the password is unset (trusted network). (See [security.md](./security.md).)
- **Setup wizard** persists persona and owner facts to the DB (live, read every turn) and
  writes model/name/channel choices to `.env` (applied on restart), after a live model
  connection test. (See [configuration.md](./configuration.md).)

## Process model

Everything runs in one Bun process so a single `bun start` (or one container) gives you
the bot **and** the web UI. The Telegram bot uses long-polling (no public webhook needed)
and the roll-up runs on an in-process cron. State is a single SQLite file under
`DATA_DIR`. (See [data-model.md](./data-model.md) and [deployment.md](./deployment.md).)
