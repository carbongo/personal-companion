# Channels

A **channel** is how you talk to the companion. Every channel normalizes input into a
neutral `turn` (`{ text, images?, kind?, mediaUrl? }`), calls `engine.respond`, and renders
the `{ reply }` it returns. The engine is channel-agnostic, so channels are thin adapters.
(See the seam in [architecture.md](./architecture.md).)

> Status: the terminal REPL (`bun run chat`), Telegram (Phase 2), the built-in web chat
> (Phase 3), and Discord voice calling (Phase 8) are all live in code. Discord's live
> end-to-end (an actual call, placed against a real guild) is unverified here — see
> [roadmap.md](./roadmap.md)'s Phase 8.

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
    triggering a reply per message. The idle window is dynamic: `CHAT_BATCH_IDLE_MS` after the
    first message, growing by `CHAT_BATCH_STEP_MS` each further message, capped at
    `CHAT_BATCH_MAX_MS`. Shared with the web chat (see
    [configuration.md](./configuration.md#chat-batching)).
  - *Outgoing reply-split* — a long reply is sent as paragraph-sized messages with a typing
    indicator and short pauses, like a person texting. Toggle with `TELEGRAM_REPLY_SPLIT`.
  - Replies are also hard-wrapped under Telegram's 4096-character message limit.
- **Voice replies:** when the reply should be spoken (the mirror or sometimes trigger — see
  [configuration.md](./configuration.md#speaking-text-to-speech)) and TTS is configured, the
  whole reply is synthesized and sent as a voice note via grammY's `sendVoice`, with a
  `record_voice` chat action shown while synthesis is in flight so the round-trip still feels
  continuous. Falls back to the normal split-text reply on any synthesis/send failure, or
  whenever the gate says no. `speakOnRequest` has no natural trigger in plain Telegram text
  chat yet, so it stays unreachable there for now. A real "call" experience (live voice
  back-and-forth) was investigated and explicitly not built — see
  [decisions/local-tts-and-speaking-modes.md](./decisions/local-tts-and-speaking-modes.md).

## Discord (optional, voice-only calling)

Discord is not a text channel — it is the transport for **live voice calls** (Phase 8),
the one place a conversation happens by talking instead of typing. Text chat stays on
Telegram and the web UI; a third text surface would just duplicate them. See
[decisions/discord-voice-calls.md](./decisions/discord-voice-calls.md) for why Discord was
picked over a PWA, SIP, Twilio, and a native CallKit app, and
[architecture.md](./architecture.md#the-call-engine) for how the call engine itself works.

- **Setup:** create a bot in the Discord developer portal, put its token in
  `DISCORD_BOT_TOKEN`, and set `DISCORD_GUILD_ID` (the server), `DISCORD_VOICE_CHANNEL_ID`
  (the voice channel it listens in), and `DISCORD_OWNER_USER_ID` (your Discord user ID).
  `CALL_ENABLED=true` is the master switch — Discord being configured is not enough on its
  own. Empty config = the channel never starts, logged and non-fatal, exactly like Telegram
  with no token.
- **Starting a call:** the bot joins automatically when the owner enters the configured
  voice channel (`voiceStateUpdate`), or on demand with a `/call` command. Both routes check
  the caller's Discord user ID against `DISCORD_OWNER_USER_ID` first — anyone else's join or
  `/call` is ignored. **Discord bots have no way to ring anyone**, so the companion can only
  ever join a call the owner starts; it cannot initiate one (that needs Phase 9's
  `deliver()` primitive, and is out of scope even then until a "call me" delivery mode is
  designed).
- **Bystander exclusion is by construction, not by a model.** Discord hands the bot a
  separate Opus audio stream per participant; the adapter subscribes to the owner's user ID
  alone (`src/channels/discord/transport.ts`), so no other participant's audio is ever
  decoded or seen. Nothing downstream has to reason about whose voice it's hearing. (See
  [security.md](./security.md).)
- **The call loop:** owner audio is resampled to 16 kHz mono, run through voice-activity
  detection (Silero ONNX when its model is available, a dependency-free energy threshold
  otherwise — `CALL_VAD_PROVIDER`), framed into an utterance, transcribed, checked against a
  Whisper hallucination gate and a backchannel filter ("mhm"/"yeah" alone never reach the
  model), and handed to `engine.respond` — the same seam every channel uses. The reply
  streams out clause-by-clause (tighter than the paragraph streaming Phase 7 gave voice
  notes and web chat, so speech starts sooner) through the same TTS backend configured for
  Telegram and the web chat.
- **Waiting for the whole thought, not the first full stop.** The endpointer
  (`CALL_PATIENCE_MS`/`_EXTENDED_MS`/`_MAX_MS`) decides when to stop listening and hand the
  utterance to the model. Only a question ("...?") commits fast — asking is the one thing
  that reliably hands the floor over. A short declarative ending in a plain full stop is
  held and joined with whatever the owner says next, because Whisper punctuates almost every
  clause with a tidy period regardless of whether the thought is actually finished; a longer
  declarative still commits promptly, since by then it plainly was the whole turn. The
  practical effect: a rambling, multi-clause turn with pauses for breath no longer gets cut
  into several separate replies at each comma-that-looks-like-a-period. See
  [configuration.md](./configuration.md#turn-taking-only-a-question-commits-fast).
- **Fast language detection.** Local transcription (`STT_PROVIDER=local`) runs a cheap
  detect-and-exit pass before the real decode when `STT_DETECT_MODEL` is set, then decodes
  at a fixed, clamped-to-`STT_LANGUAGES` language instead of letting the main model guess —
  faster and, for a bilingual owner, more reliable than auto-detect. See
  [configuration.md](./configuration.md#fast-language-detection-and-clamping-it-to-what-you-actually-speak).
- **The hallucination gate actually catches silence-fill now.** It used to score on a signal
  (`no_speech_prob`) the local whisper-cli binary never reports, so dead air occasionally
  came back as an invented sentence with nothing to stop it. It now scores on the decoder's
  own per-token confidence, which whisper-cli does report — see
  [configuration.md](./configuration.md#the-hallucination-gate-and-what-it-actually-gates-on).
- **Voices switch by script, mid-reply.** Replies are spoken clause by clause, and each
  clause's voice is picked from `TTS_LOCAL_MODEL_MAP` by guessing the language from that
  clause's own script (Cyrillic vs. Latin) — so a reply that mixes English and Russian is
  heard in both voices instead of one voice reading the wrong language's words. Applies to
  every channel that speaks replies, not just calls. See
  [configuration.md](./configuration.md#picking-a-voice-per-clause-by-script).
- **Barge-in:** speaking over the companion's playback stops synthesis and audio
  immediately, and truncates the stored assistant turn to only the clauses that actually
  played — the model never believes it said something the owner never heard. On by default
  (`CALL_BARGE_IN`), and can be turned off.
- **Call turns persist as `kind:"voice"` messages** through the normal `messages` table, so
  they flow into the nightly roll-up like any other conversation — no special case.
- **A deliberate exception to local-first:** call audio transits Discord's own voice
  servers to reach it, unlike every other default in this project. Enabling the channel is
  an explicit opt-in to that; see [security.md](./security.md) and
  [decisions/discord-voice-calls.md](./decisions/discord-voice-calls.md).
- **Settings:** connection fields live under **Channels**, next to Telegram; call behaviour
  (VAD provider/sensitivity, silence timing, barge-in, the call model override) lives under
  a **Calling** sub-tab in Capabilities. See
  [configuration.md](./configuration.md#calling-over-discord-optional).

## Built-in web chat

A browser chat served by the same Bun process, so you can use the companion with **no
Telegram setup at all**. Open the app in a browser and talk to it. It streams over
`POST /api/chat/stream`, which builds a `turn` and calls `engine.respondStream` — the
streaming sibling of the `engine.respond` seam Telegram uses — so the web chat shares one
conversation and memory with every other channel (messages persist to the same `messages`
table, bucketed by the live day). A non-streaming `POST /api/chat` remains for other callers.

The web chat deliberately mirrors the Telegram channel:

- **Incoming batching, with read-style ticks** — a burst of quick messages is folded into one
  turn rather than answered line-by-line. Each message shows immediately with **one tick
  (queued — not sent yet, or it errored)**; once you go quiet for the current idle window the
  whole burst is delivered as a single `turn` and they flip to **two ticks (delivered)**. The
  window is the same dynamic, growing window as Telegram (the client reads
  `batchIdleMs`/`batchStepMs`/`batchMaxMs` from `/api/state`, sourced from the shared
  `CHAT_BATCH_*`). A burst that errored stays at one tick and rides along with your next send.
- **Live paragraph streaming** — a "…" bubble shows while the model gathers itself, then the
  reply **streams in paragraph-by-paragraph**: each finished paragraph is sent as its own
  message the instant the model completes it (server-side via `respondStream` + the provider's
  `chatStream`, sent as NDJSON `{type:"paragraph"}` lines; the pure `takeParagraphs` splitter
  flushes on blank lines, with sidecar/web tags stripped). The reply is still stored as one
  assistant message; history reload splits it back into the same paragraph bubbles.
- **Images** — attach (or paste) one or more images; they're sent as base64 `images` on the
  turn to vision-capable models, exactly like a Telegram photo. Each is saved under
  `DATA_DIR/uploads` and served back through the auth-gated `/uploads/` route, so it
  redisplays as a thumbnail when the history reloads (Telegram photos are saved the same way).
- **Voice** — record from the mic (shown only when STT is configured; needs a secure origin
  such as `https`/`localhost`) or attach an audio file. It POSTs to `POST /api/transcribe`,
  which runs the same STT backend every channel uses, and drops the transcript into the
  composer to review before sending.
- **Voice playback** — when a reply is being spoken, `respondStream` synthesizes audio
  per paragraph (behind `ttsConfigured()` and the same three-trigger gate as Telegram) and
  streams it back as an `audioUrl` alongside each NDJSON paragraph, saved under
  `DATA_DIR/uploads`. The client (`web/src/lib/voice.ts`) is a small sequential audio-queue
  player — one reused `<audio>` element, unlocked on the send gesture, clips enqueued and
  played back-to-back as they arrive — so speech starts after the first paragraph instead of
  waiting for the whole reply. A composer toggle requests a spoken reply (`Turn.wantsVoice`,
  the `speakOnRequest` trigger); a "speaking" indicator shows while audio plays. Once the
  stream completes, the message is persisted as `kind:"voice"` so it replays correctly after
  a reload.

The chat is one screen of a small web interface that also includes:

- **Memory admin** (`/memory`) — read and edit the Core (with an Edit/Preview toggle that
  renders Markdown), add / search / delete saved memories, read the daily summaries (rendered
  as Markdown), and trigger the nightly roll-up on demand. (See [memory.md](./memory.md).)
- **Settings** (`/setup`, nav label "Settings") — the first-run flow (name, owner, persona,
  owner facts, model with a live connection test, optional Telegram token + allowed user IDs)
  that doubles as a full settings editor afterwards: it prefills from the live configuration
  and exposes every variable in `.env.example` — model tuning, Telegram batching, memory, web
  access, speech-to-text, weather, and app/access — grouped to match the file. Secrets (bot
  token, API keys, `WEB_AUTH_PASSWORD`) are write-only — never echoed back, only shown as
  "set"; blank optional fields are left untouched on save. (See
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
