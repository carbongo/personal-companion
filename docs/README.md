# personal-companion — documentation

This is the project wiki: the authoritative description of *what this is* and *why*.
Pages cross-link each other and use flat, descriptive names (no number prefixes).

> Keep these in sync with the code. Every behaviour change updates the relevant page,
> [`AGENTS.md`](../AGENTS.md), and [`CHANGELOG.md`](./CHANGELOG.md). See the working
> agreement in [`AGENTS.md`](../AGENTS.md).

## Start here

- [overview](./overview.md) — what it is, who it's for, the core idea
- [architecture](./architecture.md) — layers, the engine seam, how a turn flows
- [tech-stack](./tech-stack.md) — runtime and libraries, and why each was chosen

## Reference

- [configuration](./configuration.md) — env vars, persona files, presets, providers
- [data-model](./data-model.md) — the SQLite tables and what they hold
- [channels](./channels.md) — Telegram and the built-in web chat
- [memory](./memory.md) — Core, saved memories, daily summaries, the nightly roll-up
- [web-access](./web-access.md) — the bounded `<search>`/`<fetch>` egress
- [security](./security.md) — auth, allowlists, the SSRF guard, privacy posture

## Operating

- [deployment](./deployment.md) — Docker, Compose, bare Bun
- [development](./development.md) — local setup, scripts, testing
- [importing](./importing.md) — bringing an existing history in (the interchange format)
- [roadmap](./roadmap.md) — the phased plan and current status
- [glossary](./glossary.md) — shared vocabulary

## Decisions

- [decisions/](./decisions/README.md) — Architecture Decision Records
