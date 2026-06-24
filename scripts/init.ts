#!/usr/bin/env bun

// First-run bootstrap for a bare (non-Docker) install. Idempotent and
// dependency-free: it creates a `.env` from the documented template if one
// isn't there yet, makes sure the data directory exists, and prints the
// next steps. It never overwrites an existing `.env` — the setup wizard
// (and you) own that file once it exists.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = `${root}.env`;
const examplePath = `${root}.env.example`;

console.log("personal-companion — setup\n");

// 1. The .env file.
if (existsSync(envPath)) {
	console.log("• .env already exists — left untouched.");
} else if (!existsSync(examplePath)) {
	console.error(
		"✗ .env.example is missing; can't create .env. Re-clone the repo?",
	);
	process.exit(1);
} else {
	copyFileSync(examplePath, envPath);
	console.log("✓ Created .env from .env.example.");
}

// 2. The data directory (SQLite DB + uploads). The server also creates this on
// first DB open, but doing it here makes a bare install feel finished.
const dataDir = process.env.DATA_DIR || "./data";
if (dataDir !== ":memory:") {
	mkdirSync(dataDir, { recursive: true });
	console.log(`✓ Data directory ready: ${dataDir}`);
}

// 3. Where to go next.
console.log(`
Next steps:

  1. (Local model) Install Ollama and pull a model:
       ollama pull gemma4:12b
     Or skip this and point .env at a hosted, OpenAI-compatible endpoint.

  2. Start the companion:
       bun run dev            # watch mode, on http://localhost:8080

  3. Open http://localhost:8080 — with nothing configured yet you land on the
     setup wizard: name your companion, pick a personality, choose a model
     (with a live connection test), and start talking.

Prefer the terminal? Run  bun run chat.
Full reference lives in docs/ (start at docs/README.md).
`);
