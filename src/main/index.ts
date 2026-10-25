import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  type OpenDialogOptions,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import electronUpdater from "electron-updater";
import { AdaptiveOrchestrator } from "../backend/adaptive-orchestrator";
import { AgentService } from "../backend/agent-service";
import { ApprovalStore } from "../backend/approval-store";
import { isUnderRoots, localAttachmentPath, mimeTypeFor } from "../backend/attachment-text";
import { BotStore } from "../backend/bot-store";
import { createCoworkerBrowser } from "../backend/browser-factory";
import type { CoworkerBrowser } from "../backend/browser-host";
import { BusinessStore } from "../backend/business-store";
import {
  resolveClaudeCli,
  resolveCodexCli,
  resolveOpenCodeCli,
  setRuntimeDirectory,
  setToolsDirectory,
} from "../backend/cli";
import { FeatureRegistry } from "../backend/feature-registry";
import { ComposioClient } from "../backend/integrations/composio-client";
import { MailboxStore } from "../backend/mailbox-store";
import { OrchestratorStore } from "../backend/orchestrator-store";
import { PermissionService } from "../backend/permission-service";
import { ProviderSetup } from "../backend/provider-setup";
import { createRoutineExecutor } from "../backend/routine-executor";
import { importDesktopRoutinesOnce } from "../backend/routine-import";
import { parseRoutineCadence, RoutineStore } from "../backend/routine-store";
import { parseCadence, ScheduleStore } from "../backend/schedule-store";
import { SharedFiles } from "../backend/shared-files";
import { SkillLibrary } from "../backend/skill-library";
import { UsageService } from "../backend/usage-service";
import {
  type AgentEvent,
  type AgentProviderId,
  type AiRuntimeStatus,
  type AiToolId,
  type AppInfo,
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
  type OpenAttachmentInput,
  type OpenSharedFileInput,
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionLevel,
  type RespondToPromptInput,
  type SaveBusinessTargetInput,
  type SendMessageInput,
  type SetQueuePausedInput,
  type StartOrchestratorRunInput,
  type TargetPeriod,
  type UpdateBotInput,
} from "../shared/ipc";
import { AgentInitializationGate } from "./agent-initialization";
import { notificationForAgentEvent } from "./agent-notifications";
import { AiRuntimeService } from "./ai-runtime-service";
import { AppLog } from "./app-log";
import { exportDiagnostics, exportSahkarmiData } from "./maintenance-service";
import { readSetupState, writeSetupState } from "./setup-store";
import { handleTrusted } from "./trusted-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";
import { supportsInstalledUpdates, UpdateService } from "./update-service";

if (!app.isPackaged) {
  // SAHKARMI_DEV_USER_DATA lets a test run use a throwaway profile instead of "Sahkarmi Dev".
  app.setPath(
    "userData",
    process.env.SAHKARMI_DEV_USER_DATA?.trim() || join(app.getPath("appData"), "Sahkarmi Dev"),
  );
}
app.enableSandbox();
if (process.platform === "win32") app.setAppUserModelId("in.sahkarmi.desktop");
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
let routineStore: RoutineStore | null = null;
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
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP(S) links can open in the external browser.");
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

  handleTrusted(IPC_CHANNELS.agentGetStatus, () => service.getStatus());
  handleTrusted(IPC_CHANNELS.agentGetUsage, () => service.getUsage());
  handleTrusted(IPC_CHANNELS.agentListModels, () => service.listModels());
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
  handleTrusted(IPC_CHANNELS.agentUpdateBot, (input: unknown) =>
    service.updateBot(parseUpdateBot(input)),
  );
  handleTrusted(IPC_CHANNELS.agentDeleteBot, async (botId: unknown) => {
    const id = requireString(botId, "botId");
    await service.deleteBot(id);
    await schedules.deleteBotData(id);
    await routines.deleteBotData(id);
  });
  handleTrusted(IPC_CHANNELS.agentReadConversation, (botId: unknown) =>
    service.readConversation(requireString(botId, "botId")),
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
  handleTrusted(IPC_CHANNELS.agentListQueue, (botId: unknown) =>
    service.listQueue(requireString(botId, "botId")),
  );
  handleTrusted(IPC_CHANNELS.agentCancelQueuedMessage, (input: unknown) => {
    const parsed = parseCancelQueuedMessage(input);
    return service.cancelQueuedMessage(parsed.botId, parsed.deliveryId);
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

  handleTrusted(IPC_CHANNELS.approvalsList, () => service.listApprovals());
  handleTrusted(IPC_CHANNELS.approvalsDecide, (input: unknown) =>
    service.decideApproval(parseDecideApproval(input)),
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
  handleTrusted(IPC_CHANNELS.routinesSave, (input: unknown) => {
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
    return routines.save({
      id: typeof input.id === "string" && input.id ? input.id : undefined,
      name: typeof input.name === "string" ? input.name : "",
      steps,
      cadence: input.cadence === null ? null : parseRoutineCadence(input.cadence),
      enabled: input.enabled === true,
      confirmFrequent: input.confirmFrequent === true,
    });
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
  handleTrusted(IPC_CHANNELS.memoryList, (category: unknown) => {
    return service.memoryStore.list(typeof category === "string" ? category : undefined);
  });
  handleTrusted(IPC_CHANNELS.memorySave, (entry: unknown) => {
    if (!isObject(entry) || typeof entry.key !== "string" || typeof entry.content !== "string") {
      throw new Error("Invalid memory entry: key and content required");
    }
    const rawCat = typeof entry.category === "string" ? entry.category : "fact";
    const category =
      rawCat === "architecture" || rawCat === "preference" || rawCat === "decision"
        ? rawCat
        : "fact";
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === "string")
      : [];
    return service.memoryStore.save({
      key: entry.key,
      content: entry.content,
      category,
      tags,
      authorBotId: typeof entry.authorBotId === "string" ? entry.authorBotId : undefined,
      id: typeof entry.id === "string" ? entry.id : undefined,
    });
  });
  handleTrusted(IPC_CHANNELS.memoryDelete, (id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid memory id");
    return service.memoryStore.delete(id);
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
    }
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

function forwardAgentEvent(event: AgentEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.agentEvent, event);
  if (mainWindow.isFocused() || !Notification.isSupported()) return;

  const content = notificationForAgentEvent(event, agentService?.listBots() ?? []);
  if (!content) return;
  const notification = new Notification(content);
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notification.show();
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

async function restoreSavedApiKeys(): Promise<void> {
  const home = homedir();
  try {
    if (!process.env.GEMINI_API_KEY && !process.env.ANTIGRAVITY_API_KEY) {
      // A Google AI Studio key saved from the Google Antigravity tile.
      const key = await readFile(
        join(home, ".gemini", "antigravity-acp", "api_key.txt"),
        "utf8",
      ).catch(() => "");
      const trimmed = key.trim();
      if (trimmed) {
        process.env.ANTIGRAVITY_API_KEY = trimmed;
        process.env.GEMINI_API_KEY = trimmed;
        process.env.GOOGLE_API_KEY = trimmed;
      }
    }
  } catch {
    // ignore
  }
  try {
    if (!process.env.OPENAI_API_KEY) {
      const key = await readFile(join(home, ".codex", "openai_api_key.txt"), "utf8").catch(
        () => "",
      );
      const trimmed = key.trim();
      if (trimmed) process.env.OPENAI_API_KEY = trimmed;
    }
  } catch {
    // ignore
  }
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      const key = await readFile(join(home, ".claude", "anthropic_api_key.txt"), "utf8").catch(
        () => "",
      );
      const trimmed = key.trim();
      if (trimmed) process.env.ANTHROPIC_API_KEY = trimmed;
    }
  } catch {
    // ignore
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
      configureContentSecurityPolicy();
      mainWindow = createWindow();
      await restoreSavedApiKeys();
      const store = new BotStore(app.getPath("userData"), homedir());
      await store.initialize();
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
      await browserHost.restore();
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
      const usage = new UsageService(app.getPath("userData"));
      await usage.initialize().catch((error) => {
        appLog.write("error", "usage ledger unreadable; starting a new one", String(error));
      });
      const composioClient = new ComposioClient({ userDataPath: app.getPath("userData") });
      service.setUsageService(usage);
      service.setComposioClient(composioClient);
      usageService = usage;
      const features = new FeatureRegistry(app.getPath("userData"));
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
      // Bring the owner's routines from their previous desktop agent over once (paused), so a switch loses nothing.
      await importDesktopRoutinesOnce({
        userDataPath: app.getPath("userData"),
        sourceDatabase: join(app.getPath("appData"), "OpenBot", "openbot.db"),
        routineCount: routines.state().routines.length,
        coworkers: store.list(),
        save: (input) => routines.save(input),
      })
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
        autoDownload: () => permissions.get().levels.app_updates === "auto",
        manualInstall: () => cannotSelfUpdate(),
        openDownload: (version) =>
          shell.openExternal(
            `https://github.com/ganguydhrubo/sahakarmi/releases/download/v${version}/Sahkarmi-${version}-arm64.dmg`,
          ),
      });
      service.on("event", forwardAgentEvent);
      const refreshOnWake = () => {
        void service.refreshModels();
        void updateService?.checkOnWake();
        void aiRuntimeService?.check();
      };
      mainWindow.on("focus", refreshOnWake);
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
      });
      aiRuntimeService.onStatus(forwardAiRuntimeStatus);
      scheduleAiRuntimeChecks();
      providerSetup = new ProviderSetup({
        toolsDirectory,
        runtimeDirectory,
        recheck: (provider) => service.ensureProvider(provider),
        openUrl: (url) => void shell.openExternal(url),
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
      const orchestratorStore = new OrchestratorStore(app.getPath("userData"));
      await orchestratorStore.initialize();
      const orchestrator = new AdaptiveOrchestrator(orchestratorStore);
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
      configureApplicationMenu(service, updateService);
      await loadRenderer(mainWindow);
      void agentInitialization
        .start()
        .then(() => {
          schedules.start(async (task) => {
            await service.sendMessage({
              botId: task.botId,
              text: `[Scheduled task] ${task.text}`,
            });
          });
          routines.start(createRoutineExecutor(service));
        })
        .catch((error) => {
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
  if (shutdownStarted) return;
  event.preventDefault();
  void prepareForShutdown().finally(() => app.quit());
});

async function prepareForShutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  isQuitting = true;
  updateService?.stop();
  providerSetup?.stop();
  scheduleStore?.stop();
  routineStore?.stop();
  const cleanupTasks = Promise.all([
    browserHost?.destroy().catch(() => {}),
    agentService?.stop().catch(() => {}),
    usageService?.flush().catch(() => {}),
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

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value;
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
