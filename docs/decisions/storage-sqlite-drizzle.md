# Storage: SQLite + Drizzle

Status: Accepted — 2026-06-24

## Context

A single-user companion needs durable state (conversation log, Core, memories, daily
summaries) with the smallest possible operational burden.

## Decision

Store everything in one **SQLite** file under `DATA_DIR`, accessed through **Drizzle** for
a typed schema and migrations. Bun's native SQLite driver means no external database and
no extra dependency.

## Consequences

- Zero-config storage: no server to run, back up by copying one file (plus uploads).
- Typed queries and generated migrations applied on startup.
- Maps cleanly to one Docker volume.
- Trade-off: not built for concurrent multi-user write load — a non-goal here (one owner
  per deployment).

## Alternatives considered

- **Postgres** — operationally heavier than a single-user app needs.
- **Flat files / JSON** — loses query/indexing and transactional safety the memory layer
  benefits from.
