import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type AddPermissionGrantInput,
  type AuditIntegrity,
  PERMISSION_CATEGORIES,
  type PermissionAuditEntry,
  type PermissionCategory,
  type PermissionGrant,
  type PermissionLevel,
  type PermissionPolicyState,
  type SafetyLimits,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import {
  allowedLevels,
  DEFAULT_PERMISSION_LEVELS,
  DEFAULT_SAFETY_LIMITS,
  decide,
  OUTBOUND_CATEGORIES,
  type PermissionDecision,
  type PermissionRequest,
  redact,
  sanitizeLevels,
  sanitizeLimits,
} from "./permission-policy";
import { isRecord } from "./protocol";

interface PolicyFileState {
  version: 1;
  levels: Record<string, string>;
  grants: PermissionGrant[];
  suggestOnlyBots?: string[];
  limits?: Partial<SafetyLimits>;
  emergencyStop?: { active: boolean; since: string | null };
}

interface AuditFileState {
  version: 1;
  entries: PermissionAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 1_000;
const MAX_GRANT_HOURS = 24 * 7;
const HOUR_MS = 3_600_000;
const GENESIS_HASH = "0".repeat(64);

function defaultPolicy(): PermissionPolicyState {
  return {
    levels: { ...DEFAULT_PERMISSION_LEVELS },
    grants: [],
    suggestOnlyBots: [],
    limits: { ...DEFAULT_SAFETY_LIMITS },
    emergencyStop: { active: false, since: null },
  };
}

/** sha256 over the previous hash and every field of the entry except its own hash. */
export function hashAuditEntry(entry: PermissionAuditEntry, prevHash: string): string {
  const { hash: _hash, prevHash: _prev, ...fields } = entry;
  const ordered = Object.keys(fields)
    .sort()
    .map((key) => [key, fields[key as keyof typeof fields]]);
  return createHash("sha256").update(prevHash).update(JSON.stringify(ordered)).digest("hex");
}

/**
 * Checks the hash chain (entries are newest first). Entries written before the chain existed
 * have no hash and are skipped; the oldest kept entry may point at one already rotated out.
 */
export function verifyAuditChain(entries: PermissionAuditEntry[]): AuditIntegrity {
  let olderHash: string | null = null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as PermissionAuditEntry;
    if (!entry.hash || !entry.prevHash) {
      if (olderHash !== null) return { ok: false, entries: entries.length, brokenAt: index };
      continue;
    }
    if (olderHash !== null && entry.prevHash !== olderHash) {
      return { ok: false, entries: entries.length, brokenAt: index };
    }
    if (hashAuditEntry(entry, entry.prevHash) !== entry.hash) {
      return { ok: false, entries: entries.length, brokenAt: index };
    }
    olderHash = entry.hash;
  }
  return { ok: true, entries: entries.length, brokenAt: null };
}

/**
 * Asks the owner and resolves with their decision. Implemented by AgentService through the
 * approvals inbox; rejects or resolves false on timeout.
 */
export type PermissionAsker = (
  request: PermissionRequest,
  decision: PermissionDecision,
) => Promise<"approved" | "rejected" | "timed-out">;

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
  #policy: PermissionPolicyState = defaultPolicy();
  #audit: PermissionAuditEntry[] = [];
  #asker: PermissionAsker | null = null;
  #onChange: ((policy: PermissionPolicyState) => void) | null = null;
  /** Outbound actions per coworker (timestamps). Kept apart from the audit so clearing it cannot reset the cap. */
  readonly #outbound = new Map<string, number[]>();
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
      suggestOnlyBots: Array.isArray(stored.suggestOnlyBots)
        ? stored.suggestOnlyBots.filter((id) => typeof id === "string")
        : [],
      limits: sanitizeLimits(stored.limits),
      emergencyStop:
        stored.emergencyStop?.active === true
          ? { active: true, since: stored.emergencyStop.since ?? null }
          : { active: false, since: null },
    };
    this.#pruneGrants();
    const audit = await this.#auditFile.read(() => ({ version: 1, entries: [] }), isAuditFileState);
    this.#audit = audit.entries.slice(0, MAX_AUDIT_ENTRIES);
  }

  setAsker(asker: PermissionAsker): void {
    this.#asker = asker;
  }

  /** Called after any settings change, so open windows can refresh. */
  setChangeListener(listener: (policy: PermissionPolicyState) => void): void {
    this.#onChange = listener;
  }

  get(): PermissionPolicyState {
    this.#pruneGrants();
    return {
      levels: { ...this.#policy.levels },
      grants: this.#policy.grants.map((grant) => ({ ...grant })),
      suggestOnlyBots: [...this.#policy.suggestOnlyBots],
      limits: { ...this.#policy.limits },
      emergencyStop: { ...this.#policy.emergencyStop },
    };
  }

  limits(): SafetyLimits {
    return { ...this.#policy.limits };
  }

  isStopped(): boolean {
    return this.#policy.emergencyStop.active;
  }

  isSuggestOnly(botId: string): boolean {
    return this.#policy.suggestOnlyBots.includes(botId);
  }

  async setSuggestOnly(botId: string, enabled: boolean): Promise<PermissionPolicyState> {
    const others = this.#policy.suggestOnlyBots.filter((id) => id !== botId);
    this.#policy.suggestOnlyBots = enabled ? [...others, botId] : others;
    await this.#persistPolicy();
    await this.recordEvent({
      botId,
      action: enabled ? "Suggest-only mode on" : "Suggest-only mode off",
      decision: "allowed",
      reason: "Changed by the owner.",
    });
    return this.get();
  }

  async setLimits(limits: SafetyLimits): Promise<PermissionPolicyState> {
    this.#policy.limits = sanitizeLimits(limits);
    await this.#persistPolicy();
    return this.get();
  }

  async setEmergencyStop(active: boolean): Promise<PermissionPolicyState> {
    this.#policy.emergencyStop = active
      ? { active: true, since: this.#now().toISOString() }
      : { active: false, since: null };
    await this.#persistPolicy();
    await this.recordEvent({
      botId: null,
      action: active ? "Emergency stop" : "Emergency stop lifted",
      decision: active ? "stopped" : "allowed",
      reason: "Changed by the owner.",
    });
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

  verifyAudit(): AuditIntegrity {
    return verifyAuditChain(this.#audit);
  }

  /**
   * Clearing keeps one anchor entry chained to the last hash, so a cleared log is visible as
   * such instead of looking like nothing ever happened.
   */
  async clearAudit(): Promise<void> {
    const removed = this.#audit.length;
    const lastHash = this.#audit[0]?.hash ?? GENESIS_HASH;
    this.#audit = [];
    await this.#append(
      {
        id: randomUUID(),
        at: this.#now().toISOString(),
        botId: null,
        provider: "app",
        category: "system",
        action: `Audit log cleared (${removed} entries)`,
        level: "ask",
        effective: "allow",
        decision: "allowed",
        reason: "Cleared by the owner.",
      },
      lastHash,
    );
  }

  /** Safety events that are not a permission request: task stopped, loop, injection flagged. */
  async recordEvent(input: {
    botId: string | null;
    provider?: string;
    action: string;
    decision: PermissionAuditEntry["decision"];
    reason: string;
  }): Promise<void> {
    await this.#append({
      id: randomUUID(),
      at: this.#now().toISOString(),
      botId: input.botId,
      provider: input.provider ?? "app",
      category: "system",
      action: redact(input.action),
      level: "ask",
      effective: input.decision === "allowed" ? "allow" : "deny",
      decision: input.decision,
      reason: redact(input.reason, 400),
    });
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
    if (decision.effective !== "deny" && this.#overOutboundCap(safeRequest)) {
      const capped: PermissionDecision = {
        ...decision,
        effective: "deny",
        reason: `Hourly limit reached: at most ${this.#policy.limits.maxOutboundPerHour} messages, posts, orders or payments per coworker per hour.`,
        grant: null,
      };
      await this.#record(safeRequest, capped, "denied");
      return { allowed: false, reason: capped.reason };
    }
    const result = await this.#authorizeDecided(safeRequest, decision);
    if (result.allowed) this.#countOutbound(safeRequest);
    return result;
  }

  #overOutboundCap(request: PermissionRequest): boolean {
    if (!OUTBOUND_CATEGORIES.includes(request.category)) return false;
    const key = request.botId ?? "*";
    const since = this.#now().getTime() - HOUR_MS;
    const recent = (this.#outbound.get(key) ?? []).filter((at) => at > since);
    this.#outbound.set(key, recent);
    return recent.length >= this.#policy.limits.maxOutboundPerHour;
  }

  #countOutbound(request: PermissionRequest): void {
    if (!OUTBOUND_CATEGORIES.includes(request.category)) return;
    const key = request.botId ?? "*";
    this.#outbound.set(key, [...(this.#outbound.get(key) ?? []), this.#now().getTime()]);
  }

  async #authorizeDecided(
    safeRequest: PermissionRequest,
    decision: PermissionDecision,
  ): Promise<AuthorizeResult> {
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
    let outcome: "approved" | "rejected" | "timed-out";
    try {
      outcome = await this.#asker(safeRequest, decision);
    } catch {
      outcome = "rejected";
    }
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
    await this.#append({
      id: randomUUID(),
      at: this.#now().toISOString(),
      botId: request.botId,
      provider: request.provider,
      category: request.category,
      action: request.action,
      level: decision.level,
      effective: decision.effective,
      decision: outcome,
      reason: request.escalate ? `${decision.reason} [escalated]` : decision.reason,
    });
  }

  async #append(entry: PermissionAuditEntry, prevHash?: string): Promise<void> {
    const previous = prevHash ?? this.#audit[0]?.hash ?? GENESIS_HASH;
    const chained = { ...entry, prevHash: previous };
    chained.hash = hashAuditEntry(chained, previous);
    this.#audit.unshift(chained);
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
      suggestOnlyBots: this.#policy.suggestOnlyBots,
      limits: this.#policy.limits,
      emergencyStop: this.#policy.emergencyStop,
    });
    this.#onChange?.(this.get());
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
