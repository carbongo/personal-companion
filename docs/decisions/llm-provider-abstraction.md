# LLM provider abstraction

Status: Accepted — 2026-06-24

## Context

The companion should run on a private local model *or* a hosted one, by the user's choice,
without the rest of the code caring which.

## Decision

Put every model behind one interface — roughly `chat(messages, opts) -> text` — with
built-in providers:

- **Ollama** (local, the default),
- **OpenAI-compatible** (OpenAI, OpenRouter, Groq, LM Studio, vLLM, …),
- **Anthropic** (native).

Provider and model are chosen by config (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`,
`LLM_API_KEY`). The engine depends only on the interface.

## Consequences

- Users pick local-first privacy or a hosted model with one config change.
- Provider SDKs stay optional — only the chosen backend is needed at runtime.
- The frugal single-shot prompting (cached prefix + small delta) is the portable default
  across providers; capable hosted models may later opt into real tool-calling.

## Alternatives considered

- **Ollama only** — rejected; excludes users who want a hosted model.
- **A single hosted provider** — rejected; breaks the local-first, no-egress default.
