import type { ApprovalCategory, ApprovalRequest } from "../../shared/ipc";
import type { ApprovalStore } from "../approval-store";
import type { ComposioClient } from "./composio-client";
import type { ComposioExecuteResult } from "./types";

const SENSITIVE_ACTION_PATTERN =
  /(send|post|create|delete|remove|merge|update|patch|drop|cancel|write|comment|publish|invite)/i;

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /xox[baprs]-[0-9a-zA-Z]{10,}/g,
  /gh[pousr]-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /"(access_token|refresh_token|api_key|secret)":\s*"[^"]+"/gi,
];

export function isActionSensitive(actionName: string): boolean {
  return SENSITIVE_ACTION_PATTERN.test(actionName);
}

export function classifyActionCategory(actionName: string): ApprovalCategory {
  const lower = actionName.toLowerCase();
  if (lower.includes("payment") || lower.includes("stripe") || lower.includes("charge")) {
    return "payment";
  }
  if (lower.includes("send") || lower.includes("post") || lower.includes("mail") || lower.includes("message")) {
    return "message";
  }
  if (lower.includes("publish") || lower.includes("tweet") || lower.includes("release") || lower.includes("pr")) {
    return "other";
  }
  if (lower.includes("delete") || lower.includes("drop") || lower.includes("remove")) {
    return "data";
  }
  return "other";
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

export class ComposioSecurityGuard {
  readonly #client: ComposioClient;
  readonly #approvals: ApprovalStore | null;

  constructor(client: ComposioClient, approvals: ApprovalStore | null = null) {
    this.#client = client;
    this.#approvals = approvals;
  }

  async executeWithSafetyCheck(
    actionName: string,
    args: Record<string, unknown>,
    botId: string,
  ): Promise<ComposioExecuteResult> {
    const isSensitive = isActionSensitive(actionName);

    if (isSensitive && this.#approvals) {
      const category = classifyActionCategory(actionName);
      const title = `Approve Action: ${actionName.replace(/_/g, " ")}`;
      const details = `Coworker requested external action on ${actionName} with parameters:\n${JSON.stringify(args, null, 2)}`;

      const request: ApprovalRequest = await this.#approvals.create({
        botId,
        title,
        category,
        details,
        amount: null,
      });

      return {
        success: false,
        requiresApproval: true,
        approvalId: request.id,
        error: `Action "${actionName}" is sensitive and requires owner approval (Approval ID: ${request.id}). Tell the owner what you are attempting to do and wait for their decision.`,
      };
    }

    const result = await this.#client.executeAction(actionName, args, `sahkarmi_${botId}`);
    if (result.data) {
      const serialized = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      result.data = JSON.parse(redactSecrets(serialized));
    }
    if (result.error) {
      result.error = redactSecrets(result.error);
    }

    return result;
  }
}
