# Glossary

**Companion** — the configured persona you talk to. One per deployment.

**Engine** — the channel- and provider-agnostic core (`companion-core/`) that turns a
`turn` into a reply plus actions. The seam everything plugs into.

**Turn** — one neutral unit of input: `{ text, images?, transcript? }`. Channels build a
turn; the engine consumes it.

**Channel** — how you talk to the companion (Telegram, built-in web chat). A thin adapter
over the engine.

**Provider** — an LLM backend behind a common `chat()` interface (Ollama,
OpenAI-compatible, Anthropic).

**Persona** — the configuration that defines *who* the companion is: identity,
relationship, tone, interests, language, style rules. Never hardcoded.

**Preset** — a neutral, original starter persona (Sage, Pip, Coach, Companion) you adapt.

**Core** — the single living Markdown document holding the spine of the relationship; the
companion updates it over time.

**Memory** — collectively: the live day's messages, the Core, discrete saved memories,
and daily summaries.

**Daily summary** — the compressed conclusion of one past day, produced by the roll-up
and read on later days instead of raw transcript.

**Roll-up** — the nightly job that summarizes the day and backfills any missed days.

**Sidecar tag** — a small tag the model emits to act without API tool-calling:
`<remember>`, `<core>`, `<note>` (memory) and `<search>`, `<fetch>` (web). Parsed,
applied, and stripped before you see the reply.

**Context provider** — a plugin that injects live context (date/time, weather, …) into a
turn.

**SSRF guard** — the check that stops web-access page reads from reaching localhost,
private networks, or internal hostnames.

**Owner** — the single person a deployment belongs to (what the companion calls you:
`COMPANION_OWNER`).
