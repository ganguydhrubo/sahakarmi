// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProviderStatus } from "../shared/ipc";
import { BusinessStore } from "./business-store";
import { compareVersions, FeatureRegistry, parseManifest } from "./feature-registry";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-features-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const providers: AgentProviderStatus[] = [
  { id: "codex", state: "not-installed", version: null, message: null },
  { id: "claude", state: "sign-in-required", version: "2", message: null },
  { id: "antigravity", state: "available", version: "1", message: null },
  { id: "opencode", state: "available", version: "1", message: null },
];
const context = { platform: "win32" as const, appVersion: "0.4.0", providers };

function manifest(features: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: "sahkarmi.features/1", version: "2026.10", features, ...extra });
}

describe("FeatureRegistry", () => {
  it("computes availability from real provider state", async () => {
    const registry = new FeatureRegistry(root);
    await registry.initialize();
    const list = registry.list(context);
    expect(list.find((f) => f.id === "provider-codex")).toMatchObject({
      availability: "needs-setup",
      reason: "ChatGPT (Codex) is not installed on this computer.",
    });
    expect(list.find((f) => f.id === "provider-claude")?.reason).toContain("Sign in");
    expect(list.find((f) => f.id === "provider-antigravity")?.availability).toBe("available");
    expect(list.find((f) => f.id === "live-dictation")?.enabled).toBe(false);
  });

  it("keeps safety features on and persists switches", async () => {
    const registry = new FeatureRegistry(root);
    await registry.initialize();
    await expect(registry.setEnabled("permissions", false)).rejects.toThrow("always on");
    await registry.setEnabled("schedules", false);
    await registry.setEnabled("live-dictation", true);
    const reopened = new FeatureRegistry(root);
    await reopened.initialize();
    expect(reopened.isEnabled("schedules")).toBe(false);
    expect(reopened.isEnabled("live-dictation")).toBe(true);
    expect(reopened.isEnabled("approvals")).toBe(true);
  });

  it("rejects feature lists that try to carry code, links or commands", () => {
    const result = parseManifest(
      manifest([{ id: "auto-pay", name: "Auto pay", script: "https://evil.example/x.js" }], {
        download: "https://evil.example/app.exe",
      }),
    );
    expect("errors" in result && result.errors.join(" ")).toMatch(
      /download.*script|script.*download/s,
    );
    expect("errors" in parseManifest("{nope")).toBe(true);
    expect("errors" in parseManifest(manifest([{ id: "X Bad", name: "x" }]))).toBe(true);
  });

  it("previews changes before applying, and announced features are never 'available'", async () => {
    const registry = new FeatureRegistry(root);
    await registry.initialize();
    const json = manifest([
      { id: "schedules", enabled: false, name: "Schedules" },
      { id: "approvals", enabled: false, name: "Approvals" },
      {
        id: "tally-sync",
        name: "Tally sync",
        description: "Live Tally sync",
        category: "business",
        minAppVersion: "0.9.0",
      },
    ]);
    const preview = registry.preview(json, "0.4.0");
    expect(preview).toMatchObject({
      ok: true,
      changed: [{ id: "schedules", change: "Switch off" }],
      added: [{ id: "tally-sync", name: "Tally sync (needs v0.9.0)" }],
      ignored: [{ id: "approvals", reason: "Safety feature; it always stays on." }],
    });
    expect(registry.isEnabled("schedules")).toBe(true);
    await registry.apply(json, "0.4.0");
    expect(registry.isEnabled("schedules")).toBe(false);
    expect(registry.list(context).find((f) => f.id === "tally-sync")).toMatchObject({
      origin: "catalogue",
      availability: "coming-later",
      enabled: false,
    });
    await registry.resetCatalogue();
    expect(registry.list(context).some((f) => f.id === "tally-sync")).toBe(false);
  });

  it("compares versions", () => {
    expect(compareVersions("0.3.3", "0.3.10")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("BusinessStore", () => {
  it("lists only usable integrations and keeps owner targets separate", async () => {
    const store = new BusinessStore(root);
    await store.initialize();
    expect(store.integrations().length).toBeGreaterThan(0);
    expect(store.integrations().some((i) => i.support === "not-supported")).toBe(false);
    const [saved] = await store.saveTarget({
      title: "Diwali orders",
      metric: "Orders",
      unit: "orders",
      targetValue: 40,
      currentValue: null,
      period: "monthly",
      dueDate: "2026-11-01",
      botId: "vikram-sales",
      notes: "",
    });
    expect(saved).toMatchObject({ title: "Diwali orders", currentValue: null });
    if (!saved) throw new Error("target not saved");
    const target = saved;
    await store.saveTarget({ ...target, currentValue: 12 });
    const reopened = new BusinessStore(root);
    await reopened.initialize();
    expect(reopened.listTargets()[0]?.currentValue).toBe(12);
    await expect(
      reopened.saveTarget({ ...target, id: "missing", currentValue: 1 }),
    ).rejects.toThrow("no longer exists");
    await expect(
      reopened.saveTarget({ ...target, id: undefined, targetValue: -1 }),
    ).rejects.toThrow();
    expect(await reopened.deleteTarget(target.id)).toEqual([]);
  });
});
