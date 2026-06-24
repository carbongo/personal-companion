# Persona as configuration, not code

Status: Accepted — 2026-06-24

## Context

The project's whole reason to exist is that *anyone* can have a companion shaped to their
liking. A hardcoded character would defeat that — and would risk baking one real person's
identity into the source.

## Decision

Personality is **configuration**. The persona (identity, relationship, tone, interests,
language, hard style rules) and owner facts come from a persona file / the `settings`
table and are assembled into the system prompt at runtime. The repo ships only **neutral,
original presets** (Sage, Pip, Coach, Companion) as starting points. A setup wizard writes
a persona for non-technical users.

This is enforced as a project rule: **no real-person data in source, tests, docs, or
history** (see [AGENTS.md](../../AGENTS.md)).

## Consequences

- Users own their companion's identity; the engine stays generic and shareable.
- Private personas and data live outside the repo (gitignored `persona/`, `.env`, `*.db`).
- Presets must be written to be archetypes, not recognizable characters.

## Alternatives considered

- **A default built-in character** — rejected; it would push one identity on everyone and
  invite committing personal data.
- **Persona only in env vars** — rejected; too cramped for multi-paragraph personality.
  A file (and UI editor) fits better, with env for the short fields.
