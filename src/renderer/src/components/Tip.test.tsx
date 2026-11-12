import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdTips, ONBOARDING_KEY, onboardingState, reloadOnboardingForTests } from "../onboarding";
import { answerText, matchesQuery } from "./HelpPanel";
import { Tip } from "./Tip";

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.removeItem(ONBOARDING_KEY);
  reloadOnboardingForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function settle() {
  vi.advanceTimersByTime(1_000);
}

describe("one-time tips", () => {
  it("appear after a moment, once, and Got it closes them for good", () => {
    const { unmount } = render(() => <Tip id="a" text="tipApproval" />);
    expect(screen.queryByRole("note")).toBeNull();
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    render(() => <Tip id="a" text="tipApproval" />);
    settle();
    expect(screen.queryByRole("note")).toBeNull();
    expect(onboardingState().seenTips).toEqual(["a"]);
  });

  it("show one at a time; the next waits until the first closes", () => {
    render(() => (
      <>
        <Tip id="first" text="tipApproval" />
        <Tip id="second" text="tipKnowledge" />
      </>
    ));
    settle();
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note").dataset.tip).toBe("first");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByRole("note").dataset.tip).toBe("second");
  });

  it("stay away while the tour or Help is open, and Turn off tips stops all of them", () => {
    const release = holdTips();
    render(() => <Tip id="held" text="tipApproval" />);
    settle();
    expect(screen.queryByRole("note")).toBeNull();
    release();
    expect(screen.getByRole("note")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off tips" }));
    expect(onboardingState().tipsOff).toBe(true);
    cleanup();
    render(() => <Tip id="other" text="tipKnowledge" />);
    settle();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("help search", () => {
  it("drops the old topic label from reused answers", () => {
    expect(answerText("CEO: open the workspace menu.")).toBe("Open the workspace menu.");
    expect(answerText("When something fails, it says why.")).toBe(
      "When something fails, it says why.",
    );
  });

  it("matches every word in any order", () => {
    expect(matchesQuery("Can I use Sahkarmi from my phone?", "phone sahkarmi")).toBe(true);
    expect(matchesQuery("Can I use Sahkarmi from my phone?", "phone laptop")).toBe(false);
  });
});
