# Tech stack

The guiding constraint: **anyone should be able to self-host this with one command.**
That favors a small dependency surface, zero-config storage, and a single process.

| Concern        | Choice                          | Why |
| -------------- | ------------------------------- | --- |
| Runtime        | [Bun](https://bun.sh)           | Fast, batteries-included (test runner, TS, SQLite driver). One toolchain. |
| Language       | TypeScript                      | Types across the engine/channel/provider seams; ships without a build step on Bun. |
| HTTP server    | [Hono](https://hono.dev)        | Tiny, fast, runs natively on Bun; serves the API and the web SPA. |
| Telegram       | [grammY](https://grammy.dev)    | Mature, typed Telegram bot framework; long-polling needs no public URL. |
| Database       | SQLite (`bun:sqlite`)           | Zero-config, single file, perfect for a single-user app. |
| ORM/migrations | [Drizzle](https://orm.drizzle.team) | Typed schema + migrations without heavyweight tooling. |
| Web UI         | React + Vite + Tailwind + shadcn/ui | Familiar, self-contained SPA for setup, chat, and memory admin. |
| Lint/format    | [Biome](https://biomejs.dev)    | One fast tool for both; no ESLint+Prettier sprawl. |
| LLM (default)  | [Ollama](https://ollama.com)    | Local-first brain, no key, no egress. |
| LLM (hosted)   | OpenAI-compatible / Anthropic   | Bring your own key for a hosted model. |
| Web search     | DuckDuckGo (keyless) / Tavily   | Works out of the box; sharper with a Tavily key. |
| Container      | `oven/bun` image + Compose      | One image runs bot + web; optional bundled Ollama service. |

## Notes

- **One process, one file.** The bot, the cron roll-up, and the web server share a
  process; all state is one SQLite file under `DATA_DIR`. This is what makes deployment a
  single container with a single volume.
- **Provider/channel seams keep dependencies optional.** grammY is only needed if you use
  Telegram; a hosted-provider SDK is only needed if you choose it. The core depends on
  none of them directly.
- See the rationale records in [decisions/](./decisions/README.md) for the choices that
  carry trade-offs (runtime, storage, provider/channel abstraction, sidecar tags).
