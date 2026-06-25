import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The client is a static SPA built to web/dist and served by the Hono server
// (see src/server/web/index.tsx). Built JS/CSS land under /assets/* — a path the
// auth middleware leaves open — so the shell loads before login, while every
// /api/* call stays gated. In `dev`, proxy the live engine on :8080 so the UI
// can be developed against a real running companion.
const TARGET = process.env.COMPANION_ORIGIN ?? "http://localhost:8080";
const proxy = Object.fromEntries(
  ["/api", "/uploads", "/login", "/logout", "/health"].map((p) => [
    p,
    { target: TARGET, changeOrigin: true },
  ]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Keep chunking simple and predictable for the no-CDN, local-first host.
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
