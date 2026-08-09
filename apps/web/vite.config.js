import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // Pre-bundle heavy ESM deps so the dev server doesn't re-transform them on
  // every cold start. Has no effect on production builds.
  optimizeDeps: {
    include: ["tone", "pixi.js", "pixi-filters"],
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
