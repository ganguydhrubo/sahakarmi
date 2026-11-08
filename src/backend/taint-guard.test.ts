// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanProvenance } from "./approval-store";
import { DEFAULT_PERMISSION_LEVELS, decide, type PermissionRequest } from "./permission-policy";
import { PermissionService } from "./permission-service";
import {
  describeSource,
  domainOf,
  type GateOutcome,
  isTaintGuarded,
  TaintGuard,
  webSource,
} from "./taint-guard";

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  botId: "bot-1",
  provider: "codex",
  category: "shell",
  action: "npm install left-pad",
  paths: [],
  ...overrides,
});

describe("isTaintGuarded", () => {
  it("guards commands, outgoing messages and key-file reads only", () => {
    expect(isTaintGuarded(request(), true)).toBe(true);
    expect(isTaintGuarded(request({ category: "file_delete", action: "rm x" }), true)).toBe(true);
    expect(isTaintGuarded(request({ category: "external_messages" }), false)).toBe(true);
    expect(
      isTaintGuarded(request({ category: "file_read", paths: ["C:/Users/a/.ssh/id_rsa"] }), false),
    ).toBe(true);
    // A tool server call is classed "shell" but is not a command.
    expect(isTaintGuarded(request(), false)).toBe(false);
    // Read-only commands and ordinary work never get the extra question.
    expect(isTaintGuarded(request({ category: "file_read", action: "ls" }), true)).toBe(false);
    expect(isTaintGuarded(request({ category: "file_modify" }), false)).toBe(false);
    expect(isTaintGuarded(request({ category: "browser_navigation" }), false)).toBe(false);
  });
});

describe("TaintGuard", () => {
  it("one question per tainted turn; the next turn starts clean", async () => {
    const guard = new TaintGuard();
    let asks = 0;
    const ask = async (): Promise<GateOutcome> => {
      asks += 1;
      return "approved";
    };
    // Clean turn: nothing to ask.
    expect(await guard.gate("bot-1", "turn-1", ask)).toBeNull();
    guard.mark("bot-1", "turn-1", webSource("https://www.example.com/a"));
    expect(await guard.gate("bot-1", "turn-1", ask)).toMatchObject({
      outcome: "approved",
      asked: true,
    });
    // Covered for the rest of the turn.
    expect(await guard.gate("bot-1", "turn-1", ask)).toBeNull();
    expect(await guard.gate("bot-1", "turn-1", ask)).toBeNull();
    expect(asks).toBe(1);
    // Another coworker and the next turn are untouched.
    expect(await guard.gate("bot-2", "turn-1", ask)).toBeNull();
    expect(await guard.gate("bot-1", "turn-2", ask)).toBeNull();
    expect(asks).toBe(1);
  });

  it("shares one answer between requests that arrive together, and remembers a no", async () => {
    const guard = new TaintGuard();
    guard.mark("bot-1", "t", { kind: "app", label: "the notes tool server" });
    let release: (outcome: GateOutcome) => void = () => undefined;
    let asks = 0;
    const ask = () => {
      asks += 1;
      return new Promise<GateOutcome>((resolve) => {
        release = resolve;
      });
    };
    const first = guard.gate("bot-1", "t", ask);
    const second = guard.gate("bot-1", "t", ask);
    release("declined");
    expect(await first).toMatchObject({ outcome: "declined", asked: true });
    expect(await second).toMatchObject({ outcome: "declined", asked: false });
    expect(await guard.gate("bot-1", "t", ask)).toMatchObject({ outcome: "declined" });
    expect(asks).toBe(1);
  });

  it("an error while asking counts as a no, never as a yes", async () => {
    const guard = new TaintGuard();
    guard.mark("bot-1", "t", webSource(null));
    const result = await guard.gate("bot-1", "t", async () => {
      throw new Error("inbox unavailable");
    });
    expect(result).toMatchObject({ outcome: "declined" });
  });

  it("endTurn forgets the turn", async () => {
    const guard = new TaintGuard();
    guard.mark("bot-1", "t", webSource("https://example.com"));
    guard.endTurn("bot-1", "t");
    expect(guard.source("bot-1", "t")).toBeNull();
  });

  it("names sources in plain words", () => {
    expect(domainOf("https://www.example.com/x?y=1")).toBe("example.com");
    expect(domainOf("file:///C:/x.html")).toBeNull();
    expect(describeSource(webSource("https://news.example.org"))).toBe(
      "a web page it read (news.example.org)",
    );
    expect(describeSource(webSource("not a url"))).toBe("a web page it read (a web page)");
    expect(describeSource({ kind: "file", label: "notes.txt" })).toContain("outside its folders");
  });
});

describe("permission decision with taint", () => {
  const policy = { levels: { ...DEFAULT_PERMISSION_LEVELS }, grants: [], autoMode: true };
  it("asks even in auto mode, but a deny setting still wins", () => {
    expect(decide(policy, request(), []).effective).toBe("allow");
    expect(decide(policy, request({ taint: { source: "a web page" } }), []).effective).toBe("ask");
    const denied = { ...policy, levels: { ...policy.levels, shell: "deny" as const } };
    expect(decide(denied, request({ taint: { source: "a web page" } }), []).effective).toBe("deny");
  });

  describe("with a pre-authorisation", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "sahkarmi-taint-"));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    it("skips the grant (and does not use it up) only while tainted", async () => {
      const permissions = new PermissionService(root);
      await permissions.initialize();
      await permissions.addGrant({
        category: "shell",
        botId: null,
        hours: 1,
        maxUses: 2,
        note: "builds",
      });
      let asks = 0;
      permissions.setAsker(async () => {
        asks += 1;
        return "approved";
      });
      expect(await permissions.authorize(request(), [root])).toMatchObject({ allowed: true });
      expect(asks).toBe(0);
      expect(
        await permissions.authorize(request({ taint: { source: "a web page" } }), [root]),
      ).toMatchObject({ allowed: true, reason: "Approved." });
      expect(asks).toBe(1);
      // One use left: the tainted request did not consume it.
      expect(permissions.get().grants[0]?.usesLeft).toBe(1);
    });
  });
});

describe("cleanProvenance", () => {
  it("keeps known kinds and short labels only", () => {
    expect(cleanProvenance({ kind: "web", label: "  example.com \n" })).toEqual({
      kind: "web",
      label: "example.com",
    });
    expect(cleanProvenance({ kind: "owner" })).toEqual({ kind: "owner" });
    expect(cleanProvenance({ kind: "unknown" })).toBeNull();
    expect(cleanProvenance("web")).toBeNull();
    expect(cleanProvenance({ kind: "coworker", label: "x".repeat(500) })?.label).toHaveLength(120);
  });
});
