# Glossary

**Companion** — the configured persona you talk to. One per deployment.

**Engine** — the channel- and provider-agnostic core (`companion-core/`) that turns a
`turn` into a reply plus actions. The seam everything plugs into.

**Turn** — one neutral unit of input: `{ text, images?, kind?, mediaUrl? }` (voice notes
arrive as text once the channel transcribes them). Channels build a turn; the engine
consumes it.

**Channel** — how you talk to the companion (Telegram, built-in web chat, Discord voice
calls). A thin adapter over the engine.

**Call engine** — the transport-independent core of live voice calling
(`companion-core/call/`): resampling, voice-activity detection, utterance framing,
endpointing, the backchannel and hallucination filters, and barge-in. Discord is its first
`CallTransport` adapter, not the engine itself.

**VAD (voice activity detection)** — deciding, frame by frame, whether incoming call audio
is speech. `EnergyVad` is a dependency-free amplitude threshold; `SileroVad` is a small
optional ONNX model, used when available.

**Endpointing** — deciding when a caller has actually finished an utterance rather than
merely paused. The shipped `Endpointer` is a heuristic reading transcript text and silence
duration (trailing hesitations and dangling clauses extend the wait; a hard maximum always
commits) — not the semantic end-of-utterance model originally sketched for Phase 8. See
[decisions/discord-voice-calls.md](./decisions/discord-voice-calls.md).

**Barge-in** — the owner talking over the companion's playback during a call. It stops
synthesis and audio immediately and truncates the stored assistant turn to only the clauses
that actually played, so history never records something the owner never heard.

**Provider** — an LLM backend behind a common `chat()` interface (Ollama,
OpenAI-compatible, Claude CLI, Anthropic).

**Persona** — the configuration that defines *who* the companion is: identity,
relationship, tone, interests, language, style rules. Never hardcoded.

**Preset** — a neutral, original starter persona (Sage, Pip, Coach, Companion) you adapt.

**Core** — the single living Markdown document holding the spine of the relationship; the
companion updates it over time.

**Memory** — collectively: the live day's messages, the Core, discrete saved memories,
and daily summaries.

**Daily summary** — the compressed conclusion of one past day, produced by the roll-up
and read on later days instead of raw transcript.

**Roll-up** — the nightly job that summarizes the day, reconciles long-term memory against
it (saving new durable facts, dropping ones the day made wrong), and backfills any missed
days.

**Sidecar tag** — a small tag the model emits to act without API tool-calling. In the live
conversation the only sidecar tags are `<search>` and `<fetch>` (web). The memory tags
`<remember>` / `<forget>` survive only inside the nightly roll-up's reconciliation pass, not
mid-conversation. Parsed and stripped before you see the reply.

**Context provider** — a plugin that injects live context (date/time, weather, …) into a
turn.

**SSRF guard** — the check that stops web-access page reads from reaching localhost,
private networks, or internal hostnames.

**Owner** — the single person a deployment belongs to (what the companion calls you:
`COMPANION_OWNER`).
