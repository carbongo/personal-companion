# Deployment

One long-lived process serves the web interface and runs the Telegram channel + nightly
roll-up. State is one SQLite file under `DATA_DIR`. That makes deployment a single
container with a single volume.

> Status: the server boots today (Phase 0). The web UI and channels fill in over Phases
> 2–3; this page describes the intended deployment shape.

## Docker Compose (recommended)

```bash
git clone https://github.com/carbongo/personal-companion
cd personal-companion
cp .env.example .env        # set COMPANION_NAME, your model, secrets
docker compose up -d
```

By default the companion expects an Ollama you already run — set
`LLM_OLLAMA_URL` (e.g. `http://host.docker.internal:11434`).

**Fully-local stack:** uncomment the `ollama` service in
[`docker-compose.yml`](../docker-compose.yml) and set `LLM_OLLAMA_URL=http://ollama:11434`.
Then `ollama pull` your model into that service.

The `./data` volume holds the SQLite DB and uploads — back it up to keep your companion's
memory.

## Bare Bun

```bash
bun install
cp .env.example .env
bun run start          # or: bun run dev  (watch mode)
```

Run it under a process manager (systemd, pm2, a container) so it restarts on reboot.

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
