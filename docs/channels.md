# Channels

A **channel** is how you talk to the companion. Every channel normalizes input into a
neutral `turn` (`{ text, images?, kind?, mediaUrl? }`), calls `engine.respond`, and renders
the `{ reply }` it returns. The engine is channel-agnostic, so channels are thin adapters.
(See the seam in [architecture.md](./architecture.md).)

> Status: all three channels are live — the terminal REPL (`bun run chat`), Telegram
> (Phase 2), and the built-in web chat (Phase 3).

## Telegram (optional)

A [grammY](https://grammy.dev) bot using **long-polling** — no public URL or webhook
needed, so it runs from anywhere, including behind NAT.

- **Setup:** create a bot with [@BotFather](https://t.me/BotFather), put the token in
  `TELEGRAM_BOT_TOKEN`, and add your numeric Telegram ID to `TELEGRAM_ALLOWED_USER_IDS`
  (get it from [@userinfobot](https://t.me/userinfobot)). Empty token = Telegram disabled.
- **Allowlist:** only listed user IDs are answered; everyone else is silently ignored.
- **Multimodal:** text, voice notes (transcribed if STT is configured — see
  [configuration.md](./configuration.md)), and photos (sent to vision-capable models).
- **Human feel:**
  - *Incoming batching* — a burst of quick messages is debounced into one turn rather than
    triggering a reply per message. It flushes after `TELEGRAM_BATCH_IDLE_MS` of silence,
    but never waits longer than `TELEGRAM_BATCH_MAX_MS` from the first message.
  - *Outgoing reply-split* — a long reply is sent as paragraph-sized messages with a typing
    indicator and short pauses, like a person texting. Toggle with `TELEGRAM_REPLY_SPLIT`.
  - Replies are also hard-wrapped under Telegram's 4096-character message limit.

## Built-in web chat

A browser chat served by the same Bun process, so you can use the companion with **no
Telegram setup at all**. Open the app in a browser and talk to it. It posts each message to
`POST /api/chat`, which builds a `turn` and calls `engine.respond` — the same seam Telegram
uses — so the web chat shares one conversation and memory with every other channel (messages
persist to the same `messages` table, bucketed by the live day). A multi-paragraph reply is
shown as separate bubbles (split on blank lines), the same texting feel the Telegram
reply-split produces; the reply is still stored as one assistant message, so this is purely a
display choice (applied both to live replies and to history on reload).

The chat is one screen of a small web interface that also includes:

- **Memory admin** (`/memory`) — read and edit the Core, add / search / delete saved
  memories, read the daily summaries, and trigger the nightly roll-up on demand. (See
  [memory.md](./memory.md).)
- **Setup wizard** (`/setup`) — a first-run flow (name, owner, persona, owner facts, model
  with a live connection test, optional Telegram token). (See
  [configuration.md](./configuration.md).)

The whole interface sits behind `WEB_AUTH_PASSWORD` and is rendered server-side with Hono
JSX — no build step (see [security.md](./security.md) and
[architecture.md](./architecture.md)).

## Adding a channel

Implement an adapter that builds a `turn`, calls `engine.respond`, and renders the
`{ reply }` it returns. No core changes required — that is the point of the seam. The
Telegram adapter in `src/channels/telegram/` is the worked example: an allowlist gate, a
pure [reply-splitter](../src/channels/telegram/split.ts), an
[incoming batcher](../src/channels/telegram/batcher.ts), and pluggable
[speech-to-text](../src/channels/stt.ts). (See
[decisions/channel-abstraction.md](./decisions/channel-abstraction.md).)
