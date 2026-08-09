import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Go relay (apps/relay) listens here in local dev via docker compose.
const RELAY_PROXY_TARGET =
  process.env.VITE_RELAY_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // Pre-bundle heavy ESM deps so the dev server doesn't re-transform them on
  // every cold start. Has no effect on production builds.
  optimizeDeps: {
    include: ["tone", "pixi.js", "pixi-filters"],
  },

  // Dev-only: forward the relay's /ws and /api routes to the Go backend so the
  // client can use same-origin URLs (ws://<host>/ws/<roomId>) exactly as it
  // will in production behind the ALB. Static /songs and /samples are still
  // served by Vite directly.
  server: {
    proxy: {
      "/ws": { target: RELAY_PROXY_TARGET, ws: true, changeOrigin: true },
      "/api": { target: RELAY_PROXY_TARGET, changeOrigin: true },
    },
  },

  build: {
    // Target modern browsers — enables more aggressive tree-shaking and avoids
    // unnecessary polyfill transforms.
    target: "es2020",

    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/tone")) return "vendor-tone";
          if (id.includes("node_modules/pixi-filters"))
            return "vendor-pixi-filters";
          if (id.includes("node_modules/pixi.js")) return "vendor-pixi";
          if (id.includes("node_modules/motion")) return "vendor-motion";
          if (id.includes("react-dom") || id.includes("node_modules/react/"))
            return "vendor-react";
        },
      },
    },
  },

  // Drop console/debugger calls in production builds only.
  // Saves ~5–10 KB on minified output and removes noisy logs on mobile.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
}));
