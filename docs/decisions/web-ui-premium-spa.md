# Web UI: a built single-page app (Vite + React + Tailwind + Motion)

Status: Accepted — 2026-06-25 (supersedes
[web-ui-server-rendered-no-build.md](./web-ui-server-rendered-no-build.md))

## Context

The server-rendered, no-build web UI was the right call for a lean first cut: it kept the
"one command, one process, no bundler" promise while the UI was a handful of functional
screens. The owner now wants the web experience to be a centerpiece — a premium, highly
adaptive, game-like interface (the **Nocturne** design system: a dark slate surface, cyan
and amber "energy", runic detailing, ancient-technological) with real motion, sound, and a
categorised "Slate" settings menu in the spirit of polished game UIs.

That ceiling is not reachable in hand-rolled CSS strings and three dependency-free scripts
without it becoming a worse version of a framework. The owner explicitly chose to add a
build step and supersede the previous decision.

## Decision

Build the web client as a **static single-page app** under `web/`, served by the same Bun
process:

- **Stack:** Vite + React 19 + Tailwind CSS v4 + [Motion](https://motion.dev) for
  animation. Fonts are self-hosted via `@fontsource` (no runtime CDN — local-first holds).
  No state library, no component kit; the design system is one stylesheet of tokens plus a
  small set of components.
- **Seam unchanged.** The SPA talks to the **existing** JSON API (`src/server/web/api.ts`).
  No server logic moved into the client; the API gained only `auth.enabled` on `/api/state`.
- **Serving.** `web/` builds to `web/dist`. The server serves that SPA when it exists
  (`src/server/web/index.tsx`), with content-hashed assets cached `immutable`. The auth gate
  is unchanged; built assets live under the already-open `/assets/*` path, data stays gated.
- **Graceful fallback.** When `web/dist` is **absent** (a bare `bun start` with no web
  build), the server falls back to the original server-rendered pages. The app still runs
  with zero front-end build — the premium UI is an enhancement, not a hard requirement.
- **Build.** `bun run web:build` (root) builds the client. The Dockerfile builds it in a
  separate stage and copies only `web/dist` into the runtime image, so the front-end
  toolchain never reaches runtime.

## Consequences

- There is now a front-end build for the premium UI. The single-process **runtime** is
  unchanged (one Bun process serves bot + API + static SPA); the build is a pre-step, like
  `db:generate`.
- Two dependency trees: the server's (tiny, unchanged) and `web/`'s (dev-only; nothing
  ships to runtime but the static `dist`).
- The login page stays server-rendered (it must work before the SPA's gated assets load)
  and was re-themed to match.

## Alternatives considered

- **Keep no-build, push vanilla hard** — reachable for ~90% of the look, but the most
  involved interactions (animated routing, the settings menu, sound) become a bespoke
  mini-framework. Rejected: more work for a lower ceiling.
- **Bundle without a framework (esbuild + GSAP)** — a middle ground, but React + Tailwind
  buys component reuse and a maintainable design system for the same build cost.
