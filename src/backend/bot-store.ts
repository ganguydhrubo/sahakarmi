import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
  type BotSummary,
  isAgentModel,
  isAvatarColor,
  isAvatarShape,
  isReasoningEffort,
  providerForModel,
  type UpdateBotInput,
  type WorkspaceState,
  type WorkspaceSummary,
} from "../shared/ipc";
import { isRecord } from "./protocol";

type StoredBot = BotSummary;

interface StoredState {
  version: 2;
  examplesInitialized: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  bots: StoredBot[];
}

export const DEFAULT_WORKSPACE_ID = "my-business";

interface DefaultCoworker {
  id: string;
  name: string;
  role: string;
  description: string;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
}

/** The starter team. Names and roles are editable; avatars are abstract shapes, never photos. */
export const DEFAULT_COWORKERS: readonly DefaultCoworker[] = [
  {
    id: "mitra-lead",
    name: "Mitra",
    role: "Orchestrator",
    description:
      "Always ready, never misses a single detail. Leads workflow coordination, multi-agent dispatch and deep check diagnostics across project files.",
    avatarShape: "blob",
    avatarColor: "orange",
  },
  {
    id: "asha-accounts",
    name: "Asha",
    role: "Accounts",
    description:
      "Every rupee accounted for, down to the last paisa. Handles invoices, GST-ready bookkeeping, payment follow-ups and reconciliations. Uses INR (₹) and Indian number formatting (lakh/crore). Never makes or schedules a payment without an approval.",
    avatarShape: "hex",
    avatarColor: "orange",
  },
  {
    id: "vikram-sales",
    name: "Vikram",
    role: "Sales",
    description:
      "Turning cold leads into handshake deals. Researches leads, drafts outreach and WhatsApp/email follow-ups, keeps the pipeline sheet current and prepares quotations. Asks for approval before contacting any customer.",
    avatarShape: "wedge",
    avatarColor: "blue",
  },
  {
    id: "meera-support",
    name: "Meera",
    role: "Support",
    description:
      "Turning customer frustrations into smiles in 12 languages. Triages customer queries, drafts polite replies, tracks tickets and escalates anything urgent. Asks for approval before sending replies to customers.",
    avatarShape: "pebble",
    avatarColor: "green",
  },
  {
    id: "arjun-research",
    name: "Arjun",
    role: "Research",
    description:
      "Finding needles in data haystacks with pin-point accuracy. Does market, competitor, supplier and compliance research for Indian businesses, cites sources and summarises findings into the Shared folder.",
    avatarShape: "squircle",
    avatarColor: "violet",
  },
  {
    id: "kavya-content",
    name: "Kavya",
    role: "Content",
    description:
      "Words that captivate, campaigns that convert. Writes social posts, product descriptions, blogs and festival campaigns matching the brand voice. Asks for approval before publishing anything.",
    avatarShape: "cloud",
    avatarColor: "yellow",
  },
  {
    id: "dev-code",
    name: "Dev",
    role: "Code",
    description:
      "Zero warnings, zero bugs, infinite uptime. Deep code inspections, refactoring, linting and verification across all project files.",
    avatarShape: "tablet",
    avatarColor: "green",
  },
  {
    id: "tara-ops",
    name: "Tara",
    role: "Ops",
    description:
      "Runs like clockwork while you sleep. Schedules background routines, cron jobs and backups.",
    avatarShape: "teardrop",
    avatarColor: "cyan",
  },
  {
    id: "kabir-security",
    name: "Kabir",
    role: "Security",
    description:
      "Locked tight. Safe, sound, and fully compliant. Guardrails credentials, security audits, and permission verification.",
    avatarShape: "squircle",
    avatarColor: "blue",
  },
];

export const DEFAULT_AGENT_MODEL: AgentModelId = "gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "medium";

export class BotStore {
  readonly #statePath: string;
  readonly #botsRoot: string;
  readonly #sharedRoot: string;
  readonly #downloadsRoot: string;
  #state: StoredState = emptyState();
  readonly #newDefaultBotIds = new Set<string>();
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, homePath: string) {
    const sahkarmiRoot = join(homePath, "Sahkarmi");
    this.#statePath = join(userDataPath, "bots.json");
    this.#botsRoot = join(sahkarmiRoot, "Coworkers");
    this.#sharedRoot = join(sahkarmiRoot, "Shared");
    this.#downloadsRoot = join(sahkarmiRoot, "Downloads");
  }

  get userDataPath(): string {
    return dirname(this.#statePath);
  }

  get sharedRoot(): string {
    return this.#sharedRoot;
  }

  get downloadsRoot(): string {
    return this.#downloadsRoot;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.#botsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#sharedRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#downloadsRoot, { recursive: true, mode: 0o700 }),
      mkdir(dirname(this.#statePath), { recursive: true, mode: 0o700 }),
    ]);

    this.#state = await this.#readState();
    if (!this.#state.examplesInitialized) {
      for (const coworker of DEFAULT_COWORKERS) {
        if (this.#state.bots.some((bot) => bot.id === coworker.id)) continue;
        const record = this.#createRecord(
          coworker.id,
          coworker.name,
          coworker.role,
          coworker.description,
        );
        record.avatarShape = coworker.avatarShape;
        record.avatarColor = coworker.avatarColor;
        this.#state.bots.push(record);
        this.#newDefaultBotIds.add(record.id);
        await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
      }
      this.#state.examplesInitialized = true;
    }
    await this.#persist();
  }

  /** Only default coworkers created by this store instance may receive an automatic first model. */
  takeAutoModelSelection(botId: string): boolean {
    return this.#newDefaultBotIds.delete(botId);
  }

  list(): BotSummary[] {
    return this.#state.bots.map((bot) => ({ ...bot }));
  }

  workspaces(): WorkspaceState {
    return {
      workspaces: this.#state.workspaces.map((workspace) => ({ ...workspace })),
      activeWorkspaceId: this.#state.activeWorkspaceId,
    };
  }

  async createWorkspace(name: string): Promise<WorkspaceState> {
    const workspace: WorkspaceSummary = {
      id: `ws-${randomUUID()}`,
      name: requiredText(name, "Workspace name", 60),
      createdAt: new Date().toISOString(),
    };
    this.#state.workspaces.push(workspace);
    this.#state.activeWorkspaceId = workspace.id;
    await this.#persist();
    return this.workspaces();
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceState> {
    const workspace = this.#requireWorkspace(workspaceId);
    workspace.name = requiredText(name, "Workspace name", 60);
    await this.#persist();
    return this.workspaces();
  }

  async setActiveWorkspace(workspaceId: string): Promise<WorkspaceState> {
    this.#requireWorkspace(workspaceId);
    this.#state.activeWorkspaceId = workspaceId;
    await this.#persist();
    return this.workspaces();
  }

  async createBot(workspaceId = this.#state.activeWorkspaceId): Promise<BotSummary> {
    this.#requireWorkspace(workspaceId);
    const record = this.#createRecord(`bot-${randomUUID()}`, "New coworker", "", "", workspaceId);
    this.#state.bots.unshift(record);
    await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
    await this.#persist();
    return { ...record };
  }

  async updateBot(input: UpdateBotInput): Promise<BotSummary> {
    const bot = this.#requireBot(input.botId);
    if (input.name !== undefined) bot.name = requiredText(input.name, "Coworker name", 80);
    if (input.role !== undefined) bot.role = input.role.trim().slice(0, 120);
    if (input.description !== undefined) bot.description = input.description.trim().slice(0, 2_000);
    if (input.notifications !== undefined) bot.notifications = input.notifications;
    if (input.model !== undefined) {
      this.#newDefaultBotIds.delete(bot.id);
      if (providerForModel(input.model) !== providerForModel(bot.model)) bot.threadId = null;
      bot.model = input.model;
    }
    if (input.reasoningEffort !== undefined) bot.reasoningEffort = input.reasoningEffort;
    if (input.avatarShape !== undefined) bot.avatarShape = input.avatarShape;
    if (input.avatarColor !== undefined) bot.avatarColor = input.avatarColor;
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
    return { ...bot };
  }

  async deleteBot(id: string): Promise<BotSummary> {
    const bot = this.#requireBot(id);
    this.#state.bots = this.#state.bots.filter((candidate) => candidate.id !== id);
    await this.#persist();
    return { ...bot };
  }

  async getOrCreate(id: string, name?: string, role?: string): Promise<BotSummary> {
    validateBotId(id);
    const existing = this.#state.bots.find((bot) => bot.id === id);
    if (existing) {
      await mkdir(existing.workspacePath, { recursive: true, mode: 0o700 });
      return { ...existing };
    }

    const record = this.#createRecord(id, name ?? titleFromId(id), role ?? "Coworker");
    this.#state.bots.push(record);
    await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
    await this.#persist();
    return { ...record };
  }

  async setThreadId(id: string, threadId: string): Promise<void> {
    const bot = this.#requireBot(id);
    bot.threadId = threadId;
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async updatePreview(id: string, preview: string): Promise<void> {
    const bot = this.#requireBot(id);
    bot.preview = preview.slice(0, 180);
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async #readState(): Promise<StoredState> {
    try {
      const raw = await readFile(this.#statePath, "utf8");
      const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const parsed: unknown = JSON.parse(cleaned);
      if (
        !isRecord(parsed) ||
        (parsed.version !== 1 && parsed.version !== 2) ||
        typeof parsed.examplesInitialized !== "boolean" ||
        !Array.isArray(parsed.bots)
      ) {
        throw new Error(
          "Coworker state is corrupt or from a newer Sahkarmi version; refusing to overwrite it.",
        );
      }

      const workspaces =
        parsed.version === 2 && Array.isArray(parsed.workspaces)
          ? parsed.workspaces.filter(isStoredWorkspace).map((workspace) => ({ ...workspace }))
          : [];
      if (workspaces.length === 0) workspaces.push(defaultWorkspace());
      const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      const fallbackWorkspaceId = workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;
      // Version 1 files predate workspaces; their coworkers join the first workspace.
      const bots: unknown[] = parsed.bots.map((bot: unknown) =>
        isRecord(bot) && (typeof bot.workspaceId !== "string" || !workspaceIds.has(bot.workspaceId))
          ? { ...bot, workspaceId: fallbackWorkspaceId }
          : bot,
      );
      if (!bots.every(isStoredBot)) {
        throw new Error(
          "Coworker state is corrupt or from a newer Sahkarmi version; refusing to overwrite it.",
        );
      }
      const storedBots = bots as StoredBot[];
      if (new Set(storedBots.map((bot) => bot.id)).size !== storedBots.length) {
        throw new Error("Coworker state contains duplicate ids; refusing to overwrite it.");
      }
      const activeWorkspaceId =
        typeof parsed.activeWorkspaceId === "string" && workspaceIds.has(parsed.activeWorkspaceId)
          ? parsed.activeWorkspaceId
          : fallbackWorkspaceId;
      return {
        version: 2,
        examplesInitialized: parsed.examplesInitialized,
        activeWorkspaceId,
        workspaces,
        bots: storedBots.map((bot) => ({ ...bot })),
      };
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async #persist(): Promise<void> {
    const serialized = `${JSON.stringify(this.#state, null, 2)}\n`;
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;

    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.#statePath);
      });
    await this.#writeQueue;
  }

  #createRecord(
    id: string,
    name: string,
    role: string,
    description = "",
    workspaceId = this.#state.workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID,
  ): StoredBot {
    validateBotId(id);
    return {
      id,
      workspaceId,
      name,
      role,
      description,
      notifications: true,
      model: DEFAULT_AGENT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      threadId: null,
      workspacePath: join(this.#botsRoot, id),
      preview: "No messages yet",
      updatedAt: null,
      avatarShape: defaultAvatarShape(id),
      avatarColor: defaultAvatarColor(id),
    };
  }

  #requireWorkspace(id: string): WorkspaceSummary {
    const workspace = this.#state.workspaces.find((candidate) => candidate.id === id);
    if (!workspace) throw new Error(`Unknown workspace: ${id}`);
    return workspace;
  }

  #requireBot(id: string): StoredBot {
    const bot = this.#state.bots.find((candidate) => candidate.id === id);
    if (!bot) throw new Error(`Unknown bot: ${id}`);
    return bot;
  }
}

function defaultWorkspace(): WorkspaceSummary {
  return { id: DEFAULT_WORKSPACE_ID, name: "My Business", createdAt: new Date().toISOString() };
}

function emptyState(): StoredState {
  return {
    version: 2,
    examplesInitialized: false,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [defaultWorkspace()],
    bots: [],
  };
}

function isStoredWorkspace(value: unknown): value is WorkspaceSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string"
  );
}

function requiredText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed.slice(0, maxLength);
}

function validateBotId(id: string): void {
  if (!isValidBotId(id)) {
    throw new Error("Invalid bot id.");
  }
}

function isValidBotId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && basename(id) === id;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isStoredBot(value: unknown): value is StoredBot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isValidBotId(value.id) &&
    typeof value.workspaceId === "string" &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    typeof value.description === "string" &&
    typeof value.notifications === "boolean" &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (typeof value.threadId === "string" || value.threadId === null) &&
    typeof value.workspacePath === "string" &&
    typeof value.preview === "string" &&
    (typeof value.updatedAt === "string" || value.updatedAt === null) &&
    isAvatarShape(value.avatarShape) &&
    isAvatarColor(value.avatarColor)
  );
}

function avatarIndex(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function defaultAvatarShape(id: string): BotAvatarShape {
  return BOT_AVATAR_SHAPES[avatarIndex(id) % BOT_AVATAR_SHAPES.length] ?? "blob";
}

function defaultAvatarColor(id: string): BotAvatarColor {
  return BOT_AVATAR_COLORS[avatarIndex(`${id}:color`) % BOT_AVATAR_COLORS.length] ?? "orange";
}
