// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "./approval-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ApprovalStore", () => {
  it("keeps pending approvals across restarts and records decisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();

    const approval = await store.create({
      botId: "meera-support",
      title: "  Reply to Mrs. Banerjee about the refund  ",
      details: "Draft attached.",
      category: "message",
    });
    expect(approval.title).toBe("Reply to Mrs. Banerjee about the refund");
    expect(store.pendingCount()).toBe(1);

    const restored = new ApprovalStore(root);
    await restored.initialize();
    expect(restored.pendingCount("meera-support")).toBe(1);
    const decided = await restored.decide({
      approvalId: approval.id,
      decision: "approved",
      note: "Add a 10% coupon",
    });
    expect(decided).toMatchObject({ status: "approved", note: "Add a 10% coupon" });
    expect(restored.pendingCount()).toBe(0);
    await expect(
      restored.create({ botId: "x", title: " ", details: "", category: "other" }),
    ).rejects.toThrow("title");
  });

  it("removes a deleted coworker's approvals", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    await store.create({
      botId: "vikram-sales",
      title: "Send quote",
      details: "",
      category: "message",
    });
    await store.deleteBotData("vikram-sales");
    expect(store.list()).toEqual([]);
  });
});
