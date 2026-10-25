import type { ApprovalRequest } from "../../shared/ipc";
import type { ApprovalStore } from "../approval-store";
import type { ComposioClient } from "./composio-client";
import {
  classifyActionCategory,
  isActionSensitive,
  redactSecrets,
  scrubValue,
} from "./composio-policy";
import type { ComposioExecuteResult } from "./types";

export { classifyActionCategory, isActionSensitive, redactSecrets } from "./composio-policy";

const ACTION_MARK = "composio-action:";
const APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ARGS_CHARS = 6_000;

export interface ComposioSecurityGuardOptions {
  /** The coworker's display name for the approval card; the id is used when unknown. */
  nameFor?: (botId: string) => string | undefined;
  /** Fired after an approval is filed, so the UI can refresh its list. */
  onApprovalCreated?: (approval: ApprovalRequest) => void;
  now?: () => number;
}

/**
 * Stands between coworkers and Composio. Read-only tools run at once. Anything that sends,
 * creates, changes or deletes files an approval and stops; once the owner approves, the
 * coworker calls the same tool again with that approval id and it runs exactly once. Every
 * output is scrubbed of tokens before it reaches the conversation.
 */
export class ComposioSecurityGuard {
  readonly #client: ComposioClient;
  readonly #approvals: ApprovalStore | null;
  readonly #options: ComposioSecurityGuardOptions;
  readonly #used = new Set<string>();

  constructor(
    client: ComposioClient,
    approvals: ApprovalStore | null = null,
    options: ComposioSecurityGuardOptions = {},
  ) {
    this.#client = client;
    this.#approvals = approvals;
    this.#options = options;
  }

  async executeWithSafetyCheck(
    actionName: string,
    args: Record<string, unknown>,
    botId: string,
  ): Promise<ComposioExecuteResult> {
    const slug = actionName.toUpperCase().replace(/-/g, "_");
    const { approval_id: rawTicket, ...toolArgs } = args;
    if (isActionSensitive(slug) && this.#approvals) {
      const ticket = typeof rawTicket === "string" ? rawTicket.trim() : "";
      if (!ticket) return this.#pause(slug, toolArgs, botId);
      const problem = this.#approvalProblem(ticket, slug, botId);
      if (problem) {
        return { success: false, requiresApproval: true, approvalId: ticket, error: problem };
      }
      this.#used.add(ticket);
    }
    const result = await this.#client.executeAction(slug, toolArgs);
    if (result.data !== undefined) result.data = scrubValue(result.data);
    if (result.error) result.error = redactSecrets(result.error);
    return result;
  }

  async #pause(
    slug: string,
    args: Record<string, unknown>,
    botId: string,
  ): Promise<ComposioExecuteResult> {
    if (!this.#approvals) throw new Error("Approvals are unavailable.");
    const { toolkit, name } = this.#client.describeAction(slug);
    const who = this.#options.nameFor?.(botId) ?? "A coworker";
    const action = name.charAt(0).toLowerCase() + name.slice(1);
    let argsText = "{}";
    try {
      argsText = clip(redactSecrets(JSON.stringify(args, null, 2)), MAX_ARGS_CHARS);
    } catch {
      argsText = "(could not show the details)";
    }
    const approval = await this.#approvals.create({
      botId,
      title: `${who} wants to ${action} on ${toolkit}`,
      category: classifyActionCategory(slug),
      details: [
        `${who} wants to run "${name}" on ${toolkit} through Composio.`,
        "",
        "With these details:",
        argsText,
        "",
        `${ACTION_MARK} ${slug}`,
      ].join("\n"),
      amount: null,
    });
    this.#options.onApprovalCreated?.(approval);
    return {
      success: false,
      requiresApproval: true,
      approvalId: approval.id,
      error: `Paused: "${name}" on ${toolkit} needs the owner's approval (approval id ${approval.id}). Tell the owner in one or two lines what you want to do, then end your turn. When the owner approves you will get a message; then call this tool again with the same arguments plus approval_id "${approval.id}". Do not retry before that.`,
    };
  }

  #approvalProblem(ticket: string, slug: string, botId: string): string | null {
    const approval = this.#approvals?.list().find((candidate) => candidate.id === ticket);
    if (!approval) {
      return `No approval with id ${ticket} exists. Call the tool again without approval_id to ask for one.`;
    }
    if (approval.botId !== botId) return `Approval ${ticket} belongs to another coworker.`;
    if (!approval.details.includes(`${ACTION_MARK} ${slug}`)) {
      return `Approval ${ticket} was for a different action, not ${slug}.`;
    }
    if (approval.status === "pending") {
      return `Approval ${ticket} is still waiting for the owner. Do not retry until you are told it was approved.`;
    }
    if (approval.status !== "approved") {
      return `The owner rejected approval ${ticket}. Do not perform this action.`;
    }
    if (this.#used.has(ticket)) {
      return `Approval ${ticket} was already used once. Ask for a new approval if this must happen again.`;
    }
    const decidedAt = approval.decidedAt ? Date.parse(approval.decidedAt) : Number.NaN;
    const now = this.#options.now?.() ?? Date.now();
    if (Number.isFinite(decidedAt) && now - decidedAt > APPROVAL_MAX_AGE_MS) {
      return `Approval ${ticket} is older than a day. Ask for a fresh approval.`;
    }
    return null;
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
