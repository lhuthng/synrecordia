import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
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
});
