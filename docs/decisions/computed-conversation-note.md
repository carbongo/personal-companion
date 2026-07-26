# The conversation read is computed, not prompted

**Date:** 2026-07-26 · **Status:** accepted

## Context

The companion clung to topics. It would raise something the owner had quietly dropped,
raise it again a turn later from a different angle, and circle it for the rest of the
day — until the owner said "let's move on". Between that and a habit of ending every
message with a question and handing the owner's own words back, it read as a mirror
rather than company.

The obvious fix is to ask the model to watch for it: *"notice when you're repeating
yourself and change the subject."* That fails for the model this project targets. A
turn's transcript gives no sense of momentum — every turn looks like the first time the
topic came up — and a small quantized local model is the last thing that can reliably
audit its own last three outputs while also writing the next one. Self-assessment
instructions of that shape are also the ones models drop first when the context gets
long, which is exactly when the circling happens.

## Decision

Measure it in plain code, and hand the model the conclusion.

`src/companion-core/conversation.ts` reads the day's messages — already in hand for the
prompt — and computes three signals: topics the companion keeps raising that the owner
has stopped answering, a streak of messages ending in questions, and a reply made mostly
of the owner's own words. Each has a named threshold. When one is crossed, a short note
rides along with that turn's user message, next to the volatile context:

```
[how this is going — your own read, not <owner>'s words]
You keep coming back to "pottery", and <owner> hasn't picked it up. That's their answer.
Let it go — …
```

The note is per-turn and never persisted, so it can't harden into the history and be
mimicked. The model is not asked to detect anything; it's told what was detected, in the
imperative, alongside standing rules in the operating block about how a conversation is
expected to move, and a block of interests giving it somewhere to move to.

## Consequences

- **Reliable on a small model.** The detection is deterministic and unit-tested; the
  model's only job is to obey a sentence, which is what it's good at.
- **Free when nothing is wrong.** A healthy conversation produces `""` — no tokens, no
  cached-prefix churn.
- **Crude by construction.** Word-overlap is not topic modelling: it can miss a topic
  restated in fresh vocabulary, and it can name a word rather than the idea. The
  thresholds are set to prefer a missed signal over a false one, since a wrong note
  tells the companion to drop something the owner is actively discussing.
- **Thresholds are constants, not env vars.** They're behaviour, not deployment config,
  and nobody can calibrate them without reading their own transcripts.
- **English-shaped.** The stopword list and the plural rule assume English. Another
  language degrades to "no signal", not to wrong signals.

## Alternatives considered

- **Prompt the model to self-monitor.** Cheapest to write, and what was already
  implicitly relied on. Rejected: it is exactly what was failing.
- **A second model call to judge the exchange.** More accurate, and could name the actual
  idea rather than a word. Rejected for now: it doubles latency and cost on *every* turn
  to catch a condition that's absent most turns. Worth revisiting as an opt-in for
  deployments on a hosted model.
- **Embeddings for topic similarity.** Better recall than word overlap, but it adds a
  model dependency and a vector store to a project whose whole storage story is one
  SQLite file.
- **Only fix the persona text.** Removing the mirroring instructions from the presets
  helped and was kept — but it can't notice the third time the same question gets asked.
