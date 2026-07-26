# Conversation dynamics

How the companion is kept from circling: a computed read of the last few exchanges, a
set of movement rules in the operating block, and interests of its own to move *to*.

Implemented in [`src/companion-core/conversation.ts`](../src/companion-core/conversation.ts)
(the read), [`persona.ts`](../src/companion-core/persona.ts) (the rules and interests),
and [`presets.ts`](../src/companion-core/presets.ts) (per-archetype interests). See
[decisions/computed-conversation-note.md](./decisions/computed-conversation-note.md) for
why the read is code rather than a prompt.

## The problem

A model handed the day's transcript has no sense of *momentum*. Every turn looks like a
fresh chance to raise the thing it raised last turn, so it clings: re-asking about a
topic the owner quietly let drop, ending every message with a question, reflecting the
owner's own words back with nothing added. The result reads as a mirror — and the only
way out is for the owner to say "let's move on", which is work the companion should be
doing itself.

Three things cause it, and each is addressed separately.

## 1. The read — measured, not asked

Asking a model to notice this about itself doesn't work; a small local model is the last
thing that can audit its own output. So it's measured in plain code from the messages
already in hand, each turn, in `buildConversationNote(messages)`:

| Signal | What it means | Threshold |
| --- | --- | --- |
| `clingingTopics` | Topic words present in ≥2 of the companion's last 3 messages **and** in its most recent one, but absent from the owner's last 2 | up to 2 topics named |
| `questionStreak` | Consecutive companion messages ending in `?` | ≥3 |
| `isEchoing` | Share of the last reply's topic words that came straight from the owner's preceding message | ≥60%, on replies of ≥6 topic words |

Words are lowercased, stripped to 4+ characters, run through a deliberately broad
stopword list (it includes conversational verbs like *think* and *feel* — a missed signal
is invisible, but a note telling the companion to drop "think" is nonsense it would have
to obey), loosely de-pluralized, and the companion's and owner's own names removed.

When nothing crosses a threshold — the normal case — the note is `""` and the prompt
grows by nothing at all. When something does, a short note rides along **on that turn
only**, next to the volatile context and never stored in history:

```
[how this is going — your own read, not <owner>'s words]
You keep coming back to "pottery", and <owner> hasn't picked it up. That's their answer.
Let it go — don't raise it again, don't check in on it, don't work it into something else.
Say what's on your own mind instead, or follow where <owner> actually is.
[end]
```

The operating block tells the companion what that note is (a mirror held up to it, not
something the owner said, never to be mentioned), so it acts on it instead of narrating
it.

## 2. The rules — "How the conversation moves"

A persona-agnostic section of `buildOperating()`, so it applies whatever character the
owner configured. In short:

- **Silence is an answer.** A topic the owner doesn't pick up is done — no re-raising, no
  asking again from another angle, no circling back later, no folding it into something
  else.
- **Don't end every message with a question.** One when there's something you actually
  want to know; otherwise say your piece and stop.
- **Reflecting back isn't a reply.** Add something that wasn't in the owner's message.
- **Changing the subject is allowed** — no permission, no announcing it.
- **Let quiet be quiet.** A short plain reply beats manufactured concern.

The neutral presets were adjusted to match: the wording that produced mirroring (*"reflect
enough that {owner} feels heard"*, *"ask good questions before offering answers"*) now
asks for the companion's own read, and the Coach archetype — the one whose whole job is
holding the owner to something — is told to name it once and then drop it.

## 3. Interests — something to move *to*

Telling the companion to let a topic go leaves a hole. Without material of its own it
either goes quiet or returns to the one thing it knows the owner cares about, which is
the loop again. So each companion has interests: what it's drawn to on its own, used when
a thread has run out.

Resolved by `buildInterests()`, in order:

1. The **`interests` setting**, written by the owner in Settings → Persona (or the setup
   wizard). `{{name}}` / `{{owner}}` are interpolated, as in the persona.
2. Otherwise the **preset's own interests** — but only when the preset is also supplying
   the identity. A hand-written persona defines the whole character, and bolting a stock
   archetype's tastes onto it would contradict it.
3. Otherwise nothing.

The block lands in the cached system prefix (it's semi-stable, like the persona), and is
framed so the interests are the companion's to raise unprompted and to hold real opinions
about — including ones the owner won't share.

## The nightly roll-up

The daily summary prompt used to record "open threads either of you left hanging", which
carried a dropped topic into the next day as a loose end to pick at. It now asks for
*genuinely* open threads, and states that a topic the owner simply stopped answering is
closed. See [memory.md](./memory.md).

## Tuning

The thresholds are named constants at the top of `conversation.ts`, not env vars —
they're behaviour, not deployment configuration, and a knob nobody can calibrate without
reading their own transcripts isn't worth the surface. Raise `LATELY`/`REPEATS` to make
the read more forgiving; lower `QUESTION_STREAK` to clamp down harder on interrogation.
`src/companion-core/conversation.test.ts` covers each signal with realistic exchanges.
