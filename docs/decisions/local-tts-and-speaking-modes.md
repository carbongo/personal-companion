# Local TTS engine, default provider, and the speaking-mode gate

Status: Accepted — 2026-07-31

## Context

Phase 7 added spoken replies (`src/channels/tts.ts`, mirroring the STT layer) and needed
three separate calls: which local synthesis engine to bundle, which provider is the
out-of-the-box default, and how a reply gets to decide it *should* be spoken at all. It
also raised a fourth question along the way — whether Telegram should grow a live,
call-like voice experience — which surfaced during the Telegram voice-note work and is
recorded here rather than left as an unexplained gap.

## Decision

**Piper is the only bundled local engine, and `local` is the default `TTS_PROVIDER`.**
Piper's small ONNX voice models synthesize a short paragraph on-box, well under the
latency a network round-trip to a hosted or `http` backend would cost, with no daemon to
keep running. Kokoro (higher-fidelity, heavier, slower per-paragraph) was considered and
rejected for the same reason `whisper.cpp` beat cloud STT as the STT default: this project
picks latency and locality over voice quality when the two trade off, matching the
local-first ethos the rest of the config defaults to (see
[local-first-default-and-web-auth](./local-first-default-and-web-auth.md)). `openai` and
`http` remain available for anyone who wants a better voice and is fine with the
round-trip.

**Whether a reply is spoken is three independent, OR'd triggers — not one enum** —
`speakMirror` (default `true`), `speakOnRequest` (default `true`), `speakSometimes`
(default `false`). A single "speaking mode" setting would force a false choice: mirroring
voice-in/voice-out, honoring an explicit per-turn request, and letting the model itself
decide via `<speak>` are genuinely different reasons to speak, and an owner may want any
combination (e.g. always mirror, never let the model decide on its own). Keeping them as
three booleans, each configurable and each visible as its own toggle in Settings, means
the default (mirror + on-request, sometimes off) is the least-surprising one: audio only
ever answers audio or an explicit ask, and the model never volunteers speech unless invited
to.

**A Telegram "call" experience — live, low-latency voice back-and-forth — was investigated
and explicitly not built.** The Bot API has no concept of a call; nothing short of a
separate MTProto user-bot integration (a second, heavier authentication surface entirely
outside the bot token model) could approximate one, and that is a poor fit for a
single-user, self-hosted companion. The fast voice-note round-trip Phase 7 ships instead —
`sendVoice` with a `record_voice` chat action while synthesizing — is the intentional
substitute: it reads as "the companion is composing a voice reply" without the
infrastructure and account-security cost of a user-bot.

## Consequences

- New installs get spoken replies with **no extra service to run** and no API key,
  consistent with the local-first default for STT and the LLM provider — but voice quality
  is a Piper voice model until an owner opts into `openai`/`http`.
- Settings ships three toggles instead of one dropdown, which is a slightly bigger surface
  but avoids re-litigating this decision later if a fourth trigger is ever needed (it's
  additive, not a breaking enum change).
- `speakOnRequest` currently has no trigger in plain Telegram text chat (there's no
  composer to toggle) — left unreachable there for now rather than inventing a slash
  command or keyword to fake one.
- No live-call feature exists or is planned under the current Bot API integration; anyone
  wanting that would need a materially different (MTProto) integration, which is out of
  scope for this project's single-user, self-hosted shape.

## Alternatives considered

- **Kokoro as the local engine** (or alongside Piper) — rejected; higher fidelity but
  slower per-paragraph synthesis, which would blunt the "speech starts after the first
  paragraph" streaming design the web chat relies on.
- **A single `TTS_SPEAK_MODE` enum** (`off`/`mirror`/`always`/`on-request`) — rejected; real
  usage wants combinations (e.g. mirror *and* on-request), which an enum can't express
  without a combinatorial blow-up of values.
- **MTProto user-bot for real Telegram calls** — rejected; a second authentication surface
  and a materially different integration than the Bot API the rest of the Telegram channel
  is built on, for a single-user deployment that doesn't need it.
