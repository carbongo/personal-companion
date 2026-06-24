# personal-companion — single-process image (bot + web interface).
# Local-first by default: point LLM_OLLAMA_URL at an Ollama instance
# (see docker-compose.yml for a bundled-Ollama stack).
FROM oven/bun:1.3-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# App source.
COPY . .

# Data (SQLite + uploads) lives on a volume.
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV PORT=8080
EXPOSE 8080

# Liveness: the web server answers /health once it's up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:8080/health').catch(() => null); process.exit(r?.ok ? 0 : 1)"

CMD ["bun", "src/server/index.ts"]
