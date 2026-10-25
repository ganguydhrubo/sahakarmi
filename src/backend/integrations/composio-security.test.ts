import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../shared/ipc";
import type { ApprovalStore } from "../approval-store";
import type { ComposioClient } from "./composio-client";
import {
  classifyActionCategory,
  describeTool,
  isActionSensitive,
  redactSecrets,
  scrubValue,
} from "./composio-policy";
import { ComposioSecurityGuard } from "./composio-security";

describe("Composio policy", () => {
  it("lets read-only tools through and pauses everything that changes something", () => {
    for (const slug of [
      "GITHUB_GET_AN_ISSUE",
      "GOOGLECALENDAR_LIST_EVENTS",
      "NOTION_SEARCH_NOTION_PAGE",
      "SLACK_CONVERSATIONS_HISTORY",
      "GITHUB_LIST_OPEN_ISSUES",
      "GMAIL_FETCH_EMAILS",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
      "github_get_a_pull_request",
    ]) {
      expect(isActionSensitive(slug), slug).toBe(false);
    }
    for (const slug of [
      "GITHUB_CREATE_A_PULL_REQUEST",
      "SLACK_CHAT_POST_MESSAGE",
      "GMAIL_SEND_EMAIL",
      "GOOGLECALENDAR_DELETE_EVENT",
      "GMAIL_CREATE_EMAIL_DRAFT",
      "GITHUB_STAR_A_REPOSITORY",
      "GITHUB_GET_AND_DELETE_THING",
      "TWITTER_CREATION_OF_A_POST",
      "NOTION_ADD_PAGE_CONTENT",
      "ZOHO_FROBNICATE_LEDGER",
    ]) {
      expect(isActionSensitive(slug), slug).toBe(true);
    }
  });

  it("files approvals under the category the owner expects", () => {
    expect(classifyActionCategory("GMAIL_SEND_EMAIL")).toBe("message");
    expect(classifyActionCategory("SLACK_CHAT_POST_MESSAGE")).toBe("message");
    expect(classifyActionCategory("STRIPE_CREATE_CHARGE")).toBe("payment");
    expect(classifyActionCategory("RAZORPAY_CREATE_ORDER")).toBe("payment");
    expect(classifyActionCategory("GITHUB_DELETE_A_REPOSITORY")).toBe("data");
    expect(classifyActionCategory("GITHUB_MERGE_A_PULL_REQUEST")).toBe("submission");
    expect(classifyActionCategory("NOTION_UPDATE_PAGE")).toBe("other");
  });

  it("describes tools in plain words", () => {
    expect(describeTool("GMAIL_SEND_EMAIL", "gmail")).toBe("Send email");
    expect(describeTool("GOOGLE_MAPS_GET_DIRECTIONS", "google_maps")).toBe("Get directions");
    expect(describeTool("GITHUB_CREATE_AN_ISSUE")).toBe("Github create an issue");
  });

  it("redacts tokens and keeps JSON valid", () => {
    const sample = "Error at Bearer sk-12345678901234567890123456 with xoxb-1234567890-abcdef";
    const cleaned = redactSecrets(sample);
    expect(cleaned).not.toContain("sk-12345678901234567890123456");
    expect(cleaned).not.toContain("xoxb-1234567890-abcdef");
    expect(cleaned).toContain("[REDACTED_SECRET]");
    expect(redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(
      "token [REDACTED_SECRET]",
    );

    const payload = {
      ok: true,
      access_token: "ya29.a0AfH6SMBverylongtokenvalue1234567890",
      note: "fine",
    };
    const scrubbed = scrubValue(payload) as Record<string, unknown>;
    expect(scrubbed.ok).toBe(true);
    expect(scrubbed.note).toBe("fine");
    expect(scrubbed.access_token).toBe("[REDACTED_SECRET]");
    expect(scrubValue("plain text with sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ inside")).toBe(
      "plain text with [REDACTED_SECRET] inside",
    );
    expect(scrubValue({ untouched: 1 })).toEqual({ untouched: 1 });
  });
});

function approval(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: "appr-1",
    botId: "kavya-content",
    title: "t",
    details: "composio-action: GMAIL_SEND_EMAIL",
    category: "message",
    amount: null,
    status: "approved",
    createdAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    note: null,
    ...overrides,
  };
}

function harness(approvals: ApprovalRequest[] = []) {
  const created: ApprovalRequest[] = [];
  const store = {
    list: () => [...approvals, ...created],
    create: vi.fn(
      async (input: { botId: string; title: string; details: string; category: string }) => {
        const record = approval({
          id: `appr-${created.length + 1}`,
          botId: input.botId,
          title: input.title,
          details: input.details,
          category: input.category as ApprovalRequest["category"],
          status: "pending",
          decidedAt: null,
        });
        created.push(record);
        return record;
      },
    ),
  } as unknown as ApprovalStore;
  const executeAction = vi.fn(async () => ({
    success: true,
    data: { sent: true, access_token: "ya29.a0AfH6SMBverylongtokenvalue1234567890" },
  }));
  const client = {
    executeAction,
    describeAction: (slug: string) =>
      slug.startsWith("GMAIL")
        ? { toolkit: "Gmail", name: "Send email" }
        : { toolkit: "GitHub", name: "Get an issue" },
  } as unknown as ComposioClient;
  const onApprovalCreated = vi.fn();
  const guard = new ComposioSecurityGuard(client, store, {
    nameFor: (botId) => (botId === "kavya-content" ? "Kavya" : undefined),
    onApprovalCreated,
  });
  return { guard, store, executeAction, created, onApprovalCreated };
}

describe("ComposioSecurityGuard", () => {
  it("runs read-only tools at once and scrubs their output", async () => {
    const { guard, executeAction } = harness();
    const result = await guard.executeWithSafetyCheck(
      "github_get_an_issue",
      { owner: "a" },
      "kavya-content",
    );
    expect(result.success).toBe(true);
    expect(executeAction).toHaveBeenCalledWith("GITHUB_GET_AN_ISSUE", { owner: "a" });
    expect((result.data as Record<string, unknown>).access_token).toBe("[REDACTED_SECRET]");
  });

  it("files a plain-English approval for a sending tool and does not run it", async () => {
    const { guard, store, executeAction, created, onApprovalCreated } = harness();
    const result = await guard.executeWithSafetyCheck(
      "GMAIL_SEND_EMAIL",
      { to: "x@example.com", body: "hi" },
      "kavya-content",
    );
    expect(executeAction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe("appr-1");
    expect(result.error).toMatch(/approval_id "appr-1"/);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "kavya-content",
        category: "message",
        title: "Kavya wants to send email on Gmail",
      }),
    );
    expect(created[0].details).toContain('"to": "x@example.com"');
    expect(created[0].details).toContain("composio-action: GMAIL_SEND_EMAIL");
    expect(onApprovalCreated).toHaveBeenCalledTimes(1);
  });

  it("runs an approved action exactly once, without the approval id in the arguments", async () => {
    const { guard, executeAction } = harness([approval({ id: "ok-1" })]);
    const first = await guard.executeWithSafetyCheck(
      "GMAIL_SEND_EMAIL",
      { to: "x", approval_id: "ok-1" },
      "kavya-content",
    );
    expect(first.success).toBe(true);
    expect(executeAction).toHaveBeenCalledWith("GMAIL_SEND_EMAIL", { to: "x" });

    const again = await guard.executeWithSafetyCheck(
      "GMAIL_SEND_EMAIL",
      { to: "x", approval_id: "ok-1" },
      "kavya-content",
    );
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already used/);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("refuses approvals that are pending, rejected, someone else's, for another action, stale or unknown", async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { guard, executeAction } = harness([
      approval({ id: "pending", status: "pending", decidedAt: null }),
      approval({ id: "rejected", status: "rejected" }),
      approval({ id: "theirs", botId: "someone-else" }),
      approval({ id: "other-action", details: "composio-action: GMAIL_CREATE_EMAIL_DRAFT" }),
      approval({ id: "stale", decidedAt: old }),
    ]);
    const attempt = (id: string) =>
      guard.executeWithSafetyCheck("GMAIL_SEND_EMAIL", { approval_id: id }, "kavya-content");
    expect((await attempt("pending")).error).toMatch(/still waiting/);
    expect((await attempt("rejected")).error).toMatch(/rejected/);
    expect((await attempt("theirs")).error).toMatch(/another coworker/);
    expect((await attempt("other-action")).error).toMatch(/different action/);
    expect((await attempt("stale")).error).toMatch(/older than a day/);
    expect((await attempt("missing")).error).toMatch(/No approval/);
    expect(executeAction).not.toHaveBeenCalled();
  });
});
