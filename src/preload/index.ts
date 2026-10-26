import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  type AgentEvent,
  type AiRuntimeStatus,
  type AttachmentImportEvent,
  type ImportAttachmentsInput,
  IPC_CHANNELS,
  type ProviderSetupState,
  type SahkarmiDesktopApi,
  type UpdateStatus,
  type VoiceState,
} from "../shared/ipc";

const attachmentImportListeners = new Set<(event: AttachmentImportEvent) => void>();

function emitAttachmentImport(event: AttachmentImportEvent): void {
  for (const listener of attachmentImportListeners) listener(event);
}

async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const requestId = crypto.randomUUID();
  emitAttachmentImport({ type: "started", requestId });
  try {
    const input: ImportAttachmentsInput = { paths: [], data: [] };
    for (const file of files) {
      const path = webUtils.getPathForFile(file);
      if (path) input.paths.push(path);
      else {
        input.data.push({
          name: file.name || `pasted-${Date.now()}.png`,
          mimeType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    const attachments = await ipcRenderer.invoke(IPC_CHANNELS.agentImportAttachments, input);
    emitAttachmentImport({ type: "completed", requestId, attachments });
  } catch (error) {
    emitAttachmentImport({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

window.addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) {
    event.preventDefault();
  }
});
window.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length) return;
  event.preventDefault();
  void importFiles(files);
});
window.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length) {
    event.preventDefault();
    void importFiles(files);
  }
});

const sahkarmiApi: SahkarmiDesktopApi = {
  setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.setTheme, theme),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getSetupState: () => ipcRenderer.invoke(IPC_CHANNELS.getSetupState),
  saveSetup: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSetup, input),
  getMacPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.getMacPermissions),
  requestMacPermission: (permission) =>
    ipcRenderer.invoke(IPC_CHANNELS.requestMacPermission, permission),
  openExternal: (destination) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, destination),
  openUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openUrl, url),
  agent: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.agentGetStatus),
    getUsage: () => ipcRenderer.invoke(IPC_CHANNELS.agentGetUsage),
    listModels: () => ipcRenderer.invoke(IPC_CHANNELS.agentListModels),
    refreshModels: () => ipcRenderer.invoke(IPC_CHANNELS.agentRefreshModels),
    listBots: () => ipcRenderer.invoke(IPC_CHANNELS.agentListBots),
    createBot: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.agentCreateBot, workspaceId),
    updateBot: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentUpdateBot, input),
    deleteBot: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentDeleteBot, botId),
    readConversation: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentReadConversation, botId),
    searchMessages: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSearchMessages, input),
    chooseAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.agentChooseAttachments),
    importData: (data) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentImportAttachments, { paths: [], data }),
    onAttachmentImport: (listener) => {
      attachmentImportListeners.add(listener);
      return () => attachmentImportListeners.delete(listener);
    },
    discardDraftAttachment: (attachmentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentDiscardDraftAttachment, attachmentId),
    openAttachment: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentOpenAttachment, input),
    sendMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSendMessage, input),
    setMessageReaction: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSetMessageReaction, input),
    listQueue: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentListQueue, botId),
    cancelQueuedMessage: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentCancelQueuedMessage, input),
    setQueuePaused: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSetQueuePaused, input),
    interrupt: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentInterrupt, input),
    respondToPrompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentRespondToPrompt, input),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler);
    },
  },
  browser: {
    open: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserOpen, input),
    activate: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserActivate, tabId),
    close: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserClose, tabId),
    listTabs: () => ipcRenderer.invoke(IPC_CHANNELS.browserListTabs),
    getControlState: () => ipcRenderer.invoke(IPC_CHANNELS.browserGetControlState),
    setVisible: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserSetVisible, input),
    getTakeover: () => ipcRenderer.invoke(IPC_CHANNELS.browserGetTakeover),
    takeOver: () => ipcRenderer.invoke(IPC_CHANNELS.browserTakeOver),
    handBack: (note) => ipcRenderer.invoke(IPC_CHANNELS.browserHandBack, note ?? null),
    declineTakeover: (note) =>
      ipcRenderer.invoke(IPC_CHANNELS.browserDeclineTakeover, note ?? null),
    preview: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserPreview, tabId),
    listSecureInputs: () => ipcRenderer.invoke(IPC_CHANNELS.secureInputList),
    submitSecureInput: (input) => ipcRenderer.invoke(IPC_CHANNELS.secureInputSubmit, input),
    dismissSecureInput: (id) => ipcRenderer.invoke(IPC_CHANNELS.secureInputDismiss, id),
    takeOverSecureInput: (id) => ipcRenderer.invoke(IPC_CHANNELS.secureInputTakeOver, id),
  },
  team: {
    listWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.teamListWorkspaces),
    createWorkspace: (name) => ipcRenderer.invoke(IPC_CHANNELS.teamCreateWorkspace, name),
    renameWorkspace: (workspaceId, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamRenameWorkspace, { workspaceId, name }),
    setActiveWorkspace: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamSetActiveWorkspace, workspaceId),
  },
  approvals: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.approvalsList),
    decide: (input) => ipcRenderer.invoke(IPC_CHANNELS.approvalsDecide, input),
  },
  permissions: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.permissionsGet),
    setLevel: (category, level) =>
      ipcRenderer.invoke(IPC_CHANNELS.permissionsSetLevel, { category, level }),
    addGrant: (input) => ipcRenderer.invoke(IPC_CHANNELS.permissionsAddGrant, input),
    revokeGrant: (grantId) => ipcRenderer.invoke(IPC_CHANNELS.permissionsRevokeGrant, grantId),
    audit: () => ipcRenderer.invoke(IPC_CHANNELS.permissionsAudit),
    clearAudit: () => ipcRenderer.invoke(IPC_CHANNELS.permissionsClearAudit),
    setAutoMode: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.permissionsSetAutoMode, enabled),
  },
  usage: {
    overview: () => ipcRenderer.invoke(IPC_CHANNELS.usageOverview),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.usageRefresh),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.usageClear),
  },
  features: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.featuresList),
    setEnabled: (featureId, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.featuresSetEnabled, { featureId, enabled }),
    previewManifest: (json) => ipcRenderer.invoke(IPC_CHANNELS.featuresPreviewManifest, json),
    applyManifest: (json) => ipcRenderer.invoke(IPC_CHANNELS.featuresApplyManifest, json),
    resetCatalogue: () => ipcRenderer.invoke(IPC_CHANNELS.featuresResetCatalogue),
  },
  business: {
    integrations: () => ipcRenderer.invoke(IPC_CHANNELS.businessIntegrations),
    listTargets: () => ipcRenderer.invoke(IPC_CHANNELS.businessListTargets),
    saveTarget: (input) => ipcRenderer.invoke(IPC_CHANNELS.businessSaveTarget, input),
    deleteTarget: (targetId) => ipcRenderer.invoke(IPC_CHANNELS.businessDeleteTarget, targetId),
  },
  marketplace: {
    installedSkills: () => ipcRenderer.invoke(IPC_CHANNELS.marketplaceInstalledSkills),
    installSkill: (skillId) => ipcRenderer.invoke(IPC_CHANNELS.marketplaceInstallSkill, skillId),
    uninstallSkill: (skillId) =>
      ipcRenderer.invoke(IPC_CHANNELS.marketplaceUninstallSkill, skillId),
  },
  schedules: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.schedulesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.schedulesCreate, input),
    setEnabled: (scheduleId, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.schedulesSetEnabled, { scheduleId, enabled }),
    delete: (scheduleId) => ipcRenderer.invoke(IPC_CHANNELS.schedulesDelete, scheduleId),
    runNow: (scheduleId) => ipcRenderer.invoke(IPC_CHANNELS.schedulesRunNow, scheduleId),
  },
  routines: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.routinesList),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.routinesSave, input),
    delete: (routineId) => ipcRenderer.invoke(IPC_CHANNELS.routinesDelete, routineId),
    setEnabled: (routineId, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.routinesSetEnabled, { routineId, enabled }),
    runNow: (routineId) => ipcRenderer.invoke(IPC_CHANNELS.routinesRunNow, routineId),
  },
  files: {
    list: (directory) => ipcRenderer.invoke(IPC_CHANNELS.filesList, directory ?? ""),
    add: (directory) => ipcRenderer.invoke(IPC_CHANNELS.filesAdd, directory ?? ""),
    open: (input) => ipcRenderer.invoke(IPC_CHANNELS.filesOpen, input),
  },
  update: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateGetStatus),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
      ipcRenderer.on(IPC_CHANNELS.updateEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.updateEvent, handler);
    },
  },
  aiRuntime: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeGetStatus),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeCheck),
    update: (toolId) => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeUpdate, toolId),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: AiRuntimeStatus) =>
        listener(status);
      ipcRenderer.on(IPC_CHANNELS.aiRuntimeEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiRuntimeEvent, handler);
    },
  },
  providerSetup: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.providerSetupList),
    connect: (provider) => ipcRenderer.invoke(IPC_CHANNELS.providerSetupConnect, provider),
    submitCode: (provider, code) =>
      ipcRenderer.invoke(IPC_CHANNELS.providerSetupSubmitCode, { provider, code }),
    setApiKey: (provider, apiKey) =>
      ipcRenderer.invoke(IPC_CHANNELS.providerSetupSetApiKey, { provider, apiKey }),
    check: (provider) => ipcRenderer.invoke(IPC_CHANNELS.providerSetupCheck, provider),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: ProviderSetupState) =>
        listener(state);
      ipcRenderer.on(IPC_CHANNELS.providerSetupEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.providerSetupEvent, handler);
    },
  },
  geminiAccounts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.geminiAccountsList),
    add: () => ipcRenderer.invoke(IPC_CHANNELS.geminiAccountsAdd),
    signIn: (id) => ipcRenderer.invoke(IPC_CHANNELS.geminiAccountsSignIn, id),
    use: (id) => ipcRenderer.invoke(IPC_CHANNELS.geminiAccountsUse, id),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.geminiAccountsRemove, id),
  },
  maintenance: {
    exportData: () => ipcRenderer.invoke(IPC_CHANNELS.maintenanceExportData),
    exportDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.maintenanceExportDiagnostics),
  },
  orchestrator: {
    getRuns: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetRuns),
    getRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetRun, runId),
    startRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorStartRun, input),
    pauseRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorPauseRun, runId),
    resumeRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorResumeRun, runId),
    cancelRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorCancelRun, runId),
  },
  memory: {
    list: (category) => ipcRenderer.invoke(IPC_CHANNELS.memoryList, category),
    save: (entry) => ipcRenderer.invoke(IPC_CHANNELS.memorySave, entry),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.memoryDelete, id),
  },
  composio: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.composioGetStatus),
    setKey: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.composioSetApiKey, { key }),
    listApps: (refresh?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.composioListApps, { refresh: refresh === true }),
    connect: (appId: string) => ipcRenderer.invoke(IPC_CHANNELS.composioConnectApp, { appId }),
    connectionStatus: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.composioConnectionStatus, { connectionId }),
    disconnect: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.composioDisconnectApp, { connectionId }),
  },
  voice: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.voiceGetState),
    install: (modelId) => ipcRenderer.invoke(IPC_CHANNELS.voiceInstall, modelId),
    cancel: (modelId) => ipcRenderer.invoke(IPC_CHANNELS.voiceCancel, modelId),
    remove: (modelId) => ipcRenderer.invoke(IPC_CHANNELS.voiceRemove, modelId),
    setSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.voiceSetSettings, settings),
    transcribe: (samples) => ipcRenderer.invoke(IPC_CHANNELS.voiceTranscribe, samples),
    speak: (text) => ipcRenderer.invoke(IPC_CHANNELS.voiceSpeak, text),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: VoiceState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.voiceEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.voiceEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld("sahkarmi", sahkarmiApi);
