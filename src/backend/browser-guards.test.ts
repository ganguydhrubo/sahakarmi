// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type BudgetTab,
  CRASH_HEALTHY_MS,
  CRASH_WINDOW_MS,
  pagesOverBudget,
  restingSiteMessage,
  SiteCrashGuard,
  siteOfPage,
} from "./browser-guards";

const NOW = 10_000_000;
const ago = (seconds: number) => NOW - seconds * 1000;

function tab(id: string, ownerBotId: string | null, lastUsed: number, guarded = false): BudgetTab {
  return { id, ownerBotId, lastUsed, protected: guarded };
}

describe("page budget", () => {
  it("leaves a coworker with two awake pages alone", () => {
    expect(pagesOverBudget([tab("a", "x", ago(600)), tab("b", "x", ago(500))], NOW)).toEqual([]);
  });

  it("sleeps the least recently used extra pages, keeping the two most recent", () => {
    const tabs = [
      tab("old", "x", ago(900)),
      tab("mid", "x", ago(600)),
      tab("new", "x", ago(300)),
      tab("newest", "x", ago(200)),
    ];
    expect(pagesOverBudget(tabs, NOW)).toEqual(["old", "mid"]);
  });

  it("never picks a protected page (on screen, busy, unsaved typing), which still counts", () => {
    const tabs = [
      tab("typed", "x", ago(900), true),
      tab("mid", "x", ago(600)),
      tab("new", "x", ago(300)),
    ];
    expect(pagesOverBudget(tabs, NOW)).toEqual(["mid"]);
    // Everything protected: nothing sleeps, even over budget.
    expect(
      pagesOverBudget(
        [
          tab("a", "x", ago(900), true),
          tab("b", "x", ago(800), true),
          tab("c", "x", ago(700), true),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it("leaves a page used in the last minute awake, and counts each coworker on its own", () => {
    const tabs = [
      tab("x1", "x", ago(30)),
      tab("x2", "x", ago(20)),
      tab("x3", "x", ago(10)),
      tab("y1", "y", ago(900)),
      tab("y2", "y", ago(800)),
      tab("y3", "y", ago(700)),
      tab("owner1", null, ago(9_000)),
      tab("owner2", null, ago(9_000)),
      tab("owner3", null, ago(9_000)),
    ];
    expect(pagesOverBudget(tabs, NOW)).toEqual(["y1"]);
  });
});

describe("site crash guard", () => {
  it("rests a site after three crashes in ten minutes, and only that site", () => {
    const guard = new SiteCrashGuard();
    expect(guard.noteCrash("bad.example", ago(300))).toBe(1);
    expect(guard.noteCrash("bad.example", ago(200))).toBe(2);
    expect(guard.isResting("bad.example", NOW)).toBe(false);
    expect(guard.noteCrash("bad.example", ago(100))).toBe(3);
    expect(guard.isResting("bad.example", NOW)).toBe(true);
    expect(guard.isResting("good.example", NOW)).toBe(false);
  });

  it("forgets crashes older than the window", () => {
    const guard = new SiteCrashGuard();
    guard.noteCrash("bad.example", ago(200) - CRASH_WINDOW_MS - 1_000);
    guard.noteCrash("bad.example", ago(200));
    expect(guard.noteCrash("bad.example", ago(100))).toBe(2);
    expect(guard.isResting("bad.example", NOW)).toBe(false);
    guard.noteCrash("bad.example", ago(50));
    expect(guard.isResting("bad.example", NOW)).toBe(true);
    expect(guard.isResting("bad.example", ago(50) + CRASH_WINDOW_MS)).toBe(false);
  });

  it("starts again after a success: the owner opened it, or a page stayed up a while", () => {
    const guard = new SiteCrashGuard();
    for (const seconds of [300, 200, 100]) guard.noteCrash("bad.example", ago(seconds));
    guard.noteSuccess("bad.example");
    expect(guard.isResting("bad.example", NOW)).toBe(false);
    guard.noteCrash("flaky.example", ago(500));
    guard.noteCrash("flaky.example", ago(400));
    guard.noteLoaded("flaky.example", ago(390));
    // Up for longer than CRASH_HEALTHY_MS before this crash: the earlier two no longer count.
    expect(guard.noteCrash("flaky.example", ago(390) + CRASH_HEALTHY_MS)).toBe(1);
  });

  it("names the site by host and tells the coworker in plain words", () => {
    expect(siteOfPage("https://Shop.Example.com/cart?x=1")).toBe("shop.example.com");
    expect(siteOfPage("about:blank")).toBe("");
    expect(siteOfPage("not a url")).toBe("");
    const guard = new SiteCrashGuard();
    for (let i = 0; i < 5; i += 1) guard.noteCrash("", NOW);
    expect(guard.isResting("", NOW)).toBe(false);
    expect(restingSiteMessage("shop.example.com")).toMatch(
      /shop\.example\.com stopped working 3 times in the last 10 minutes/,
    );
  });
});
