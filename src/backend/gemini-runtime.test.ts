// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotSummary } from "../shared/ipc";
import type { GeminiAccountSource } from "./gemini-accounts";
import { GeminiRotation, IdleWatch, pickPrewarmBots } from "./gemini-runtime";

function bot(id: string, model: string, threadId: string | null, updatedAt: string): BotSummary {
  return { id, model, threadId, updatedAt } as unknown as BotSummary;
}

describe("pickPrewarmBots", () => {
  it("picks the most recently used Gemini coworkers that already have a conversation", () => {
    const bots = [
      bot("old", "antigravity-default", "t-old", "2026-10-01T00:00:00Z"),
      bot("new", "antigravity-default", "t-new", "2026-10-25T00:00:00Z"),
      bot("mid", "antigravity-default", "t-mid", "2026-10-20T00:00:00Z"),
      bot("never-ran", "antigravity-default", null, "2026-10-26T00:00:00Z"),
      bot("other-ai", "opencode-free", "t-oc", "2026-10-26T00:00:00Z"),
      bot("loaded", "antigravity-default", "t-loaded", "2026-10-26T00:00:00Z"),
    ];
    const picked = pickPrewarmBots(
      bots,
      (candidate) => candidate.model.startsWith("antigravity"),
      new Set(["t-loaded"]),
    );
    expect(picked.map((candidate) => candidate.id)).toEqual(["new", "mid"]);
  });
});

describe("IdleWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops after a quiet spell, re-armed by every use and held off while busy", async () => {
    const onIdle = vi.fn();
    let busy = false;
    const watch = new IdleWatch({ onIdle, isBusy: () => busy, delayMs: () => 1_000 });
    watch.touch();
    await vi.advanceTimersByTimeAsync(900);
    watch.touch();
    await vi.advanceTimersByTimeAsync(900);
    expect(onIdle).not.toHaveBeenCalled();

    busy = true;
    await vi.advanceTimersByTimeAsync(200);
    expect(onIdle).not.toHaveBeenCalled();
    expect(watch.armed).toBe(true);

    busy = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(watch.armed).toBe(false);

    watch.touch();
    watch.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

class FakeAccounts implements GeminiAccountSource {
  active = "default";
  constructor(readonly signedIn: string[]) {}
  activeId(): string {
    return this.active;
  }
  activeGeminiHome(): string | null {
    return this.active === "default" ? null : `/accounts/${this.active}/.gemini`;
  }
  async nextSignedIn(exclude: ReadonlySet<string>): Promise<string | null> {
    const start = this.signedIn.indexOf(this.active);
    for (let step = 1; step <= this.signedIn.length; step += 1) {
      const candidate = this.signedIn[(start + step) % this.signedIn.length];
      if (candidate && candidate !== this.active && !exclude.has(candidate)) return candidate;
    }
    return null;
  }
  async setActive(id: string): Promise<void> {
    this.active = id;
  }
}

describe("GeminiRotation", () => {
  it("moves through every signed-in account once, then gives up", async () => {
    const accounts = new FakeAccounts(["default", "b", "c"]);
    const rotation = new GeminiRotation(accounts);
    expect(await rotation.plan("bot", "default")).toEqual({ kind: "switch", accountId: "b" });
    expect(accounts.active).toBe("b");
    expect(await rotation.plan("bot", "b")).toEqual({ kind: "switch", accountId: "c" });
    // All three used up for this message: the usual free-model fallback takes over.
    expect(await rotation.plan("bot", "c")).toEqual({ kind: "none" });
    expect(accounts.active).toBe("c");

    // An answer clears the chain; the next limit starts again from the account in use.
    rotation.forget("bot");
    expect(await rotation.plan("bot", "c")).toEqual({ kind: "switch", accountId: "default" });
  });

  it("only re-sends when another coworker already moved Gemini to a fresh account", async () => {
    const accounts = new FakeAccounts(["default", "b"]);
    const rotation = new GeminiRotation(accounts);
    expect(await rotation.plan("asha", "default")).toEqual({ kind: "switch", accountId: "b" });
    // Meera's turn failed on the old account while Asha's switch was under way.
    expect(await rotation.plan("meera", "default")).toEqual({ kind: "resend" });
    expect(await rotation.plan("meera", "b")).toEqual({ kind: "none" });
  });

  it("does nothing when there is no other signed-in account", async () => {
    const accounts = new FakeAccounts(["default"]);
    const rotation = new GeminiRotation(accounts);
    expect(await rotation.plan("bot", "default")).toEqual({ kind: "none" });
    expect(accounts.active).toBe("default");
  });

  it("forgets an old chain after a while", async () => {
    let now = 0;
    const accounts = new FakeAccounts(["default", "b"]);
    const rotation = new GeminiRotation(accounts, () => now);
    expect(await rotation.plan("bot", "default")).toEqual({ kind: "switch", accountId: "b" });
    expect(await rotation.plan("bot", "b")).toEqual({ kind: "none" });
    now = 16 * 60_000;
    expect(await rotation.plan("bot", "b")).toEqual({ kind: "switch", accountId: "default" });
  });
});
