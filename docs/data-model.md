# Data model

All state is one **SQLite** file under `DATA_DIR`, managed with **Drizzle**. The schema
is single-user: there is exactly one companion per deployment. Tables use generic names
(no persona-specific naming).

> Status: implemented (Phase 1). Schema lives in `src/db/schema.ts`; migrations are
> generated into `drizzle/` (`bun run db:generate`) and applied on first open. Update
> this page in the same change as any schema edit (see [AGENTS.md](../AGENTS.md)).

## Tables

### `messages` — the live conversation log
Rolling log of the conversation, bucketed by local day (`day` = `YYYY-MM-DD` in `TZ`).
The current day is the live working memory; past days live on only as their summary.

| column     | type      | notes |
| ---------- | --------- | ----- |
| id         | integer   | pk |
| day        | text      | local-day bucket, indexed |
| role       | text      | `user` \| `assistant` |
| kind       | text      | `text` \| `voice` \| `photo` |
| content    | text      | what gets persisted and shown back as context |
| media_url  | text null | one or more `/uploads/…` attachment paths (newline-separated) saved for the turn — web chat images and Telegram photos; served back by the auth-gated `/uploads/` route and redisplayed in the chat history |
| created_at | integer   | timestamp, indexed |

### `core` — the living "Core" document
A singleton (`id = 1`) Markdown doc: the spine of who the companion is *with you* —
relationship state, your projects, ongoing threads, the little things. Edited by you in the
web UI.

| column     | type    | notes |
| ---------- | ------- | ----- |
| id         | integer | pk, always 1 |
| content_md | text    | the Core doc |
| updated_at | integer | timestamp |

### `memories` — discrete saved facts
Individual durable facts: saved by the nightly roll-up as it reconciles memory against each
day (and dropped by it when a day makes one wrong), or added/removed by you in the web UI.

| column     | type      | notes |
| ---------- | --------- | ----- |
| id         | integer   | pk |
| content    | text      | the fact |
| tags       | text null | optional comma tags |
| created_at | integer   | timestamp, indexed |

### `daily_summaries` — one compressed day each
The nightly roll-up compresses each past day's `messages` into one summary the companion
reads on later days.

| column     | type    | notes |
| ---------- | ------- | ----- |
| day        | text    | pk, `YYYY-MM-DD` |
| summary_md | text    | the day's conclusion, in the companion's voice |
| created_at | integer | timestamp |

### `settings` — persisted configuration edited in the UI
A simple key/value store. Keys in use today: `persona` (a persona override saved from the
web UI, overlaying the file/preset and read every turn) and `setup_complete` (`"1"` once
the setup wizard has been saved, which is what flips the root path from the wizard to the
chat). Owner facts from the wizard seed the `core` doc rather than living here. Columns:
`key` (pk), `value`, `updated_at`.

## Provenance

This schema generalizes a proven single-user companion design: a daily-bucketed log, a
singleton Core, discrete memories, and nightly summaries. The roles and shapes are
carried over; the naming is made generic and the `settings` table is added so the
companion is fully standalone.

## Migrating in existing data

`bun run import` (`scripts/import.ts`) loads an existing companion's history into these
tables from a neutral, documented interchange format — see [importing.md](./importing.md).
Personal data imported this way stays in your local `*.db` — never committed (see
[AGENTS.md](../AGENTS.md)).
