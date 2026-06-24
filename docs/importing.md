# Importing existing data

Already have a companion somewhere — an older bot, a pile of chat logs, notes you've kept
elsewhere — and want to bring its history in? `bun run import` loads an existing single-user
history into this project's [data model](./data-model.md): the conversation log, the Core
doc, saved memories, daily summaries, and notes.

> Status: implemented (Phase 5). The importer is `scripts/import.ts`.

## The idea: a neutral interchange format

The importer is deliberately **decoupled from any source system.** It does not read another
app's database; it reads a small, documented set of files that *you* produce. So adopting
the project is two steps:

1. **Export** your old data into the interchange files below (a short, throwaway adapter
   script in whatever language your old system speaks).
2. **Import** those files with `bun run import`.

This keeps the project generic — it ships only the importer and this spec, never anyone's
source schema — and it means your personal data never has to pass through code that gets
committed here. (See the golden rule in [AGENTS.md](../AGENTS.md).)

## The interchange directory

Put any subset of these files in a directory (default `./import`, which is **gitignored**):

```
import/
  core.md                # the Core doc — plain Markdown/text
  messages.jsonl         # one JSON object per line (see below)
  memories.json          # a JSON array
  daily-summaries.json   # a JSON array
  notes.json             # a JSON array
```

Missing files are simply skipped. Field details:

### `messages.jsonl`

One JSON object **per line** (JSON Lines), oldest first:

```json
{"role":"user","content":"hey","createdAt":"2024-02-01T10:00:00.000Z"}
{"role":"assistant","content":"hi there","createdAt":"2024-02-01T10:00:05.000Z"}
```

| field       | required | notes |
| ----------- | -------- | ----- |
| `role`      | yes      | `"user"` or `"assistant"` |
| `content`   | yes      | the message text |
| `createdAt` | recommended | ISO-8601 string or epoch-millis; preserved on the row |
| `day`       | optional | `YYYY-MM-DD` bucket; derived from `createdAt` (in your `TZ`) when omitted |
| `kind`      | optional | `text` (default), `voice`, or `photo` |
| `mediaUrl`  | optional | a `/uploads/…`-style path, if any |

Each message needs a `day` **or** a `createdAt` so it can be bucketed. Supplying
`createdAt` is best: it preserves both the day and the original ordering.

### `memories.json`

```json
[{ "content": "prefers tea over coffee", "tags": "preferences", "createdAt": "2024-02-01T10:00:00.000Z" }]
```

`content` is required; `tags` (comma-separated) and `createdAt` are optional.

### `daily-summaries.json`

```json
[{ "day": "2024-01-31", "summary": "A calm settling-in day.", "createdAt": "..." }]
```

`day` (`YYYY-MM-DD`) and `summary` are required; `createdAt` optional. Summaries upsert by
`day`, so re-importing the same day overwrites rather than duplicates.

### `notes.json`

```json
[{ "title": "Reading list", "content": "- a book\n- another", "createdAt": "..." }]
```

`title` is required; `content` and `createdAt` are optional.

### `core.md`

The whole file becomes the Core document verbatim.

## Running it

```bash
bun run import [dir] [--dry-run] [--force] [--strict]
```

- **`dir`** — the interchange directory (default `./import`).
- **`--dry-run`** — parse and validate everything, print a plan, **write nothing**. Always
  start here.
- **`--strict`** — abort if *any* record fails validation. Without it, bad records are
  reported and skipped.
- **`--force`** — import even if the target database already holds history.

A typical adoption:

```bash
bun run init                 # ensure .env + the data dir exist
# ...produce ./import/* from your old system...
bun run import --dry-run      # check the counts and any validation errors
bun run import                # write into the DB under DATA_DIR
```

The importer writes into the same SQLite file the app uses (under `DATA_DIR`), inside a
single transaction — if anything fails, nothing is written.

## Safety: it won't duplicate your history

`messages`, `memories`, and `notes` have no natural key, so a second run would otherwise
double them. The importer **refuses** to write to those tables if they already contain
rows, unless you pass `--force`. The safest pattern is to import **once into a fresh
`DATA_DIR`**. Daily summaries (keyed by day) and the Core doc are exceptions: summaries
upsert, and the Core is only overwritten with `--force`.

## Your data stays yours

The files under `./import` and the resulting `*.db` are **gitignored** and never committed.
The public project carries only the generic importer and this format spec. Bringing your
own history in is a local, private operation — see [security.md](./security.md) and
[AGENTS.md](../AGENTS.md).
