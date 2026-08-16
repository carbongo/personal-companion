# Discord as the call transport, and the call engine behind it

Status: Accepted — 2026-08-16

## Context

[local-tts-and-speaking-modes](./local-tts-and-speaking-modes.md) closed the question of a
*Telegram* call and recorded that no live-call feature was planned. That was scoped to
Telegram's Bot API, and it left the broader want unanswered: a real-time, full-duplex voice
conversation — a call — reachable from a phone.

Two problems sit behind that want, and they are separable. The **transport** is how audio
reaches the phone and how the conversation is summoned. The **call engine** is everything
that makes a live conversation tolerable: not reacting to bystanders, to keyboards, or to a
mid-sentence "um…", and stopping cleanly when interrupted. Only the second is interesting,
and it is the same work whatever the transport is.

Four transports were surveyed:

- **Installed PWA.** iOS gives PWAs Web Push (16.4+) but no silent push, no background
  wake, and no CallKit — the framework behind the lock-screen ring is native-only. The
  ceiling is a notification that, when tapped, opens the app and starts a session. It
  cannot ring.
- **SIP + a third-party client** (Linphone, Groundwire). Genuinely rings, because those
  clients register themselves with CallKit; costs nothing per minute and stays on the
  tailnet. Requires running and maintaining a PBX (Asterisk/FreeSWITCH), and reliable VoIP
  push for a backgrounded client is the fiddly part.
- **Twilio `<Connect><Stream>`.** A real call to a real number, working in about a day, at
  roughly $1/month plus per-minute. Every word transits Twilio.
- **A native app with CallKit.** Total control, and by a wide margin the most work: an
  Apple Developer account, a real app, and a release process, for one user.

## Decision

**Discord is the call transport, and it carries voice only.** A bot sitting in a voice
channel in a private guild gives a real mobile call experience — the phone's ongoing-call
UI, speakerphone, background audio — for the price of a bot token. No Apple Developer
account, no PBX to operate, no per-minute cost, and the mobile client already exists and is
already installed. Text chat stays on Telegram and the web UI; Discord is not being adopted
as a general channel, because a third text channel is surface without a reason.

The accepted cost is that **Discord cannot ring.** The owner starts every call by joining a
voice channel. This is the one thing SIP and Twilio buy that Discord does not, and it is
worth deferring rather than paying a PBX or a phone bill for: the companion has no way to
*initiate* contact at all until Phase 9's `deliver()` primitive exists, so the ability to
be rung is not currently blocked by the transport.

**Bystander rejection comes from the transport, not from a model.** Discord delivers
per-user Opus streams, so the adapter subscribes to the owner's user ID alone and no other
participant's audio is ever received. This is exact and free, and it is a large part of why
Discord won. Acoustic speaker verification (ECAPA-TDNN enrolment) is therefore **deferred**
— it would only add rejecting a second voice bleeding into the owner's own microphone,
which is a narrower problem than it first appears.

**The call engine lives in `src/companion-core/call/`, not in the Discord adapter.** Silero
VAD for speech framing, a small end-of-utterance model for semantic endpointing, a
filler/backchannel filter, a Whisper hallucination gate, and barge-in that truncates the
assistant turn in history to what was actually spoken. None of this is Discord-specific, and
keeping it behind the channel seam is what makes a later SIP or native transport an adapter
rather than a rewrite. Call turns go through `engine.respond` like any other turn and
persist as `kind:"voice"` messages, so persona, memory, and the nightly roll-up need no
special case.

**Calls get their own model override** (`CALL_MODEL`, falling back to the configured model).
A call has nowhere to hide a slow turn, and the local-first default is a small model chosen
for text.

**Speech-to-speech APIs were rejected for this phase.** OpenAI Realtime and Gemini Live
collapse the entire engine into one socket with better latency than this design will
achieve. They also bypass `engine.respond`, taking persona, memory, and the sidecar tags
with them — persona and memory would have to be re-injected as session instructions and
re-exposed as function calls. That is a fork in the architecture, not a provider swap, and
it is not one to take incidentally while adding a channel.

## Consequences

- **Call audio transits Discord's servers.** This is a real, deliberate exception to the
  local-first posture of every other default (see
  [local-first-default-and-web-auth](./local-first-default-and-web-auth.md)), scoped to this
  one channel and to audio only. Anyone unwilling to accept it should not enable the
  Discord channel; the transport-independent engine means a self-hosted SIP adapter remains
  open to them later.
- **Bot audio receive is undocumented by Discord.** `@discordjs/voice` implements it anyway
  and it is widely used, but it carries no stability guarantee and could break without
  notice. The call engine surviving that breakage — because it is not in the adapter — is
  the mitigation.
- `@discordjs/voice` has known friction with the `sodium-native` native module under Bun;
  the pure JS/wasm encryption and Opus fallbacks are preferred, at some CPU cost.
- The prior statement in [local-tts-and-speaking-modes](./local-tts-and-speaking-modes.md)
  that no live-call feature is planned is superseded by this record; its reasoning about
  *Telegram* specifically still stands.
- Phase 7's per-paragraph `ParagraphSink` becomes per-clause for calls. The paragraph
  granularity remains correct for voice notes.

## Alternatives considered

- **PWA "call mode"** — rejected as the primary transport; it cannot ring and iOS suspends
  it in the background, so the phone must stay awake with the app open. Still the cheapest
  future second adapter, since the web client already captures microphone audio.
- **SIP + Linphone/Groundwire** — rejected for now, and the strongest candidate if ringing
  becomes the priority: it rings properly, costs nothing per minute, and stays on the
  tailnet, but it means operating a PBX for one user.
- **Twilio Programmable Voice** — rejected; the fastest path to a working call, but routing
  every call through a commercial carrier is a worse privacy trade than Discord for no
  benefit this project needs.
- **Native iOS app with CallKit** — rejected; weeks of work and a paid developer account to
  serve one person.
- **Discord as a full channel (text + voice)** — rejected; a third text channel duplicating
  what Telegram and the web UI already do, with its own splitter, batcher, and allowlist.
