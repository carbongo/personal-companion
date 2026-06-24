# Development

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- (Optional) [Ollama](https://ollama.com) with a model pulled, for a local brain
- (Optional) Docker, to build/run the container

## Setup

```bash
bun install
cp .env.example .env
bun run dev        # watch mode; boots the server on $PORT (default 8080)
```

Check it's alive:

```bash
curl localhost:8080/health    # {"status":"ok",...}
```

## Scripts

| Command             | What it does |
| ------------------- | ------------ |
| `bun run dev`       | Server in watch mode. |
| `bun run start`     | Server, once. |
| `bun run check`     | Biome lint + format check. |
| `bun run format`    | Biome format, write. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun test`          | Run tests. |

CI (`.github/workflows/ci.yml`) runs `check`, `typecheck`, `bun test`, and a Docker build
on every push and PR.

## Conventions

- **Imports:** `#/` aliases `src/` (e.g. `import { config } from "#/config/index.ts"`).
- **Env:** read only in `src/config/`; the rest of the code takes the typed `config`.
- **Style:** tabs, double quotes, Biome-enforced. Comments explain *why*.
- **Tests:** colocated `*.test.ts`, run with `bun test`.

## Database & migrations

Schema lives in `src/db/` (Drizzle). Migrations are generated from the schema and applied
on startup against the SQLite file in `DATA_DIR`. (Lands in Phase 1 — see
[data-model.md](./data-model.md).)

## Importing existing companion data

A one-off importer under `scripts/` can copy an existing single-user companion's history
(daily messages, Core, memories, summaries) into this schema. Imported personal data
stays in your local `*.db` and is never committed (see [AGENTS.md](../AGENTS.md)).

## The docs contract

Update [`docs/`](./README.md), [`AGENTS.md`](../AGENTS.md), and
[`CHANGELOG.md`](./CHANGELOG.md) in the **same change** as any behaviour change. A change
that leaves docs stale is incomplete. New design decision? Add an ADR under
[`decisions/`](./decisions/README.md).
