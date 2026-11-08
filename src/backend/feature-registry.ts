import { join } from "node:path";
import {
  type AgentProviderId,
  type AgentProviderStatus,
  type DesktopPlatform,
  FEATURE_CATEGORIES,
  type FeatureCategory,
  type FeatureManifestPreview,
  type FeatureRequirement,
  type FeatureState,
  PROVIDER_LABELS,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  requires: FeatureRequirement[];
  canDisable: boolean;
  defaultEnabled: boolean;
}

/** Everything this build ships. A feature list can describe or switch these; never add code. */
export const BUILT_IN_FEATURES: FeatureDefinition[] = [
  feature(
    "approvals",
    "Approvals inbox",
    "Coworkers ask before money, messages and submissions.",
    "core",
    [],
    false,
  ),
  feature(
    "permissions",
    "Permission controls",
    "Per-category rules enforced on every tool call, with an audit log.",
    "core",
    [],
    false,
  ),
  feature(
    "task-queue",
    "Task queue",
    "Queue, pause and cancel work for each coworker.",
    "core",
    [],
    false,
  ),
  feature(
    "taint-guard",
    "Check after reading outside content",
    "After a coworker reads a web page, an app's reply or a file from outside its folders, the first command, outgoing message or key-file read in that reply asks you once, even if you pre-approved it. One question per reply at most. Off: decided by your permission settings alone, as before.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "budget-stop",
    "Work limits",
    "Stops a coworker after the daily number of replies you set, and a team run after the number of steps you set, with a note saying how to raise it. No limit is set until you set one. Off: limits are ignored.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "approval-provenance",
    "Show where a request came from",
    "Approval cards say what started the request: you, a routine, a schedule, a team run, another coworker, you from your phone, or a web page or app it read. Off: cards as before.",
    "core",
    [],
    true,
    true,
  ),
  feature("shared-files", "Shared files", "One folder every coworker can read and write.", "core"),
  feature(
    "auto-continue",
    "Keep going without babysitting",
    "A coworker that stops before its next step is told to carry on, a few times per request. Approvals are never skipped.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "knowledge-base",
    "Knowledge Bases",
    "Index your PDFs, Word, Excel, PowerPoint and text files on this computer; coworkers search them and cite the page.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "knowledge-auto-context",
    "Documents in every message",
    "Matching excerpts from your Knowledge Bases are added to each message you send, so coworkers answer from your documents without being asked to search.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "memory-auto-context",
    "Team memory in every message",
    "Up to three notes your coworkers saved that match your message are added to it, so they remember decisions and preferences without being asked to look.",
    "core",
    [],
    true,
    true,
  ),
  feature("schedules", "Schedules", "Run a task daily, weekly or once at a set time.", "core"),
  feature(
    "team-run-ai-planning",
    "Team runs: the CEO plans",
    "A multi-step team run asks the workspace CEO for the task list (checked, and sent back at most twice if unusable) instead of the standard three steps.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "cross-model-review",
    "Team runs: second-model review",
    "After each team-run task, a coworker on a different AI model reviews the work before it counts as done. Costs one more turn per task.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "team-run-sqlite-checkpoints",
    "Team runs: one checkpoint database",
    "Team-run progress is saved in one small SQLite file instead of a file per run; older files are imported. Off: one JSON file per run, as before.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "background-tray",
    "Keep running in the tray",
    "Closing the window keeps Sahkarmi running in the notification area, so schedules, routines and Telegram keep working. Quit from the tray icon. Windows only.",
    "core",
    [{ type: "platform", platforms: ["win32"] }],
    true,
    false,
  ),
  feature(
    "browser",
    "Built-in browser",
    "Coworkers browse in their own tabs; you can take over for logins and OTPs.",
    "core",
  ),
  feature(
    "browser-hide-secrets",
    "Built-in browser: hide secrets from the AI",
    "Before a page is read to a coworker's AI, passwords, sign-in tokens and API keys in fields and web addresses are replaced with [hidden]. Ordinary page text is unchanged. Off: pages are passed on as they are.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "browser-action-memory",
    "Built-in browser: remember clicked elements",
    "When a page changes after a coworker read it, Sahkarmi finds the element it clicked or typed into before, but only when exactly one element on the same page matches it in every detail, and says so. Otherwise the step stops as before.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "provider-codex",
    "ChatGPT (Codex)",
    "Use your ChatGPT sign-in through the Codex CLI.",
    "providers",
    [{ type: "provider", provider: "codex" }],
  ),
  feature(
    "provider-claude",
    "Claude",
    "Use your Claude sign-in through Claude Code.",
    "providers",
    [{ type: "provider", provider: "claude" }],
  ),
  feature(
    "provider-antigravity",
    "Google Antigravity",
    "Use your Google sign-in through Google's Antigravity agent.",
    "providers",
    [{ type: "provider", provider: "antigravity" }],
  ),
  feature(
    "provider-opencode",
    "OpenCode (free)",
    "Bundled free models; no account needed.",
    "providers",
    [{ type: "provider", provider: "opencode" }],
  ),
  feature(
    "engine-open-model",
    "Open Interpreter engine",
    "Adds a free, open-source coding engine for open models. You install its program yourself (Connect shows where); every command and file edit it wants still asks Sahkarmi's approvals first. Off: the engine is not listed or started.",
    "providers",
    [{ type: "platform", platforms: ["win32"] }],
    true,
    false,
  ),
  feature(
    "model-usage",
    "Model usage",
    "Limits, tokens and estimated cost, each labelled with its source.",
    "workspace",
    [{ type: "any-provider" }],
  ),
  feature(
    "rich-replies",
    "Structured replies",
    "Lists, tables, checklists and code blocks with copy buttons.",
    "workspace",
  ),
  feature(
    "voice-recorder",
    "Voice notes",
    "Record, preview and send a voice note to a coworker.",
    "workspace",
  ),
  feature(
    "live-dictation",
    "Live dictation",
    "Speech-to-text from your system's speech service, where available.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "model-suggestions",
    "Model suggestions",
    "Suggest a model per task profile. Never switches to a paid model by itself.",
    "labs",
    [{ type: "any-provider" }],
    true,
    false,
  ),
  feature(
    "lean-runtime",
    "Light on memory",
    "Starts only the AIs your coworkers use, closes a Claude coworker's process after 10 quiet minutes (at most 3 stay open; its chat resumes where it left off), and slows down hidden coworker browsers while Sahkarmi is minimised.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "fair-turns",
    "Fair turns",
    "When coworkers wait for a free slot, each gets a turn in rotation: the one that just finished goes behind those already waiting, so a quick task is never stuck behind one coworker's long queue. Messages you type still go first. Off: first come, first served.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "page-budget",
    "Two awake pages per coworker",
    "Each coworker keeps at most two browser pages awake; its least recently used extra page sleeps (never the page on screen, one in use, or one with unsaved typing). Sleeping pages keep their address and wake when used.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "page-crash-guard",
    "Rest pages that keep crashing",
    "If a website's page crashes three times in ten minutes, its tab stays asleep and the coworker is told in plain words, so one broken site cannot slow the PC. It clears once a page of that site works again.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "leftover-cleanup",
    "Close leftovers from the last run",
    "At start, closes coworker programs that Sahkarmi itself started last time and that were left running after it closed unexpectedly. Only programs from Sahkarmi's own folders or launches are touched; your own terminals and assistant apps never are. Each one closed is written to the log.",
    "labs",
    [{ type: "platform", platforms: ["win32"] }],
    true,
    false,
  ),
  feature(
    "live-meter-detail",
    "Processor and page meter",
    "The memory meter in Settings > Features also shows processor use and how many browser pages are awake. Measured only while the meter is open or memory is short.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "chat-delta-updates",
    "Fast chat updates",
    "During a task each step updates only its own message, and an opened chat is shown from memory instead of being read again. Off: the whole chat is re-sent at every step.",
    "core",
    [],
    true,
    true,
  ),
  feature(
    "mcp-fresh-path",
    "MCP servers: see newly installed programs",
    "Re-reads Windows' PATH when Settings opens, so a program installed while Sahkarmi runs (uv, Python, Node) is found without a restart, and gives MCP servers a clean environment without Sahkarmi's keys.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "mcp-test-first",
    "MCP servers: test before use",
    "New MCP servers are saved switched off until a test shows they start and list their tools, and can be limited to some coworkers.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "mcp-shared-mode",
    "MCP servers: shared mode",
    "A server you mark as shared starts once for the whole app (on first use) and every coworker uses that one copy through a private address on this PC; it stops when idle. Off: each chat starts its own copy.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "mcp-guided-install",
    "MCP servers: install for me",
    "After you approve a card that lists every download and command, Sahkarmi installs a server (or a command-line tool as a Skill) into its own folder, and can fetch uv, Python 3.11 or Node.js with checked SHA-256 sums. Off: you install programs yourself.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "mcp-smart-import",
    "MCP servers: smart GitHub connect",
    "Reads a GitHub repo, the official MCP Registry and npm/PyPI to say whether it is an MCP server and how to run it. Off: only the repo's .mcp.json is read.",
    "labs",
    [],
    true,
    true,
  ),
  feature(
    "mcp-connector-gallery",
    "MCP servers: ready-made connectors",
    "Shows a list of free, checked connectors (web pages, files, Git, time, code hosting, databases, email, Google Workspace, India GST lookups, Tally, documents, website debugging). Nothing is added, downloaded or started until you press Add; each one is saved switched off until its test passes. Off: the list is hidden.",
    "labs",
    [],
    true,
    false,
  ),
  feature(
    "marketplace",
    "Marketplace",
    "Add ready-made coworkers and install skills in one click.",
    "workspace",
  ),
  feature(
    "business-targets",
    "Business targets",
    "Your own goals, tracked separately from any platform data.",
    "business",
  ),
  feature(
    "integrations",
    "Integrations",
    "What each business platform allows and how coworkers can help.",
    "business",
  ),
];

interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
}

interface FeatureFileState {
  version: 1;
  disabled: string[];
  enabled: string[];
  catalogue: { version: string; entries: CatalogueEntry[] } | null;
}

interface ParsedManifest {
  version: string;
  entries: Array<CatalogueEntry & { enabled: boolean | null; minAppVersion: string | null }>;
}

const MANIFEST_SCHEMA = "sahkarmi.features/1";
const MAX_MANIFEST_BYTES = 64 * 1024;
const ALLOWED_TOP_KEYS = new Set(["schema", "version", "features"]);
const ALLOWED_FEATURE_KEYS = new Set([
  "id",
  "name",
  "description",
  "category",
  "enabled",
  "minAppVersion",
]);

export interface FeatureContext {
  platform: DesktopPlatform;
  appVersion: string;
  providers: AgentProviderStatus[];
}

export class FeatureRegistry {
  readonly #file: JsonFile<FeatureFileState>;
  #state: FeatureFileState = emptyState();

  constructor(userDataPath: string) {
    this.#file = new JsonFile(join(userDataPath, "features.json"));
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(emptyState, isFeatureState);
  }

  list(context: FeatureContext): FeatureState[] {
    const builtIns = BUILT_IN_FEATURES.map((definition) => {
      const { availability, reason } = evaluate(definition.requires, context);
      const enabled = definition.canDisable
        ? this.#state.enabled.includes(definition.id) ||
          (definition.defaultEnabled && !this.#state.disabled.includes(definition.id))
        : true;
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        origin: "built-in" as const,
        availability,
        reason,
        enabled,
        canDisable: definition.canDisable,
      };
    });
    const announced = (this.#state.catalogue?.entries ?? [])
      .filter((entry) => !BUILT_IN_FEATURES.some((definition) => definition.id === entry.id))
      .map((entry) => ({
        ...entry,
        origin: "catalogue" as const,
        availability: "coming-later" as const,
        reason: "Listed in your imported feature list. It needs a Sahkarmi update to be installed.",
        enabled: false,
        canDisable: false,
      }));
    return [...builtIns, ...announced];
  }

  async setEnabled(featureId: string, enabled: boolean): Promise<void> {
    const definition = BUILT_IN_FEATURES.find((candidate) => candidate.id === featureId);
    if (!definition) throw new Error("Only installed features can be switched on or off.");
    if (!definition.canDisable) throw new Error("This safety feature is always on.");
    this.#state.disabled = this.#state.disabled.filter((id) => id !== featureId);
    this.#state.enabled = this.#state.enabled.filter((id) => id !== featureId);
    if (enabled !== definition.defaultEnabled) {
      (enabled ? this.#state.enabled : this.#state.disabled).push(featureId);
    }
    await this.#file.write(this.#state);
  }

  isEnabled(featureId: string): boolean {
    const definition = BUILT_IN_FEATURES.find((candidate) => candidate.id === featureId);
    if (!definition) return false;
    if (!definition.canDisable) return true;
    return (
      this.#state.enabled.includes(featureId) ||
      (definition.defaultEnabled && !this.#state.disabled.includes(featureId))
    );
  }

  preview(json: string, appVersion: string): FeatureManifestPreview {
    const parsed = parseManifest(json);
    if ("errors" in parsed) {
      return {
        ok: false,
        errors: parsed.errors,
        added: [],
        changed: [],
        ignored: [],
        catalogueVersion: null,
      };
    }
    const added: FeatureManifestPreview["added"] = [];
    const changed: FeatureManifestPreview["changed"] = [];
    const ignored: FeatureManifestPreview["ignored"] = [];
    for (const entry of parsed.entries) {
      const builtIn = BUILT_IN_FEATURES.find((definition) => definition.id === entry.id);
      if (!builtIn) {
        if (entry.minAppVersion && compareVersions(appVersion, entry.minAppVersion) < 0) {
          added.push({ id: entry.id, name: `${entry.name} (needs v${entry.minAppVersion})` });
        } else {
          added.push({ id: entry.id, name: entry.name });
        }
        continue;
      }
      if (entry.enabled === null) {
        ignored.push({ id: entry.id, reason: "Already installed; nothing to change." });
      } else if (!builtIn.canDisable) {
        ignored.push({ id: entry.id, reason: "Safety feature; it always stays on." });
      } else if (entry.enabled !== this.isEnabled(entry.id)) {
        changed.push({
          id: entry.id,
          name: builtIn.name,
          change: entry.enabled ? "Switch on" : "Switch off",
        });
      } else {
        ignored.push({ id: entry.id, reason: "Already in that state." });
      }
    }
    return { ok: true, errors: [], added, changed, ignored, catalogueVersion: parsed.version };
  }

  async apply(json: string, appVersion: string): Promise<void> {
    const preview = this.preview(json, appVersion);
    if (!preview.ok) throw new Error(preview.errors.join(" "));
    const parsed = parseManifest(json) as ParsedManifest;
    for (const change of preview.changed) {
      const entry = parsed.entries.find((candidate) => candidate.id === change.id);
      if (entry && entry.enabled !== null) await this.setEnabled(change.id, entry.enabled);
    }
    this.#state.catalogue = {
      version: parsed.version,
      entries: parsed.entries
        .filter((entry) => !BUILT_IN_FEATURES.some((definition) => definition.id === entry.id))
        .map(({ id, name, description, category }) => ({ id, name, description, category })),
    };
    await this.#file.write(this.#state);
  }

  async resetCatalogue(): Promise<void> {
    this.#state.catalogue = null;
    await this.#file.write(this.#state);
  }
}

/**
 * Validates an imported feature list. It is metadata only: any key that could point at code,
 * a download or a command is rejected outright rather than ignored.
 */
export function parseManifest(json: string): ParsedManifest | { errors: string[] } {
  if (Buffer.byteLength(json, "utf8") > MAX_MANIFEST_BYTES) {
    return { errors: ["The feature list is larger than 64 KB."] };
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { errors: ["The feature list is not valid JSON."] };
  }
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: ["The feature list must be a JSON object."] };
  for (const key of Object.keys(value)) {
    if (!ALLOWED_TOP_KEYS.has(key)) errors.push(`Unsupported field "${key}".`);
  }
  if (value.schema !== MANIFEST_SCHEMA) errors.push(`"schema" must be "${MANIFEST_SCHEMA}".`);
  const version = typeof value.version === "string" ? value.version.trim().slice(0, 40) : "";
  if (!version) errors.push(`"version" is required.`);
  if (!Array.isArray(value.features) || value.features.length === 0) {
    errors.push(`"features" must be a non-empty list.`);
    return { errors };
  }
  if (value.features.length > 100) errors.push("A feature list can describe at most 100 features.");
  const entries: ParsedManifest["entries"] = [];
  const seen = new Set<string>();
  value.features.forEach((raw, index) => {
    const where = `Feature ${index + 1}`;
    if (!isRecord(raw)) {
      errors.push(`${where} must be an object.`);
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!ALLOWED_FEATURE_KEYS.has(key)) {
        errors.push(
          `${where}: field "${key}" is not allowed (feature lists cannot carry code, links or commands).`,
        );
      }
    }
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(id))
      errors.push(`${where}: "id" must be 2–48 lowercase letters, digits or dashes.`);
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}".`);
    seen.add(id);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > 80) errors.push(`${where}: "name" must be 1–80 characters.`);
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (description.length > 300)
      errors.push(`${where}: "description" is longer than 300 characters.`);
    const category = raw.category ?? "labs";
    if (!FEATURE_CATEGORIES.includes(category as FeatureCategory)) {
      errors.push(`${where}: unknown category "${String(category)}".`);
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      errors.push(`${where}: "enabled" must be true or false.`);
    }
    const minAppVersion = raw.minAppVersion;
    if (
      minAppVersion !== undefined &&
      (typeof minAppVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(minAppVersion))
    ) {
      errors.push(`${where}: "minAppVersion" must look like 1.2.3.`);
    }
    entries.push({
      id,
      name,
      description,
      category: category as FeatureCategory,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
      minAppVersion: typeof minAppVersion === "string" ? minAppVersion : null,
    });
  });
  return errors.length ? { errors } : { version, entries };
}

function evaluate(
  requires: FeatureRequirement[],
  context: FeatureContext,
): { availability: FeatureState["availability"]; reason: string | null } {
  for (const requirement of requires) {
    if (requirement.type === "platform" && !requirement.platforms.includes(context.platform)) {
      return { availability: "unavailable", reason: "Not available on this operating system." };
    }
    if (
      requirement.type === "app-version" &&
      compareVersions(context.appVersion, requirement.minimum) < 0
    ) {
      return {
        availability: "unavailable",
        reason: `Needs Sahkarmi ${requirement.minimum} or newer.`,
      };
    }
    if (requirement.type === "provider") {
      const status = context.providers.find((provider) => provider.id === requirement.provider);
      const reason = providerReason(requirement.provider, status);
      if (reason) return reason;
    }
    if (
      requirement.type === "any-provider" &&
      !context.providers.some((provider) => provider.state === "available")
    ) {
      return { availability: "needs-setup", reason: "Connect at least one AI provider." };
    }
  }
  return { availability: "available", reason: null };
}

function providerReason(
  provider: AgentProviderId,
  status: AgentProviderStatus | undefined,
): { availability: FeatureState["availability"]; reason: string } | null {
  const label = PROVIDER_LABELS[provider];
  switch (status?.state) {
    case "available":
      return null;
    case "not-installed":
      return { availability: "needs-setup", reason: `${label} is not installed on this computer.` };
    case "sign-in-required":
      return { availability: "needs-setup", reason: `Sign in to ${label} to use it.` };
    case "outdated":
      return { availability: "needs-setup", reason: `Update ${label} to a newer version.` };
    case "error":
      return {
        availability: "unavailable",
        reason: status.message ?? `${label} reported an error.`,
      };
    default:
      return { availability: "needs-setup", reason: `Checking ${label}…` };
  }
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function feature(
  id: string,
  name: string,
  description: string,
  category: FeatureCategory,
  requires: FeatureRequirement[] = [],
  canDisable = true,
  defaultEnabled = true,
): FeatureDefinition {
  return { id, name, description, category, requires, canDisable, defaultEnabled };
}

function emptyState(): FeatureFileState {
  return { version: 1, disabled: [], enabled: [], catalogue: null };
}

function isFeatureState(value: unknown): value is FeatureFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.disabled) &&
    Array.isArray(value.enabled) &&
    (value.catalogue === null || isRecord(value.catalogue))
  );
}
