# Tech stack

The guiding constraint: **anyone should be able to self-host this with one command.**
That favors a small dependency surface, zero-config storage, and a single process.

| Concern        | Choice                          | Why |
| -------------- | ------------------------------- | --- |
| Runtime        | [Bun](https://bun.sh)           | Fast, batteries-included (test runner, TS, SQLite driver). One toolchain. |
| Language       | TypeScript                      | Types across the engine/channel/provider seams; ships without a build step on Bun. |
| HTTP server    | [Hono](https://hono.dev)        | Tiny, fast, runs natively on Bun; serves the JSON API and the web pages. |
| Telegram       | [grammY](https://grammy.dev)    | Mature, typed Telegram bot framework; long-polling needs no public URL. |
| Database       | SQLite (`bun:sqlite`)           | Zero-config, single file, perfect for a single-user app. |
| ORM/migrations | [Drizzle](https://orm.drizzle.team) | Typed schema + migrations without heavyweight tooling. |
| Web UI         | Vite + React + Tailwind + Motion SPA (`web/`), built to `web/dist` and served by the Bun process | A premium, adaptive, animated interface (chat + a categorised "Slate" settings menu). Falls back to lean server-rendered Hono JSX when `web/dist` isn't built. |
| Lint/format    | [Biome](https://biomejs.dev)    | One fast tool for both; no ESLint+Prettier sprawl. |
| LLM (default)  | [Ollama](https://ollama.com)    | Local-first brain, no key, no egress. |
| LLM (hosted)   | OpenAI-compatible / Anthropic   | Bring your own key for a hosted model. |
| Web search     | DuckDuckGo (keyless) / Tavily   | Works out of the box; sharper with a Tavily key. |
| Container      | `oven/bun` image + Compose      | One image runs bot + web; optional bundled Ollama service. |

## Notes

- **One process, one file.** The bot, the cron roll-up, and the web server share a
  process; all state is one SQLite file under `DATA_DIR`. This is what makes deployment a
  single container with a single volume.
- **One runtime, one optional pre-build.** The premium web UI is a Vite/React SPA in
  `web/`, built with `bun run web:build` to `web/dist` and served by the same Bun process —
  the runtime is still one process, one SQLite file. The build is a pre-step (like
  `db:generate`), and the front-end toolchain is dev-only: nothing but the static `dist`
  reaches the runtime image. If `web/dist` isn't built, the server falls back to the lean
  server-rendered pages, so `bun start` alone still works. (See
  [decisions/web-ui-premium-spa.md](./decisions/web-ui-premium-spa.md), which supersedes
  [web-ui-server-rendered-no-build.md](./decisions/web-ui-server-rendered-no-build.md).)
- **Provider/channel seams keep dependencies optional.** grammY is only needed if you use
  Telegram; a hosted-provider SDK is only needed if you choose it. The core depends on
  none of them directly.
- See the rationale records in [decisions/](./decisions/README.md) for the choices that
  carry trade-offs (runtime, storage, provider/channel abstraction, sidecar tags).
