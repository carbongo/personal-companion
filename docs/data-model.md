# Data model

All state is one **SQLite** file under `DATA_DIR`, managed with **Drizzle**. The schema
is single-user: there is exactly one companion per deployment. Tables use generic names
(no persona-specific naming).

> Status: schema lands in Phase 1. This page is the design contract; update it in the
> same change as any schema edit (see [AGENTS.md](../AGENTS.md)).

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
| media_url  | text null | `/uploads/…` path for an attachment, if any |
| created_at | integer   | timestamp, indexed |

### `core` — the living "Core" document
A singleton (`id = 1`) Markdown doc: the spine of who the companion is *with you* —
relationship state, your projects, ongoing threads, the little things. Edited by the
companion (via `<core>`) and by you in the web UI.

| column     | type    | notes |
| ---------- | ------- | ----- |
| id         | integer | pk, always 1 |
| content_md | text    | the Core doc |
| updated_at | integer | timestamp |

### `memories` — discrete saved facts
Individual facts the companion chooses to keep (via `<remember>`), or that you add.

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

### `notes` — things the companion files for you
Standalone notes the companion creates (via `<note>`), kept in its own store so the
feature works without any external app.

| column     | type    | notes |
| ---------- | ------- | ----- |
| id         | integer | pk |
| title      | text    | note title |
| content_md | text    | note body |
| created_at | integer | timestamp |

### `settings` — persisted configuration edited in the UI
Persona text and owner facts can be edited in the web UI and persisted here, overlaying
the file/env defaults. (Key/value or a small typed row — finalized in Phase 1.)

## Provenance

This schema generalizes a proven single-user companion design: a daily-bucketed log, a
singleton Core, discrete memories, and nightly summaries. The roles and shapes are
carried over; the naming is made generic and the `notes`/`settings` tables are added so
the companion is fully standalone.

## Migrating in existing data

A one-off script (`scripts/`) can import an existing companion's history into these
tables. See [development.md](./development.md). Personal data imported this way stays in
your local `*.db` — never committed (see [AGENTS.md](../AGENTS.md)).
