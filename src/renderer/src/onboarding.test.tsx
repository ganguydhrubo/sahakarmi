import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedTour, placeCard } from "./components/GuidedTour";
import { onboardingBn, onboardingEn, onboardingHi } from "./i18n-onboarding";
import {
  dismissWelcome,
  ONBOARDING_KEY,
  onboardingState,
  parseOnboarding,
  reloadOnboardingForTests,
  resetOnboarding,
  settleWelcomeForExistingUser,
  welcomeEligible,
} from "./onboarding";

describe("onboarding state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    reloadOnboardingForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers the welcome only to a new install, after the coworkers have loaded", () => {
    expect(welcomeEligible({ botsLoaded: false, hasHistory: false })).toBe(false);
    expect(welcomeEligible({ botsLoaded: true, hasHistory: false })).toBe(true);
    expect(welcomeEligible({ botsLoaded: true, hasHistory: true })).toBe(false);
  });

  it("marks an existing user as having seen the welcome", () => {
    settleWelcomeForExistingUser({ botsLoaded: true, hasHistory: true });
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_KEY) ?? "{}").welcome).toBe(
      "dismissed",
    );
    reloadOnboardingForTests();
    expect(welcomeEligible({ botsLoaded: true, hasHistory: false })).toBe(false);
  });

  it("remembers a dismissed welcome across a restart", () => {
    dismissWelcome();
    reloadOnboardingForTests();
    expect(onboardingState().welcome).toBe("dismissed");
    expect(welcomeEligible({ botsLoaded: true, hasHistory: false })).toBe(false);
  });

  it("shows the welcome again only after an explicit reset, even with history", () => {
    dismissWelcome();
    resetOnboarding();
    reloadOnboardingForTests();
    expect(welcomeEligible({ botsLoaded: true, hasHistory: true })).toBe(true);
    // An existing user who resets is not silently dismissed again.
    settleWelcomeForExistingUser({ botsLoaded: true, hasHistory: true });
    expect(onboardingState().welcome).toBe("show");
  });

  it("opens nothing by itself when storage cannot save", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    reloadOnboardingForTests();
    expect(welcomeEligible({ botsLoaded: true, hasHistory: false })).toBe(false);
    // A choice still applies on screen for this session.
    dismissWelcome();
    expect(onboardingState().welcome).toBe("dismissed");
  });

  it("treats a damaged saved value as seen instead of looping", () => {
    expect(parseOnboarding("{not json").welcome).toBe("dismissed");
    expect(parseOnboarding(JSON.stringify({ welcome: "weird", tour: 3 }))).toEqual({
      version: 1,
      welcome: "auto",
      tour: "never",
      checklistHidden: false,
    });
  });
});

describe("guided tour", () => {
  it("ends quietly when none of its controls are on screen", () => {
    const onEnd = vi.fn();
    render(() => <GuidedTour onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledWith("nothing");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the card inside the window", () => {
    const viewport = { width: 800, height: 600 };
    const card = { width: 300, height: 140 };
    // A wide control at the bottom (the message box): the card goes above it.
    const composer = placeCard({ top: 520, left: 100, width: 640, height: 60 }, card, viewport);
    expect(composer.top + card.height).toBeLessThanOrEqual(520);
    expect(composer.left).toBeGreaterThanOrEqual(12);
    expect(composer.left + card.width).toBeLessThanOrEqual(788);
    // A small rail button on the left: the card goes to its right.
    const rail = placeCard({ top: 200, left: 7, width: 42, height: 42 }, card, viewport);
    expect(rail.left).toBeGreaterThan(49);
    // A control in the top-right corner never pushes the card off screen.
    const corner = placeCard({ top: 4, left: 760, width: 36, height: 30 }, card, viewport);
    expect(corner.left + card.width).toBeLessThanOrEqual(788);
    expect(corner.top).toBeGreaterThanOrEqual(12);
  });
});

describe("onboarding translations", () => {
  it("has every key in English, Hindi and Bengali, with real text", () => {
    const keys = Object.keys(onboardingEn);
    for (const dictionary of [onboardingHi, onboardingBn]) {
      expect(Object.keys(dictionary).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const value = dictionary[key as keyof typeof onboardingEn];
        expect(value.trim()).not.toBe("");
        // Placeholders such as {count} must survive translation.
        const placeholders = onboardingEn[key as keyof typeof onboardingEn].match(/\{\w+\}/g) ?? [];
        for (const placeholder of placeholders) expect(value).toContain(placeholder);
      }
    }
    expect(onboardingHi.welcomeTitle).not.toBe(onboardingEn.welcomeTitle);
    expect(onboardingBn.welcomeTitle).not.toBe(onboardingEn.welcomeTitle);
  });
});
