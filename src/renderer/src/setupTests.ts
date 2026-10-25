import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@solidjs/testing-library";
import { afterEach } from "vitest";

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

// Tests never start the other agents installed on the developer's computer (Qwen Code, Cursor…).
for (const id of [
  "cursor",
  "copilot",
  "kimi",
  "cline",
  "qwen",
  "grok",
  "droid",
  "qoder",
  "goose",
  "vibe",
  "kiro",
]) {
  // This file is typed for the browser; vitest itself runs on Node, where process exists.
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  if (env) env[`SAHKARMI_${id.toUpperCase()}_PATH`] ??= "<not-installed-in-tests>";
}

afterEach(() => cleanup());

// The full suite runs every file in parallel; a loaded CI runner can take more than the
// default second to render a view, which showed up as a flaky "connects a provider" test.
configure({ asyncUtilTimeout: 5_000 });
