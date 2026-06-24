# personal-companion

A self-hostable, configurable **AI companion** you actually talk to — over Telegram
and a built-in web chat. It remembers your conversations, builds a living picture of
who you are over time, and is whoever *you* want it to be: a friend, a mentor, a
coach, a sounding board.

**Local-first by default.** Point it at a local [Ollama](https://ollama.com) model and
nothing leaves your machine. Prefer a hosted model? Drop in any OpenAI-compatible or
Anthropic key instead. One deployment = one person's companion.

> **Status: working, still maturing.** The engine, the Telegram channel, and the web
> interface (chat + memory admin + first-run setup wizard) are all in place (Phases 0–3).
> Packaging polish and a data importer are next — see [docs/roadmap.md](./docs/roadmap.md).

---

## Why

Most "AI companion" products are someone else's persona on someone else's servers,
reading your conversations. This is the opposite: **your companion, your data, your
rules**, running on hardware you control, shaped by a persona you write.

## Features

- 🧠 **Persistent memory** — a living "Core" doc, discrete saved facts, and a nightly
  roll-up that compresses each day into a summary it reads on later days.
- 💬 **Talk how you like** — Telegram (text, voice notes, photos) *and* a built-in
  browser chat. Telegram is optional; the web chat works on its own.
- 🎭 **Fully configurable persona** — name it, set its personality, relationship, tone,
  interests, and language with a setup wizard or a persona file. Ships with neutral
  presets, never a fixed character.
- 🔌 **Bring your own brain** — local Ollama (default), or any OpenAI-compatible /
  Anthropic endpoint.
- 🌐 **Optional web access** — it can search and read links you share, when you let it.
- 🐳 **One-command deploy** — Docker Compose, with an optional bundled Ollama.

## Quickstart

```bash
git clone https://github.com/carbongo/personal-companion
cd personal-companion
bun install
bun run dev               # boots the server on http://localhost:8080
```

Then open `http://localhost:8080` — with nothing configured yet, you land on the **setup
wizard**: name your companion, pick a personality, point it at a model (with a live
connection test), and you're talking. No front-end build step. Prefer the terminal?
`bun run chat`.

Full setup, configuration, and deployment live in the **[docs wiki](./docs/README.md)**.

## Documentation

Everything about *what this is* and *why* is in [`docs/`](./docs/README.md), wiki-style.
Start at [docs/overview.md](./docs/overview.md) or jump to
[configuration](./docs/configuration.md) · [architecture](./docs/architecture.md) ·
[deployment](./docs/deployment.md) · [roadmap](./docs/roadmap.md).

Contributing? Read [AGENTS.md](./AGENTS.md) first — docs are part of every change.

## License

[MIT](./LICENSE).
