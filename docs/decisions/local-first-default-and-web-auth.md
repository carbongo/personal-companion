# Local-first default, with real web-interface auth

Status: Accepted — 2026-06-24

## Context

A companion sees intimate conversation. Privacy is a first-class concern. At the same
time, this is software *anyone* deploys — it may end up exposed on a network, unlike a
single owner's Tailscale-only box.

## Decision

- **Default to local-first.** The out-of-the-box brain is a local Ollama model, so
  conversation content never leaves the machine. Using a hosted provider is an explicit,
  documented opt-in.
- **Protect the web interface with app-level auth** (`WEB_AUTH_PASSWORD`), because the
  project cannot assume a trusted-network deployment. Telegram is guarded by a user-ID
  allowlist. Recommend Tailscale / a TLS reverse proxy on top.
- **No telemetry.** State is one local SQLite file; nothing phones home.

## Consequences

- The strongest privacy story is the default; users trade it away knowingly if they pick a
  hosted model.
- One required secret per exposed surface (web password, bot token); none has a real
  default.
- A bit more setup than a network-trust-only design, justified by broad deployability.

## Alternatives considered

- **Network-trust only (no app auth)** — fine for one owner on a private tailnet, unsafe as
  a default for arbitrary deployments.
- **Hosted-first** — rejected; weaker privacy and a paid dependency by default.
