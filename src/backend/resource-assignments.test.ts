// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accessAllows,
  accessIsEmpty,
  EVERYONE_ACCESS,
  normaliseAccess,
} from "../shared/resource-access";
import { ResourceAssignmentStore } from "./resource-assignments";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const asha = { botId: "asha", workspaceId: "ws_sales", provider: "claude", isCeo: false };
const ceo = { botId: "boss", workspaceId: "ws_ops", provider: "codex", isCeo: true };
const ravi = { botId: "ravi", workspaceId: "ws_ops", provider: "antigravity", isCeo: false };

describe("resource access", () => {
  it("matches any one of everyone, engine, coworker, workspace or CEO", () => {
    const none = { ...EVERYONE_ACCESS, everyone: false };
    expect(accessIsEmpty(none)).toBe(true);
    expect(accessAllows(none, asha)).toBe(false);
    expect(accessAllows({ ...none, providers: ["claude"] }, asha)).toBe(true);
    expect(accessAllows({ ...none, providers: ["claude"] }, ravi)).toBe(false);
    expect(accessAllows({ ...none, botIds: ["ravi"] }, ravi)).toBe(true);
    expect(accessAllows({ ...none, workspaceIds: ["ws_ops"] }, ceo)).toBe(true);
    expect(accessAllows({ ...none, ceo: true }, ceo)).toBe(true);
    expect(accessAllows({ ...none, ceo: true }, ravi)).toBe(false);
  });

  it("cleans whatever arrives", () => {
    expect(normaliseAccess({ everyone: "yes", botIds: ["a", "a", 3, ""] })).toEqual({
      everyone: false,
      ceo: false,
      botIds: ["a"],
      workspaceIds: [],
      providers: [],
    });
    expect(normaliseAccess(null)).toEqual(EVERYONE_ACCESS);
  });
});

describe("ResourceAssignmentStore", () => {
  it("is everyone's by default, keeps the owner's choice across restarts, and announces it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-assign-"));
    roots.push(root);
    const store = new ResourceAssignmentStore(root);
    await store.initialize();
    expect(store.allows("app", "notion", asha)).toBe(true);
    const changed: string[] = [];
    store.onChanged((kind, id) => changed.push(`${kind}:${id}`));
    await store.set("app", "notion", { ...EVERYONE_ACCESS, everyone: false, providers: ["codex"] });
    expect(changed).toEqual(["app:notion"]);
    expect(store.allows("app", "notion", asha)).toBe(false);
    expect(store.allows("app", "notion", ceo)).toBe(true);

    const again = new ResourceAssignmentStore(root);
    await again.initialize();
    expect(again.allows("app", "notion", asha)).toBe(false);
    expect(again.get("app", "gmail")).toBeNull();

    await again.set("app", "notion", null);
    expect(again.allows("app", "notion", asha)).toBe(true);
    expect(again.list()).toEqual([]);
  });
});
