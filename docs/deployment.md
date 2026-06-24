# Deployment

One long-lived process serves the web interface and runs the Telegram channel + nightly
roll-up. State is one SQLite file under `DATA_DIR`. That makes deployment a single
container with a single volume.

> Status: live through Phase 4 — the server, the Telegram channel, and the web interface
> (chat + memory admin + setup wizard) all run today, and packaging is in place (Docker
> image + Compose with an optional bundled Ollama, plus a `bun run init` bootstrap). There
> is **no front-end build step**: the web UI is served straight from the Bun process.

## Docker Compose (recommended)

```bash
git clone https://github.com/carbongo/personal-companion
cd personal-companion
cp .env.example .env        # set COMPANION_NAME, your model, secrets
docker compose up -d
```

The image carries a `/health` healthcheck and always listens on `8080` internally; the
host port comes from `PORT` in `.env` (mapped to `8080`).

By default the companion expects an Ollama you already run — set
`LLM_OLLAMA_URL` (e.g. `http://host.docker.internal:11434`).

**Bundled Ollama (fully-local stack):** bring the model up alongside the app with the
`ollama` compose profile, then pull a model into it:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull gemma4:12b
```

Set `LLM_OLLAMA_URL=http://ollama:11434` in `.env` so the app reaches that service.

The `./data` volume holds the SQLite DB and uploads — back it up to keep your companion's
memory. The named `ollama` volume (with the profile) keeps pulled models.

**First run:** open `http://<host>:<PORT>` in a browser; with nothing configured yet it
lands on the **setup wizard**, which tests your model and writes a `.env`. Set
`WEB_AUTH_PASSWORD` if the port is reachable by anyone but you (see
[security.md](./security.md)).

## Bare Bun

```bash
bun install
bun run init           # scaffolds .env from the template + the data dir
bun run start          # or: bun run dev  (watch mode)
```

`bun run init` is idempotent — it won't overwrite an existing `.env`. Run it under a
process manager (systemd, pm2, a container) so it restarts on reboot.

## Choosing where it runs

Because the Telegram bot uses **long-polling**, it needs no public URL and runs from
anywhere — a home server, a VPS, a spare box. Two things to weigh:

- **Always-on?** The companion only answers while the process is up. For 24/7 reach, run
  it on a machine that stays awake.
- **Where's the model?** Local-first is simplest when the model runs on the *same* host
  (`LLM_OLLAMA_URL=http://localhost:11434`) — one endpoint, no network hop. If the model
  lives on a different machine, point `LLM_OLLAMA_URL` at it (and keep that link private,
  e.g. over a VPN/Tailscale).

## Updating

```bash
git pull
docker compose up -d --build   # or re-run bun start for a bare install
```

Migrations run on startup; your `DATA_DIR` is untouched. See
[development.md](./development.md) for migration details.
