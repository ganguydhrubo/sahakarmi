import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityState } from "../activity";
import { setActivityStyle } from "../preferences";
import { ActivityIndicator, ROTATE_MS } from "./ActivityIndicator";

beforeEach(() => setActivityStyle("seedha"));

const THINKING: ActivityState = {
  phase: "thinking",
  category: null,
  detail: null,
  toolFailed: false,
  retry: null,
  key: "thinking:a1",
};

describe("ActivityIndicator", () => {
  it("keeps the same line between rotations while clock ticks arrive", () => {
    const start = Date.now();
    const [now, setNow] = createSignal(start);
    const [activity, setActivity] = createSignal<ActivityState>(THINKING);
    render(() => (
      <ActivityIndicator bot={undefined} activity={activity()} now={now()} activeSince={start} />
    ));
    const secondary = () => document.querySelector(".activity-secondary")?.textContent;
    const first = secondary();
    for (let tick = 1; tick < ROTATE_MS / 1_000; tick += 1) {
      setNow(start + tick * 1_000);
      // A new object with the same event key, as the parent produces every second.
      setActivity({ ...THINKING });
      expect(secondary()).toBe(first);
    }
    setNow(start + ROTATE_MS + 10);
    expect(secondary()).not.toBe(first);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Coworker: Request par kaam chal raha hai…",
    );
    expect(document.querySelector(".activity-elapsed")?.textContent).toBe("4s");
  });

  it("stops the spinner and shows the outcome when the turn ends", () => {
    render(() => (
      <ActivityIndicator
        bot={undefined}
        activity={{ ...THINKING, phase: "failed", key: "failed:1" }}
        now={Date.now()}
        activeSince={null}
      />
    ));
    expect(document.querySelector(".activity-spinner")).toBeNull();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Coworker: Task complete nahi ho paya. Dobara try karein.",
    );
    expect(document.querySelector(".activity-secondary")).toBeNull();
  });
});
