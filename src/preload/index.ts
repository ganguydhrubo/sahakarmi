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
  usageCount: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.usageCountGet),
    set: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.usageCountSet, enabled),
  },
  agent: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.agentGetStatus),
    getUsage: () => ipcRenderer.invoke(IPC_CHANNELS.agentGetUsage),
    listModels: () => ipcRenderer.invoke(IPC_CHANNELS.agentListModels),
    refreshModels: () => ipcRenderer.invoke(IPC_CHANNELS.agentRefreshModels),
    probeProviders: () => ipcRenderer.invoke(IPC_CHANNELS.agentProbeProviders),
    listBots: () => ipcRenderer.invoke(IPC_CHANNELS.agentListBots),
    createBot: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.agentCreateBot, workspaceId),
    updateBot: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentUpdateBot, input),
    deleteBot: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentDeleteBot, botId),
    readConversation: (botId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentReadConversation, botId, options),
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
    readInstructions: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentReadInstructions, botId),
    saveInstructions: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSaveInstructions, input),
    revealInstructions: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentRevealInstructions, botId),
    branchConversation: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentBranchConversation, input),
    sendMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSendMessage, input),
    setMessageReaction: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSetMessageReaction, input),
    listQueue: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentListQueue, botId),
    cancelQueuedMessage: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentCancelQueuedMessage, input),
    sendQueuedNow: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentSendQueuedNow, input),
    rerunInterrupted: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentRerunInterrupted, input),
    dismissInterrupted: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentDismissInterrupted, input),
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
    deleteWorkspace: (input) => ipcRenderer.invoke(IPC_CHANNELS.teamDeleteWorkspace, input),
    setWorkspaceCeo: (workspaceId, botId) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamSetWorkspaceCeo, { workspaceId, botId }),
    createFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.teamCreateFolder, input),
    renameFolder: (folderId, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamRenameFolder, { folderId, name }),
    moveFolder: (folderId, parentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamMoveFolder, { folderId, parentId }),
    reorderFolder: (folderId, direction) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamReorderFolder, { folderId, direction }),
    deleteFolder: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.teamDeleteFolder, folderId),
    setBotFolder: (botId, folderId) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamSetBotFolder, { botId, folderId }),
    unbindPublishingAccount: (botId, platform, source) =>
      ipcRenderer.invoke(IPC_CHANNELS.teamUnbindPublishingAccount, { botId, platform, source }),
  },
  approvals: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.approvalsList),
    decide: (input) => ipcRenderer.invoke(IPC_CHANNELS.approvalsDecide, input),
    listAuthority: () => ipcRenderer.invoke(IPC_CHANNELS.approvalsListAuthority),
    grantAuthority: (input) => ipcRenderer.invoke(IPC_CHANNELS.approvalsGrantAuthority, input),
    revokeAuthority: (grantId) =>
      ipcRenderer.invoke(IPC_CHANNELS.approvalsRevokeAuthority, grantId),
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
    learnedSkills: () => ipcRenderer.invoke(IPC_CHANNELS.marketplaceLearnedSkills),
    removeLearnedSkill: (skillId) =>
      ipcRenderer.invoke(IPC_CHANNELS.marketplaceRemoveLearnedSkill, skillId),
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
    rerunFrom: (runId, stepId) =>
      ipcRenderer.invoke(IPC_CHANNELS.routinesRerunFrom, { runId, stepId }),
    design: (input) => ipcRenderer.invoke(IPC_CHANNELS.routinesDesign, input),
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.routinesPickFolder),
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
    storageUsage: () => ipcRenderer.invoke(IPC_CHANNELS.maintenanceStorageUsage),
    cleanStorage: (input) => ipcRenderer.invoke(IPC_CHANNELS.maintenanceStorageClean, input),
  },
  orchestrator: {
    getRuns: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetRuns),
    getRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetRun, runId),
    startRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorStartRun, input),
    pauseRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorPauseRun, runId),
    resumeRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorResumeRun, runId),
    cancelRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorCancelRun, runId),
    getEngineSettings: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetEngineSettings),
    setEngineSettings: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.orchestratorSetEngineSettings, input),
    performance: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorPerformance),
    resourceStatus: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorResourceStatus),
    getBudgets: () => ipcRenderer.invoke(IPC_CHANNELS.orchestratorGetBudgets),
    setBudgets: (input) => ipcRenderer.invoke(IPC_CHANNELS.orchestratorSetBudgets, input),
  },
  intelligence: {
    status: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceStatus, workspaceId ?? null),
    performance: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligencePerformance, workspaceId ?? null),
    outcomes: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceOutcomes, input ?? {}),
    recommend: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceRecommend, input),
    predictions: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligencePredictions, workspaceId ?? null),
    analyzeRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceAnalyzeRun, runId),
    decisions: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceDecisions, workspaceId ?? null),
    experiences: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceExperiences, workspaceId ?? null),
    addExperience: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceAddExperience, input),
    correctExperience: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceCorrectExperience, input),
    deleteExperience: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceDeleteExperience, input),
    setFeedback: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceSetFeedback, input),
    setExcluded: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceSetExcluded, input),
    resources: () => ipcRenderer.invoke(IPC_CHANNELS.intelligenceResources),
    rollbackModel: (input) => ipcRenderer.invoke(IPC_CHANNELS.intelligenceRollbackModel, input),
    resetLearning: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.intelligenceResetLearning, workspaceId ?? null),
  },
  knowledge: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.knowledgeList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeUpdate, input),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeDelete, id),
    addFiles: (kbId, paths) =>
      ipcRenderer.invoke(IPC_CHANNELS.knowledgeAddFiles, paths ? { kbId, paths } : kbId),
    pathsForFiles: (files) =>
      files.map((file) => webUtils.getPathForFile(file)).filter((path) => Boolean(path)),
    addFolder: (kbId) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeAddFolder, kbId),
    removeFolder: (kbId, folderId) =>
      ipcRenderer.invoke(IPC_CHANNELS.knowledgeRemoveFolder, { kbId, folderId }),
    removeSource: (kbId, sourceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.knowledgeRemoveSource, { kbId, sourceId }),
    setSourceEnabled: (kbId, sourceId, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.knowledgeSetSourceEnabled, { kbId, sourceId, enabled }),
    sync: (kbId) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSync, kbId),
    search: (input) => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSearch, input),
    openSource: (kbId, documentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.knowledgeOpenSource, { kbId, documentId }),
    semanticStatus: () => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSemanticStatus),
    installSemantic: () => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSemanticInstall),
    removeSemantic: () => ipcRenderer.invoke(IPC_CHANNELS.knowledgeSemanticRemove),
  },
  memory: {
    list: (input) => ipcRenderer.invoke(IPC_CHANNELS.memoryList, input),
    save: (entry) => ipcRenderer.invoke(IPC_CHANNELS.memorySave, entry),
    delete: (id, workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.memoryDelete, { id, workspaceId }),
  },
  assignments: {
    overview: () => ipcRenderer.invoke(IPC_CHANNELS.assignmentsOverview),
    set: (kind, id, access) =>
      ipcRenderer.invoke(IPC_CHANNELS.assignmentsSet, { kind, id, access }),
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
  apis: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.apisList),
    discover: (input) => ipcRenderer.invoke(IPC_CHANNELS.apisDiscover, input),
    update: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.apisUpdate, { id, patch }),
    runTests: (id) => ipcRenderer.invoke(IPC_CHANNELS.apisRunTests, id),
    activate: (id) => ipcRenderer.invoke(IPC_CHANNELS.apisActivate, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.apisSetEnabled, { id, enabled }),
    setAccess: (id, access) => ipcRenderer.invoke(IPC_CHANNELS.apisSetAccess, { id, access }),
    activity: (id) => ipcRenderer.invoke(IPC_CHANNELS.apisActivity, id),
    revoke: (id) => ipcRenderer.invoke(IPC_CHANNELS.apisRevoke, id),
  },
  telegram: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.telegramStatus),
    setToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.telegramSetToken, { token }),
    setCoworker: (botId: string) => ipcRenderer.invoke(IPC_CHANNELS.telegramSetCoworker, { botId }),
    unpair: () => ipcRenderer.invoke(IPC_CHANNELS.telegramUnpair),
    setAllowPasswords: (allow: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.telegramSetAllowPasswords, { allow }),
  },
  customSkills: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.customSkillsList),
    add: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.customSkillsAdd, { text }),
    previewGithub: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.customSkillsPreviewGithub, { url }),
    installGithub: (url: string, paths: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.customSkillsInstallGithub, { url, paths }),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.customSkillsRemove, { id }),
    markReviewed: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.customSkillsMarkReviewed, { id }),
    installPack: (packId: string, skills?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.customSkillsInstallPack, { packId, skills }),
  },
  mcp: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.mcpList),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.mcpSave, input),
    importJson: (text: string, replace?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpImportJson, { text, replace: replace ?? [] }),
    githubJson: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpGithubJson, { url }),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpSetEnabled, { id, enabled }),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpRemove, { id }),
    recheck: () => ipcRenderer.invoke(IPC_CHANNELS.mcpRecheck),
    test: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpTest, { id }),
    setCoworkers: (id: string, coworkerIds: string[] | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpSetCoworkers, { id, coworkerIds }),
    analyzeGithub: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpAnalyzeGithub, { url }),
    addCandidate: (
      analysisId: string,
      candidateId: string,
      name: string,
      env: Record<string, string>,
    ) => ipcRenderer.invoke(IPC_CHANNELS.mcpAddCandidate, { analysisId, candidateId, name, env }),
    planInstall: (analysisId, candidateId, name, env) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpPlanInstall, { analysisId, candidateId, name, env }),
    planSkill: (analysisId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpPlanSkill, { analysisId }),
    planTool: (tool) => ipcRenderer.invoke(IPC_CHANNELS.mcpPlanTool, { tool }),
    runInstall: (planId: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpRunInstall, { planId }),
    installStatus: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpInstallStatus, { jobId }),
    cancelInstall: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.mcpCancelInstall, { jobId }),
    setShared: (id: string, shared: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpSetShared, { id, shared }),
    addAdapter: (analysisId: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpAddAdapter, { analysisId, name }),
    connectors: () => ipcRenderer.invoke(IPC_CHANNELS.mcpConnectors),
    addConnector: (id: string, name: string, values: Record<string, string>) =>
      ipcRenderer.invoke(IPC_CHANNELS.mcpAddConnector, { id, name, values }),
  },
  workflow: {
    export: (source, format) => ipcRenderer.invoke(IPC_CHANNELS.workflowExport, { source, format }),
    readImport: () => ipcRenderer.invoke(IPC_CHANNELS.workflowReadImport),
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
