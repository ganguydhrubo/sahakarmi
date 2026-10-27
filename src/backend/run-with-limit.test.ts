// @vitest-environment node

import { describe, expect, it } from "vitest";
import { runWithLimit } from "./agent-service";

describe("runWithLimit", () => {
  it("runs every item, never more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10 + (item % 3) * 5));
      done.push(item);
      running -= 1;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    await runWithLimit([], 3, async () => {
      throw new Error("never called");
    });
    const seen: string[] = [];
    await runWithLimit(["a"], 5, async (item) => {
      seen.push(item);
    });
    expect(seen).toEqual(["a"]);
  });
});
