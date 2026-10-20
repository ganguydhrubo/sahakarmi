import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  APPROVAL_CATEGORIES,
  type ApprovalCategory,
  type ApprovalRequest,
  type DecideApprovalInput,
  type PermissionCategory,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface ApprovalState {
  version: 1;
  approvals: ApprovalRequest[];
}

export interface CreateApprovalInput {
  botId: string;
  title: string;
  details: string;
  category: ApprovalCategory;
  amount?: string | null;
  kind?: "action" | "permission";
  permissionCategory?: PermissionCategory;
}

const MAX_KEPT_DECIDED = 200;

/**
 * Human-in-the-loop approvals. A coworker files a request and ends its turn; the decision is
 * delivered back to it as a queued message, so nothing blocks while the owner is away.
 */
export class ApprovalStore {
  readonly #file: JsonFile<ApprovalState>;
  #state: ApprovalState = { version: 1, approvals: [] };

  constructor(userDataPath: string) {
    this.#file = new JsonFile(join(userDataPath, "approvals.json"));
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(() => ({ version: 1, approvals: [] }), isApprovalState);
    // A paused tool call cannot survive a restart: close those requests honestly.
    let changed = false;
    for (const approval of this.#state.approvals) {
      if (approval.kind === "permission" && approval.status === "pending") {
        approval.status = "rejected";
        approval.decidedAt = new Date().toISOString();
        approval.note = "Expired: Sahkarmi restarted before a decision, so the action did not run.";
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  list(): ApprovalRequest[] {
    return this.#state.approvals.map((approval) => ({ ...approval }));
  }

  pendingCount(botId?: string): number {
    return this.#state.approvals.filter(
      (approval) => approval.status === "pending" && (!botId || approval.botId === botId),
    ).length;
  }

  async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
    const title = input.title.trim().slice(0, 200);
    if (!title) throw new Error("An approval needs a short title.");
    if (!APPROVAL_CATEGORIES.includes(input.category))
      throw new Error("Unknown approval category.");
    const approval: ApprovalRequest = {
      id: randomUUID(),
      botId: input.botId,
      title,
      details: input.details.trim().slice(0, 8_000),
      category: input.category,
      amount: input.amount?.trim().slice(0, 60) || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      note: null,
      ...(input.kind === "permission"
        ? { kind: "permission" as const, permissionCategory: input.permissionCategory }
        : {}),
    };
    this.#state.approvals.unshift(approval);
    await this.#persist();
    return { ...approval };
  }

  async decide(input: DecideApprovalInput): Promise<ApprovalRequest> {
    const approval = this.#state.approvals.find((candidate) => candidate.id === input.approvalId);
    if (!approval) throw new Error("This approval no longer exists.");
    if (approval.status !== "pending") throw new Error("This approval was already decided.");
    approval.status = input.decision;
    approval.decidedAt = new Date().toISOString();
    approval.note = input.note?.trim().slice(0, 2_000) || null;
    await this.#persist();
    return { ...approval };
  }

  async deleteBotData(botId: string): Promise<void> {
    this.#state.approvals = this.#state.approvals.filter((approval) => approval.botId !== botId);
    await this.#persist();
  }

  async #persist(): Promise<void> {
    const pending = this.#state.approvals.filter((approval) => approval.status === "pending");
    const decided = this.#state.approvals
      .filter((approval) => approval.status !== "pending")
      .slice(0, MAX_KEPT_DECIDED);
    this.#state.approvals = [...pending, ...decided].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    await this.#file.write(this.#state);
  }
}

function isApprovalState(value: unknown): value is ApprovalState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.approvals) &&
    value.approvals.every(
      (approval) =>
        isRecord(approval) &&
        typeof approval.id === "string" &&
        typeof approval.botId === "string" &&
        typeof approval.title === "string" &&
        typeof approval.details === "string" &&
        APPROVAL_CATEGORIES.includes(approval.category as ApprovalCategory) &&
        (approval.status === "pending" ||
          approval.status === "approved" ||
          approval.status === "rejected"),
    )
  );
}
