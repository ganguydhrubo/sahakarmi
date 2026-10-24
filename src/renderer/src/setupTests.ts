import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@solidjs/testing-library";
import { afterEach } from "vitest";

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

afterEach(() => cleanup());

// The full suite runs every file in parallel; a loaded CI runner can take more than the
// default second to render a view, which showed up as a flaky "connects a provider" test.
configure({ asyncUtilTimeout: 5_000 });
