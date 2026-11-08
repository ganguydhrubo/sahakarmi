// @vitest-environment node

import { describe, expect, it } from "vitest";
import { StartupTimings } from "./startup-timings";

describe("startup timings", () => {
  it("times each step and names the slowest", () => {
    let now = 0;
    const timings = new StartupTimings(() => now);
    now = 300;
    timings.mark("window");
    now = 9_500;
    timings.mark("AI engines ready");
    expect(timings.summary()).toEqual({
      totalMs: 9_500,
      steps: [
        { step: "window", ms: 300 },
        { step: "AI engines ready", ms: 9_200 },
      ],
      slowest: "AI engines ready",
      slow: true,
    });
  });
});
