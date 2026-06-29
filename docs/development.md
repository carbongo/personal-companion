# Development

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- (Optional) [Ollama](https://ollama.com) with a model pulled, for a local brain
- (Optional) Docker, to build/run the container

## Setup

```bash
bun install
bun run init       # scaffolds .env from the template + the data dir (idempotent)
bun run web:build  # builds the premium SPA → web/dist (the server serves it)
bun run dev        # watch mode; boots the server on $PORT (default 8080)
```

Check it's alive:

```bash
curl localhost:8080/health    # {"status":"ok",...}
```

Then open `http://localhost:8080` for the web interface (chat + the categorised "Slate"
settings menu).

### Working on the web client

The premium UI is a Vite + React + Tailwind + Motion SPA in **`web/`** (the Nocturne design
system — see [decisions/web-ui-premium-spa.md](./decisions/web-ui-premium-spa.md)). It's a
self-contained sub-package with its own deps:

```bash
bun run web:dev    # Vite dev server on :5173, proxying /api → the running server on :8080
```

`web:dev` gives instant HMR while talking to a real engine; point it elsewhere with
`COMPANION_ORIGIN=http://host:port`. For production, `bun run web:build` writes `web/dist`,
which the Bun server serves (content-hashed assets, `immutable`). The server is **non-watch**
for the built SPA, so after a `web:build` restart the server. If `web/dist` is missing the
server falls back to the original server-rendered pages in `src/server/web/` (the **login**
page is always server-rendered).

## Scripts

| Command             | What it does |
| ------------------- | ------------ |
| `bun run init`      | First-run bootstrap for a bare install: `.env` + data dir. |
| `bun run import`    | Import an existing history (see [importing.md](./importing.md)). |
| `bun run dev`       | Server in watch mode. |
| `bun run start`     | Server, once. |
| `bun run web:build` | Build the premium SPA (`web/`) → `web/dist`. |
| `bun run web:dev`   | Vite dev server for the SPA (:5173), proxying the API. |
| `bun run chat`      | Terminal REPL to talk to the engine (needs a model). |
| `bun run db:generate` | Regenerate Drizzle migrations after a schema change. |
| `bun run check`     | Biome lint + format check. |
| `bun run format`    | Biome format, write. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun test`          | Run tests (in-memory DB via `bunfig.toml` preload). |

CI (`.github/workflows/ci.yml`) runs `check`, `typecheck`, `bun test`, and a Docker build
on every push and PR.

## Conventions

- **Imports:** `#/` aliases `src/` (e.g. `import { config } from "#/config/index.ts"`).
- **Env:** read only in `src/config/`; the rest of the code takes the typed `config`.
- **Style:** tabs, double quotes, Biome-enforced. Comments explain *why*.
- **Tests:** colocated `*.test.ts`, run with `bun test`.

## Database & migrations

Schema lives in `src/db/schema.ts` (Drizzle). After changing it, run `bun run db:generate`
to write a new migration into `drizzle/`, and commit it. Migrations are applied on first DB
open (including on startup), against the SQLite file in `DATA_DIR`. Tests use an in-memory
DB. See [data-model.md](./data-model.md).

## Importing existing companion data

`bun run import` (`scripts/import.ts`) copies an existing single-user history (messages,
Core, memories, daily summaries, notes) into this schema from a neutral, documented
interchange format — start at [importing.md](./importing.md). Imported personal data stays
in your local `*.db` and is never committed (see [AGENTS.md](../AGENTS.md)).

## The docs contract

Update [`docs/`](./README.md), [`AGENTS.md`](../AGENTS.md), and
[`CHANGELOG.md`](./CHANGELOG.md) in the **same change** as any behaviour change. A change
that leaves docs stale is incomplete. New design decision? Add an ADR under
[`decisions/`](./decisions/README.md).
