import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solidPlugin({ hot: false })],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/renderer/src/setupTests.ts"],
    // Tests that start fake agent servers wait up to 30 s for them (a busy PC or CI runner took
    // over 10 s); a test that passes is not slowed down by a longer limit.
    testTimeout: 60_000,
  },
});
