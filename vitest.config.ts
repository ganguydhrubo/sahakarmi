import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solidPlugin({ hot: false })],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/renderer/src/setupTests.ts"],
    // Tests that start fake agent servers wait up to 10 s for them; the 5 s default failed
    // random ones whenever the machine was busy.
    testTimeout: 20_000,
  },
});
