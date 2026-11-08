/**
 * Who may use one resource (a web API, a connected app, a skill or an MCP server). The owner
 * picks any mix: everyone, coworkers running on some engines (Claude, Codex, Antigravity…),
 * single coworkers, whole workspaces, and each workspace's CEO. Any one match is enough.
 */
export interface ResourceAccess {
  everyone: boolean;
  /** The CEO of every workspace (each CEO still only works inside its own workspace). */
  ceo: boolean;
  botIds: string[];
  workspaceIds: string[];
  /** Engines (agent providers, e.g. "claude", "antigravity"): every coworker running on one. */
  providers: string[];
}

export type ResourceKind = "api" | "app" | "skill" | "mcp";

/** A coworker asking to use a resource. */
export interface AccessSubject {
  botId: string;
  workspaceId: string | null;
  provider: string | null;
  isCeo: boolean;
}

export const EVERYONE_ACCESS: ResourceAccess = {
  everyone: true,
  ceo: false,
  botIds: [],
  workspaceIds: [],
  providers: [],
};

export function accessAllows(access: ResourceAccess, subject: AccessSubject): boolean {
  if (access.everyone) return true;
  if (access.botIds.includes(subject.botId)) return true;
  if (subject.workspaceId && access.workspaceIds.includes(subject.workspaceId)) return true;
  if (subject.provider && access.providers.includes(subject.provider)) return true;
  return access.ceo && subject.isCeo;
}

/** True when the owner chose nobody at all: the resource is connected but nobody may use it. */
export function accessIsEmpty(access: ResourceAccess): boolean {
  return (
    !access.everyone &&
    !access.ceo &&
    access.botIds.length === 0 &&
    access.workspaceIds.length === 0 &&
    access.providers.length === 0
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item))]
    : [];
}

/** Any stored or sent value, made safe. Unknown shapes fall back to `fallback`. */
export function normaliseAccess(value: unknown, fallback = EVERYONE_ACCESS): ResourceAccess {
  if (!value || typeof value !== "object") return { ...fallback };
  const input = value as Record<string, unknown>;
  return {
    everyone: input.everyone === true,
    ceo: input.ceo === true,
    botIds: strings(input.botIds),
    workspaceIds: strings(input.workspaceIds),
    providers: strings(input.providers),
  };
}

/** The names a summary needs; anything unknown is counted rather than named. */
export interface AccessNames {
  bots: Map<string, string>;
  workspaces: Map<string, string>;
  providers: Map<string, string>;
}

/** "Everyone", or e.g. "CEO · Claude coworkers · Sales workspace · Asha, Ravi". */
export function describeAccess(access: ResourceAccess, names: AccessNames): string {
  if (access.everyone) return "Everyone";
  if (accessIsEmpty(access)) return "Nobody yet";
  const parts: string[] = [];
  if (access.ceo) parts.push("CEOs");
  for (const id of access.providers) parts.push(`${names.providers.get(id) ?? id} coworkers`);
  for (const id of access.workspaceIds) {
    const name = names.workspaces.get(id);
    if (name) parts.push(`${name} workspace`);
  }
  const bots = access.botIds.map((id) => names.bots.get(id)).filter(Boolean);
  if (bots.length > 3) parts.push(`${bots.slice(0, 3).join(", ")} +${bots.length - 3}`);
  else if (bots.length > 0) parts.push(bots.join(", "));
  return parts.join(" · ") || "Nobody yet";
}
