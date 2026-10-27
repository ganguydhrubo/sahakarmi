import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type AddPermissionGrantInput,
  PERMISSION_CATEGORIES,
  type PermissionAuditEntry,
  type PermissionCategory,
  type PermissionGrant,
  type PermissionLevel,
  type PermissionPolicyState,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import {
  allowedLevels,
  DEFAULT_PERMISSION_LEVELS,
  decide,
  type PermissionDecision,
  type PermissionRequest,
  redact,
  sanitizeLevels,
} from "./permission-policy";
import { isRecord } from "./protocol";

interface PolicyFileState {
  version: 1;
  levels: Record<string, string>;
  grants: PermissionGrant[];
  autoMode?: boolean;
}

interface AuditFileState {
  version: 1;
  entries: PermissionAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 1_000;
const MAX_GRANT_HOURS = 24 * 7;

/**
 * Asks the owner and resolves with their decision. Implemented by AgentService through the
 * approvals inbox; rejects or resolves false on timeout.
 */
export type PermissionAsker = (
  request: PermissionRequest,
  decision: PermissionDecision,
) => Promise<"approved" | "rejected" | "timed-out" | "deferred">;

/**
 * Said to a coworker whose runtime cannot wait for the owner: the request stays in the inbox and
 * the coworker hears the decision later.
 */
export const DEFERRED_APPROVAL_REASON =
  "Waiting for the owner's approval. Do not retry now: end your turn. You will get a message when the owner decides; if they approve, repeat exactly the same action and it will go through without asking again.";

export interface AuthorizeResult {
  allowed: boolean;
  reason: string;
}

/**
 * The single place every adapter asks "may this coworker do this?". Settings are persisted in
 * permissions.json; every decision that was not plain "allowed automatically" is written to a
 * capped, redacted audit log (permission-audit.json).
 */
export class PermissionService {
  readonly #policyFile: JsonFile<PolicyFileState>;
  readonly #auditFile: JsonFile<AuditFileState>;
  #policy: PermissionPolicyState = {
    levels: { ...DEFAULT_PERMISSION_LEVELS },
    grants: [],
    autoMode: false,
  };
  #audit: PermissionAuditEntry[] = [];
  #asker: PermissionAsker | null = null;
  readonly #now: () => Date;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.#policyFile = new JsonFile(join(userDataPath, "permissions.json"));
    this.#auditFile = new JsonFile(join(userDataPath, "permission-audit.json"));
    this.#now = now;
  }

  async initialize(): Promise<void> {
    const stored = await this.#policyFile.read(
      () => ({ version: 1, levels: { ...DEFAULT_PERMISSION_LEVELS }, grants: [] }),
      isPolicyFileState,
    );
    this.#policy = {
      levels: sanitizeLevels(stored.levels),
      grants: stored.grants.filter((grant) => PERMISSION_CATEGORIES.includes(grant.category)),
      autoMode: stored.autoMode === true,
    };
    this.#pruneGrants();
    const audit = await this.#auditFile.read(() => ({ version: 1, entries: [] }), isAuditFileState);
    this.#audit = audit.entries.slice(0, MAX_AUDIT_ENTRIES);
  }

  setAsker(asker: PermissionAsker): void {
    this.#asker = asker;
  }

  get(): PermissionPolicyState {
    this.#pruneGrants();
    return {
      levels: { ...this.#policy.levels },
      grants: this.#policy.grants.map((grant) => ({ ...grant })),
      autoMode: this.#policy.autoMode,
    };
  }

  async setAutoMode(enabled: boolean): Promise<PermissionPolicyState> {
    this.#policy.autoMode = enabled;
    await this.#persistPolicy();
    return this.get();
  }

  async setLevel(
    category: PermissionCategory,
    level: PermissionLevel,
  ): Promise<PermissionPolicyState> {
    if (!PERMISSION_CATEGORIES.includes(category)) throw new Error("Unknown permission category.");
    if (!allowedLevels(category).includes(level)) {
      throw new Error("This level is not allowed for a sensitive action.");
    }
    this.#policy.levels[category] = level;
    await this.#persistPolicy();
    return this.get();
  }

  async addGrant(input: AddPermissionGrantInput): Promise<PermissionPolicyState> {
    if (!PERMISSION_CATEGORIES.includes(input.category)) {
      throw new Error("Unknown permission category.");
    }
    const hours = Number(input.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_GRANT_HOURS) {
      throw new Error("A pre-authorisation must last between a few minutes and 7 days.");
    }
    const maxUses = input.maxUses === null ? null : Math.floor(Number(input.maxUses));
    if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 1_000)) {
      throw new Error("Uses must be between 1 and 1000.");
    }
    const now = this.#now();
    this.#policy.grants.unshift({
      id: randomUUID(),
      category: input.category,
      botId: input.botId,
      expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
      usesLeft: maxUses,
      note: redact(input.note ?? "", 200),
      createdAt: now.toISOString(),
    });
    await this.#persistPolicy();
    return this.get();
  }

  async revokeGrant(grantId: string): Promise<PermissionPolicyState> {
    this.#policy.grants = this.#policy.grants.filter((grant) => grant.id !== grantId);
    await this.#persistPolicy();
    return this.get();
  }

  audit(): PermissionAuditEntry[] {
    return this.#audit.map((entry) => ({ ...entry }));
  }

  async clearAudit(): Promise<void> {
    this.#audit = [];
    await this.#auditFile.write({ version: 1, entries: [] });
  }

  /** Effective decision without side effects (used by tests and the UI preview). */
  evaluate(request: PermissionRequest, workspaceRoots: string[]): PermissionDecision {
    this.#pruneGrants();
    return decide(this.#policy, request, workspaceRoots, this.#now());
  }

  /**
   * Enforces the policy for one concrete action. Never throws for a denial: callers translate
   * `allowed: false` into the provider's "declined" answer so the coworker sees why.
   */
  async authorize(request: PermissionRequest, workspaceRoots: string[]): Promise<AuthorizeResult> {
    const safeRequest = { ...request, action: redact(request.action) };
    const decision = this.evaluate(safeRequest, workspaceRoots);
    if (decision.effective === "allow") {
      if (decision.grant) {
        await this.#consumeGrant(decision.grant.id);
        await this.#record(safeRequest, decision, "allowed");
      } else if (decision.level !== "auto") {
        await this.#record(safeRequest, decision, "allowed");
      }
      return { allowed: true, reason: decision.reason };
    }
    if (decision.effective === "deny") {
      await this.#record(safeRequest, decision, "denied");
      return { allowed: false, reason: decision.reason };
    }
    if (!this.#asker) {
      await this.#record(safeRequest, decision, "denied");
      return { allowed: false, reason: "No one is available to approve this action." };
    }
    let outcome: "approved" | "rejected" | "timed-out" | "deferred";
    try {
      outcome = await this.#asker(safeRequest, decision);
    } catch {
      outcome = "rejected";
    }
    // Still undecided: recorded once the owner decides and the coworker repeats the action.
    if (outcome === "deferred") return { allowed: false, reason: DEFERRED_APPROVAL_REASON };
    await this.#record(safeRequest, decision, outcome);
    if (outcome === "approved") return { allowed: true, reason: "Approved by the owner." };
    return {
      allowed: false,
      reason:
        outcome === "timed-out"
          ? "The owner did not answer in time, so the action was not performed."
          : "The owner declined this action.",
    };
  }

  async #consumeGrant(grantId: string): Promise<void> {
    const grant = this.#policy.grants.find((candidate) => candidate.id === grantId);
    if (!grant || grant.usesLeft === null) return;
    grant.usesLeft -= 1;
    if (grant.usesLeft <= 0) {
      this.#policy.grants = this.#policy.grants.filter((candidate) => candidate.id !== grantId);
    }
    await this.#persistPolicy();
  }

  async #record(
    request: PermissionRequest,
    decision: PermissionDecision,
    outcome: PermissionAuditEntry["decision"],
  ): Promise<void> {
    this.#audit.unshift({
      id: randomUUID(),
      at: this.#now().toISOString(),
      botId: request.botId,
      provider: request.provider,
      category: request.category,
      action: request.action,
      level: decision.level,
      effective: decision.effective,
      decision: outcome,
      reason: decision.reason,
    });
    this.#audit = this.#audit.slice(0, MAX_AUDIT_ENTRIES);
    await this.#auditFile.write({ version: 1, entries: this.#audit });
  }

  #pruneGrants(): void {
    const now = this.#now().getTime();
    this.#policy.grants = this.#policy.grants.filter(
      (grant) =>
        Date.parse(grant.expiresAt) > now && (grant.usesLeft === null || grant.usesLeft > 0),
    );
  }

  async #persistPolicy(): Promise<void> {
    this.#pruneGrants();
    await this.#policyFile.write({
      version: 1,
      levels: { ...this.#policy.levels },
      grants: this.#policy.grants,
      autoMode: this.#policy.autoMode,
    });
  }
}

function isPolicyFileState(value: unknown): value is PolicyFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.levels) &&
    Array.isArray(value.grants) &&
    value.grants.every(
      (grant) =>
        isRecord(grant) &&
        typeof grant.id === "string" &&
        typeof grant.category === "string" &&
        (grant.botId === null || typeof grant.botId === "string") &&
        typeof grant.expiresAt === "string" &&
        (grant.usesLeft === null || typeof grant.usesLeft === "number"),
    )
  );
}

function isAuditFileState(value: unknown): value is AuditFileState {
  return isRecord(value) && value.version === 1 && Array.isArray(value.entries);
}
