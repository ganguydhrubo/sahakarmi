import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  APPROVAL_CATEGORIES,
  type ApprovalAuthorityGrant,
  type ApprovalCategory,
  type ApprovalProvenance,
  type ApprovalRequest,
  type ApprovalRiskLevel,
  type DecideApprovalInput,
  type PermissionCategory,
  SENSITIVE_PERMISSION_CATEGORIES,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface ApprovalState {
  version: 1;
  approvals: ApprovalRequest[];
  /** Absent in files written before authority could be delegated. */
  authority?: ApprovalAuthorityGrant[];
}

export interface CreateApprovalInput {
  botId: string;
  title: string;
  details: string;
  category: ApprovalCategory;
  amount?: string | null;
  kind?: "action" | "permission";
  permissionCategory?: PermissionCategory;
  technical?: string;
  workspaceId?: string;
  taskId?: string | null;
  /** Absolute moment the request dies. Callers that park a tool call pass their own timeout. */
  expiresAt?: string | null;
  ownerOnly?: boolean;
  bindsAccount?: ApprovalRequest["bindsAccount"];
  provenance?: ApprovalProvenance;
}

const PROVENANCE_KINDS = new Set<ApprovalProvenance["kind"]>([
  "owner",
  "remote",
  "routine",
  "schedule",
  "team-run",
  "coworker",
  "system",
  "web",
  "app",
  "file",
]);

/** A known kind and a short one-line label, or nothing. */
export function cleanProvenance(value: unknown): ApprovalProvenance | null {
  if (!isRecord(value) || !PROVENANCE_KINDS.has(value.kind as ApprovalProvenance["kind"])) {
    return null;
  }
  const label =
    typeof value.label === "string" ? value.label.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return label
    ? { kind: value.kind as ApprovalProvenance["kind"], label }
    : { kind: value.kind as ApprovalProvenance["kind"] };
}

function provenanceField(value: unknown): { provenance?: ApprovalProvenance } {
  const provenance = cleanProvenance(value);
  return provenance ? { provenance } : {};
}

const MAX_AUTHORITY_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_KEPT_DECIDED = 200;

/**
 * A coworker that asked and ended its turn can wait; the owner may be asleep. Long, but not
 * forever: an approval nobody answered in a week is stale and its context is gone.
 */
const ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Medium by default; the categories that can spend money or reach outsiders are high. */
function riskLevelFor(category: PermissionCategory | undefined): ApprovalRiskLevel {
  if (!category) return "medium";
  if (SENSITIVE_PERMISSION_CATEGORIES.includes(category)) return "high";
  if (category === "shell" || category === "downloads") return "medium";
  if (category === "research" || category === "file_read") return "low";
  return "medium";
}

/** Short, mobile-friendly handle for a request. Collisions are resolved by the caller. */
export function shortApprovalId(id: string): string {
  return id.replaceAll("-", "").slice(0, 8);
}

/**
 * Human-in-the-loop approvals. A coworker files a request and ends its turn; the decision is
 * delivered back to it as a queued message, so nothing blocks while the owner is away.
 */
export class ApprovalStore {
  readonly #file: JsonFile<ApprovalState>;
  #state: ApprovalState = { version: 1, approvals: [] };

  constructor(userDataPath: string) {
    this.#file = new JsonFile(join(userDataPath, "approvals.json"), { recoverCorrupt: true });
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(() => ({ version: 1, approvals: [] }), isApprovalState);
    // A paused tool call cannot survive a restart: close those requests honestly.
    let changed = false;
    for (const approval of this.#state.approvals) {
      if (approval.kind === "permission" && approval.status === "pending") {
        approval.status = "expired";
        approval.decidedAt = new Date().toISOString();
        approval.note = "Expired: Sahkarmi restarted before a decision, so the action did not run.";
        changed = true;
      }
    }
    if (this.#expireOverdue()) changed = true;
    if (changed) await this.#persist();
  }

  list(): ApprovalRequest[] {
    return this.#state.approvals.map((approval) => ({ ...approval }));
  }

  get(approvalId: string): ApprovalRequest | null {
    const found = this.#state.approvals.find((approval) => approval.id === approvalId);
    return found ? { ...found } : null;
  }

  /**
   * Resolves the short handle an owner types in Telegram. An ambiguous prefix is never guessed:
   * approving the wrong request is exactly the mistake this must not make.
   */
  resolve(handle: string): { approval: ApprovalRequest } | { ambiguous: ApprovalRequest[] } | null {
    const wanted = handle.trim().toLowerCase().replaceAll("-", "");
    if (!wanted) return null;
    const exact = this.#state.approvals.find((approval) => approval.id === handle.trim());
    if (exact) return { approval: { ...exact } };
    const matches = this.#state.approvals.filter((approval) =>
      approval.id.replaceAll("-", "").startsWith(wanted),
    );
    if (matches.length === 0) return null;
    if (matches.length > 1) return { ambiguous: matches.map((approval) => ({ ...approval })) };
    return { approval: { ...(matches[0] as ApprovalRequest) } };
  }

  /** Moves pending requests past their expiry to "expired". Returns true if anything changed. */
  async sweepExpired(): Promise<ApprovalRequest[]> {
    const before = new Set(
      this.#state.approvals.filter((a) => a.status === "expired").map((a) => a.id),
    );
    if (!this.#expireOverdue()) return [];
    await this.#persist();
    return this.#state.approvals
      .filter((approval) => approval.status === "expired" && !before.has(approval.id))
      .map((approval) => ({ ...approval }));
  }

  #expireOverdue(now = Date.now()): boolean {
    let changed = false;
    for (const approval of this.#state.approvals) {
      if (approval.status !== "pending" || !approval.expiresAt) continue;
      if (Date.parse(approval.expiresAt) > now) continue;
      approval.status = "expired";
      approval.decidedAt = new Date(now).toISOString();
      approval.note = "Expired: no decision before the deadline, so the action did not run.";
      changed = true;
    }
    return changed;
  }

  /**
   * Closes a request nobody answered in time. Separate from `decide` on purpose: a deadline
   * passing is not the owner refusing, and the audit trail must not pretend it was.
   */
  async expire(approvalId: string, note: string): Promise<ApprovalRequest | null> {
    const approval = this.#state.approvals.find((candidate) => candidate.id === approvalId);
    if (approval?.status !== "pending") return null;
    approval.status = "expired";
    approval.decidedAt = new Date().toISOString();
    approval.note = note;
    await this.#persist();
    return { ...approval };
  }

  /** Records that Telegram did (or could not) carry the request to the owner. */
  async recordDelivery(approvalId: string, error: string | null): Promise<void> {
    const approval = this.#state.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) return;
    approval.notifiedAt = error ? null : new Date().toISOString();
    approval.deliveryError = error;
    await this.#persist();
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
    // Asking again for the same thing while the first is unanswered is not a second request.
    const details = input.details.trim().slice(0, 8_000);
    const repeat = this.#state.approvals.find(
      (candidate) =>
        candidate.status === "pending" &&
        candidate.botId === input.botId &&
        candidate.kind !== "permission" &&
        input.kind !== "permission" &&
        candidate.title === title &&
        candidate.details === details,
    );
    if (repeat) return { ...repeat };
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
      ...(input.technical?.trim() ? { technical: input.technical.trim().slice(0, 4_000) } : {}),
      workspaceId: input.workspaceId,
      taskId: input.taskId ?? null,
      riskLevel: riskLevelFor(input.permissionCategory),
      // A parked tool call carries its own deadline; a coworker that ended its turn gets the
      // long default. Either way every request has one, so nothing waits for ever.
      expiresAt: input.expiresAt ?? new Date(Date.now() + ACTION_TTL_MS).toISOString(),
      decidedBy: null,
      routedToBotId: null,
      ...(input.ownerOnly ? { ownerOnly: true } : {}),
      ...(input.bindsAccount ? { bindsAccount: { ...input.bindsAccount } } : {}),
      ...provenanceField(input.provenance),
      notifiedAt: null,
      deliveryError: null,
    };
    this.#state.approvals.unshift(approval);
    await this.#persist();
    return { ...approval };
  }

  /**
   * The one place a decision is written, for the desktop and for Telegram alike. Expiry is
   * checked here rather than by the caller, so a late remote "approve" can never revive a
   * dead request.
   */
  async decide(input: DecideApprovalInput): Promise<ApprovalRequest> {
    const approval = this.#state.approvals.find((candidate) => candidate.id === input.approvalId);
    if (!approval) throw new Error("This approval no longer exists.");
    if (approval.status === "pending" && this.#expireOverdue()) await this.#persist();
    if (approval.status === "expired") {
      throw new Error("This approval expired, so it can no longer be approved or rejected.");
    }
    if (approval.status !== "pending") {
      throw new Error(`This approval was already ${approval.status}.`);
    }
    approval.status = input.decision;
    approval.decidedAt = new Date().toISOString();
    approval.note = input.note?.trim().slice(0, 2_000) || null;
    approval.decidedBy = input.decidedBy?.trim().slice(0, 120) || "desktop";
    await this.#persist();
    return { ...approval };
  }

  async setRouting(approvalId: string, botId: string | null): Promise<void> {
    const approval = this.#state.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) return;
    approval.routedToBotId = botId;
    await this.#persist();
  }

  /** Grants still in force; an expired one simply stops counting. */
  listAuthority(now = Date.now()): ApprovalAuthorityGrant[] {
    return (this.#state.authority ?? [])
      .filter((grant) => Date.parse(grant.expiresAt) > now)
      .map((grant) => ({ ...grant, categories: [...grant.categories] }));
  }

  async addAuthority(
    input: Omit<ApprovalAuthorityGrant, "id" | "createdAt" | "expiresAt"> & { hours: number },
  ): Promise<ApprovalAuthorityGrant> {
    const categories = [...new Set(input.categories)];
    if (categories.length === 0) throw new Error("Choose at least one kind of approval.");
    if (!categories.every((category) => APPROVAL_CATEGORIES.includes(category))) {
      throw new Error("Unknown approval category.");
    }
    if (!Number.isFinite(input.hours) || input.hours <= 0) {
      throw new Error("Authority needs a time limit.");
    }
    const now = Date.now();
    const parent = input.parentGrantId
      ? this.listAuthority(now).find((grant) => grant.id === input.parentGrantId)
      : null;
    if (input.parentGrantId && !parent) throw new Error("That authority has ended.");
    const limit = parent ? Date.parse(parent.expiresAt) : now + MAX_AUTHORITY_MS;
    const grant: ApprovalAuthorityGrant = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      botId: input.botId,
      categories,
      grantedBy: input.grantedBy,
      parentGrantId: input.parentGrantId,
      createdAt: new Date(now).toISOString(),
      // Passed-on authority can never outlast what it came from.
      expiresAt: new Date(Math.min(now + input.hours * 3_600_000, limit)).toISOString(),
    };
    // A new grant to the same coworker from the same source replaces the old one. Whatever was
    // passed on from a replaced grant ends with it, so it can never exceed the new scope.
    const replaced = this.listAuthority(now).filter(
      (other) =>
        other.workspaceId === grant.workspaceId &&
        other.botId === grant.botId &&
        other.parentGrantId === grant.parentGrantId,
    );
    await this.revokeAuthority((other) => replaced.some((old) => old.id === other.id));
    this.#state.authority = [grant, ...this.listAuthority(now)];
    await this.#persist();
    return { ...grant };
  }

  /** Ends the grants that match, and everything that was passed on from them. */
  async revokeAuthority(matches: (grant: ApprovalAuthorityGrant) => boolean): Promise<void> {
    const grants = this.#state.authority ?? [];
    const ended = new Set(grants.filter(matches).map((grant) => grant.id));
    for (let grown = true; grown; ) {
      grown = false;
      for (const grant of grants) {
        if (grant.parentGrantId && ended.has(grant.parentGrantId) && !ended.has(grant.id)) {
          ended.add(grant.id);
          grown = true;
        }
      }
    }
    if (ended.size === 0) return;
    this.#state.authority = grants.filter((grant) => !ended.has(grant.id));
    await this.#persist();
  }

  /** Keeps a moved coworker's requests naming its new workspace; routing starts over. */
  async moveWorkspace(fromWorkspaceId: string, toWorkspaceId: string): Promise<void> {
    for (const approval of this.#state.approvals) {
      if (approval.workspaceId !== fromWorkspaceId) continue;
      approval.workspaceId = toWorkspaceId;
      if (approval.status === "pending") approval.routedToBotId = null;
    }
    await this.#persist();
  }

  async deleteBotData(botId: string): Promise<void> {
    this.#state.approvals = this.#state.approvals.filter((approval) => approval.botId !== botId);
    await this.revokeAuthority((grant) => grant.botId === botId);
    for (const approval of this.#state.approvals) {
      if (approval.routedToBotId === botId) approval.routedToBotId = null;
    }
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
          approval.status === "rejected" ||
          approval.status === "expired"),
    )
  );
}
