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

  it("expires a request instead of letting a late answer revive it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    const approval = await store.create({
      botId: "asha-accounts",
      title: "Pay the GST invoice",
      details: "",
      category: "payment",
      permissionCategory: "payments",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(approval.riskLevel).toBe("high");

    const swept = await store.sweepExpired();
    expect(swept.map((item) => item.id)).toEqual([approval.id]);
    expect(store.get(approval.id)?.status).toBe("expired");
    // An expired request is dead: a decision arriving afterwards must not resurrect it.
    await expect(store.decide({ approvalId: approval.id, decision: "approved" })).rejects.toThrow(
      /expired/,
    );
    expect(store.pendingCount()).toBe(0);
  });

  it("refuses a second decision and records who decided", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    const approval = await store.create({
      botId: "asha-accounts",
      title: "Send the quote",
      details: "",
      category: "message",
    });
    const decided = await store.decide({
      approvalId: approval.id,
      decision: "approved",
      decidedBy: "telegram:42",
    });
    expect(decided.decidedBy).toBe("telegram:42");
    await expect(store.decide({ approvalId: approval.id, decision: "rejected" })).rejects.toThrow(
      /already approved/,
    );
  });

  it("resolves a short handle but never guesses between two", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    const approval = await store.create({
      botId: "asha-accounts",
      title: "Send the quote",
      details: "",
      category: "message",
    });
    const short = approval.id.replaceAll("-", "").slice(0, 8);
    expect(store.resolve(short)).toMatchObject({ approval: { id: approval.id } });
    expect(store.resolve(approval.id)).toMatchObject({ approval: { id: approval.id } });
    expect(store.resolve("nope-nope")).toBeNull();
    expect(store.resolve("")).toBeNull();
  });

  it("closes a tool call parked across a restart as expired, not rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    const approval = await store.create({
      botId: "asha-accounts",
      title: "Run a command",
      details: "",
      category: "other",
      kind: "permission",
      permissionCategory: "shell",
    });

    const restored = new ApprovalStore(root);
    await restored.initialize();
    // "rejected" would claim the owner refused; they were never asked in time.
    expect(restored.get(approval.id)?.status).toBe("expired");
  });

  it("records how the Telegram notification went", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-approvals-"));
    roots.push(root);
    const store = new ApprovalStore(root);
    await store.initialize();
    const approval = await store.create({
      botId: "asha-accounts",
      title: "Send the quote",
      details: "",
      category: "message",
    });
    await store.recordDelivery(approval.id, "chat not found");
    expect(store.get(approval.id)).toMatchObject({
      notifiedAt: null,
      deliveryError: "chat not found",
      // A failed delivery changes nothing about consent.
      status: "pending",
    });
    await store.recordDelivery(approval.id, null);
    expect(store.get(approval.id)?.deliveryError).toBeNull();
    expect(store.get(approval.id)?.notifiedAt).not.toBeNull();
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
