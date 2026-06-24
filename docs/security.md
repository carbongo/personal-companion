# Security & privacy

`personal-companion` is single-user software you self-host. The posture: **your data
stays on your infrastructure, and the few ways in are locked down.**

## Privacy posture

- **Local-first default.** With `LLM_PROVIDER=ollama`, conversation content never leaves
  your machine. Choosing a hosted provider is an explicit opt-in that sends turns to that
  provider — your call. (See
  [decisions/local-first-default-and-web-auth.md](./decisions/local-first-default-and-web-auth.md).)
- **Your data is yours.** All state is one local SQLite file under `DATA_DIR`. No
  telemetry, no phone-home.
- **No personal data in the repo.** The project ships zero real-person data; your
  persona, `.env`, and database are gitignored. (See [AGENTS.md](../AGENTS.md).)

## The ways in, and how they're guarded

- **Web interface** — protected by `WEB_AUTH_PASSWORD`. Unlike a Tailscale-only setup,
  this project assumes you *might* expose the port, so set a password. For extra safety,
  put it behind Tailscale or a reverse proxy with TLS. (Web auth lands in Phase 3.)
- **Telegram** — an **allowlist** (`TELEGRAM_ALLOWED_USER_IDS`); messages from anyone not
  listed are silently ignored. The bot token is the one required secret for that channel.
- **Web access egress** — off-by-config-able, bounded, and behind an **SSRF guard** that
  blocks localhost, private/loopback/link-local ranges, and internal hostnames so a shared
  link can't reach internal services. (See [web-access.md](./web-access.md).)

## Secrets

Secrets (`TELEGRAM_BOT_TOKEN`, `LLM_API_KEY`, `TAVILY_API_KEY`, `WEB_AUTH_PASSWORD`) come
from the environment only and never have real defaults. Keep `.env` out of git (it is
gitignored).

## Reporting

Found a vulnerability? Open a private security advisory on the GitHub repo rather than a
public issue.
