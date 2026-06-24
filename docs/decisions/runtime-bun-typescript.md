# Runtime: Bun + TypeScript, one process

Status: Accepted — 2026-06-24

## Context

The project must be easy for anyone to self-host, while staying a comfortable codebase to
extend. It bundles a bot, a web server, a database, and a nightly job.

## Decision

Use **Bun** with **TypeScript**, running the whole app as **one long-lived process**. Bun
provides the runtime, a test runner, native SQLite, and TS execution without a separate
build step. The Telegram channel, the web interface, and the in-process cron roll-up all
share the process and one SQLite file.

## Consequences

- Deployment is a single container with a single volume — low friction for self-hosters.
- One toolchain (Bun + Biome) instead of several; CI is `check` + `typecheck` + `test` +
  Docker build.
- Types hold the engine/channel/provider seams together.
- Trade-off: a single process means the bot is up only when the process is up. Acceptable
  for single-user software; documented in [deployment.md](../deployment.md).

## Alternatives considered

- **Node + tsc build** — more setup, slower iteration, no built-in test/SQLite.
- **Separate services** (bot, web, worker) — more moving parts than a single-user app
  warrants.
