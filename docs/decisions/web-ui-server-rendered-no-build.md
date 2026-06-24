# Web UI: server-rendered Hono JSX, no build step

Status: Accepted — 2026-06-24 (supersedes the earlier "React + Vite + Tailwind + shadcn/ui
SPA" note in [tech-stack.md](../tech-stack.md))

## Context

Phase 3 adds a web interface: a built-in browser chat, a memory admin, and a first-run
setup wizard. An early tech-stack sketch named a React + Vite + Tailwind + shadcn/ui SPA.
That conflicts with the project's load-bearing constraints: **one command to self-host, a
small dependency surface, a single process, and "ships without a build step on Bun"** — a
full SPA toolchain adds a separate build stage, a large `node_modules`, and a multi-stage
Dockerfile, for a single-user app with a handful of screens.

## Decision

Render the web UI **on the server with Hono's JSX**, with no front-end bundler:

- Pages are Hono JSX components served by the same Bun process (`src/server/web/pages.tsx`).
- Interactivity is three small, dependency-free scripts and one stylesheet, served as
  routes from string constants (`src/server/web/assets.ts`) — no compile, no bundle.
- The JSON API (`src/server/web/api.ts`) is the seam the scripts talk to; it is also useful
  on its own.
- `tsconfig.json` sets `jsx: "react-jsx"` + `jsxImportSource: "hono/jsx"`; that is the only
  toolchain change. No new runtime dependency (Hono was already present).

## Consequences

- `bun start` (or one container, one stage) serves the bot **and** the full web UI. No
  `vite build`, no front-end install step, nothing to keep in sync between two toolchains.
- The UI is intentionally lean and functional rather than richly componentized. If a screen
  ever needs heavier client state, the JSON API already exists and a scoped island could be
  added without changing the server model.
- Styling is hand-rolled CSS (one file) rather than a utility framework — fine at this size.

## Alternatives considered

- **React + Vite + Tailwind + shadcn/ui SPA** — most polished and familiar, but it imports a
  build pipeline and a large dependency tree into an otherwise build-free, single-process
  app. Rejected for conflicting with the one-command, small-surface goal.
- **Preact + Bun's built-in bundler** — a lighter middle ground (real components, one
  toolchain, `bun build` only). Reasonable, but still a build step and a dependency for a UI
  this small. Kept in reserve if the UI grows.
