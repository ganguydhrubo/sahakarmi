import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposioClient } from "./composio-client";
import { ComposioSecurityGuard, isActionSensitive, redactSecrets } from "./composio-security";

describe("ComposioClient & ComposioSecurityGuard", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "composio-test-"));
    delete process.env.COMPOSIO_API_KEY;
  });

  afterEach(async () => {
    delete process.env.COMPOSIO_API_KEY;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("initializes as unconfigured when no key is set", async () => {
    const client = new ComposioClient({ userDataPath: tempDir });
    const status = await client.getStatus();
    expect(status.configured).toBe(false);
    expect(status.apiKeyMasked).toBeNull();
    expect(status.monthlyQuota).toBe(100_000);
    expect(status.freeTierActive).toBe(true);
  });

  it("stores and retrieves the API key with masking", async () => {
    const client = new ComposioClient({ userDataPath: tempDir });
    const status = await client.setApiKey("comp_live_secret1234567890abcdef");
    expect(status.configured).toBe(true);
    expect(status.apiKeyMasked).toBe("comp...cdef");

    const reloaded = new ComposioClient({ userDataPath: tempDir });
    const key = await reloaded.getApiKey();
    expect(key).toBe("comp_live_secret1234567890abcdef");
  });

  it("lists curated SaaS applications with metadata", async () => {
    const client = new ComposioClient({ userDataPath: tempDir });
    const apps = await client.listApps();
    expect(apps.length).toBeGreaterThanOrEqual(6);

    const github = apps.find((a) => a.id === "github");
    expect(github).toBeDefined();
    expect(github?.name).toBe("GitHub");
    expect(github?.category).toBe("developer");
    expect(github?.popularActions.length).toBeGreaterThan(0);

    const slack = apps.find((a) => a.id === "slack");
    expect(slack).toBeDefined();
    expect(slack?.category).toBe("communication");
  });

  it("identifies sensitive vs read-only actions correctly", () => {
    expect(isActionSensitive("GITHUB_CREATE_A_PULL_REQUEST")).toBe(true);
    expect(isActionSensitive("SLACK_CHAT_POST_MESSAGE")).toBe(true);
    expect(isActionSensitive("GMAIL_SEND_EMAIL")).toBe(true);
    expect(isActionSensitive("GOOGLECALENDAR_DELETE_EVENT")).toBe(true);

    expect(isActionSensitive("GITHUB_GET_AN_ISSUE")).toBe(false);
    expect(isActionSensitive("GOOGLECALENDAR_LIST_EVENTS")).toBe(false);
    expect(isActionSensitive("NOTION_SEARCH_NOTION_PAGE")).toBe(false);
  });

  it("redacts sensitive tokens and keys from outputs", () => {
    const sample = "Error at Bearer sk-12345678901234567890123456 with xoxb-1234567890-abcdef";
    const cleaned = redactSecrets(sample);
    expect(cleaned).not.toContain("sk-12345678901234567890123456");
    expect(cleaned).not.toContain("xoxb-1234567890-abcdef");
    expect(cleaned).toContain("[REDACTED_SECRET]");
  });

  it("intercepts sensitive actions and creates approval requests", async () => {
    const client = new ComposioClient({ userDataPath: tempDir });
    const mockCreateApproval = vi.fn().mockResolvedValue({ id: "appr-123", status: "pending" });
    const mockApprovalStore = { create: mockCreateApproval } as any;

    const guard = new ComposioSecurityGuard(client, mockApprovalStore);
    const result = await guard.executeWithSafetyCheck(
      "SLACK_CHAT_POST_MESSAGE",
      { channel: "#general", text: "Hello team" },
      "kavya-content",
    );

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe("appr-123");
    expect(mockCreateApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "kavya-content",
        category: "message",
      }),
    );
  });

  it("generates dynamic tools schema for connected applications", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: "ca_1", appName: "github", status: "ACTIVE" },
        ],
      }),
    });

    const client = new ComposioClient({
      userDataPath: tempDir,
      fetchImpl: mockFetch as any,
    });
    await client.setApiKey("test_key_123");

    const tools = await client.getDynamicTools("test_bot");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name.includes("github"))).toBe(true);
    expect(tools[0]).toHaveProperty("inputSchema");
  });
});
