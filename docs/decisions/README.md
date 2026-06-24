# Decision records

Architecture Decision Records — the *why* behind choices that carry trade-offs. Filenames
are descriptive (no number prefixes); each record carries its own date and status.

Add one whenever you make a decision a future reader would otherwise have to reverse-
engineer. Keep them short: Context, Decision, Consequences, and Alternatives considered.

## Records

- [runtime-bun-typescript](./runtime-bun-typescript.md) — Bun + TypeScript, one process
- [storage-sqlite-drizzle](./storage-sqlite-drizzle.md) — SQLite + Drizzle for state
- [llm-provider-abstraction](./llm-provider-abstraction.md) — pluggable model backends
- [channel-abstraction](./channel-abstraction.md) — the `engine.respond(turn)` seam
- [persona-as-configuration](./persona-as-configuration.md) — personality is config, not code
- [local-first-default-and-web-auth](./local-first-default-and-web-auth.md) — privacy posture
- [sidecar-tags-not-tool-calling](./sidecar-tags-not-tool-calling.md) — how the model acts
- [bounded-web-access](./bounded-web-access.md) — deliberate, guarded egress
