# Claude CLI as a provider

Status: Accepted — 2026-07-26

## Context

A local model is the privacy-first default, but it ties the companion to the machine that can
run it. Anyone whose model lives on a laptop loses their companion the moment the lid closes —
exactly when a pocket-sized chat over Telegram is worth the most. The obvious fix is to move
the deployment onto an always-on box, which then needs a brain that box can actually run.

Small always-on hosts often can't hold a decent local model, and reaching a hosted API means
provisioning and storing an API key. But the kind of box that hosts this is frequently a
machine that already has the **Claude CLI installed and signed in**. That is an authenticated
Claude model already sitting on the host, with no key to issue and nothing new to run.

## Decision

Add a third built-in provider, **`claude-cli`**, that spawns the local `claude` binary in
headless mode (`claude -p`) once per generation, instead of talking HTTP. It implements the
same `LLMProvider` interface as the others (see
[llm-provider-abstraction](./llm-provider-abstraction.md)), so the engine is unchanged.

Config is `LLM_PROVIDER=claude-cli`, `LLM_MODEL` as a Claude alias or full name (`haiku`,
`sonnet`, `claude-haiku-4-5`), and `LLM_CLAUDE_BIN` for the binary's location. **No API key
and no base URL** — the CLI carries its own authentication.

Three details make a coding agent behave as a chat model:

- **`--system-prompt`** *replaces* Claude Code's own system prompt, so the persona is the whole
  prompt: no CLAUDE.md, no coding scaffolding, no tool instructions.
- **`--tools ""`, `--strict-mcp-config`, `--setting-sources ""`** strip it to a plain model —
  it cannot read files, run commands, or inherit the host's settings, hooks, or MCP servers.
  `--no-session-persistence` leaves nothing on disk.
- **Prior turns are flattened into one labelled transcript** inside a single user message.
  History cannot be sent as separate stream-json messages: the CLI answers *each* user message
  it reads, which would generate (and bill) a reply per historical line.

Images ride along as base64 blocks in that one message, and `--include-partial-messages`
gives real token deltas, so vision and streaming both work like the other providers.
`LLM_THINK` maps to `--effort`; since the CLI has no off switch, `false` becomes `low`.

## Consequences

- An always-on host that already runs Claude Code can host the companion with **no key, no
  model download, and no second service** — one env change.
- Usage is billed to whatever the CLI is signed in as. On a subscription that means companion
  chat draws on the same allowance as coding; a Haiku turn is cheap, but it is not free and it
  is not local. Users who want zero egress should stay on Ollama.
- `LLM_TEMPERATURE`, `LLM_NUM_CTX` and `LLM_MAX_TOKENS` have no CLI equivalent and are
  **ignored** by this provider; reply length is the persona's job. Reasoning tokens share the
  output budget, so capping output would truncate replies rather than shorten them.
- A process spawn per turn costs a little latency (a few hundred ms on top of generation) and
  depends on the CLI's flags staying stable — a coupling the HTTP providers don't have.
- The prompt is a flattened transcript rather than native message roles, which is slightly
  less faithful than the other providers' role arrays.

## Alternatives considered

- **Native `anthropic` provider over HTTP** — still the right thing to add (and still
  planned), but it needs an API key. This provider exists precisely to need nothing.
- **`--resume` with a persistent CLI session per conversation** — rejected; the engine owns
  history and memory, and a second source of truth inside the CLI would diverge from the
  database and bypass the memory layer.
- **Passing history as separate stream-json messages** — rejected; the CLI replies to every
  user message it reads, so this generates and bills a reply per historical turn.
- **`--bare`** — rejected; it strips context nicely but restricts auth to `ANTHROPIC_API_KEY`,
  which defeats the whole point of using the CLI's own sign-in.
