// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_ACCOUNT_ID, GeminiAccountStore } from "./gemini-accounts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-gemini-accounts-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function signIn(home: string, email: string): Promise<void> {
  const acp = join(home, ".gemini", "antigravity-acp");
  await mkdir(acp, { recursive: true });
  await writeFile(join(acp, "acp_token.json"), "{}");
  await writeFile(join(acp, "sahkarmi-account.json"), JSON.stringify({ email, tier: "Free" }));
}

describe("GeminiAccountStore", () => {
  it("starts with the first account in the real home and keeps extra accounts apart", async () => {
    const home = join(root, "home");
    const store = new GeminiAccountStore(join(root, "user-data"), home, {});
    await store.initialize();
    expect(store.activeId()).toBe(DEFAULT_GEMINI_ACCOUNT_ID);
    expect(store.activeGeminiHome()).toBeNull();
    expect((await store.list()).accounts).toEqual([
      {
        id: DEFAULT_GEMINI_ACCOUNT_ID,
        email: null,
        tier: null,
        signedIn: false,
        active: true,
      },
    ]);

    await signIn(home, "first@example.com");
    const extra = await store.add();
    expect(store.homeOf(extra)).toBe(join(root, "user-data", "gemini-accounts", extra));
    expect(store.geminiHomeOf(extra)).toBe(
      join(root, "user-data", "gemini-accounts", extra, ".gemini"),
    );
    // A new account is not signed in until Google's own sign-in ran in its folder.
    expect((await store.list()).accounts.map((account) => account.signedIn)).toEqual([true, false]);
    await signIn(store.homeOf(extra), "second@example.com");
    expect((await store.list()).accounts[1]).toMatchObject({
      email: "second@example.com",
      signedIn: true,
      active: false,
    });

    await store.setActive(extra);
    expect(store.activeGeminiHome()).toBe(store.geminiHomeOf(extra));

    // Saved: a restart keeps both accounts and the one in use.
    const reloaded = new GeminiAccountStore(join(root, "user-data"), home, {});
    await reloaded.initialize();
    expect(reloaded.activeId()).toBe(extra);
    expect((await reloaded.list()).accounts.map((account) => account.email)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
  });

  it("counts an API key from the environment for the first account only", async () => {
    const store = new GeminiAccountStore(join(root, "user-data"), join(root, "home"), {
      GEMINI_API_KEY: "key",
    });
    await store.initialize();
    await store.add();
    expect((await store.list()).accounts.map((account) => account.signedIn)).toEqual([true, false]);
  });

  it("finds the next signed-in account in order, skipping ones already tried", async () => {
    const home = join(root, "home");
    const store = new GeminiAccountStore(join(root, "user-data"), home, {});
    await store.initialize();
    await signIn(home, "a@example.com");
    const second = await store.add();
    const third = await store.add();
    await signIn(store.homeOf(third), "c@example.com");

    // The second account never signed in, so it is skipped.
    expect(await store.nextSignedIn(new Set())).toBe(third);
    await store.setActive(third);
    expect(await store.nextSignedIn(new Set())).toBe(DEFAULT_GEMINI_ACCOUNT_ID);
    expect(await store.nextSignedIn(new Set([DEFAULT_GEMINI_ACCOUNT_ID]))).toBeNull();
    await signIn(store.homeOf(second), "b@example.com");
    expect(await store.nextSignedIn(new Set([DEFAULT_GEMINI_ACCOUNT_ID]))).toBe(second);
  });

  it("removes an extra account with its sign-in, and never the first one", async () => {
    const store = new GeminiAccountStore(join(root, "user-data"), join(root, "home"), {});
    await store.initialize();
    const extra = await store.add();
    await signIn(store.homeOf(extra), "x@example.com");
    await store.setActive(extra);

    await expect(store.remove(DEFAULT_GEMINI_ACCOUNT_ID)).rejects.toThrow(/first Google account/);
    await store.remove(extra);
    expect(store.activeId()).toBe(DEFAULT_GEMINI_ACCOUNT_ID);
    expect((await store.list()).accounts).toHaveLength(1);
    expect(() => store.homeOf(extra)).toThrow(/not on this computer/);
    await expect(store.setActive(extra)).rejects.toThrow(/not on this computer/);
  });
});
