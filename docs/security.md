# Security & privacy

`personal-companion` is single-user software you self-host. The posture: **your data
stays on your infrastructure, and the few ways in are locked down.**

## Privacy posture

- **Local-first default.** With `LLM_PROVIDER=ollama`, conversation content never leaves
  your machine. Choosing a hosted provider is an explicit opt-in that sends turns to that
  provider — your call. (See
  [decisions/local-first-default-and-web-auth.md](./decisions/local-first-default-and-web-auth.md).)
- **`claude-cli` runs a local process, not a local model.** It spawns the `claude` binary on
  the host, so turns still go to Anthropic — treat it as a hosted provider for privacy
  purposes. The spawned CLI is stripped of every capability it doesn't need (`--tools ""`,
  `--strict-mcp-config`, `--setting-sources ""`, `--no-session-persistence`), so it cannot
  read files, run commands, load the host's hooks or MCP servers, or leave sessions on disk.
- **Discord voice calls are a deliberate, scoped exception.** Enabling the Discord channel
  means call audio transits Discord's own voice servers to reach the bot — the one place in
  this project that isn't local-first by default. It is opt-in (`CALL_ENABLED` plus a bot
  token), scoped to audio only, and the call engine stays transport-independent so a
  self-hosted alternative (e.g. SIP) remains open later without a rewrite. See
  [decisions/discord-voice-calls.md](./decisions/discord-voice-calls.md).
- **Your data is yours.** All state is one local SQLite file under `DATA_DIR`. No
  telemetry, no phone-home.
- **No personal data in the repo.** The project ships zero real-person data; your
  persona, `.env`, and database are gitignored. (See [AGENTS.md](../AGENTS.md).)

## The ways in, and how they're guarded

- **Web interface** — protected by `WEB_AUTH_PASSWORD`. When set, every page and API route
  sits behind a login; a correct password issues an `httpOnly`, `SameSite=Lax` session
  cookie whose value is an HMAC derived from the password (the password itself never travels
  in the cookie, and rotating it invalidates old sessions). The password is checked in
  constant time. When the password is **empty there is no app-level auth** — appropriate
  only on a trusted network, since the project assumes you *might* expose the port. For
  extra safety, put it behind Tailscale or a reverse proxy with TLS. `/health` and the
  static assets stay open so health checks and the login page work.
- **Telegram** — an **allowlist** (`TELEGRAM_ALLOWED_USER_IDS`); messages from anyone not
  listed are silently ignored. The bot token is the one required secret for that channel.
- **Discord voice calls** — gated on `DISCORD_OWNER_USER_ID` at two points: joining a call
  (on the owner entering the voice channel, or `/call`) and, separately, **which audio the
  bot ever decodes**. Discord delivers a per-user Opus stream per participant, and
  `channels/discord/transport.ts` subscribes to the owner's user ID alone — a bystander in
  the same voice channel is never heard, by construction, not by a model judging whose
  voice it is. See [channels.md](./channels.md#discord-optional-voice-only-calling) and
  [decisions/discord-voice-calls.md](./decisions/discord-voice-calls.md).
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
