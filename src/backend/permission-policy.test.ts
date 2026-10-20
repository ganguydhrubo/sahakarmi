// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PermissionPolicyState } from "../shared/ipc";
import {
  allowedLevels,
  classifyAcpTool,
  classifyBrowserAction,
  classifyClaudeTool,
  classifyCommand,
  DEFAULT_PERMISSION_LEVELS,
  decide,
  redact,
  sanitizeLevels,
} from "./permission-policy";
import { PermissionService } from "./permission-service";

const ROOTS = ["/data/coworkers/asha", "/data/Shared"];

function policy(overrides: Partial<PermissionPolicyState> = {}): PermissionPolicyState {
  return { levels: { ...DEFAULT_PERMISSION_LEVELS }, grants: [], autoMode: false, ...overrides };
}

function request(category: Parameters<typeof decide>[1]["category"], paths: string[] = []) {
  return { botId: "asha", provider: "codex", category, action: "test", paths };
}

describe("permission policy", () => {
  it("auto mode stops asking for everyday work but never for money, messages or forms", () => {
    const auto = policy({ autoMode: true });
    expect(decide(auto, request("shell"), ROOTS).effective).toBe("allow");
    expect(decide(auto, request("file_delete", ["/elsewhere/x"]), ROOTS).effective).toBe("allow");
    expect(decide(auto, request("file_modify", ["/outside/a.txt"]), ROOTS).effective).toBe("allow");
    for (const sensitive of [
      "payments",
      "external_messages",
      "publication",
      "official_forms",
    ] as const) {
      expect(decide(auto, request(sensitive), ROOTS).effective).toBe("ask");
    }
    const blocked = policy({
      autoMode: true,
      levels: { ...DEFAULT_PERMISSION_LEVELS, shell: "deny" },
    });
    expect(decide(blocked, request("shell"), ROOTS).effective).toBe("deny");
  });

  it("never makes a sensitive category automatic, even from a tampered file", () => {
    expect(allowedLevels("payments")).toEqual(["ask", "deny"]);
    const levels = sanitizeLevels({ payments: "auto", publication: "workspace", shell: "auto" });
    expect(levels.payments).toBe("ask");
    expect(levels.publication).toBe("ask");
    expect(levels.shell).toBe("auto");
    const tampered = policy({ levels: { ...DEFAULT_PERMISSION_LEVELS, payments: "auto" } });
    expect(decide(tampered, request("payments"), ROOTS).effective).toBe("ask");
  });

  it("keeps writes inside the coworker folders and asks elsewhere", () => {
    const state = policy();
    expect(decide(state, request("file_modify", ["/data/Shared/a.txt"]), ROOTS).effective).toBe(
      "allow",
    );
    expect(
      decide(state, request("file_modify", ["/data/coworkers/asha/../vikram/x"]), ROOTS).effective,
    ).toBe("ask");
    expect(decide(state, request("file_create", []), ROOTS).effective).toBe("ask");
    expect(decide(state, request("file_read", ["/etc/hosts"]), ROOTS).effective).toBe("allow");
    expect(decide(state, request("file_delete", ["/data/Shared/a"]), ROOTS).effective).toBe("ask");
  });

  it("denies when the owner chose deny", () => {
    const state = policy({ levels: { ...DEFAULT_PERMISSION_LEVELS, shell: "deny" } });
    expect(decide(state, request("shell"), ROOTS)).toMatchObject({ effective: "deny" });
  });

  it("uses only matching, unexpired grants with uses left", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const grant = {
      id: "g1",
      category: "external_messages" as const,
      botId: "asha",
      expiresAt: "2026-10-20T11:00:00Z",
      usesLeft: 2,
      note: "Diwali greetings",
      createdAt: "2026-10-20T09:00:00Z",
    };
    expect(
      decide(policy({ grants: [grant] }), request("external_messages"), ROOTS, now),
    ).toMatchObject({ effective: "allow", grant: { id: "g1" } });
    const otherBot = { ...request("external_messages"), botId: "vikram" };
    expect(decide(policy({ grants: [grant] }), otherBot, ROOTS, now).effective).toBe("ask");
    const expired = { ...grant, expiresAt: "2026-10-20T09:59:00Z" };
    expect(
      decide(policy({ grants: [expired] }), request("external_messages"), ROOTS, now).effective,
    ).toBe("ask");
    const usedUp = { ...grant, usesLeft: 0 };
    expect(
      decide(policy({ grants: [usedUp] }), request("external_messages"), ROOTS, now).effective,
    ).toBe("ask");
    const denied = policy({
      levels: { ...DEFAULT_PERMISSION_LEVELS, external_messages: "deny" },
      grants: [grant],
    });
    expect(decide(denied, request("external_messages"), ROOTS, now).effective).toBe("deny");
  });

  it("classifies commands, Claude tools and ACP tool kinds", () => {
    expect(classifyCommand("git status")).toBe("file_read");
    expect(classifyCommand("ls -la | sh")).toBe("shell");
    expect(classifyCommand("rm -rf build")).toBe("file_delete");
    expect(classifyCommand("npm install")).toBe("shell");
    expect(classifyClaudeTool("Write", { file_path: "/x/a.md" })).toMatchObject({
      category: "file_create",
      paths: ["/x/a.md"],
    });
    expect(classifyClaudeTool("Bash", { command: "rm a" }).category).toBe("file_delete");
    expect(classifyClaudeTool("WebSearch", { query: "GST rates" }).category).toBe("research");
    expect(classifyClaudeTool("SomethingNew", {}).category).toBe("shell");
    expect(classifyAcpTool("edit", "Edit a.txt", ["/a.txt"], null)).toBe("file_modify");
    expect(classifyAcpTool("execute", "Run", [], { command: "cat a" })).toBe("file_read");
    expect(classifyAcpTool("fetch", "Fetch", [], null)).toBe("research");
  });

  it("escalates risky browser actions in English, Hindi and Bengali", () => {
    expect(classifyBrowserAction("click", "Pay now", "https://shop.in", false)).toBe("payments");
    expect(classifyBrowserAction("click", "भुगतान करें", "", false)).toBe("payments");
    expect(classifyBrowserAction("click", "পোস্ট করুন", "", false)).toBe("publication");
    expect(classifyBrowserAction("click", "Send message", "", false)).toBe("external_messages");
    expect(classifyBrowserAction("click", "Next page", "", false)).toBe("browser_interaction");
    expect(classifyBrowserAction("type", "Search", "", false)).toBe("browser_interaction");
    expect(classifyBrowserAction("type", "PAN", "https://www.incometax.gov.in/x", true)).toBe(
      "official_forms",
    );
    expect(classifyBrowserAction("scroll", "", "", false)).toBe("browser_navigation");
  });

  it("redacts secrets and card numbers", () => {
    expect(redact("curl -H 'Authorization: Bearer abc.def' api_key=xyz 4111111111111111")).toBe(
      "curl -H 'Authorization: [redacted]' [redacted] [redacted]",
    );
    expect(redact("x".repeat(300)).length).toBe(241);
  });
});

describe.sequential("PermissionService", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-permissions-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists levels, rejects unsafe levels and consumes limited grants", async () => {
    const service = new PermissionService(root);
    await service.initialize();
    await expect(service.setLevel("payments", "auto")).rejects.toThrow("not allowed");
    await service.setLevel("shell", "deny");
    await service.addGrant({
      category: "publication",
      botId: null,
      hours: 1,
      maxUses: 1,
      note: "Post the Diwali offer",
    });
    const reloaded = new PermissionService(root);
    await reloaded.initialize();
    expect(reloaded.get().levels.shell).toBe("deny");
    expect(reloaded.get().grants).toHaveLength(1);

    const first = await reloaded.authorize(
      { botId: "kavya", provider: "claude", category: "publication", action: "post", paths: [] },
      ROOTS,
    );
    expect(first.allowed).toBe(true);
    expect(reloaded.get().grants).toHaveLength(0);
    // No asker is attached, so a second publication is refused rather than silently allowed.
    const second = await reloaded.authorize(
      { botId: "kavya", provider: "claude", category: "publication", action: "post", paths: [] },
      ROOTS,
    );
    expect(second.allowed).toBe(false);
    expect(reloaded.audit().map((entry) => entry.decision)).toEqual(["denied", "allowed"]);
  });

  it("asks the owner, records the outcome and never logs secrets", async () => {
    const service = new PermissionService(root);
    await service.initialize();
    const asked: string[] = [];
    service.setAsker(async (pending) => {
      asked.push(pending.action);
      return "approved";
    });
    const result = await service.authorize(
      {
        botId: "asha",
        provider: "codex",
        category: "shell",
        action: "deploy --token=supersecret123",
        paths: [],
      },
      ROOTS,
    );
    expect(result.allowed).toBe(true);
    expect(asked[0]).not.toContain("supersecret123");
    const file = await readFile(join(root, "permission-audit.json"), "utf8");
    expect(file).not.toContain("supersecret123");
    expect(service.audit()[0]).toMatchObject({ decision: "approved", category: "shell" });
    // Plain automatic reads are not written to the audit log.
    await service.authorize(
      { botId: "asha", provider: "codex", category: "file_read", action: "cat", paths: [] },
      ROOTS,
    );
    expect(service.audit()).toHaveLength(1);
    await service.clearAudit();
    expect(service.audit()).toHaveLength(0);
  });

  it("falls back to safe defaults when the stored file has unknown values", async () => {
    await writeFile(
      join(root, "permissions.json"),
      JSON.stringify({ version: 1, levels: { payments: "auto", shell: "bogus" }, grants: [] }),
    );
    const service = new PermissionService(root);
    await service.initialize();
    expect(service.get().levels.payments).toBe("ask");
    expect(service.get().levels.shell).toBe("ask");
  });
});
