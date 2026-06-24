# Changelog

Newest first. Every major action (feature, schema, dependency, env var, decision, or
ops change) gets an entry here — see the working agreement in [AGENTS.md](../AGENTS.md).

## 2026-06-24

- **Phase 0 — project scaffold.** New repository `personal-companion`: MIT license,
  Bun + TypeScript toolchain (Biome, tsc, `bun test`), a bootable Hono server with
  `/health`, typed config loader (`src/config/`), Dockerfile + Compose, GitHub Actions CI
  (check / typecheck / test / docker build), a complete `.env.example` configuration
  reference, the full docs wiki, and `AGENTS.md`.
- **Project established.** Extracted as a generic, self-hostable AI companion from a
  proven single-user companion design. No persona-specific code or data — personality is
  configuration. Seeded the founding decision records under `decisions/`.
