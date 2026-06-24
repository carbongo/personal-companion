# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

`personal-companion` is a **self-hostable, single-user AI companion**: a configurable
persona with persistent memory that you talk to over Telegram and a built-in web chat,
backed by a local or hosted LLM. One deployment serves one person. See [`docs/`](./docs/)
for the full design.

---

## 0. Read this first

The authoritative description of this project lives in the [`docs/`](./docs/) wiki, **not**
in code comments or chat history. Before changing anything non-trivial:

1. Read the relevant page in `docs/` (start at [`docs/README.md`](./docs/README.md)).
2. Make your change.
3. **Update the docs in the same change.** Docs and code are expected to stay in sync.
   If you add a table, document it in [`docs/data-model.md`](./docs/data-model.md);
   if you make a design decision, add an ADR under
   [`docs/decisions/`](./docs/decisions/).

A change that alters behaviour but leaves the docs stale is considered incomplete.

> **Working agreement (non-negotiable): update `docs/` AND this `AGENTS.md` on _every_
> major action — for current work and all future changes.** A "major action" is anything
> a reader of the wiki would want to know: a new or changed feature, a schema change, a
> dependency/stack change, a new env var, a design decision, or a deploy/ops change. For
> every such action, also append an entry to [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)
> (newest first). Docs are part of the deliverable, not an afterthought.

---

## 1. The golden rule: this project is generic

`personal-companion` ships **no real person's identity or data — ever.** It is the engine;
a user's companion is the engine *plus their private configuration*.

- **No real names, personas, memories, locations, chat IDs, tokens, or owner facts** in
  source, tests, fixtures, docs, or commit history. Use neutral placeholders
  (`Companion`, `friend`, `Sage`, `127.0.0.1`).
- **Personality is configuration, not code.** Persona text comes from a user's persona
  file / the database (see [`docs/configuration.md`](./docs/configuration.md)), never
  hardcoded.
- **Shipped presets stay neutral and original** — generic archetypes (calm mentor,
  upbeat friend, blunt coach, neutral default), not a specific character.
- A user's filled-in `.env`, their `persona/`, their `*.db`, and their `import/` staging
  directory are **gitignored** and must stay that way.

If you are tempted to hardcode anything personal, make it a config field instead.

---

## 2. The `docs/` wiki — structure

Everything about *what this is* and *why* is documented here, wiki-fashion, with the
pages cross-linking each other. Pages use **flat, descriptive names — no number
prefixes.**

```
docs/
  README.md          wiki home / index
  overview.md        what it is, who it's for, the core idea
  architecture.md    layers, the engine seam, request/turn flow
  tech-stack.md      runtime, libraries, and why
  data-model.md      SQLite tables and their roles
  configuration.md   env vars, persona files, presets, providers
  channels.md        Telegram + the built-in web chat
  memory.md          Core, memories, daily summaries, roll-up
  web-access.md      bounded <search>/<fetch> egress
  security.md        auth, allowlists, SSRF guard, privacy posture
  deployment.md      Docker / Compose / bare Bun
  development.md      local dev, scripts, testing
  importing.md        bringing an existing history in (interchange format)
  roadmap.md         phased plan and status
  glossary.md        shared vocabulary
  CHANGELOG.md       newest-first log of every major change
  decisions/         Architecture Decision Records (descriptive filenames)
```

---

## 3. Conventions

- **Runtime:** Bun + TypeScript. **Lint/format:** Biome (`bun run check`). **Types:**
  `bun run typecheck`. **Tests:** `bun test`. CI runs all four plus a Docker build.
- **Imports:** use the `#/` alias for `src/` (e.g. `import { config } from "#/config/index.ts"`).
- **Env access** goes through `src/config/` only; the rest of the code takes a typed
  `config` object.
- **The engine is the seam.** Channels build a `Turn` and call
  `companion-core/engine.respond` — keep channel- and provider-specific code out of the
  core (see [`docs/architecture.md`](./docs/architecture.md)). The built-in web chat is a
  channel like any other: it calls `respond` too.
- **The web UI has no build step.** It lives in `src/server/web/`, rendered server-side
  with Hono JSX (files with JSX use `.tsx`; `tsconfig.json` sets `jsxImportSource`). The
  one stylesheet and the page scripts are strings in `assets.ts` served as routes — do
  **not** add Vite/Tailwind/a bundler or a front-end `node_modules` (see
  [`docs/decisions/web-ui-server-rendered-no-build.md`](./docs/decisions/web-ui-server-rendered-no-build.md)).
- **DB changes:** edit `src/db/schema.ts`, then `bun run db:generate` and commit the new
  migration in `drizzle/`. Update [`docs/data-model.md`](./docs/data-model.md).
- **Packaging:** `bun run init` (`scripts/init.ts`) is the bare-install bootstrap — keep it
  idempotent and never have it overwrite a user's `.env`. Deployment is one Docker image +
  `docker-compose.yml`; the bundled Ollama stays behind the `ollama` compose profile so the
  default `up` is the app alone (see [`docs/deployment.md`](./docs/deployment.md)).
- **Adoption/import:** `bun run import` (`scripts/import.ts`) reads a neutral, documented
  interchange format (`docs/importing.md`) — never another system's schema. Keep it that
  way: imported data is the user's, lands only in their gitignored `*.db`, and the importer
  must keep refusing to duplicate existing history without `--force`.
- **Comments** explain *why*, in the calm register the rest of the file uses. Match the
  surrounding style.
- **Secrets** never get a real default. Optional features degrade gracefully when unset.

---

## 4. Before you finish

- `bun run check && bun run typecheck && bun test` pass.
- Docs touched for any behaviour change; `docs/CHANGELOG.md` has a new entry.
- No personal data introduced (see §1).
