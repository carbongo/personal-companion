# Overview

## What it is

`personal-companion` is a self-hostable AI companion: a configurable persona with
persistent memory that you talk to over Telegram and a built-in web chat. It is the
*engine*. Loaded with your private configuration, it becomes *your* companion.

One deployment serves **one person** (single-user, single-tenant). Run your own; your
data stays yours.

## Who it's for

Anyone who wants a personal AI companion they fully control: the personality, the model
behind it, where it runs, and what it remembers. No accounts, no someone-else's-servers,
no fixed character.

## The core idea

Three ideas hold the project together:

1. **Generic by construction.** The repo contains zero real-person data. Personality is
   configuration, not code. It ships neutral presets you adapt — never a fixed character.
   (See the golden rule in [AGENTS.md](../AGENTS.md).)

2. **Local-first, but your choice.** The default brain is a local
   [Ollama](https://ollama.com) model, so conversations never leave your machine. You can
   instead point it at any OpenAI-compatible or Anthropic endpoint. (See
   [decisions/local-first-default-and-web-auth.md](./decisions/local-first-default-and-web-auth.md).)

3. **Memory is the spine.** It keeps a living "Core" picture of you, saves discrete
   facts on its own, and compresses each day into a summary it reads on later days — so
   it carries continuity instead of starting fresh every conversation. (See
   [memory.md](./memory.md).)

## How you talk to it

- **Telegram** (optional): text, voice notes (transcribed), and photos in; text out.
  It reads like a person texting — batching your quick messages, replying in paragraphs.
- **Built-in web chat**: a browser chat served by the app itself, so you can use it with
  no Telegram setup at all.

Both go through the same engine. See [channels.md](./channels.md).

## What it is not

- Not multi-user SaaS. One deployment, one owner.
- Not a fixed character or a branded persona. You define who it is.
- Not a general task agent. It is a companion with memory; tools are deliberately small
  (its own memory, optional web lookups). See [architecture.md](./architecture.md).

## Where to go next

- The shape of the system: [architecture.md](./architecture.md)
- Making it yours: [configuration.md](./configuration.md)
- The build plan and status: [roadmap.md](./roadmap.md)
