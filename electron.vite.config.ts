import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The Knowledge Bases worker runs in its own utility process, next to index.js.
        input: {
          index: "src/main/index.ts",
          "knowledge-worker": "src/backend/knowledge/knowledge-worker.ts",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [solidPlugin(), tailwindcss()],
  },
});
