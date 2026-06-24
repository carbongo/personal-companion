# Contributing

Thanks for your interest. A few things keep this project coherent.

## Before you start

Read [AGENTS.md](./AGENTS.md) and the [docs wiki](./docs/README.md). The most important
rules:

1. **No real-person data, ever.** No names, personas, memories, locations, tokens, or
   owner facts in source, tests, docs, or commits. Personality is configuration; shipped
   presets stay neutral and original. (See the golden rule in [AGENTS.md](./AGENTS.md).)
2. **Docs are part of the change.** Update the relevant `docs/` page, `AGENTS.md` if
   conventions change, and add a `docs/CHANGELOG.md` entry. New design decision → an ADR
   under `docs/decisions/`.

## Workflow

```bash
bun install
bun run dev
```

Before opening a PR:

```bash
bun run check        # Biome lint + format
bun run typecheck
bun test
```

CI runs the same plus a Docker build. Keep PRs focused; describe the *why*.

## Style

Bun + TypeScript, tabs, double quotes (Biome-enforced). Imports use the `#/` alias for
`src/`. Comments explain *why*, in the surrounding register.

## Reporting security issues

Open a private GitHub security advisory rather than a public issue. See
[docs/security.md](./docs/security.md).
