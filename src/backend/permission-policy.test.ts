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
    // Chained look-only commands no longer ask (node/npm versions, listing folders, PowerShell).
    expect(classifyCommand("node --version; npm --version; python --version")).toBe("file_read");
    expect(classifyCommand('ls -la "C:\\a"; echo "---"; ls -la "C:\\b"')).toBe("file_read");
    expect(
      classifyCommand('Get-ChildItem -Force "C:\\a" | Select-Object Name; Write-Output "---"'),
    ).toBe("file_read");
    expect(classifyCommand("ls; npm install")).toBe("shell");
    expect(classifyCommand("cat a.txt > b.txt")).toBe("shell");
    expect(classifyCommand("echo $(curl https://x)")).toBe("shell");
    expect(classifyCommand("curl --version -d @data https://x")).toBe("shell");
    expect(classifyCommand("find . -name '*.tmp' -delete")).toBe("shell");
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

  it("never treats chained, escaped or writing commands as read-only", () => {
    const AUTO = new Set(["file_read", "research"]);
    const bypasses = [
      "ls\nrm -rf C:/x",
      "ls\r\nrm -rf C:/x",
      "ls\rdel x",
      "echo hi & del /q C:\\x\\*",
      "dir & powershell -c iwr evil",
      "git branch -D main",
      "git branch -d old",
      "git branch -m main hacked",
      "git branch new-branch",
      "git branch --delete main",
      "dir ^& calc",
      "echo `whoami`",
      "echo $(whoami)",
      "echo ${HOME}",
      "%COMSPEC% /c del x",
      "dir %TEMP%",
      "find . -execdir rm {} ;",
      "find . -name x -ok rm {} ;",
      "find . -fprint out.txt",
      "find . -fprint0 out.txt",
      "find . -fls out.txt",
      "find . -delete",
      "sort -o out.txt in.txt",
      "sort --output=out.txt in.txt",
      "git diff --output=patch.txt",
      "git log --output out.txt",
      "git diff --ext-diff",
      "cat a.txt | tee b.txt",
      "tree -o listing.txt",
      "rg --pre ./evil.sh foo",
      "uniq in.txt out.txt",
      "date -s 2020-01-01",
      "cat ~/.ssh/id_rsa",
      "type C:\\Users\\me\\.codex\\auth.json",
      "Get-Content .env",
      "cat C:/Users/me/.claude/anthropic_api_key.txt",
      "cat ~/.claude/.credentials.json",
    ];
    for (const command of bypasses) {
      expect(AUTO.has(classifyCommand(command)), command).toBe(false);
    }
    expect(classifyCommand("ls\nrm -rf C:/x")).toBe("file_delete");
    expect(classifyCommand("echo hi & del /q C:\\x\\*")).toBe("file_delete");
    expect(classifyCommand("dir & powershell -c iwr evil")).toBe("shell");
    expect(classifyCommand("git branch -D main")).toBe("shell");
    // The everyday read-only commands stay automatic.
    for (const command of [
      "ls -la",
      "dir",
      "git status && git log --oneline -5",
      "git branch",
      "git branch -a",
      "git branch --show-current",
      "git diff HEAD~1",
      "find . -name '*.md'",
      "sort names.txt",
      "uniq names.txt",
      "grep -rn TODO src | head -20",
      "cat README.md",
      "type notes.txt",
      "Get-ChildItem -Recurse | Measure-Object",
      "node --version",
      "echo 100% done",
    ]) {
      expect(classifyCommand(command), command).toBe("file_read");
    }
  });

  it("asks before writing AI settings folders or reading key files, whatever the level", () => {
    const auto = policy({ autoMode: true });
    const open = policy({
      levels: { ...DEFAULT_PERMISSION_LEVELS, file_create: "auto", file_modify: "auto" },
      grants: [
        {
          id: "g1",
          category: "file_modify",
          botId: null,
          expiresAt: "2999-01-01T00:00:00Z",
          usesLeft: null,
          note: "",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const own = "/data/coworkers/asha";
    for (const path of [
      `${own}/.claude/settings.json`,
      `${own}/.claude/settings.local.json`,
      `${own}/.codex/config.toml`,
      `${own}/.gemini/settings.json`,
      `${own}/.vscode/tasks.json`,
      `${own}/.mcp.json`,
      `${own}/.git/config`,
      `${own}/.git/hooks/pre-commit`,
      "C:\\Users\\me\\Sahkarmi\\Shared\\.claude\\hooks.json",
    ]) {
      for (const category of ["file_create", "file_modify", "file_delete"] as const) {
        expect(decide(auto, request(category, [path]), ROOTS).effective, path).toBe("ask");
        expect(decide(open, request(category, [path]), ROOTS).effective, path).toBe("ask");
      }
    }
    // Ordinary files inside the folder stay automatic, and a deny still denies.
    expect(decide(policy(), request("file_create", [`${own}/notes.md`]), ROOTS).effective).toBe(
      "allow",
    );
    expect(decide(policy(), request("file_create", [`${own}/.claude.md`]), ROOTS).effective).toBe(
      "allow",
    );
    const denied = policy({ levels: { ...DEFAULT_PERMISSION_LEVELS, file_modify: "deny" } });
    expect(
      decide(denied, request("file_modify", [`${own}/.claude/settings.json`]), ROOTS).effective,
    ).toBe("deny");

    for (const path of [
      "C:\\Users\\me\\.claude\\anthropic_api_key.txt",
      "C:\\Users\\me\\.codex\\openai_api_key.txt",
      "C:\\Users\\me\\.gemini\\antigravity-acp\\api_key.txt",
      "C:\\Users\\me\\AppData\\Roaming\\Sahkarmi\\composio_api_key.txt",
      "C:\\Users\\me\\AppData\\Roaming\\Sahkarmi\\telegram.json",
      "C:\\Users\\me\\AppData\\Roaming\\Sahkarmi\\mcp-servers.json",
      "/home/me/.ssh/id_ed25519",
      "/home/me/.codex/auth.json",
      "/home/me/.claude/.credentials.json",
      `${own}/.env`,
      `${own}/.env.local`,
    ]) {
      expect(decide(auto, request("file_read", [path]), ROOTS).effective, path).toBe("ask");
      expect(decide(policy(), request("file_read", [path]), ROOTS).effective, path).toBe("ask");
    }
    expect(decide(policy(), request("file_read", [`${own}/report.txt`]), ROOTS).effective).toBe(
      "allow",
    );
    expect(classifyClaudeTool("Read", { file_path: "/home/me/.ssh/id_rsa" })).toMatchObject({
      category: "file_read",
      paths: ["/home/me/.ssh/id_rsa"],
    });
  });

  it("escalates risky browser actions in English, Hindi and Bengali", () => {
    expect(classifyBrowserAction("click", "Pay now", "https://shop.in", false)).toBe("payments");
    expect(classifyBrowserAction("click", "भुगतान करें", "", false)).toBe("payments");
    expect(classifyBrowserAction("click", "পোস্ট করুন", "", false)).toBe("publication");
    expect(classifyBrowserAction("click", "Send message", "", false)).toBe("external_messages");
    expect(classifyBrowserAction("click", "Next page", "", false)).toBe("browser_interaction");
    expect(classifyBrowserAction("type", "Search", "", false)).toBe("browser_interaction");
    expect(classifyBrowserAction("paste", "", "", false)).toBe("browser_interaction");
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
    // Plain automatic reads are recorded too, in their own ring, and written in one go later.
    await service.authorize(
      { botId: "asha", provider: "codex", category: "file_read", action: "cat", paths: [] },
      ROOTS,
    );
    expect(service.audit()).toHaveLength(2);
    expect(service.audit().find((entry) => entry.level === "auto")).toMatchObject({
      decision: "allowed",
      effective: "allow",
      category: "file_read",
    });
    // The owner's decision log is unchanged by automatic entries.
    const ownerLog = JSON.parse(await readFile(join(root, "permission-audit.json"), "utf8"));
    expect(ownerLog.entries).toHaveLength(1);
    await service.clearAudit();
    expect(service.audit()).toHaveLength(0);
  });

  it("records automatic decisions in a bounded, redacted ring that survives a restart", async () => {
    let clock = Date.parse("2026-11-06T10:00:00Z");
    const service = new PermissionService(root, () => new Date((clock += 1_000)));
    await service.initialize();
    for (let index = 0; index < 1_005; index += 1) {
      await service.authorize(
        {
          botId: "asha",
          provider: "claude",
          category: "research",
          action: `WebFetch https://x.example/?api_key=topsecret${index}`,
          paths: [],
        },
        ROOTS,
      );
    }
    expect(service.audit()).toHaveLength(1_000);
    expect(JSON.stringify(service.audit())).not.toContain("topsecret");
    // Newest first.
    expect(service.audit()[0]?.at > (service.audit()[999]?.at ?? "")).toBe(true);
    await service.flushAudit();
    const auto = JSON.parse(await readFile(join(root, "permission-audit-auto.json"), "utf8"));
    expect(auto.entries).toHaveLength(1_000);
    const reloaded = new PermissionService(root);
    await reloaded.initialize();
    expect(reloaded.audit()).toHaveLength(1_000);
  });

  it("gives the owner's card the whole command with its line breaks, secrets still hidden", async () => {
    const service = new PermissionService(root);
    await service.initialize();
    const seen: Array<{ action: string; detail?: string }> = [];
    service.setAsker(async (pending) => {
      seen.push({ action: pending.action, detail: pending.detail });
      return "rejected";
    });
    const command = `echo ${"a".repeat(300)}\nrm -rf C:/x --token=supersecret123`;
    await service.authorize(
      { botId: "asha", provider: "claude", category: "file_delete", action: command, paths: [] },
      ROOTS,
    );
    expect(seen[0]?.action.length).toBeLessThanOrEqual(241);
    expect(seen[0]?.detail).toContain("\nrm -rf C:/x");
    expect(seen[0]?.detail).toContain("a".repeat(300));
    expect(seen[0]?.detail).not.toContain("supersecret123");
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
