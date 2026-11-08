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
  type BranchOrigin,
  type CreateFolderInput,
  type CrewAvatar,
  type DeleteWorkspaceInput,
  isAgentModel,
  isAvatarColor,
  isAvatarShape,
  isBotTemplateRef,
  isCrewAvatar,
  isReasoningEffort,
  legacyModelReplacement,
  MAX_FOLDER_DEPTH,
  type PendingBotRuntime,
  type PublishingAccount,
  providerForModel,
  type SidebarFolder,
  type UpdateBotInput,
  type WorkspaceState,
  type WorkspaceSummary,
} from "../shared/ipc";
import { isRecord } from "./protocol";

type StoredBot = BotSummary;

interface StoredState {
  version: 2;
  examplesInitialized: boolean;
  /** The default coworkers have been given their brand robot faces (once, never again). */
  brandFacesApplied?: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  folders: SidebarFolder[];
  bots: StoredBot[];
}

const MAX_FOLDERS = 200;

export const DEFAULT_WORKSPACE_ID = "my-business";

interface DefaultCoworker {
  id: string;
  name: string;
  role: string;
  description: string;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
  /** The Sahkarmi brand robot this coworker wears by default. */
  avatarModel?: CrewAvatar;
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
    avatarModel: "startup",
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
    avatarModel: "outreach",
  },
  {
    id: "meera-support",
    name: "Meera",
    role: "Support",
    description:
      "Turning customer frustrations into smiles in 12 languages. Triages customer queries, drafts polite replies, tracks tickets and escalates anything urgent. Asks for approval before sending replies to customers.",
    avatarShape: "pebble",
    avatarColor: "green",
    avatarModel: "whatsapp",
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
    avatarModel: "publisher",
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

export const DEFAULT_AGENT_MODEL: AgentModelId = "gpt-5.6-sol";
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

  /** Every coworker's own folder lives under this root. */
  get botsRoot(): string {
    return this.#botsRoot;
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
        if (coworker.avatarModel) record.avatarModel = coworker.avatarModel;
        this.#state.bots.push(record);
        this.#newDefaultBotIds.add(record.id);
        await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
      }
      this.#state.examplesInitialized = true;
    }
    if (!this.#state.brandFacesApplied) {
      // Existing default coworkers get their brand robot once; a face the owner already chose
      // (a robot, or "Drawn shape" saved as null) is never changed.
      for (const coworker of DEFAULT_COWORKERS) {
        const bot = this.#state.bots.find((candidate) => candidate.id === coworker.id);
        if (bot && coworker.avatarModel && bot.avatarModel === undefined) {
          bot.avatarModel = coworker.avatarModel;
        }
      }
      this.#state.brandFacesApplied = true;
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
      folders: this.#state.folders.map((folder) => ({ ...folder })),
    };
  }

  // ---- Sidebar folders: nest to MAX_FOLDER_DEPTH inside one workspace ----

  async createFolder(input: CreateFolderInput): Promise<WorkspaceState> {
    this.#requireWorkspace(input.workspaceId);
    if (this.#state.folders.length >= MAX_FOLDERS) throw new Error("That is enough folders.");
    const parent = input.parentId ? this.#requireFolder(input.parentId) : null;
    if (parent && parent.workspaceId !== input.workspaceId) {
      throw new Error("A folder stays inside its own workspace.");
    }
    if (parent && this.#folderDepth(parent.id) >= MAX_FOLDER_DEPTH) {
      throw new Error(`Folders go ${MAX_FOLDER_DEPTH} levels deep at most.`);
    }
    this.#state.folders.push({
      id: `folder-${randomUUID()}`,
      workspaceId: input.workspaceId,
      name: requiredText(input.name, "Folder name", 60),
      parentId: parent?.id ?? null,
    });
    await this.#persist();
    return this.workspaces();
  }

  async renameFolder(folderId: string, name: string): Promise<WorkspaceState> {
    this.#requireFolder(folderId).name = requiredText(name, "Folder name", 60);
    await this.#persist();
    return this.workspaces();
  }

  /** Puts a folder (with everything in it) inside another folder, or at the top with null. */
  async moveFolder(folderId: string, parentId: string | null): Promise<WorkspaceState> {
    const folder = this.#requireFolder(folderId);
    if (parentId === folderId) throw new Error("A folder cannot go inside itself.");
    if (parentId) {
      const parent = this.#requireFolder(parentId);
      if (parent.workspaceId !== folder.workspaceId) {
        throw new Error("A folder stays inside its own workspace.");
      }
      if (this.#folderAncestors(parent.id).includes(folderId)) {
        throw new Error("A folder cannot go inside one of its own folders.");
      }
      if (this.#folderDepth(parent.id) + this.#subtreeHeight(folderId) > MAX_FOLDER_DEPTH) {
        throw new Error(`Folders go ${MAX_FOLDER_DEPTH} levels deep at most.`);
      }
    }
    folder.parentId = parentId;
    await this.#persist();
    return this.workspaces();
  }

  /** Moves a folder before or after its neighbour among the folders of the same parent. */
  async reorderFolder(folderId: string, direction: "up" | "down"): Promise<WorkspaceState> {
    const folder = this.#requireFolder(folderId);
    const siblings = this.#state.folders.filter(
      (candidate) =>
        candidate.workspaceId === folder.workspaceId && candidate.parentId === folder.parentId,
    );
    const at = siblings.indexOf(folder);
    const swapWith = siblings[direction === "up" ? at - 1 : at + 1];
    if (!swapWith) return this.workspaces();
    const all = this.#state.folders;
    const from = all.indexOf(folder);
    const to = all.indexOf(swapWith);
    all[from] = swapWith;
    all[to] = folder;
    await this.#persist();
    return this.workspaces();
  }

  /** Removes one folder; its coworkers and folders move up to where it was. */
  async deleteFolder(folderId: string): Promise<WorkspaceState> {
    const folder = this.#requireFolder(folderId);
    for (const child of this.#state.folders) {
      if (child.parentId === folderId) child.parentId = folder.parentId;
    }
    for (const bot of this.#state.bots) {
      if (bot.folderId === folderId) bot.folderId = folder.parentId;
    }
    this.#state.folders = this.#state.folders.filter((candidate) => candidate.id !== folderId);
    await this.#persist();
    return this.workspaces();
  }

  async setBotFolder(botId: string, folderId: string | null): Promise<BotSummary> {
    const bot = this.#requireBot(botId);
    if (folderId) {
      const folder = this.#requireFolder(folderId);
      if (folder.workspaceId !== bot.workspaceId) {
        throw new Error("A coworker goes into a folder of its own workspace.");
      }
      bot.folderId = folderId;
    } else {
      delete bot.folderId;
    }
    await this.#persist();
    return { ...bot };
  }

  #requireFolder(id: string): SidebarFolder {
    const folder = this.#state.folders.find((candidate) => candidate.id === id);
    if (!folder) throw new Error(`Unknown folder: ${id}`);
    return folder;
  }

  #folderAncestors(id: string): string[] {
    const chain: string[] = [];
    let current = this.#state.folders.find((candidate) => candidate.id === id);
    while (current?.parentId && chain.length < 10) {
      chain.push(current.parentId);
      const parentId = current.parentId;
      current = this.#state.folders.find((candidate) => candidate.id === parentId);
    }
    return chain;
  }

  /** 1 for a top-level folder, 2 for one inside it, and so on. */
  #folderDepth(id: string): number {
    return this.#folderAncestors(id).length + 1;
  }

  /** 1 for a folder with no folders inside, 2 with one level of folders, and so on. */
  #subtreeHeight(id: string): number {
    const children = this.#state.folders.filter((candidate) => candidate.parentId === id);
    return 1 + Math.max(0, ...children.map((child) => this.#subtreeHeight(child.id)));
  }

  /** Remembers where a branched coworker came from. */
  async setBranchOrigin(botId: string, origin: BranchOrigin): Promise<BotSummary> {
    const bot = this.#requireBot(botId);
    bot.branchedFrom = { ...origin };
    await this.#persist();
    return { ...bot };
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

  /**
   * Removes a workspace, moving its remaining coworkers to `moveCoworkersTo`. The service deletes
   * the ones that go with it first; a coworker is never left pointing at a workspace that is gone.
   */
  async deleteWorkspace(input: DeleteWorkspaceInput): Promise<WorkspaceState> {
    this.#requireWorkspace(input.workspaceId);
    if (this.#state.workspaces.length <= 1) {
      throw new Error("This is your only workspace, so it cannot be deleted.");
    }
    if (input.moveCoworkersTo === input.workspaceId) {
      throw new Error("Choose a different workspace to move the coworkers to.");
    }
    const members = this.#state.bots.filter((bot) => bot.workspaceId === input.workspaceId);
    if (input.moveCoworkersTo === null) {
      if (members.length > 0) throw new Error("This workspace still has coworkers.");
    } else {
      this.#requireWorkspace(input.moveCoworkersTo);
      for (const bot of members) {
        bot.workspaceId = input.moveCoworkersTo;
        delete bot.folderId;
      }
    }
    this.#state.folders = this.#state.folders.filter(
      (folder) => folder.workspaceId !== input.workspaceId,
    );
    this.#state.workspaces = this.#state.workspaces.filter(
      (workspace) => workspace.id !== input.workspaceId,
    );
    if (this.#state.activeWorkspaceId === input.workspaceId) {
      this.#state.activeWorkspaceId =
        input.moveCoworkersTo ?? this.#state.workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;
    }
    await this.#persist();
    return this.workspaces();
  }

  async setWorkspaceCeo(workspaceId: string, botId: string | null): Promise<WorkspaceState> {
    const workspace = this.#requireWorkspace(workspaceId);
    if (botId !== null) {
      const bot = this.#requireBot(botId);
      if (bot.workspaceId !== workspaceId) {
        throw new Error("Only a coworker in this workspace can be its CEO.");
      }
    }
    workspace.ceoBotId = botId;
    await this.#persist();
    return this.workspaces();
  }

  async setPublishingAccounts(botId: string, accounts: PublishingAccount[]): Promise<BotSummary> {
    const bot = this.#requireBot(botId);
    bot.publishingAccounts = accounts;
    await this.#persist();
    return { ...bot };
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
    if (input.description !== undefined) bot.description = input.description.trim().slice(0, 4_000);
    if (input.notifications !== undefined) bot.notifications = input.notifications;
    if (input.model !== undefined) {
      this.#newDefaultBotIds.delete(bot.id);
      if (providerForModel(input.model) !== providerForModel(bot.model)) bot.threadId = null;
      bot.model = input.model;
    }
    if (input.reasoningEffort !== undefined) bot.reasoningEffort = input.reasoningEffort;
    if (input.avatarShape !== undefined) bot.avatarShape = input.avatarShape;
    if (input.avatarColor !== undefined) bot.avatarColor = input.avatarColor;
    if (input.avatarModel !== undefined) bot.avatarModel = input.avatarModel;
    if (input.template !== undefined) bot.template = { ...input.template };
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
    return { ...bot };
  }

  async deleteBot(id: string): Promise<BotSummary> {
    const bot = this.#requireBot(id);
    this.#state.bots = this.#state.bots.filter((candidate) => candidate.id !== id);
    for (const workspace of this.#state.workspaces) {
      if (workspace.ceoBotId === id) workspace.ceoBotId = null;
    }
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

  /** Remembers (or clears) a model or effort to apply once the coworker's current work ends. */
  async setPendingRuntime(id: string, runtime: PendingBotRuntime | null): Promise<void> {
    const bot = this.#requireBot(id);
    if (runtime) bot.pendingRuntime = { ...runtime };
    else delete bot.pendingRuntime;
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
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
      const bots: unknown[] = parsed.bots.map((bot: unknown) => {
        if (!isRecord(bot)) return bot;
        const workspaceId =
          typeof bot.workspaceId !== "string" || !workspaceIds.has(bot.workspaceId)
            ? fallbackWorkspaceId
            : bot.workspaceId;
        // A coworker on a provider Sahkarmi no longer ships moves to the bundled free model.
        const model = legacyModelReplacement(bot.model) ?? bot.model;
        return { ...bot, workspaceId, model };
      });
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
      // A damaged or old folder list loses nothing: every folder is kept where it can be.
      const folders = (Array.isArray(parsed.folders) ? parsed.folders : [])
        .filter(isStoredFolder)
        .filter((folder) => workspaceIds.has(folder.workspaceId))
        .map((folder) => ({ ...folder }));
      const folderIds = new Set(folders.map((folder) => folder.id));
      for (const folder of folders) {
        if (folder.parentId && !folderIds.has(folder.parentId)) folder.parentId = null;
      }
      const filedBots = storedBots.map((bot) => {
        const copy = { ...bot };
        if (copy.folderId && !folderIds.has(copy.folderId)) delete copy.folderId;
        return copy;
      });
      return {
        version: 2,
        examplesInitialized: parsed.examplesInitialized,
        ...(parsed.brandFacesApplied === true ? { brandFacesApplied: true } : {}),
        activeWorkspaceId,
        workspaces,
        folders,
        bots: filedBots,
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
        await renameWithRetry(temporaryPath, this.#statePath);
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
    folders: [],
    bots: [],
  };
}

function isStoredFolder(value: unknown): value is SidebarFolder {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.workspaceId === "string" &&
    typeof value.name === "string" &&
    (value.parentId === null || typeof value.parentId === "string")
  );
}

/** Windows refuses a rename for a moment while an antivirus or indexer holds the target. */
async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
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
    isAvatarColor(value.avatarColor) &&
    (value.avatarModel === undefined ||
      value.avatarModel === null ||
      isCrewAvatar(value.avatarModel)) &&
    (value.template === undefined || isBotTemplateRef(value.template)) &&
    (value.pendingRuntime === undefined ||
      value.pendingRuntime === null ||
      isPendingRuntime(value.pendingRuntime)) &&
    (value.folderId === undefined ||
      value.folderId === null ||
      typeof value.folderId === "string") &&
    (value.branchedFrom === undefined ||
      value.branchedFrom === null ||
      isBranchOrigin(value.branchedFrom))
  );
}

function isBranchOrigin(value: unknown): value is BranchOrigin {
  return (
    isRecord(value) &&
    typeof value.botId === "string" &&
    typeof value.name === "string" &&
    typeof value.messageId === "string" &&
    typeof value.createdAt === "string"
  );
}

function isPendingRuntime(value: unknown): value is PendingBotRuntime {
  return isRecord(value) && isAgentModel(value.model) && isReasoningEffort(value.reasoningEffort);
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
