import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  crashReporter,
  desktopCapturer,
  dialog,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  type OpenDialogOptions,
  powerMonitor,
  protocol,
  type SaveDialogOptions,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import { AdaptiveOrchestrator } from "../backend/adaptive-orchestrator";
import { memoryCategory } from "../backend/agent-memory-store";
import { AgentService } from "../backend/agent-service";
import { ApprovalStore } from "../backend/approval-store";
import { isUnderRoots, localAttachmentPath, mimeTypeFor } from "../backend/attachment-text";
import { BotStore } from "../backend/bot-store";
import { createCoworkerBrowser } from "../backend/browser-factory";
import type { CoworkerBrowser } from "../backend/browser-host";
import { browserPagesFromAudit } from "../backend/browser-state";
import { BusinessStore } from "../backend/business-store";
import {
  resolveClaudeCli,
  resolveCodexCli,
  resolveOpenCodeCli,
  setCliVersionCache,
  setRuntimeDirectory,
  setToolsDirectory,
} from "../backend/cli";
import { MAX_INSTRUCTIONS_CHARS } from "../backend/coworker-instructions";
import { CustomSkills } from "../backend/custom-skills";
import { DesktopHost } from "../backend/desktop/desktop-host";
import { desktopControlSupported } from "../backend/desktop/desktop-tools";
import { EngineSettingsStore } from "../backend/engine-settings";
import { FeatureRegistry } from "../backend/feature-registry";
import { DEFAULT_GEMINI_ACCOUNT_ID, GeminiAccountStore } from "../backend/gemini-accounts";
import { COMPOSIO_SECRET, ComposioClient } from "../backend/integrations/composio-client";
import { onCorruptFileRecovered } from "../backend/json-file";
import type { KnowledgeApi } from "../backend/knowledge/knowledge-api";
import { KnowledgeHost } from "../backend/knowledge/knowledge-host";
import { MailboxStore } from "../backend/mailbox-store";
import { McpServerStore } from "../backend/mcp-servers";
import { OrchestratorStore } from "../backend/orchestrator-store";
import { classifyCommand } from "../backend/permission-policy";
import { PermissionService } from "../backend/permission-service";
import { ProviderSetup } from "../backend/provider-setup";
import { createRoutineExecutor } from "../backend/routine-executor";
import { importDesktopRoutinesOnce } from "../backend/routine-import";
import { parseRoutineCadence, parseRoutineTrigger, RoutineStore } from "../backend/routine-store";
import { RunEventStore } from "../backend/run-events";
import { parseCadence, ScheduleStore } from "../backend/schedule-store";
import { SecretCodec, SecretStore } from "../backend/secret-store";
import { SharedFiles } from "../backend/shared-files";
import { LearnedSkills, SkillLibrary } from "../backend/skill-library";
import { TelegramBridge } from "../backend/telegram-bridge";
import { UsageService } from "../backend/usage-service";
import { VerificationRepairEngine } from "../backend/verification-repair-engine";
import { VoiceService } from "../backend/voice/voice-service";
import {
  chatWorkflow,
  parseWorkflowJson,
  renderWorkflow,
  routineWorkflow,
  suggestAssignments,
  teamRunWorkflow,
  workflowFileName,
} from "../backend/workflow-export";
import {
  type AgentEvent,
  type AgentProviderId,
  type AiRuntimeStatus,
  type AiToolId,
  type AppInfo,
  type ApprovalCategory,
  type AppSetupState,
  type BrowserBounds,
  type BrowserOpenInput,
  type BrowserVisibilityInput,
  type CancelQueuedMessageInput,
  type CreateScheduleInput,
  type DecideApprovalInput,
  type DesktopPlatform,
  type ExternalDestination,
  type ImportAttachmentsInput,
  type InterruptTurnInput,
  IPC_CHANNELS,
  isAgentModel,
  isAgentProvider,
  isAiToolId,
  isAvatarColor,
  isAvatarShape,
  isBotTemplateRef,
  isMessageReaction,
  isReasoningEffort,
  type MacPermissionId,
  type MacPermissionsState,
  type McpServerInput,
  type OpenAttachmentInput,
  type OpenSharedFileInput,
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionLevel,
  type ReadConversationOptions,
  type RespondToPromptInput,
  type SaveBusinessTargetInput,
  type SendMessageInput,
  type SetQueuePausedInput,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type StartOrchestratorRunInput,
  type StorageCleanInput,
  type TargetPeriod,
  type UpdateBotInput,
  type WorkflowDoc,
} from "../shared/ipc";
import { AgentInitializationGate } from "./agent-initialization";
import {
  type AgentNotificationContent,
  notificationForAgentEvent,
  notificationsForNewApprovals,
} from "./agent-notifications";
import { AiRuntimeService } from "./ai-runtime-service";
import { AppLog } from "./app-log";
import { BackgroundTray, shouldHideToTray } from "./background-tray";
import { useOwnClaudeAccount } from "./claude-account";
import { pruneCrashDumps, redactErrorForLog } from "./crash-dumps";
import {
  cleanStorage,
  exportDiagnostics,
  exportSahkarmiData,
  readStorageUsage,
} from "./maintenance-service";
import { cleanUpRuntimes, markRuntimeStarted } from "./runtime-cleanup";
import { readSetupState, writeSetupState } from "./setup-store";
import { removeOrphanGeminiHomes, removeOrphanPartitions } from "./storage-cleanup";
import { handleTrusted } from "./trusted-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";
import {
  fileInstallAttemptStore,
  runningInstallerName,
  supportsInstalledUpdates,
  UpdateService,
} from "./update-service";

if (!app.isPackaged) {
  // SAHKARMI_DEV_USER_DATA lets a test run use a throwaway profile instead of "Sahkarmi Dev".
  app.setPath(
    "userData",
    process.env.SAHKARMI_DEV_USER_DATA?.trim() || join(app.getPath("appData"), "Sahkarmi Dev"),
  );
}
app.enableSandbox();
// Development runs get their own ID: sharing it made Windows show the Electron logo for the
// installed app in the taskbar.
if (process.platform === "win32")
  app.setAppUserModelId(app.isPackaged ? "in.sahkarmi.desktop" : "in.sahkarmi.desktop.dev");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
// A second instance has nothing to do: leave at once (the first instance gets "second-instance").
if (!hasSingleInstanceLock) app.exit(0);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sahkarmi-app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "sahkarmi-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const appLog = new AppLog(app.getPath("userData"));

// Crash dumps are written locally only (nothing is uploaded) next to the app data, so a crash
// can be looked at; pruneCrashDumps keeps the newest few.
try {
  app.setPath("crashDumps", join(app.getPath("userData"), "Crashpad"));
  crashReporter.start({ uploadToServer: false });
} catch (error) {
  appLog.write("warn", "crash reporter did not start", String(error));
}

/** True once the window has loaded; before that a main-process error is a failed start. */
let mainProcessStarted = false;
const mainProcessErrors: number[] = [];

/**
 * A stray exception in a timer or callback used to show Electron's error dialog over the app.
 * It is logged (secrets masked) and the app carries on: coworkers run in their own processes and
 * every store writes atomically. A burst is logged only partly so the log cannot fill up.
 */
function logMainProcessError(kind: string, error: unknown): void {
  const now = Date.now();
  while (mainProcessErrors.length && now - (mainProcessErrors[0] ?? 0) > 60_000) {
    mainProcessErrors.shift();
  }
  mainProcessErrors.push(now);
  if (mainProcessErrors.length > 20) return;
  console.error(`Main process ${kind}:`, error);
  appLog.write("error", `main process ${kind}`, redactErrorForLog(error, homedir()));
}

process.on("uncaughtException", (error) => {
  logMainProcessError("uncaught exception", error);
  if (mainProcessStarted) return;
  dialog.showErrorBox(
    "Sahkarmi couldn’t start",
    `${error.message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.`,
  );
  app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logMainProcessError("unhandled promise rejection", reason);
});

/** Store files that were unreadable at startup and replaced by defaults; told to the owner once. */
const corruptFileNotices: string[] = [];
onCorruptFileRecovered((recovery) => {
  appLog.write("warn", "store file unreadable; moved aside and started with defaults", {
    reason: recovery.reason,
    backup: recovery.backupPath,
  });
  corruptFileNotices.push(`${recovery.reason}\nKept as: ${recovery.backupPath}`);
  showCorruptFileNotices();
});

function showCorruptFileNotices(): void {
  if (!mainProcessStarted || !mainWindow || mainWindow.isDestroyed()) return;
  if (corruptFileNotices.length === 0) return;
  // A box owned by a hidden window stays hidden too (first start, or the tray): wait for it.
  if (!mainWindow.isVisible()) {
    mainWindow.once("show", showCorruptFileNotices);
    return;
  }
  const detail = corruptFileNotices.splice(0).join("\n\n");
  void dialog
    .showMessageBox(mainWindow, {
      type: "warning",
      title: "Sahkarmi",
      message: "Some settings could not be read and were reset",
      detail: `${detail}\n\nSahkarmi started with default settings for these. The unreadable copies were kept, not deleted. Check your permissions in Settings.`,
    })
    .catch((error) => appLog.write("warn", "could not show the reset notice", String(error)));
}

/** Settings → Features → "Keep running in the tray"; set once the feature list is loaded. */
let keepRunningInTray: () => boolean = () => false;
let backgroundTray: BackgroundTray | null = null;
let trayHintShown = false;
/** Coworker queues that "Pause all coworkers" paused, so resuming leaves the owner's own pauses. */
const pausedByTray = new Set<string>();
let allPaused = false;
/** Window focus refreshes models, updates and AI tools at most this often. */
const FOCUS_REFRESH_MS = 10 * 60_000;
let mainWindow: BrowserWindow | null = null;
nativeTheme.on("updated", () => {
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0F1220" : "#FBF7F0");
});
let browserHost: CoworkerBrowser | null = null;
let agentService: AgentService | null = null;
let mailboxStore: MailboxStore | null = null;
let updateService: UpdateService | null = null;
let aiRuntimeService: AiRuntimeService | null = null;
let scheduleStore: ScheduleStore | null = null;
let knowledgeService: KnowledgeApi | null = null;
let routineStore: RoutineStore | null = null;
let telegramBridge: TelegramBridge | null = null;
let usageService: UsageService | null = null;
let isQuitting = false;
let shutdownStarted = false;

const SETUP_FILE = "sahkarmi-setup-v2.json";
const BROWSER_STATE_FILE = "sahkarmi-browser-state-v1.json";
const BROWSER_PROFILE_DIR = "coworker-browser-profile";

const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "agent-setup": "https://github.com/ganguydhrubo/sahakarmi/blob/main/docs/TROUBLESHOOTING.md",
  feedback: "https://github.com/ganguydhrubo/sahakarmi/issues/new/choose",
  message: "https://github.com/ganguydhrubo/sahakarmi/discussions",
};

function configureContentSecurityPolicy(): void {
  const developmentSources = app.isPackaged ? "" : " http://localhost:* ws://localhost:*";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: sahkarmi-attachment: https:",
    "font-src 'self' data:",
    // Voice-note previews play the just-recorded audio from a blob: URL made by the app itself.
    "media-src 'self' blob:",
    `connect-src 'self'${developmentSources}`,
    "object-src 'none'",
    "frame-src 'self' sahkarmi-attachment:",
    "base-uri 'none'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

function registerExtensionsIpc(skills: CustomSkills, mcp: McpServerStore): void {
  const text = (input: unknown, key: string) =>
    isObject(input) && typeof input[key] === "string" ? (input[key] as string) : "";
  handleTrusted(IPC_CHANNELS.customSkillsList, () => skills.list());
  handleTrusted(IPC_CHANNELS.customSkillsAdd, (input: unknown) =>
    skills.addFromText(text(input, "text")),
  );
  handleTrusted(IPC_CHANNELS.customSkillsPreviewGithub, (input: unknown) =>
    skills.previewGithub(text(input, "url")),
  );
  handleTrusted(IPC_CHANNELS.customSkillsInstallGithub, (input: unknown) =>
    skills.installGithub(
      text(input, "url"),
      isObject(input) && Array.isArray(input.paths)
        ? input.paths.filter((path): path is string => typeof path === "string")
        : [],
    ),
  );
  handleTrusted(IPC_CHANNELS.customSkillsRemove, (input: unknown) =>
    skills.remove(requireString(isObject(input) ? input.id : null, "id")),
  );
  handleTrusted(IPC_CHANNELS.customSkillsMarkReviewed, (input: unknown) =>
    skills.markReviewed(requireString(isObject(input) ? input.id : null, "id")),
  );
  handleTrusted(IPC_CHANNELS.mcpList, () => mcp.list());
  handleTrusted(IPC_CHANNELS.mcpSave, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid MCP server.");
    return mcp.save(input as unknown as McpServerInput);
  });
  handleTrusted(IPC_CHANNELS.mcpImportJson, (input: unknown) =>
    mcp.importJson(text(input, "text")),
  );
  handleTrusted(IPC_CHANNELS.mcpGithubJson, (input: unknown) => mcp.githubJson(text(input, "url")));
  handleTrusted(IPC_CHANNELS.mcpSetEnabled, (input: unknown) =>
    mcp.setEnabled(
      requireString(isObject(input) ? input.id : null, "id"),
      isObject(input) && input.enabled === true,
    ),
  );
  handleTrusted(IPC_CHANNELS.mcpRemove, (input: unknown) =>
    mcp.remove(requireString(isObject(input) ? input.id : null, "id")),
  );
}

/**
 * handleTrusted for a service initialised after the window shows: each call first waits for
 * `ready`, so an early request from the page still gets a loaded answer.
 */
function trustedAfter(ready: Promise<unknown>) {
  return <Arguments extends unknown[], Result>(
    channel: string,
    handler: (...arguments_: Arguments) => Result,
  ): void =>
    handleTrusted(channel, async (...arguments_: Arguments) => {
      await ready;
      return handler(...arguments_);
    });
}

function registerKnowledgeIpc(knowledge: KnowledgeApi, ready: Promise<unknown>): void {
  const handleTrusted = trustedAfter(ready);
  const kbId = (value: unknown) => requireString(value, "knowledgeBaseId");
  handleTrusted(IPC_CHANNELS.knowledgeList, () => knowledge.list());
  handleTrusted(IPC_CHANNELS.knowledgeCreate, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid knowledge base.");
    return knowledge.create({
      name: requireString(input.name, "name"),
      workspaceId: requireString(input.workspaceId, "workspaceId"),
    });
  });
  handleTrusted(IPC_CHANNELS.knowledgeUpdate, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid knowledge base.");
    return knowledge.update({
      id: kbId(input.id),
      name: typeof input.name === "string" ? input.name : undefined,
      botIds: Array.isArray(input.botIds)
        ? input.botIds.filter((id): id is string => typeof id === "string")
        : undefined,
      privacy:
        input.privacy === "owner" || input.privacy === "coworkers" ? input.privacy : undefined,
    });
  });
  handleTrusted(IPC_CHANNELS.knowledgeDelete, (id: unknown) => knowledge.delete(kbId(id)));
  handleTrusted(IPC_CHANNELS.knowledgeAddFiles, async (input: unknown) => {
    if (isObject(input) && Array.isArray(input.paths)) {
      const paths = input.paths.filter((path): path is string => typeof path === "string");
      return paths.length ? knowledge.addFiles(kbId(input.kbId), paths) : knowledge.list();
    }
    const id = input;
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Documents",
          extensions: [
            "pdf",
            "docx",
            "pptx",
            "xlsx",
            "csv",
            "tsv",
            "md",
            "markdown",
            "txt",
            "log",
            "json",
            "html",
            "htm",
          ],
        },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return knowledge.list();
    return knowledge.addFiles(kbId(id), result.filePaths);
  });
  handleTrusted(IPC_CHANNELS.knowledgeAddFolder, async (id: unknown) => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return knowledge.list();
    return knowledge.addFolder(kbId(id), folder);
  });
  handleTrusted(IPC_CHANNELS.knowledgeRemoveFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid request.");
    return knowledge.removeFolder(kbId(input.kbId), requireString(input.folderId, "folderId"));
  });
  handleTrusted(IPC_CHANNELS.knowledgeRemoveSource, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid request.");
    return knowledge.removeSource(kbId(input.kbId), requireString(input.sourceId, "sourceId"));
  });
  handleTrusted(IPC_CHANNELS.knowledgeSetSourceEnabled, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid request.");
    return knowledge.setSourceEnabled(
      kbId(input.kbId),
      requireString(input.sourceId, "sourceId"),
      input.enabled === true,
    );
  });
  handleTrusted(IPC_CHANNELS.knowledgeSync, (id: unknown) => knowledge.sync(kbId(id)));
  handleTrusted(IPC_CHANNELS.knowledgeSearch, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid search.");
    return knowledge.search({
      query: requireString(input.query, "query"),
      kbIds: Array.isArray(input.kbIds)
        ? input.kbIds.filter((id): id is string => typeof id === "string")
        : undefined,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    });
  });
  handleTrusted(IPC_CHANNELS.knowledgeOpenSource, async (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid request.");
    const path = await knowledge.sourcePath(
      kbId(input.kbId),
      requireString(input.documentId, "documentId"),
    );
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  handleTrusted(IPC_CHANNELS.knowledgeSemanticStatus, () => knowledge.semanticStatus());
  handleTrusted(IPC_CHANNELS.knowledgeSemanticInstall, () => knowledge.installSemantic());
  handleTrusted(IPC_CHANNELS.knowledgeSemanticRemove, () => knowledge.removeSemantic());
}

function registerTelegramIpc(telegram: TelegramBridge): void {
  handleTrusted(IPC_CHANNELS.telegramStatus, () => telegram.status());
  handleTrusted(IPC_CHANNELS.telegramSetToken, (input: unknown) =>
    telegram.setToken(isObject(input) && typeof input.token === "string" ? input.token : ""),
  );
  handleTrusted(IPC_CHANNELS.telegramSetCoworker, (input: unknown) =>
    telegram.setCoworker(requireString(isObject(input) ? input.botId : null, "botId")),
  );
  handleTrusted(IPC_CHANNELS.telegramUnpair, () => telegram.unpair());
}

function registerIpcHandlers(
  service: AgentService,
  mailbox: MailboxStore,
  browser: CoworkerBrowser,
  updater: UpdateService,
  setupFile: string,
  initializeAgent: () => Promise<void>,
  schedules: ScheduleStore,
  sharedFiles: SharedFiles,
  permissions: PermissionService,
  usage: UsageService,
  features: FeatureRegistry,
  business: BusinessStore,
  routines: RoutineStore,
  aiRuntime: AiRuntimeService,
  orchestrator: AdaptiveOrchestrator,
  store: BotStore,
  composio: ComposioClient,
): void {
  const featureContext = () => ({
    platform: process.platform as DesktopPlatform,
    appVersion: app.getVersion(),
    providers: service.getStatus().providers ?? [],
  });
  handleTrusted(IPC_CHANNELS.getAppInfo, (): AppInfo => {
    const platform = process.platform;
    if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
      throw new Error(`Unsupported desktop platform: ${platform}`);
    }
    return { name: app.getName(), version: app.getVersion(), platform };
  });
  handleTrusted(IPC_CHANNELS.getSetupState, () => readSetupState(setupFile));
  handleTrusted(IPC_CHANNELS.saveSetup, async (input: unknown): Promise<AppSetupState> => {
    const preferredProvider = parseProvider(input);
    const state = await writeSetupState(setupFile, preferredProvider);
    await service.setPreferredProvider(preferredProvider);
    await initializeAgent();
    return state;
  });
  handleTrusted(IPC_CHANNELS.getMacPermissions, readMacPermissions);
  handleTrusted(IPC_CHANNELS.requestMacPermission, (permission: unknown) =>
    requestMacPermission(parseMacPermission(permission)),
  );
  handleTrusted(IPC_CHANNELS.openExternal, (destination: unknown) => {
    if (destination !== "agent-setup" && destination !== "feedback" && destination !== "message") {
      throw new Error("Unknown external destination.");
    }
    return shell.openExternal(EXTERNAL_DESTINATIONS[destination]);
  });
  handleTrusted(IPC_CHANNELS.openUrl, (value: unknown) => {
    const url = new URL(requireString(value, "URL"));
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
      throw new Error("Only HTTP(S) and email links can open outside Sahkarmi.");
    }
    return shell.openExternal(url.toString());
  });
  handleTrusted(IPC_CHANNELS.setTheme, (value: unknown) => {
    if (value !== "system" && value !== "light" && value !== "dark")
      throw new Error("Invalid theme.");
    nativeTheme.themeSource = value;
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0F1220" : "#FBF7F0");
  });
  handleTrusted(IPC_CHANNELS.updateGetStatus, () => updater.getStatus());
  handleTrusted(IPC_CHANNELS.updateCheck, () => updater.checkForUpdates());
  handleTrusted(IPC_CHANNELS.updateDownload, () => updater.downloadUpdate());
  handleTrusted(IPC_CHANNELS.updateInstall, () => updater.installUpdate());
  handleTrusted(IPC_CHANNELS.aiRuntimeGetStatus, () => aiRuntime.getStatus());
  handleTrusted(IPC_CHANNELS.aiRuntimeCheck, () => aiRuntime.check());
  handleTrusted(IPC_CHANNELS.aiRuntimeUpdate, async (toolId: unknown) => {
    const result = await aiRuntime.update(parseAiToolId(toolId));
    void service.refreshModels().catch(() => {});
    return result;
  });
  handleTrusted(IPC_CHANNELS.maintenanceExportData, () =>
    exportSahkarmiData({ service, mailbox, parentWindow: mainWindow }),
  );
  handleTrusted(IPC_CHANNELS.maintenanceExportDiagnostics, () =>
    exportDiagnostics({ service, browser, updater, parentWindow: mainWindow }),
  );
  const storageContext = {
    userData: app.getPath("userData"),
    transfersRoot: join(store.sharedRoot, "Transfers"),
    botIds: () => store.list().map((bot) => bot.id),
    mailbox,
  };
  handleTrusted(IPC_CHANNELS.maintenanceStorageUsage, () => readStorageUsage(storageContext));
  handleTrusted(IPC_CHANNELS.maintenanceStorageClean, (input: unknown) =>
    cleanStorage(storageContext, parseStorageClean(input)),
  );

  handleTrusted(IPC_CHANNELS.agentGetStatus, () => service.getStatus());
  handleTrusted(IPC_CHANNELS.agentGetUsage, () => service.getUsage());
  handleTrusted(IPC_CHANNELS.agentListModels, () => service.listModels());
  handleTrusted(IPC_CHANNELS.agentProbeProviders, () => service.probeProviders());
  handleTrusted(IPC_CHANNELS.agentRefreshModels, async () => {
    await service.refreshModels(true);
    return service.listModels();
  });
  handleTrusted(IPC_CHANNELS.agentListBots, () => service.listBots());
  handleTrusted(IPC_CHANNELS.agentCreateBot, (workspaceId: unknown) =>
    service.createBot(
      workspaceId === undefined || workspaceId === null
        ? undefined
        : requireString(workspaceId, "workspaceId"),
    ),
  );
  /** A deleted coworker leaves nothing behind that still names it. */
  async function removeBotRecords(id: string): Promise<void> {
    await schedules.deleteBotData(id);
    await routines.deleteBotData(id);
    await business.clearBot(id);
    await permissions.deleteBotData(id);
  }

  handleTrusted(IPC_CHANNELS.agentUpdateBot, (input: unknown) =>
    service.updateBot(parseUpdateBot(input)),
  );
  handleTrusted(IPC_CHANNELS.agentDeleteBot, async (botId: unknown) => {
    const id = requireString(botId, "botId");
    await service.deleteBot(id);
    await removeBotRecords(id);
  });
  handleTrusted(IPC_CHANNELS.agentReadConversation, (botId: unknown, options: unknown) =>
    service.readConversation(requireString(botId, "botId"), readConversationOptions(options)),
  );
  handleTrusted(IPC_CHANNELS.agentSearchMessages, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid search request.");
    return service.searchMessages({
      query: requireString(input.query, "query"),
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : undefined,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    });
  });
  handleTrusted(IPC_CHANNELS.agentSendMessage, (input: unknown) =>
    service.sendMessage(parseSendMessage(input)),
  );
  handleTrusted(IPC_CHANNELS.agentSetMessageReaction, (input: unknown) => {
    const parsed = parseMessageReaction(input);
    return service.setMessageReaction(parsed);
  });
  handleTrusted(IPC_CHANNELS.agentChooseAttachments, async () => {
    const options: OpenDialogOptions = { properties: ["openFile", "multiSelections"] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : service.prepareAttachments(result.filePaths);
  });
  handleTrusted(IPC_CHANNELS.agentImportAttachments, (input: unknown) => {
    const parsed = parseImportAttachments(input);
    return service.prepareImportedAttachments(parsed.paths, parsed.data);
  });
  handleTrusted(IPC_CHANNELS.agentDiscardDraftAttachment, (attachmentId: unknown) =>
    service.discardDraftAttachment(requireString(attachmentId, "attachmentId")),
  );
  handleTrusted(IPC_CHANNELS.agentOpenAttachment, async (input: unknown) => {
    const parsed = parseOpenAttachment(input);
    const localPath = localAttachmentPath(parsed.attachmentId);
    const attachment = localPath
      ? isUnderRoots(localPath, [store.botsRoot, store.sharedRoot])
        ? { path: localPath }
        : null
      : await mailbox.resolveAttachment(parsed.attachmentId);
    if (!attachment) throw new Error("Attachment was not found.");
    if (parsed.action === "reveal") {
      shell.showItemInFolder(attachment.path);
      return;
    }
    const error = await shell.openPath(attachment.path);
    if (error) throw new Error(error);
  });
  handleTrusted(IPC_CHANNELS.agentReadInstructions, (botId: unknown) =>
    service.readInstructions(requireString(botId, "botId")),
  );
  handleTrusted(IPC_CHANNELS.agentSaveInstructions, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid instructions request.");
    const text = typeof input.text === "string" ? input.text : "";
    if (text.length > MAX_INSTRUCTIONS_CHARS) {
      throw new Error(
        `Instructions are limited to ${MAX_INSTRUCTIONS_CHARS.toLocaleString()} characters.`,
      );
    }
    return service.saveInstructions({
      botId: requireString(input.botId, "botId"),
      text,
      expectedHash: typeof input.expectedHash === "string" ? input.expectedHash.slice(0, 64) : null,
    });
  });
  handleTrusted(IPC_CHANNELS.agentRevealInstructions, async (botId: unknown) => {
    shell.showItemInFolder(await service.instructionsFilePath(requireString(botId, "botId")));
  });
  handleTrusted(IPC_CHANNELS.agentBranchConversation, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid branch request.");
    return service.branchConversation({
      botId: requireString(input.botId, "botId"),
      messageId: requireString(input.messageId, "messageId"),
    });
  });
  handleTrusted(IPC_CHANNELS.agentListQueue, (botId: unknown) =>
    service.listQueue(requireString(botId, "botId")),
  );
  handleTrusted(IPC_CHANNELS.agentCancelQueuedMessage, (input: unknown) => {
    const parsed = parseCancelQueuedMessage(input);
    return service.cancelQueuedMessage(parsed.botId, parsed.deliveryId);
  });
  handleTrusted(IPC_CHANNELS.agentRerunInterrupted, (input: unknown) => {
    const parsed = parseCancelQueuedMessage(input);
    return service.rerunInterrupted(parsed.botId, parsed.deliveryId);
  });
  handleTrusted(IPC_CHANNELS.agentDismissInterrupted, (input: unknown) => {
    const parsed = parseCancelQueuedMessage(input);
    return service.dismissInterrupted(parsed.botId, parsed.deliveryId);
  });
  handleTrusted(IPC_CHANNELS.agentSendQueuedNow, (input: unknown) => {
    const parsed = parseCancelQueuedMessage(input);
    return service.sendQueuedNow(parsed.botId, parsed.deliveryId);
  });
  handleTrusted(IPC_CHANNELS.agentSetQueuePaused, (input: unknown) => {
    const parsed = parseSetQueuePaused(input);
    return service.setQueuePaused(parsed.botId, parsed.paused);
  });
  handleTrusted(IPC_CHANNELS.agentInterrupt, (input: unknown) => {
    const parsed = parseInterrupt(input);
    return service.interrupt(parsed.botId, parsed.turnId);
  });
  handleTrusted(IPC_CHANNELS.agentRespondToPrompt, (input: unknown) =>
    service.respondToPrompt(parsePromptResponse(input)),
  );

  handleTrusted(IPC_CHANNELS.browserOpen, (input: unknown) => {
    const parsed = parseBrowserOpen(input);
    return browser.open(parsed.url, parsed.ownerThreadId ?? null, parsed.ownerBotId ?? null);
  });
  handleTrusted(IPC_CHANNELS.browserActivate, (tabId: unknown) =>
    browser.activate(requireString(tabId, "tabId")),
  );
  handleTrusted(IPC_CHANNELS.browserClose, (tabId: unknown) =>
    browser.close(requireString(tabId, "tabId")),
  );
  handleTrusted(IPC_CHANNELS.browserListTabs, () => browser.listTabs());
  handleTrusted(IPC_CHANNELS.browserGetControlState, () => browser.getControlState());
  handleTrusted(IPC_CHANNELS.browserSetVisible, async (input: unknown) => {
    const parsed = parseVisibility(input);
    await browser.setVisible(parsed);
  });
  handleTrusted(IPC_CHANNELS.browserGetTakeover, () => service.getTakeover());
  handleTrusted(IPC_CHANNELS.browserTakeOver, () => service.takeOverBrowser());
  handleTrusted(IPC_CHANNELS.browserHandBack, (note: unknown) =>
    service.handBackBrowser(typeof note === "string" && note.trim() ? note : null),
  );
  handleTrusted(IPC_CHANNELS.browserDeclineTakeover, (note: unknown) =>
    service.declineBrowserTakeover(typeof note === "string" && note.trim() ? note : null),
  );
  handleTrusted(IPC_CHANNELS.browserPreview, (tabId: unknown) =>
    browser
      .preview(requireString(tabId, "tabId"))
      .then((image) => (image ? previewThumbnail(image) : null))
      .catch(() => null),
  );
  handleTrusted(IPC_CHANNELS.secureInputList, () => service.listSecureInputs());
  handleTrusted(IPC_CHANNELS.secureInputSubmit, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid secure input.");
    return service.submitSecureInput(
      requireString(input.id, "id"),
      typeof input.value === "string" ? input.value : "",
    );
  });
  handleTrusted(IPC_CHANNELS.secureInputDismiss, (id: unknown) =>
    service.dismissSecureInput(requireString(id, "id")),
  );
  handleTrusted(IPC_CHANNELS.secureInputTakeOver, (id: unknown) =>
    service.takeOverSecureInput(requireString(id, "id")),
  );

  handleTrusted(IPC_CHANNELS.teamListWorkspaces, () => service.listWorkspaces());
  handleTrusted(IPC_CHANNELS.teamCreateWorkspace, (name: unknown) =>
    service.createWorkspace(requireString(name, "name")),
  );
  handleTrusted(IPC_CHANNELS.teamRenameWorkspace, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid workspace rename request.");
    return service.renameWorkspace(
      requireString(input.workspaceId, "workspaceId"),
      requireString(input.name, "name"),
    );
  });
  handleTrusted(IPC_CHANNELS.teamSetActiveWorkspace, (workspaceId: unknown) =>
    service.setActiveWorkspace(requireString(workspaceId, "workspaceId")),
  );

  handleTrusted(IPC_CHANNELS.teamDeleteWorkspace, async (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid workspace delete request.");
    const { state, deletedBotIds } = await service.deleteWorkspace({
      workspaceId: requireString(input.workspaceId, "workspaceId"),
      moveCoworkersTo:
        input.moveCoworkersTo === null
          ? null
          : requireString(input.moveCoworkersTo, "moveCoworkersTo"),
    });
    for (const id of deletedBotIds) await removeBotRecords(id);
    return state;
  });
  handleTrusted(IPC_CHANNELS.teamCreateFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid folder request.");
    return service.createFolder({
      workspaceId: requireString(input.workspaceId, "workspaceId"),
      name: requireString(input.name, "name"),
      parentId:
        input.parentId === null || input.parentId === undefined
          ? null
          : requireString(input.parentId, "parentId"),
    });
  });
  handleTrusted(IPC_CHANNELS.teamRenameFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid folder request.");
    return service.renameFolder(
      requireString(input.folderId, "folderId"),
      requireString(input.name, "name"),
    );
  });
  handleTrusted(IPC_CHANNELS.teamMoveFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid folder request.");
    return service.moveFolder(
      requireString(input.folderId, "folderId"),
      input.parentId === null ? null : requireString(input.parentId, "parentId"),
    );
  });
  handleTrusted(IPC_CHANNELS.teamReorderFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid folder request.");
    if (input.direction !== "up" && input.direction !== "down") throw new Error("Bad direction.");
    return service.reorderFolder(requireString(input.folderId, "folderId"), input.direction);
  });
  handleTrusted(IPC_CHANNELS.teamDeleteFolder, (folderId: unknown) =>
    service.deleteFolder(requireString(folderId, "folderId")),
  );
  handleTrusted(IPC_CHANNELS.teamSetBotFolder, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid folder request.");
    return service.setBotFolder(
      requireString(input.botId, "botId"),
      input.folderId === null ? null : requireString(input.folderId, "folderId"),
    );
  });
  handleTrusted(IPC_CHANNELS.teamSetWorkspaceCeo, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid CEO request.");
    return service.setWorkspaceCeo(
      requireString(input.workspaceId, "workspaceId"),
      input.botId === null ? null : requireString(input.botId, "botId"),
    );
  });
  handleTrusted(IPC_CHANNELS.teamUnbindPublishingAccount, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid request.");
    const platform = input.platform as SocialPlatform;
    if (!SOCIAL_PLATFORMS.includes(platform)) throw new Error("Unknown platform.");
    if (input.source !== "browser" && input.source !== "composio") {
      throw new Error("Unknown account source.");
    }
    return service.unbindPublishingAccount(
      requireString(input.botId, "botId"),
      platform,
      input.source,
    );
  });

  handleTrusted(IPC_CHANNELS.approvalsListAuthority, () => service.listApprovalAuthority());
  handleTrusted(IPC_CHANNELS.approvalsGrantAuthority, (input: unknown) => {
    if (!isObject(input) || !Array.isArray(input.categories)) {
      throw new Error("Invalid authority request.");
    }
    return service.grantApprovalAuthority({
      workspaceId: requireString(input.workspaceId, "workspaceId"),
      categories: input.categories as ApprovalCategory[],
      hours: Number(input.hours),
    });
  });
  handleTrusted(IPC_CHANNELS.approvalsRevokeAuthority, (grantId: unknown) =>
    service.revokeApprovalAuthority(requireString(grantId, "grantId")),
  );

  handleTrusted(IPC_CHANNELS.approvalsList, () => service.listApprovals());
  handleTrusted(IPC_CHANNELS.approvalsDecide, (input: unknown) =>
    // Only the trusted renderer reaches this channel, so the decision-maker is the owner at
    // this computer. Telegram supplies its own, verified, decidedBy.
    service.decideApproval({ ...parseDecideApproval(input), decidedBy: "desktop" }),
  );

  handleTrusted(IPC_CHANNELS.permissionsGet, () => permissions.get());
  handleTrusted(IPC_CHANNELS.permissionsSetLevel, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid permission update.");
    const category = requireString(input.category, "category") as PermissionCategory;
    const level = requireString(input.level, "level") as PermissionLevel;
    if (!PERMISSION_CATEGORIES.includes(category) || !PERMISSION_LEVELS.includes(level)) {
      throw new Error("Invalid permission update.");
    }
    return permissions.setLevel(category, level);
  });
  handleTrusted(IPC_CHANNELS.permissionsAddGrant, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid pre-authorisation.");
    const category = requireString(input.category, "category") as PermissionCategory;
    if (!PERMISSION_CATEGORIES.includes(category)) throw new Error("Unknown permission category.");
    const botId = typeof input.botId === "string" && input.botId ? input.botId : null;
    if (botId && !service.listBots().some((bot) => bot.id === botId)) {
      throw new Error("Unknown coworker.");
    }
    return permissions.addGrant({
      category,
      botId,
      hours: Number(input.hours),
      maxUses: input.maxUses === null || input.maxUses === undefined ? null : Number(input.maxUses),
      note: typeof input.note === "string" ? input.note : "",
    });
  });
  handleTrusted(IPC_CHANNELS.permissionsRevokeGrant, (grantId: unknown) =>
    permissions.revokeGrant(requireString(grantId, "grantId")),
  );
  handleTrusted(IPC_CHANNELS.permissionsAudit, () => permissions.audit());
  handleTrusted(IPC_CHANNELS.permissionsClearAudit, () => permissions.clearAudit());
  handleTrusted(IPC_CHANNELS.permissionsSetAutoMode, (enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid auto mode request.");
    return permissions.setAutoMode(enabled);
  });

  handleTrusted(IPC_CHANNELS.usageOverview, () => service.usageOverview());
  handleTrusted(IPC_CHANNELS.usageRefresh, () => service.refreshUsage());
  handleTrusted(IPC_CHANNELS.usageClear, async () => {
    await usage.clear();
    return service.usageOverview();
  });

  handleTrusted(IPC_CHANNELS.featuresList, () => features.list(featureContext()));
  handleTrusted(IPC_CHANNELS.featuresSetEnabled, async (input: unknown) => {
    if (!isObject(input) || typeof input.enabled !== "boolean") {
      throw new Error("Invalid feature update.");
    }
    await features.setEnabled(requireString(input.featureId, "featureId"), input.enabled);
    return features.list(featureContext());
  });
  handleTrusted(IPC_CHANNELS.featuresPreviewManifest, (json: unknown) =>
    features.preview(requireString(json, "json"), app.getVersion()),
  );
  handleTrusted(IPC_CHANNELS.featuresApplyManifest, async (json: unknown) => {
    await features.apply(requireString(json, "json"), app.getVersion());
    return features.list(featureContext());
  });
  handleTrusted(IPC_CHANNELS.featuresResetCatalogue, async () => {
    await features.resetCatalogue();
    return features.list(featureContext());
  });

  handleTrusted(IPC_CHANNELS.businessIntegrations, () => business.integrations());
  const skills = new SkillLibrary(sharedFiles.root);
  handleTrusted(IPC_CHANNELS.marketplaceInstalledSkills, () => skills.installed());
  handleTrusted(IPC_CHANNELS.marketplaceInstallSkill, (skillId: unknown) =>
    skills.install(requireString(skillId, "skillId")),
  );
  handleTrusted(IPC_CHANNELS.marketplaceUninstallSkill, (skillId: unknown) =>
    skills.uninstall(requireString(skillId, "skillId")),
  );
  const learnedSkills = new LearnedSkills(sharedFiles.root);
  handleTrusted(IPC_CHANNELS.marketplaceLearnedSkills, () => learnedSkills.list());
  handleTrusted(IPC_CHANNELS.marketplaceRemoveLearnedSkill, (skillId: unknown) =>
    learnedSkills.remove(requireString(skillId, "skillId")),
  );
  handleTrusted(IPC_CHANNELS.businessListTargets, () => business.listTargets());
  handleTrusted(IPC_CHANNELS.businessSaveTarget, (input: unknown) =>
    business.saveTarget(parseSaveTarget(input)),
  );
  handleTrusted(IPC_CHANNELS.businessDeleteTarget, (targetId: unknown) =>
    business.deleteTarget(requireString(targetId, "targetId")),
  );

  handleTrusted(IPC_CHANNELS.composioGetStatus, () => composio.getStatus());
  handleTrusted(IPC_CHANNELS.composioSetApiKey, (input: unknown) => {
    const key = isObject(input) && typeof input.key === "string" ? input.key : "";
    return composio.setApiKey(key);
  });
  handleTrusted(IPC_CHANNELS.composioListApps, (input: unknown) =>
    composio.listApps(isObject(input) && input.refresh === true),
  );
  handleTrusted(IPC_CHANNELS.composioConnectApp, (input: unknown) => {
    const appId = isObject(input) && typeof input.appId === "string" ? input.appId : "";
    return composio.initiateConnection(appId);
  });
  handleTrusted(IPC_CHANNELS.composioConnectionStatus, (input: unknown) => {
    const connectionId =
      isObject(input) && typeof input.connectionId === "string" ? input.connectionId : "";
    return composio.getConnectionStatus(connectionId);
  });
  handleTrusted(IPC_CHANNELS.composioDisconnectApp, (input: unknown) => {
    const connectionId =
      isObject(input) && typeof input.connectionId === "string" ? input.connectionId : "";
    return composio.deleteConnection(connectionId);
  });

  handleTrusted(IPC_CHANNELS.schedulesList, () => schedules.list());
  handleTrusted(IPC_CHANNELS.schedulesCreate, (input: unknown) => {
    const parsed = parseCreateSchedule(input);
    if (!service.listBots().some((bot) => bot.id === parsed.botId)) {
      throw new Error("Unknown coworker.");
    }
    return schedules.create(parsed);
  });
  handleTrusted(IPC_CHANNELS.schedulesSetEnabled, (input: unknown) => {
    if (!isObject(input) || typeof input.enabled !== "boolean") {
      throw new Error("Invalid schedule update.");
    }
    return schedules.setEnabled(requireString(input.scheduleId, "scheduleId"), input.enabled);
  });
  handleTrusted(IPC_CHANNELS.schedulesDelete, (scheduleId: unknown) =>
    schedules.delete(requireString(scheduleId, "scheduleId")),
  );
  handleTrusted(IPC_CHANNELS.schedulesRunNow, (scheduleId: unknown) =>
    schedules.runNow(requireString(scheduleId, "scheduleId")),
  );

  handleTrusted(IPC_CHANNELS.routinesList, () => routines.state());
  handleTrusted(IPC_CHANNELS.workflowExport, async (input: unknown) => {
    if (!isObject(input) || !isObject(input.source)) throw new Error("Invalid export.");
    const format = input.format === "txt" || input.format === "json" ? input.format : "md";
    const source = input.source;
    const bots = service.listBots();
    let doc: WorkflowDoc;
    if (source.kind === "chat") {
      const botId = requireString(source.botId, "botId");
      const bot = bots.find((candidate) => candidate.id === botId);
      if (!bot) throw new Error("Unknown coworker.");
      const snapshot = await service.readConversation(botId);
      doc = chatWorkflow(bot, snapshot.messages, source.scope === "all" ? "all" : "last", bots);
    } else if (source.kind === "team-run") {
      const run = await orchestrator.getRun(requireString(source.runId, "runId"));
      if (!run) throw new Error("That team run no longer exists.");
      doc = teamRunWorkflow(run, bots);
    } else if (source.kind === "routine") {
      const state = await routines.state();
      const routine = state.routines.find((candidate) => candidate.id === source.routineId);
      if (!routine) throw new Error("That routine no longer exists.");
      doc = routineWorkflow(routine, state, bots);
    } else {
      throw new Error("Invalid export.");
    }
    const folder = join(store.sharedRoot, "Exports");
    await mkdir(folder, { recursive: true });
    const options: SaveDialogOptions = {
      title: "Export workflow",
      defaultPath: join(folder, workflowFileName(doc, format)),
      filters: [
        format === "md"
          ? { name: "Markdown", extensions: ["md"] }
          : format === "txt"
            ? { name: "Text", extensions: ["txt"] }
            : { name: "Sahkarmi workflow (JSON)", extensions: ["json"] },
      ],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, renderWorkflow(doc, format), "utf8");
    return { path: result.filePath };
  });
  handleTrusted(IPC_CHANNELS.workflowReadImport, async () => {
    const options: OpenDialogOptions = {
      title: "Import workflow",
      properties: ["openFile"],
      filters: [{ name: "Sahkarmi workflow (JSON)", extensions: ["json"] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    if ((await stat(path)).size > 2_000_000)
      throw new Error("That file is too large for a workflow.");
    const doc = parseWorkflowJson(await readFile(path, "utf8"));
    return { doc, suggestions: suggestAssignments(doc, service.listBots()) };
  });
  handleTrusted(IPC_CHANNELS.routinesSave, async (input: unknown) => {
    if (!isObject(input) || !Array.isArray(input.steps)) throw new Error("Invalid routine.");
    const known = new Set(service.listBots().map((bot) => bot.id));
    const steps = input.steps.map((step) => {
      if (!isObject(step)) throw new Error("Invalid routine step.");
      const botId = requireString(step.botId, "botId");
      if (!known.has(botId)) throw new Error("Unknown coworker.");
      return {
        id: typeof step.id === "string" ? step.id : undefined,
        botId,
        instruction: typeof step.instruction === "string" ? step.instruction : "",
      };
    });
    const trigger = input.trigger ? await parseRoutineTrigger(input.trigger) : null;
    return routines.save({
      id: typeof input.id === "string" && input.id ? input.id : undefined,
      name: typeof input.name === "string" ? input.name : "",
      steps,
      cadence: trigger || input.cadence === null ? null : parseRoutineCadence(input.cadence),
      trigger,
      enabled: input.enabled === true,
      confirmFrequent: input.confirmFrequent === true,
    });
  });
  handleTrusted(IPC_CHANNELS.routinesPickFolder, async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const folder = result.filePaths[0];
    return result.canceled || !folder ? null : folder;
  });
  handleTrusted(IPC_CHANNELS.routinesDelete, (routineId: unknown) =>
    routines.delete(requireString(routineId, "routineId")),
  );
  handleTrusted(IPC_CHANNELS.routinesSetEnabled, (input: unknown) => {
    if (!isObject(input) || typeof input.enabled !== "boolean") {
      throw new Error("Invalid routine update.");
    }
    return routines.setEnabled(requireString(input.routineId, "routineId"), input.enabled);
  });
  handleTrusted(IPC_CHANNELS.routinesRunNow, (routineId: unknown) =>
    routines.runNow(requireString(routineId, "routineId")),
  );

  handleTrusted(IPC_CHANNELS.filesList, (directory: unknown) =>
    sharedFiles.list(typeof directory === "string" ? directory : ""),
  );
  handleTrusted(IPC_CHANNELS.filesAdd, async (directory: unknown) => {
    const folder = typeof directory === "string" ? directory : "";
    const options: OpenDialogOptions = { properties: ["openFile", "multiSelections"] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? sharedFiles.list(folder) : sharedFiles.add(result.filePaths, folder);
  });
  handleTrusted(IPC_CHANNELS.filesOpen, async (input: unknown) => {
    const parsed = parseOpenSharedFile(input);
    const target = sharedFiles.resolve(parsed.path);
    if (parsed.action === "reveal") {
      shell.showItemInFolder(target);
      return;
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  handleTrusted(IPC_CHANNELS.orchestratorGetRuns, () => orchestrator.getRuns());
  handleTrusted(IPC_CHANNELS.orchestratorGetRun, (runId: unknown) => {
    if (typeof runId !== "string") throw new Error("Invalid runId");
    return orchestrator.getRun(runId);
  });
  handleTrusted(IPC_CHANNELS.orchestratorStartRun, (input: unknown) => {
    if (!isObject(input) || typeof input.objective !== "string") {
      throw new Error("Invalid StartOrchestratorRunInput");
    }
    const check = input.checkCommand ?? null;
    if (check !== null && (typeof check !== "string" || check.length > 500)) {
      throw new Error("Invalid check command.");
    }
    const workspacePath = store.sharedRoot;
    const existingBots = store.list();
    return orchestrator.startRun(
      input as unknown as StartOrchestratorRunInput,
      workspacePath,
      existingBots,
    );
  });
  handleTrusted(IPC_CHANNELS.orchestratorPauseRun, (runId: unknown) => {
    if (typeof runId !== "string") throw new Error("Invalid runId");
    return orchestrator.pauseRun(runId);
  });
  handleTrusted(IPC_CHANNELS.orchestratorResumeRun, (runId: unknown) => {
    if (typeof runId !== "string") throw new Error("Invalid runId");
    return orchestrator.resumeRun(runId, store.sharedRoot);
  });
  handleTrusted(IPC_CHANNELS.orchestratorCancelRun, (runId: unknown) => {
    if (typeof runId !== "string") throw new Error("Invalid runId");
    return orchestrator.cancelRun(runId);
  });
  handleTrusted(IPC_CHANNELS.memoryList, async (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid memory list request.");
    const workspaceId = requireString(input.workspaceId, "workspaceId");
    const category = typeof input.category === "string" ? input.category : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 200;
    const offset = typeof input.offset === "number" ? input.offset : 0;
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (query) {
      const memories = await service.memoryStore.search(workspaceId, query, { category, limit });
      return { memories, total: memories.length, offset: 0 };
    }
    return service.memoryStore.list(workspaceId, { category, limit, offset });
  });
  handleTrusted(IPC_CHANNELS.memorySave, (entry: unknown) => {
    if (!isObject(entry) || typeof entry.key !== "string" || typeof entry.content !== "string") {
      throw new Error("Invalid memory entry: key and content required");
    }
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === "string")
      : [];
    return service.memoryStore.save({
      workspaceId: requireString(entry.workspaceId, "workspaceId"),
      key: entry.key,
      content: entry.content,
      category: memoryCategory(entry.category),
      tags,
      authorBotId: typeof entry.authorBotId === "string" ? entry.authorBotId : undefined,
      id: typeof entry.id === "string" ? entry.id : undefined,
    });
  });
  handleTrusted(IPC_CHANNELS.memoryDelete, (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid memory id");
    return service.memoryStore.delete(
      requireString(input.id, "id"),
      requireString(input.workspaceId, "workspaceId"),
    );
  });
}

function parseDecideApproval(value: unknown): DecideApprovalInput {
  if (!isObject(value) || (value.decision !== "approved" && value.decision !== "rejected")) {
    throw new Error("Invalid approval decision.");
  }
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string") {
    throw new Error("Invalid approval note.");
  }
  return {
    approvalId: requireString(value.approvalId, "approvalId"),
    decision: value.decision,
    note: typeof value.note === "string" ? value.note : null,
  };
}

function parseCreateSchedule(value: unknown): CreateScheduleInput {
  if (!isObject(value)) throw new Error("Invalid schedule.");
  return {
    botId: requireString(value.botId, "botId"),
    text: requireString(value.text, "text"),
    cadence: parseCadence(value.cadence),
  };
}

function parseOpenSharedFile(value: unknown): OpenSharedFileInput {
  if (!isObject(value) || (value.action !== "open" && value.action !== "reveal")) {
    throw new Error("Invalid file action.");
  }
  return { path: typeof value.path === "string" ? value.path : "", action: value.action };
}

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function windowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

/** The last window position and size, if it still lands on a connected display. */
function readWindowState(): WindowState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(windowStatePath(), "utf8"));
    if (!isObject(parsed)) return null;
    const { x, y, width, height, maximized } = parsed;
    if (typeof width !== "number" || typeof height !== "number" || width < 960 || height < 640) {
      return null;
    }
    const state: WindowState = { width, height, maximized: maximized === true };
    if (typeof x === "number" && typeof y === "number") {
      const visible = screen.getAllDisplays().some(({ workArea }) => {
        return (
          x + 80 < workArea.x + workArea.width &&
          x + width - 80 > workArea.x &&
          y + 40 < workArea.y + workArea.height &&
          y >= workArea.y - 8
        );
      });
      if (visible) Object.assign(state, { x, y });
    }
    return state;
  } catch {
    return null;
  }
}

function rememberWindowState(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
    const state: WindowState = { ...bounds, maximized: window.isMaximized() };
    void writeFile(windowStatePath(), JSON.stringify(state)).catch(() => undefined);
  };
  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  window.on("resize", scheduleSave);
  window.on("move", scheduleSave);
  window.on("maximize", scheduleSave);
  window.on("unmaximize", scheduleSave);
  window.on("close", save);
}

function createWindow(): BrowserWindow {
  const icon = windowIcon();
  const saved = readWindowState();
  const window = new BrowserWindow({
    width: saved?.width ?? 1200,
    height: saved?.height ?? 820,
    ...(saved?.x !== undefined && saved?.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0F1220" : "#FBF7F0",
    title: "Sahkarmi",
    ...(icon ? { icon } : {}),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 13, y: 14 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  if (icon && process.platform === "win32") {
    window.setIcon(icon);
  }

  window.once("ready-to-show", () => {
    if (saved?.maximized) window.maximize();
    window.show();
  });
  rememberWindowState(window);
  window.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      window.hide();
    } else if (
      shouldHideToTray({
        platform: process.platform,
        enabled: keepRunningInTray(),
        quitting: isQuitting,
      })
    ) {
      // Background mode: schedules, routines and Telegram keep running; Quit is in the tray.
      event.preventDefault();
      window.hide();
      showBackgroundTray();
    }
  });
  // Windows is signing out or shutting down: never hold it up by hiding to the tray.
  window.on("session-end", () => {
    isQuitting = true;
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // The app window may use the microphone (voice notes, after the owner presses record) and the
  // clipboard (copy buttons), nothing else. Coworker browser tabs use their own session, which
  // denies everything.
  const allowed = (contents: Electron.WebContents | null, permission: string, types?: string[]) =>
    contents === window.webContents &&
    isTrustedRendererUrl(contents.getURL()) &&
    (permission === "clipboard-sanitized-write" ||
      (permission === "media" && (types ?? ["audio"]).every((type) => type === "audio")));
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const types = "mediaTypes" in details ? details.mediaTypes : undefined;
      callback(allowed(contents, permission, types));
    },
  );
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowed(contents, permission, details.mediaType ? [details.mediaType] : undefined),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  // A crashed or killed window page used to leave a blank window until the app was restarted.
  // It loads again (coworkers keep running in the main process); a page that keeps dying is
  // left alone after a few tries in a short time, so it cannot loop.
  const reloads: number[] = [];
  window.webContents.on("render-process-gone", (_event, details) => {
    appLog.write("error", "window page stopped", details);
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const now = Date.now();
    while (reloads.length && now - (reloads[0] ?? 0) > 5 * 60_000) reloads.shift();
    if (reloads.length >= 3) return;
    reloads.push(now);
    void loadRenderer(window).catch(() => undefined);
  });
  window.on("unresponsive", () => appLog.write("warn", "window not responding"));
  window.on("responsive", () => appLog.write("info", "window responding again"));

  return window;
}

/** The Sahkarmi logo for the window and taskbar (.ico on Windows for crisp small sizes). */
function windowIcon(): Electron.NativeImage | undefined {
  if (process.platform === "darwin") return undefined;
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icons", process.platform === "win32" ? "icon.ico" : "icon.png")]
    : [
        join(
          __dirname,
          "../../build",
          process.platform === "win32" ? "icon.ico" : "icons/512x512.png",
        ),
      ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) return undefined;
  const img = nativeImage.createFromPath(found);
  return img.isEmpty() ? undefined : img;
}

function loadRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  return developmentUrl
    ? window.loadURL(developmentUrl)
    : window.loadURL("sahkarmi-app://app/index.html");
}

function configureApplicationMenu(service: AgentService, updater: UpdateService): void {
  if (process.platform !== "darwin") {
    // No menu bar on Windows and Linux: nothing for the Alt key to pop up over the chat.
    // Copy, paste and the usual editing keys work without one; "Stop all agents" keeps its key.
    Menu.setApplicationMenu(null);
    const stopAllShortcut = (window: BrowserWindow) => {
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.control && !input.alt && input.key === ".") {
          event.preventDefault();
          void service.interruptAll();
        }
      });
    };
    if (mainWindow && !mainWindow.isDestroyed()) stopAllShortcut(mainWindow);
    app.on("browser-window-created", (_event, window) => stopAllShortcut(window));
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: "appMenu",
        submenu: [
          {
            label: "Stop all agents",
            accelerator: "CommandOrControl+.",
            click: () => void service.interruptAll(),
          },
          { type: "separator" },
          {
            label: "Check for Updates…",
            click: () => void updater.checkForUpdates(),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

/** Approval requests that already raised a notification (or appeared while the owner looked). */
const notifiedApprovals = new Set<string>();

/** The owner is looking at Sahkarmi: the window is shown, not minimised, and focused. */
function ownerIsPresent(): boolean {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized() &&
      mainWindow.isFocused(),
  );
}

function forwardAgentEvent(event: AgentEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.agentEvent, event);
  if (event.type === "approvals-changed") {
    // Tracked even while the owner is looking, so a card they already saw never pops up later.
    const contents = notificationsForNewApprovals(
      event.approvals,
      agentService?.listBots() ?? [],
      notifiedApprovals,
    );
    if (ownerIsPresent() || !Notification.isSupported()) return;
    for (const content of contents) showAgentNotification(content);
    return;
  }
  if (mainWindow.isFocused() || !Notification.isSupported()) return;

  const content = notificationForAgentEvent(event, agentService?.listBots() ?? []);
  if (!content) return;
  showAgentNotification(content);
}

function showAgentNotification(content: AgentNotificationContent): void {
  const notification = new Notification({ title: content.title, body: content.body });
  notification.on("click", () => openMainWindow(content.botId ?? null, content.approvalId));
  notification.show();
}

/** Brings the window back (from the tray too) and, when given, opens that coworker's chat. */
function openMainWindow(botId: string | null = null, approvalId?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (botId || approvalId) {
    mainWindow.webContents.send(IPC_CHANNELS.agentEvent, {
      type: "open-requested",
      botId,
      ...(approvalId ? { approvalId } : {}),
    } satisfies AgentEvent);
  }
}

function showBackgroundTray(): void {
  if (!backgroundTray) {
    const icon = windowIcon() ?? nativeImage.createEmpty();
    backgroundTray = new BackgroundTray(icon, {
      open: () => openMainWindow(),
      setPaused: (paused) => void setAllCoworkersPaused(paused),
      isPaused: () => allPaused,
      quit: () => app.quit(),
    });
  }
  backgroundTray.show();
  if (!trayHintShown && Notification.isSupported()) {
    trayHintShown = true;
    const hint = new Notification({
      title: "Sahkarmi is still running",
      body: "Schedules and routines keep working. Right-click the tray icon to pause or quit.",
    });
    hint.on("click", () => openMainWindow());
    hint.show();
  }
}

/**
 * Tray → "Pause all coworkers": stops running turns, pauses every queue and holds schedules and
 * routines until resumed. Not remembered across a restart.
 */
async function setAllCoworkersPaused(paused: boolean): Promise<void> {
  allPaused = paused;
  scheduleStore?.setPaused(paused);
  routineStore?.setPaused(paused);
  const service = agentService;
  if (!service) return;
  try {
    if (paused) {
      await service.interruptAll();
      for (const bot of service.listBots()) {
        if (service.listQueue(bot.id).paused && !pausedByTray.has(bot.id)) continue;
        pausedByTray.add(bot.id);
        await service.setQueuePaused(bot.id, true);
      }
    } else {
      for (const botId of [...pausedByTray]) {
        pausedByTray.delete(botId);
        await service.setQueuePaused(botId, false).catch(() => undefined);
      }
    }
  } catch (error) {
    appLog.write("error", paused ? "pause all failed" : "resume all failed", String(error));
  }
  backgroundTray?.refresh();
}

let selfUpdateCheck: Promise<boolean> | null = null;

/**
 * macOS only replaces an app with a Developer ID signature; ad-hoc signed (unsigned) builds fail
 * at install. Detected once from the running bundle's signature.
 */
function cannotSelfUpdate(): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  selfUpdateCheck ??= new Promise((resolve) => {
    const bundle = join(dirname(app.getPath("exe")), "..", "..");
    execFile("codesign", ["-dv", "--verbose=2", bundle], (_error, stdout, stderr) => {
      resolve(!/Authority=Developer ID Application/.test(`${stdout}${stderr}`));
    });
  });
  return selfUpdateCheck;
}

let providerSetup: ProviderSetup | null = null;
let secretStore: SecretStore | null = null;
let secretCodec: SecretCodec | null = null;
const SECRET_STORE_FILE = "secrets.enc.json";
let voiceService: VoiceService | null = null;
let desktopHost: DesktopHost | null = null;

/** Two minutes of 16 kHz audio is the longest clip one dictation request may carry. */
const MAX_DICTATION_SAMPLES = 16_000 * 120;

function registerVoiceHandlers(voice: VoiceService, ready: Promise<unknown>): void {
  const handleTrusted = trustedAfter(ready);
  const modelId = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-z0-9-]{2,40}$/.test(value)) {
      throw new Error("Unknown voice model.");
    }
    return value;
  };
  handleTrusted(IPC_CHANNELS.voiceGetState, () => voice.getState());
  handleTrusted(IPC_CHANNELS.voiceInstall, (value: unknown) => voice.install(modelId(value)));
  handleTrusted(IPC_CHANNELS.voiceCancel, (value: unknown) => voice.cancel(modelId(value)));
  handleTrusted(IPC_CHANNELS.voiceRemove, (value: unknown) => voice.remove(modelId(value)));
  handleTrusted(IPC_CHANNELS.voiceSetSettings, (value: unknown) => {
    if (!isObject(value)) throw new Error("Invalid voice settings.");
    return voice.setSettings(value);
  });
  handleTrusted(IPC_CHANNELS.voiceTranscribe, (value: unknown) => {
    if (!(value instanceof Float32Array) || value.length > MAX_DICTATION_SAMPLES) {
      throw new Error("That recording is too long. Keep it under two minutes.");
    }
    return voice.transcribe(value);
  });
  handleTrusted(IPC_CHANNELS.voiceSpeak, (value: unknown) => {
    if (typeof value !== "string") throw new Error("Nothing to read aloud.");
    return voice.speak(value);
  });
}

function registerGeminiAccountHandlers(
  accounts: GeminiAccountStore,
  setup: ProviderSetup,
  service: AgentService,
): void {
  const accountId = (value: unknown) => {
    if (typeof value !== "string" || !value || value.length > 64) {
      throw new Error("Unknown Google account.");
    }
    return value;
  };
  // Sign-ins run in the background; their progress reaches the Gemini row as setup events.
  const signIn = (id: string) => {
    if (id === DEFAULT_GEMINI_ACCOUNT_ID) void setup.connect("antigravity");
    else void setup.signInGeminiAccount(accounts.homeOf(id));
  };
  handleTrusted(IPC_CHANNELS.geminiAccountsList, () => accounts.list());
  handleTrusted(IPC_CHANNELS.geminiAccountsAdd, async () => {
    signIn(await accounts.add());
    return accounts.list();
  });
  handleTrusted(IPC_CHANNELS.geminiAccountsSignIn, async (value: unknown) => {
    const id = accountId(value);
    accounts.homeOf(id);
    signIn(id);
    return accounts.list();
  });
  handleTrusted(IPC_CHANNELS.geminiAccountsUse, async (value: unknown) => {
    const id = accountId(value);
    const changed = accounts.activeId() !== id;
    await accounts.setActive(id);
    if (changed) void service.switchGeminiAccount().catch(() => undefined);
    return accounts.list();
  });
  handleTrusted(IPC_CHANNELS.geminiAccountsRemove, async (value: unknown) => {
    const id = accountId(value);
    const wasActive = accounts.activeId() === id;
    await accounts.remove(id);
    if (wasActive) void service.switchGeminiAccount().catch(() => undefined);
    return accounts.list();
  });
}

function registerProviderSetupHandlers(setup: ProviderSetup): void {
  const provider = (value: unknown) => {
    if (!isAgentProvider(value)) throw new Error("Unknown provider.");
    return value;
  };
  handleTrusted(IPC_CHANNELS.providerSetupList, () => setup.list());
  handleTrusted(IPC_CHANNELS.providerSetupConnect, (value: unknown) =>
    setup.connect(provider(value)),
  );
  handleTrusted(IPC_CHANNELS.providerSetupCheck, (value: unknown) => setup.check(provider(value)));
  handleTrusted(IPC_CHANNELS.providerSetupSubmitCode, (input: unknown) => {
    if (!isObject(input) || typeof input.code !== "string") throw new Error("Invalid code.");
    return setup.submitCode(provider(input.provider), input.code);
  });
  handleTrusted(IPC_CHANNELS.providerSetupSetApiKey, (input: unknown) => {
    if (!isObject(input) || typeof input.apiKey !== "string") throw new Error("Invalid API key.");
    return setup.setApiKey(provider(input.provider), input.apiKey);
  });
}

/**
 * API keys live encrypted in secrets.enc.json (Windows DPAPI through safeStorage). Keys an older
 * Sahkarmi saved as plain .txt files are moved in once, and each file is removed only after its
 * encrypted copy reads back. Without DPAPI the old files stay and are used as before.
 */
async function restoreSavedApiKeys(): Promise<void> {
  const home = homedir();
  secretCodec = new SecretCodec(safeStorage);
  const store = new SecretStore({
    filePath: join(app.getPath("userData"), SECRET_STORE_FILE),
    codec: secretCodec,
    legacyFiles: {
      GEMINI_API_KEY: join(home, ".gemini", "antigravity-acp", "api_key.txt"),
      OPENAI_API_KEY: join(home, ".codex", "openai_api_key.txt"),
      ANTHROPIC_API_KEY: join(home, ".claude", "anthropic_api_key.txt"),
      [COMPOSIO_SECRET]: join(app.getPath("userData"), "composio_api_key.txt"),
    },
  });
  secretStore = store;
  try {
    await store.load();
    const { migrated, kept } = await store.migrate();
    if (migrated.length) appLog.write("info", "API keys moved to encrypted storage", migrated);
    if (kept.length) appLog.write("warn", "API keys left in their old files", kept);
  } catch (error) {
    appLog.write("warn", "encrypted key storage unavailable", String(error));
  }
  // Sahkarmi's own environment; each AI tool is then started with only its own key.
  const entries = await store.entries().catch((): Array<[string, string]> => []);
  for (const [name, value] of entries) {
    // Composio reads its key from the store itself.
    if (name === COMPOSIO_SECRET) continue;
    if (name === "GEMINI_API_KEY") {
      // A Google AI Studio key saved from the Google Antigravity tile.
      if (!process.env.GEMINI_API_KEY && !process.env.ANTIGRAVITY_API_KEY) {
        process.env.ANTIGRAVITY_API_KEY = value;
        process.env.GEMINI_API_KEY = value;
        process.env.GOOGLE_API_KEY = value;
      }
      continue;
    }
    if (!process.env[name]) process.env[name] = value;
  }
}

function forwardUpdateStatus(status: import("../shared/ipc").UpdateStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.updateEvent, status);
}

function forwardAiRuntimeStatus(status: AiRuntimeStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.aiRuntimeEvent, status);
}

const AI_RUNTIME_CHECK_INTERVAL_MS = 15 * 60 * 1_000;

function scheduleAiRuntimeChecks(): void {
  const timer = setInterval(() => {
    void aiRuntimeService?.check();
  }, AI_RUNTIME_CHECK_INTERVAL_MS);
  timer.unref?.();
  const firstCheck = setTimeout(() => {
    void aiRuntimeService?.check();
  }, 60_000);
  firstCheck.unref?.();
}

/**
 * Opening Sahkarmi while its update installer runs blocks the installer and starts the update
 * again. Instead, say so, close, and open again by itself once the installer has finished.
 */
/** Passed when the app is opened again after waiting for an installer, so it never waits twice. */
const AFTER_INSTALL_WAIT = "--after-install-wait";

/** The update installer still running, if any (tasklist runs alongside the rest of start-up). */
async function findRunningInstaller(): Promise<string | null> {
  if (process.platform !== "win32" || !app.isPackaged) return null;
  if (process.argv.includes(AFTER_INSTALL_WAIT)) return null;
  const tasks = await new Promise<string>((resolve) => {
    execFile(
      "tasklist",
      ["/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 5_000 },
      (error, stdout) => resolve(error ? "" : stdout),
    );
  });
  return runningInstallerName(tasks, app.getVersion());
}

async function waitForRunningInstaller(installer: string | null): Promise<boolean> {
  if (!installer) return false;
  const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const script = [
    `Wait-Process -Name ${quote(installer.replace(/\.exe$/i, ""))} -Timeout 300 -ErrorAction SilentlyContinue`,
    "Start-Sleep -Seconds 2",
    `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote(AFTER_INSTALL_WAIT)}`,
  ].join("; ");
  spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  ).unref();
  console.info(`[update] ${installer} is still installing; Sahkarmi will open after it finishes`);
  await dialog
    .showMessageBox({
      type: "info",
      title: "Sahkarmi",
      message: "Sahkarmi is finishing an update.",
      detail: "It will open by itself in a minute. You don't need to do anything.",
      buttons: ["OK"],
      signal: AbortSignal.timeout(10_000),
    })
    .catch(() => undefined);
  app.quit();
  return true;
}

function parseAiToolId(value: unknown): AiToolId {
  if (typeof value !== "string" || !isAiToolId(value)) throw new Error("Unknown AI tool.");
  return value;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      // tasklist takes a few hundred ms: it runs while everything else starts. The window only
      // shows once the page is loaded, which waits for this answer.
      const runningInstaller = findRunningInstaller().catch(() => null);
      configureContentSecurityPolicy();
      mainWindow = createWindow();
      // Work that the first screen does not need starts once the window is on screen.
      const shownWindow = mainWindow;
      const windowShown = new Promise<void>((resolve) => {
        shownWindow.once("ready-to-show", () => resolve());
        setTimeout(resolve, 15_000).unref?.();
      });
      await restoreSavedApiKeys();
      // Never blocks startup: only copies nobody uses are removed, so it can run alongside.
      void cleanUpRuntimes(app.getPath("userData"))
        .then(({ removed }) => {
          if (removed.length) appLog.write("info", "removed unused AI tool copies", removed);
        })
        .catch(() => undefined);
      await useOwnClaudeAccount(app.getPath("userData")).catch((error) =>
        appLog.write("warn", "claude account folder", String(error)),
      );
      const store = new BotStore(app.getPath("userData"), homedir());
      await store.initialize();
      // Browser data of deleted coworkers (their sessions are never opened again).
      void windowShown
        .then(() =>
          removeOrphanPartitions(
            app.getPath("userData"),
            store.list().map((bot) => bot.id),
          ),
        )
        .then(({ removed }) => {
          if (removed.length)
            appLog.write("info", "removed deleted coworkers' browser data", removed);
        })
        .catch(() => undefined);
      mailboxStore = new MailboxStore(app.getPath("userData"), store.sharedRoot);
      await mailboxStore.initialize();
      configureApplicationProtocol();
      configureAttachmentProtocol(mailboxStore, store);
      browserHost = createCoworkerBrowser(
        mainWindow,
        store.downloadsRoot,
        join(app.getPath("userData"), BROWSER_STATE_FILE),
        join(app.getPath("userData"), BROWSER_PROFILE_DIR),
      );
      await browserHost.restore({
        botOfThread: (threadId) =>
          store.list().find((bot) => bot.threadId === threadId)?.id ?? null,
        botIds: store.list().map((bot) => bot.id),
        loadUsedPages: () =>
          browserPagesFromAudit(join(app.getPath("userData"), "permission-audit.json")),
      });
      const setupFile = join(app.getPath("userData"), SETUP_FILE);
      const setupState = await readSetupState(setupFile);
      const permissions = new PermissionService(app.getPath("userData"));
      agentService = new AgentService(
        store,
        mailboxStore,
        browserHost,
        readComputerUsePrerequisites,
        30_000,
        setupState.preferredProvider ?? "opencode",
        new ApprovalStore(app.getPath("userData")),
        permissions,
      );
      const service = agentService;
      const geminiAccounts = new GeminiAccountStore(app.getPath("userData"));
      await geminiAccounts.initialize().catch((error) => {
        appLog.write(
          "error",
          "Google account list unreadable; using the first account",
          String(error),
        );
      });
      service.setGeminiAccounts(geminiAccounts);
      // Sign-in folders of Google accounts removed while Google's server still held them.
      void windowShown
        .then(() => removeOrphanGeminiHomes(app.getPath("userData")))
        .then(({ removed }) => {
          if (removed.length)
            appLog.write("info", "removed unused Google account folders", removed);
        })
        .catch(() => undefined);
      service.on("log", (message) => appLog.write("info", message));
      // A newly downloaded AI tool worked once: the copy it replaced can go now.
      service.on("runtime-started", (_provider, executable) => {
        const userData = app.getPath("userData");
        void markRuntimeStarted(userData, executable)
          .then((marked) => (marked ? cleanUpRuntimes(userData) : null))
          .then((result) => {
            if (result?.removed.length)
              appLog.write("info", "removed replaced AI tool copies", result.removed);
          })
          .catch(() => undefined);
      });
      const usage = new UsageService(app.getPath("userData"));
      await usage.initialize().catch((error) => {
        appLog.write("error", "usage ledger unreadable; starting a new one", String(error));
      });
      const composioClient = new ComposioClient({
        userDataPath: app.getPath("userData"),
        secrets: secretStore ?? undefined,
      });
      service.setUsageService(usage);
      service.setComposioClient(composioClient);
      if (desktopControlSupported()) {
        // Started on a coworker's first desktop step; Sahkarmi's own windows stay off limits.
        desktopHost = new DesktopHost({
          scriptDir: join(app.getPath("userData"), "desktop"),
          protectedPids: [process.pid],
        });
        service.setDesktopHost(desktopHost);
      }
      const mcpServers = new McpServerStore(app.getPath("userData"), undefined, secretCodec);
      await mcpServers.load().catch((error) => {
        appLog.write("error", "MCP server list unreadable; starting with none", String(error));
      });
      service.setMcpServers(mcpServers);
      registerExtensionsIpc(new CustomSkills(store.sharedRoot), mcpServers);
      usageService = usage;
      const features = new FeatureRegistry(app.getPath("userData"));
      service.configureContinuation(() => features.isEnabled("auto-continue"));
      const engineSettings = new EngineSettingsStore(app.getPath("userData"));
      await engineSettings.initialize();
      service.configureEngineSettings(() => engineSettings.get());
      let runEvents: RunEventStore | null = null;
      try {
        runEvents = new RunEventStore(join(app.getPath("userData"), "run-events.sqlite"));
        const recorder = runEvents;
        service.configureRunEvents((event) => recorder.record(event));
      } catch (error) {
        appLog.write("error", "Performance record unavailable", String(error));
      }
      registerEngineIpc(service, engineSettings, runEvents);
      keepRunningInTray = () => features.isEnabled("background-tray");
      // Approvals raised while the owner is away wait longer before they expire.
      service.setOwnerPresence(ownerIsPresent);
      service.configureLazyProviderStart(() => features.isEnabled("lean-runtime"));
      service.configureClaudeIdleClose(() => features.isEnabled("lean-runtime"));
      service.configureDeltaUpdates(() => features.isEnabled("chat-delta-updates"));
      // Knowledge Bases run in a utility process (indexing never blocks the window); the host
      // falls back to this process if it cannot start. It starts after the window shows.
      const knowledge = new KnowledgeHost(app.getPath("userData"), {
        fork: () =>
          utilityProcess.fork(join(__dirname, "knowledge-worker.js"), [], {
            serviceName: "Sahkarmi Knowledge",
          }),
      });
      knowledgeService = knowledge;
      knowledge.on("event", forwardAgentEvent);
      knowledge.on("log", (line: string) => appLog.write("warn", "knowledge", line));
      const knowledgeReady = windowShown.then(() =>
        knowledge.initialize().catch((error) => {
          appLog.write("error", "knowledge bases unreadable; starting empty", String(error));
        }),
      );
      service.configureMemory(() => features.isEnabled("memory-auto-context"));
      service.attachKnowledge(
        knowledge,
        () => features.isEnabled("knowledge-base") && features.isEnabled("knowledge-auto-context"),
        () => features.isEnabled("knowledge-base"),
      );
      registerKnowledgeIpc(knowledge, knowledgeReady);
      await features.initialize().catch((error) => {
        appLog.write("error", "feature settings unreadable; using defaults", String(error));
      });
      const business = new BusinessStore(app.getPath("userData"));
      await business.initialize();
      const schedules = new ScheduleStore(app.getPath("userData"));
      await schedules.initialize();
      scheduleStore = schedules;
      schedules.on("changed", (list) =>
        forwardAgentEvent({ type: "schedules-changed", schedules: list }),
      );
      const routines = new RoutineStore(app.getPath("userData"));
      await routines.initialize();
      // Bring the owner's routines from their previous desktop agent over once (paused), so a
      // switch loses nothing. Not needed for the first screen: it runs once the window shows.
      void windowShown
        .then(() =>
          importDesktopRoutinesOnce({
            userDataPath: app.getPath("userData"),
            sourceDatabase: join(app.getPath("appData"), "OpenBot", "openbot.db"),
            routineCount: routines.state().routines.length,
            coworkers: store.list(),
            save: (input) => routines.save(input),
          }),
        )
        .then((report) => {
          if (report)
            appLog.write("info", "Imported routines from the previous desktop agent", report);
        })
        .catch((error) =>
          appLog.write("warn", "Could not import routines from the previous desktop agent", error),
        );
      routineStore = routines;
      service.setRoutineHost(routines);
      routines.on("changed", (state) => forwardAgentEvent({ type: "routines-changed", state }));
      const sharedFiles = new SharedFiles(store.sharedRoot);
      const { autoUpdater } = electronUpdater;
      autoUpdater.logger = {
        info: (message) => appLog.write("info", "updater", message),
        warn: (message) => appLog.write("warn", "updater", message),
        error: (message) => appLog.write("error", "updater", message),
      };
      updateService = new UpdateService(autoUpdater, {
        currentVersion: app.getVersion(),
        enabled:
          app.isPackaged &&
          supportsInstalledUpdates(process.platform) &&
          existsSync(join(process.resourcesPath, "app-update.yml")),
        beforeInstall: prepareForShutdown,
        installAttempts: fileInstallAttemptStore(app.getPath("userData")),
        afterFailedInstall: () => {
          // beforeInstall already stopped the coworkers: start fresh so the owner can keep working.
          if (!shutdownStarted) return;
          appLog.write("warn", "updater", "Installer did not start; relaunching Sahkarmi");
          app.relaunch();
          app.exit(0);
        },
        unsupportedMessage: process.windowsStore
          ? "This copy of Sahkarmi is updated by the Microsoft Store."
          : undefined,
        autoDownload: () => permissions.get().levels.app_updates === "auto",
        manualInstall: () => cannotSelfUpdate(),
        openDownload: (version) =>
          shell.openExternal(
            process.platform === "win32"
              ? `https://github.com/ganguydhrubo/sahakarmi/releases/download/v${version}/Sahkarmi-${version}-x64.exe`
              : `https://github.com/ganguydhrubo/sahakarmi/releases/download/v${version}/Sahkarmi-${version}-arm64.dmg`,
          ),
      });
      service.on("event", forwardAgentEvent);
      let lastWakeWork = Date.now();
      const refreshOnWake = () => {
        lastWakeWork = Date.now();
        service.wakeIdleProviders();
        void service.refreshModels();
        void updateService?.checkOnWake();
        void aiRuntimeService?.check();
      };
      // Every click back into the window used to start a model refresh (one CLI per provider),
      // an update check and an AI-tool version check: a burst of processes and network calls
      // that made the window stutter. Focus now does it at most every few minutes; waking the
      // PC from sleep still does it at once, and the 15-minute timers keep running.
      const refreshOnFocus = () => {
        service.wakeIdleProviders();
        if (Date.now() - lastWakeWork >= FOCUS_REFRESH_MS) refreshOnWake();
      };
      mainWindow.on("focus", refreshOnFocus);
      // Minimised or hidden: coworker pages nobody is using slow down and go quiet.
      const browserForWindow = browserHost;
      const quietPages = (hidden: boolean) => () => {
        if (features.isEnabled("lean-runtime")) browserForWindow.setWindowHidden?.(hidden);
        else if (!hidden) browserForWindow.setWindowHidden?.(false);
      };
      mainWindow.on("minimize", quietPages(true));
      mainWindow.on("hide", quietPages(true));
      mainWindow.on("restore", quietPages(false));
      mainWindow.on("show", quietPages(false));
      powerMonitor.on("resume", refreshOnWake);
      mainWindow.once("closed", () => powerMonitor.removeListener("resume", refreshOnWake));
      service.on("event", (event) => {
        if (event.type === "error")
          appLog.write(
            "error",
            `${event.code}${event.botId ? ` (${event.botId})` : ""}: ${event.message}`,
          );
        else if (event.type === "models-changed") {
          appLog.write("info", "model catalog refreshed", { count: event.models.length });
        } else if (event.type === "status") {
          appLog.write("info", `agent status: ${event.status.phase}`, event.status.providers);
        }
      });
      updateService.on("status", forwardUpdateStatus);
      updateService.start();
      const toolsDirectory = join(app.getPath("userData"), "tools");
      setToolsDirectory(toolsDirectory);
      setCliVersionCache(join(app.getPath("userData"), "cli-versions.json"));
      const runtimeDirectory = join(app.getPath("userData"), "runtime");
      setRuntimeDirectory(runtimeDirectory);
      aiRuntimeService = new AiRuntimeService({
        runtimeDirectory,
        currentOpenCodeVersion: async () => {
          try {
            const resolved = await resolveOpenCodeCli();
            return resolved.version;
          } catch {
            return null;
          }
        },
        installedToolVersions: async () => {
          const versions: Record<string, string | null> = {};
          for (const provider of service.getStatus().providers ?? []) {
            versions[provider.id] = provider.version ?? null;
          }
          if (!versions.codex) {
            versions.codex = await resolveCodexCli()
              .then((c) => c.version)
              .catch(() => null);
          }
          if (!versions.claude) {
            versions.claude = await resolveClaudeCli()
              .then((c) => c.version)
              .catch(() => null);
          }
          return versions;
        },
        autoDownload: () => permissions.get().levels.app_updates === "auto",
        log: (level, message) => appLog.write(level, "ai-runtime", message),
        // Restarts that provider on the new copy now if it is idle, otherwise on a later refresh.
        onToolDownloaded: () => void service.refreshModels(true).catch(() => {}),
      });
      aiRuntimeService.onStatus(forwardAiRuntimeStatus);
      scheduleAiRuntimeChecks();
      providerSetup = new ProviderSetup({
        toolsDirectory,
        runtimeDirectory,
        recheck: (provider) => service.ensureProvider(provider),
        openUrl: (url) => void shell.openExternal(url),
        secrets: secretStore ?? undefined,
      });
      providerSetup.on("state", (state) => {
        if (state.phase === "failed") {
          appLog.write("warn", `provider connect failed: ${state.provider}`, state.message);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.providerSetupEvent, state);
        }
      });
      registerProviderSetupHandlers(providerSetup);
      registerGeminiAccountHandlers(geminiAccounts, providerSetup, service);
      voiceService = new VoiceService({ userDataPath: app.getPath("userData") });
      const voice = voiceService;
      const voiceReady = windowShown.then(() =>
        voice.initialize().catch((error) => {
          appLog.write("error", "voice settings unreadable; using defaults", String(error));
        }),
      );
      voiceService.on("state", (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.voiceEvent, state);
        }
      });
      registerVoiceHandlers(voiceService, voiceReady);
      const orchestratorStore = new OrchestratorStore(app.getPath("userData"));
      await orchestratorStore.initialize();
      const orchestrator = new AdaptiveOrchestrator(
        orchestratorStore,
        {
          port: {
            sendMessage: (input) => service.sendMessage(input),
            listQueue: (botId) => service.listQueue(botId),
            readConversation: (botId) => service.readConversation(botId),
            on: (event, listener) => service.on(event, listener),
            off: (event, listener) => service.off(event, listener),
            listBots: () => service.listBots(),
            listApprovals: () => service.listApprovals(),
            withdrawDelivery: (botId, deliveryId) => service.withdrawDelivery(botId, deliveryId),
          },
          checkpoints: () =>
            features.isEnabled("team-run-sqlite-checkpoints") ? "sqlite" : "json",
          review: () => features.isEnabled("cross-model-review"),
          planner: (workspaceId) => {
            if (!features.isEnabled("team-run-ai-planning")) return null;
            const workspaces = service.listWorkspaces().workspaces;
            const workspace =
              workspaces.find((candidate) => candidate.id === workspaceId) ?? workspaces[0];
            return workspace?.ceoBotId ?? null;
          },
        },
        {
          // The owner's check command runs only where the permission rules allow it.
          verifier: new VerificationRepairEngine(({ botId, command, cwd }) =>
            permissions.authorize(
              {
                botId,
                provider: "sahkarmi",
                category: classifyCommand(command),
                action: `Run the team run's check command: ${command}`,
                paths: [cwd],
                reason: "The owner set this check for the team run.",
              },
              [cwd],
            ),
          ),
        },
      );
      orchestrator.onEvent((event) => forwardAgentEvent(event));
      const agentInitialization = new AgentInitializationGate(() => service.initialize());
      registerIpcHandlers(
        service,
        mailboxStore,
        browserHost,
        updateService,
        setupFile,
        () => agentInitialization.start(),
        schedules,
        sharedFiles,
        permissions,
        usage,
        features,
        business,
        routines,
        aiRuntimeService,
        orchestrator,
        store,
        composioClient,
      );
      const telegram = new TelegramBridge({
        userDataPath: app.getPath("userData"),
        codec: secretCodec ?? undefined,
        agent: {
          listBots: () => service.listBots(),
          sendMessage: (input) => service.sendMessage(input),
          readConversation: (botId) => service.readConversation(botId),
          subscribe: (listener) => {
            service.on("event", listener);
            return () => service.off("event", listener);
          },
          // Remote approvals reuse the desktop path exactly: same store, same policy, same
          // audit trail. Telegram only ever decides requests the policy already raised.
          listApprovals: () => service.listApprovals(),
          decideApproval: (input) => service.decideApproval(input),
          permissionPolicy: () => service.permissionPolicy(),
          sweepExpiredApprovals: () => service.sweepExpiredApprovals(),
          recordApprovalDelivery: (approvalId, error) =>
            service.recordApprovalDelivery(approvalId, error),
          ceos: () => {
            const bots = service.listBots();
            return store
              .workspaces()
              .workspaces.flatMap((space) => bots.filter((bot) => bot.id === space.ceoBotId));
          },
          workspaceName: (workspaceId) =>
            store.workspaces().workspaces.find((space) => space.id === workspaceId)?.name ?? null,
        },
        log: (level, message, detail) => appLog.write(level, message, detail),
        // Secure configuration. Nothing is written to source control and the token is never
        // logged; it goes only to api.telegram.org.
        envToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
        envOwnerUserId: Number.parseInt(process.env.OWNER_TELEGRAM_ID ?? "", 10) || null,
        approvalsEnabled: process.env.SAHKARMI_TELEGRAM_APPROVALS !== "off",
      });
      telegramBridge = telegram;
      registerTelegramIpc(telegram);
      configureApplicationMenu(service, updateService);
      if (await waitForRunningInstaller(await runningInstaller)) return;
      await loadRenderer(mainWindow);
      mainProcessStarted = true;
      showCorruptFileNotices();
      void pruneCrashDumps(app.getPath("crashDumps"))
        .then((deleted) => {
          if (deleted) appLog.write("info", "removed old crash dumps", { deleted });
        })
        .catch(() => undefined);
      // Runs after the first successful start, including a retry from the window after a failed
      // first try; before, a failed first try left these off until the app restarted.
      agentInitialization.onReady(() => {
        schedules.start(async (task) => {
          await service.sendMessage({
            botId: task.botId,
            text: `[Scheduled task] ${task.text}`,
            origin: "schedule",
          });
        });
        routines.start(createRoutineExecutor(service));
        // A team run paused on an approval before the restart listens for the decision again.
        void orchestrator
          .restoreWaitingRuns()
          .catch((error) => appLog.write("error", "Team runs did not resume", error));
        void telegram
          .initialize()
          .catch((error) => appLog.write("error", "Telegram bridge did not start", error));
      });
      void agentInitialization.start().catch((error) => {
        console.error("Unable to initialize the local agent backend:", error);
        appLog.write("error", "Unable to initialize the local agent backend", error);
      });

      app.on("activate", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          return;
        }
        mainWindow = createWindow();
        void loadRenderer(mainWindow);
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Sahkarmi failed to start:", error);
      appLog.write("error", "Sahkarmi failed to start", error);
      dialog.showErrorBox(
        "Sahkarmi couldn’t start",
        `${message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.`,
      );
      app.quit();
    });
}

function readComputerUsePrerequisites(): {
  screenRecording: boolean;
  accessibility: boolean;
} {
  if (process.platform !== "darwin") {
    return { screenRecording: false, accessibility: false };
  }
  return {
    screenRecording: systemPreferences.getMediaAccessStatus("screen") === "granted",
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

function readMacPermissions(): MacPermissionsState {
  if (process.platform !== "darwin") {
    return { screenRecording: "unknown", accessibility: "unknown" };
  }
  return {
    screenRecording: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
      ? "granted"
      : "not-determined",
  };
}

async function requestMacPermission(permission: MacPermissionId): Promise<MacPermissionsState> {
  if (process.platform !== "darwin") return readMacPermissions();
  if (permission === "accessibility") {
    systemPreferences.isTrustedAccessibilityClient(true);
    return readMacPermissions();
  }

  const state = systemPreferences.getMediaAccessStatus("screen");
  if (state === "not-determined") {
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  } else if (state === "denied" || state === "unknown") {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  }
  return readMacPermissions();
}

function parseProvider(input: unknown): AgentProviderId {
  if (!input || typeof input !== "object") throw new Error("Setup input is required.");
  const provider = Reflect.get(input, "preferredProvider");
  if (!isAgentProvider(provider)) throw new Error("Unknown provider.");
  return provider;
}

function parseMacPermission(input: unknown): MacPermissionId {
  if (input !== "screen-recording" && input !== "accessibility") {
    throw new Error("Unknown macOS permission.");
  }
  return input;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  isQuitting = true;
  backgroundTray?.destroy();
  if (shutdownStarted) return;
  event.preventDefault();
  // A stuck agent process or dialog must never keep the app open after the owner quit it.
  const backstop = setTimeout(() => app.exit(0), QUIT_BACKSTOP_MS);
  backstop.unref?.();
  void prepareForShutdown().finally(() => app.quit());
});

const QUIT_BACKSTOP_MS = 8_000;

async function prepareForShutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  isQuitting = true;
  updateService?.stop();
  providerSetup?.stop();
  scheduleStore?.stop();
  routineStore?.stop();
  knowledgeService?.close();
  const cleanupTasks = Promise.all([
    browserHost?.destroy().catch(() => {}),
    telegramBridge?.stop().catch(() => {}),
    agentService?.stop().catch(() => {}),
    usageService?.flush().catch(() => {}),
    voiceService?.dispose().catch(() => {}),
    desktopHost?.dispose().catch(() => {}),
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  await Promise.race([cleanupTasks, timeout]);
}

function parseSaveTarget(value: unknown): SaveBusinessTargetInput {
  if (!isObject(value)) throw new Error("Invalid target.");
  const number = (field: unknown) =>
    field === null || field === undefined || field === "" ? null : Number(field);
  const targetValue = number(value.targetValue);
  if (targetValue === null) throw new Error("The target value is required.");
  const text = (field: unknown) => (typeof field === "string" ? field : "");
  return {
    id: typeof value.id === "string" && value.id ? value.id : undefined,
    title: requireString(value.title, "title"),
    metric: text(value.metric),
    unit: text(value.unit),
    targetValue,
    currentValue: number(value.currentValue),
    period: text(value.period) as TargetPeriod,
    dueDate: typeof value.dueDate === "string" && value.dueDate ? value.dueDate : null,
    botId: typeof value.botId === "string" && value.botId ? value.botId : null,
    notes: text(value.notes),
  };
}

function parseStorageClean(value: unknown): StorageCleanInput {
  if (!isObject(value) || typeof value.category !== "string") {
    throw new Error("Invalid storage clean request.");
  }
  if (value.category === "attachments") {
    const days = typeof value.olderThanDays === "number" ? value.olderThanDays : Number.NaN;
    if (!Number.isFinite(days) || days < 1) throw new Error("Choose at least 1 day.");
    return { category: "attachments", olderThanDays: Math.floor(days) };
  }
  if (["browser", "runtimes", "accounts", "logs"].includes(value.category)) {
    return { category: value.category as "browser" | "runtimes" | "accounts" | "logs" };
  }
  throw new Error("This kind of data cannot be cleaned here.");
}

function readConversationOptions(value: unknown): ReadConversationOptions | undefined {
  if (!isObject(value) || typeof value.limit !== "number" || !Number.isFinite(value.limit)) {
    return undefined;
  }
  return { limit: Math.max(1, Math.min(100_000, Math.floor(value.limit))) };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value;
}

/** Settings > Features engine limits and the local Performance view. */
function registerEngineIpc(
  service: AgentService,
  engineSettings: EngineSettingsStore,
  runEvents: RunEventStore | null,
): void {
  handleTrusted(IPC_CHANNELS.orchestratorGetEngineSettings, () => engineSettings.get());
  handleTrusted(IPC_CHANNELS.orchestratorSetEngineSettings, async (input: unknown) => {
    if (!isObject(input)) throw new Error("Invalid engine settings.");
    const saved = await engineSettings.update(input);
    service.configureEngineSettings(() => engineSettings.get());
    return saved;
  });
  handleTrusted(
    IPC_CHANNELS.orchestratorPerformance,
    () =>
      runEvents?.summary() ?? {
        since: null,
        totalTurns: 0,
        byCoworker: [],
        byModel: [],
        recent: [],
      },
  );
}

function parseSendMessage(value: unknown): SendMessageInput {
  if (!isObject(value)) throw new Error("Invalid send message request.");
  const attachmentDraftIds = value.attachmentDraftIds ?? [];
  if (
    !Array.isArray(attachmentDraftIds) ||
    !attachmentDraftIds.every((item) => typeof item === "string")
  ) {
    throw new Error("Invalid attachment drafts.");
  }
  if (typeof value.text !== "string") throw new Error("text is required.");
  if (!value.text.trim() && attachmentDraftIds.length === 0) {
    throw new Error("A message or attachment is required.");
  }
  const replyToMessageId = value.replyToMessageId ?? null;
  if (replyToMessageId !== null && typeof replyToMessageId !== "string") {
    throw new Error("Invalid reply target.");
  }
  return {
    botId: requireString(value.botId, "botId"),
    text: value.text,
    attachmentDraftIds,
    replyToMessageId: replyToMessageId?.trim() || null,
    // The composer asks to join a running turn; the renderer can never claim another origin.
    ...(value.steer === true ? { steer: true } : {}),
  };
}

function parseMessageReaction(value: unknown) {
  if (!isObject(value)) throw new Error("Invalid message reaction request.");
  const emoji = value.emoji;
  if (emoji !== null && !isMessageReaction(emoji)) {
    throw new Error("Invalid message reaction.");
  }
  return {
    botId: requireString(value.botId, "botId"),
    messageId: requireString(value.messageId, "messageId"),
    emoji,
  };
}

function parseUpdateBot(value: unknown): UpdateBotInput {
  if (!isObject(value)) throw new Error("Invalid bot update request.");
  const result: UpdateBotInput = { botId: requireString(value.botId, "botId") };
  for (const field of ["name", "role", "description"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Invalid ${field}.`);
    }
    if (typeof value[field] === "string") result[field] = value[field];
  }
  if (value.notifications !== undefined) {
    if (typeof value.notifications !== "boolean") throw new Error("Invalid notifications value.");
    result.notifications = value.notifications;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("Invalid agent model.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("Invalid reasoning effort.");
    result.reasoningEffort = value.reasoningEffort;
  }
  if (value.avatarShape !== undefined) {
    if (!isAvatarShape(value.avatarShape)) throw new Error("Invalid avatar shape.");
    result.avatarShape = value.avatarShape;
  }
  if (value.avatarColor !== undefined) {
    if (!isAvatarColor(value.avatarColor)) throw new Error("Invalid avatar color.");
    result.avatarColor = value.avatarColor;
  }
  if (value.template !== undefined) {
    if (!isBotTemplateRef(value.template)) throw new Error("Invalid coworker template.");
    result.template = value.template;
  }
  return result;
}

function parseImportAttachments(value: unknown): ImportAttachmentsInput {
  if (!isObject(value) || !Array.isArray(value.paths) || !Array.isArray(value.data)) {
    throw new Error("Invalid attachment import.");
  }
  if (!value.paths.every((path) => typeof path === "string" && path.length > 0)) {
    throw new Error("Invalid attachment path.");
  }
  const data = value.data.map((item) => {
    if (
      !isObject(item) ||
      typeof item.name !== "string" ||
      typeof item.mimeType !== "string" ||
      !(item.bytes instanceof Uint8Array)
    ) {
      throw new Error("Invalid attachment data.");
    }
    return { name: item.name, mimeType: item.mimeType, bytes: item.bytes };
  });
  return { paths: value.paths, data };
}

function parseOpenAttachment(value: unknown): OpenAttachmentInput {
  if (!isObject(value) || (value.action !== "open" && value.action !== "reveal")) {
    throw new Error("Invalid attachment action.");
  }
  return {
    attachmentId: requireString(value.attachmentId, "attachmentId"),
    action: value.action,
  };
}

function parseCancelQueuedMessage(value: unknown): CancelQueuedMessageInput {
  if (!isObject(value)) throw new Error("Invalid queue cancellation request.");
  return {
    botId: requireString(value.botId, "botId"),
    deliveryId: requireString(value.deliveryId, "deliveryId"),
  };
}

function parseSetQueuePaused(value: unknown): SetQueuePausedInput {
  if (!isObject(value) || typeof value.paused !== "boolean") {
    throw new Error("Invalid queue pause request.");
  }
  return { botId: requireString(value.botId, "botId"), paused: value.paused };
}

function configureAttachmentProtocol(mailbox: MailboxStore, store: BotStore): void {
  session.defaultSession.protocol.handle("sahkarmi-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      // sahkarmi-attachment://local/<id>: a file a coworker wrote in its folder or Shared.
      if (url.host === "local" && id) {
        const path = localAttachmentPath(`local:${id}`);
        if (!path || !isUnderRoots(path, [store.botsRoot, store.sharedRoot])) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(await readFile(path), {
          headers: {
            "Content-Type": mimeTypeFor(path),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          },
        });
      }
      const attachment = id ? await mailbox.resolveAttachment(id) : null;
      if (!attachment) return new Response("Not found", { status: 404 });
      return new Response(await readFile(attachment.path), {
        headers: {
          "Content-Type": attachment.mimeType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function configureApplicationProtocol(): void {
  const rendererRoot = resolve(__dirname, "../renderer");
  session.defaultSession.protocol.handle("sahkarmi-app", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "app") return new Response("Not found", { status: 404 });
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = resolve(rendererRoot, `.${pathname}`);
      const candidate = relative(rendererRoot, filePath);
      if (candidate.startsWith("..") || isAbsolute(candidate)) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(await readFile(filePath), {
        headers: {
          "Content-Type": applicationContentType(filePath),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function applicationContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function parseInterrupt(value: unknown): InterruptTurnInput {
  if (!isObject(value)) throw new Error("Invalid interrupt request.");
  return {
    botId: requireString(value.botId, "botId"),
    turnId: requireString(value.turnId, "turnId"),
  };
}

function parsePromptResponse(value: unknown): RespondToPromptInput {
  if (
    !isObject(value) ||
    (typeof value.requestId !== "string" && typeof value.requestId !== "number")
  ) {
    throw new Error("Invalid prompt response.");
  }
  if (!isObject(value.answers)) throw new Error("Prompt answers are required.");
  const answers: Record<string, string[]> = {};
  for (const [key, answer] of Object.entries(value.answers)) {
    if (!Array.isArray(answer) || !answer.every((item) => typeof item === "string")) {
      throw new Error("Invalid prompt answer.");
    }
    answers[key] = answer;
  }
  return { requestId: value.requestId, answers };
}

function parseBrowserOpen(value: unknown): BrowserOpenInput {
  if (!isObject(value)) throw new Error("Invalid browser open request.");
  return {
    url: requireString(value.url, "url"),
    ownerThreadId:
      value.ownerThreadId === null || value.ownerThreadId === undefined
        ? null
        : requireString(value.ownerThreadId, "ownerThreadId"),
    ownerBotId:
      value.ownerBotId === null || value.ownerBotId === undefined
        ? null
        : requireString(value.ownerBotId, "ownerBotId"),
  };
}

function parseVisibility(value: unknown): BrowserVisibilityInput {
  if (!isObject(value) || typeof value.visible !== "boolean") {
    throw new Error("Invalid browser visibility request.");
  }
  return {
    visible: value.visible,
    bounds: value.bounds === undefined ? undefined : parseBounds(value.bounds),
    ...(value.botId === undefined
      ? {}
      : { botId: value.botId === null ? null : requireString(value.botId, "botId") }),
    ...(value.threadId === undefined
      ? {}
      : { threadId: value.threadId === null ? null : requireString(value.threadId, "threadId") }),
  };
}

function parseBounds(value: unknown): BrowserBounds {
  if (!isObject(value)) throw new Error("Invalid browser bounds.");
  const fields = ["x", "y", "width", "height"] as const;
  for (const field of fields) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
      throw new Error(`Invalid browser bound: ${field}.`);
    }
  }
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Page pictures for the browser page cards: small JPEGs, so several pages stay cheap to show. */
function previewThumbnail(dataUrl: string): string | null {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  const small = width > 640 ? image.resize({ width: 640, quality: "good" }) : image;
  return `data:image/jpeg;base64,${small.toJPEG(72).toString("base64")}`;
}
