# Decision records

Architecture Decision Records — the *why* behind choices that carry trade-offs. Filenames
are descriptive (no number prefixes); each record carries its own date and status.

Add one whenever you make a decision a future reader would otherwise have to reverse-
engineer. Keep them short: Context, Decision, Consequences, and Alternatives considered.

## Records

- [runtime-bun-typescript](./runtime-bun-typescript.md) — Bun + TypeScript, one process
- [storage-sqlite-drizzle](./storage-sqlite-drizzle.md) — SQLite + Drizzle for state
- [llm-provider-abstraction](./llm-provider-abstraction.md) — pluggable model backends
- [claude-cli-provider](./claude-cli-provider.md) — the local `claude` command as a brain
- [channel-abstraction](./channel-abstraction.md) — the `engine.respond(turn)` seam
- [persona-as-configuration](./persona-as-configuration.md) — personality is config, not code
- [computed-conversation-note](./computed-conversation-note.md) — circling is measured in code, not self-reported
- [local-first-default-and-web-auth](./local-first-default-and-web-auth.md) — privacy posture
- [web-ui-server-rendered-no-build](./web-ui-server-rendered-no-build.md) — Hono JSX, no SPA bundler
- [sidecar-tags-not-tool-calling](./sidecar-tags-not-tool-calling.md) — how the model acts
- [bounded-web-access](./bounded-web-access.md) — deliberate, guarded egress
- [web-ui-premium-spa](./web-ui-premium-spa.md) — the built SPA in `web/`, and the
  server-rendered fallback it keeps
- [local-tts-and-speaking-modes](./local-tts-and-speaking-modes.md) — Piper as the local
  engine, three independent speaking triggers, no Telegram call feature
- [discord-voice-calls](./discord-voice-calls.md) — Discord as the call transport, and the
  transport-independent call engine behind it
