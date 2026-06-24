# Channels

A **channel** is how you talk to the companion. Every channel normalizes input into a
neutral `turn` (`{ text, images?, transcript? }`), calls `engine.respond`, and renders the
reply. The engine is channel-agnostic, so channels are thin adapters. (See the seam in
[architecture.md](./architecture.md).)

> Status: Telegram lands in Phase 2, the web chat in Phase 3.

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
  - *Incoming batching* — quick consecutive messages are debounced into one turn instead
    of triggering a reply per message.
  - *Outgoing reply-split* — a long reply is sent as paragraph-sized messages with typing
    indicators and short pauses, like a person texting. Toggle with `TELEGRAM_REPLY_SPLIT`.

## Built-in web chat

A browser chat served by the same Bun process, so you can use the companion with **no
Telegram setup at all**. It uses the same engine and memory; messages persist to the same
`messages` table. The web chat shares the web interface with the setup wizard and memory
admin, behind `WEB_AUTH_PASSWORD`. (See [security.md](./security.md).)

## Adding a channel

Implement an adapter that builds a `turn`, calls `engine.respond`, and renders
`{ reply, actions }`. No core changes required — that is the point of the seam. (See
[decisions/channel-abstraction.md](./decisions/channel-abstraction.md).)
