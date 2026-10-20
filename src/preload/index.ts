import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  type AgentEvent,
  type AttachmentImportEvent,
  type ImportAttachmentsInput,
  IPC_CHANNELS,
  type SahkarmiDesktopApi,
  type UpdateStatus,
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
    listBots: () => ipcRenderer.invoke(IPC_CHANNELS.agentListBots),
    createBot: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.agentCreateBot, workspaceId),
    updateBot: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentUpdateBot, input),
    deleteBot: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentDeleteBot, botId),
    readConversation: (botId) => ipcRenderer.invoke(IPC_CHANNELS.agentReadConversation, botId),
    chooseAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.agentChooseAttachments),
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
  schedules: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.schedulesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.schedulesCreate, input),
    setEnabled: (scheduleId, enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.schedulesSetEnabled, { scheduleId, enabled }),
    delete: (scheduleId) => ipcRenderer.invoke(IPC_CHANNELS.schedulesDelete, scheduleId),
    runNow: (scheduleId) => ipcRenderer.invoke(IPC_CHANNELS.schedulesRunNow, scheduleId),
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
  maintenance: {
    exportData: () => ipcRenderer.invoke(IPC_CHANNELS.maintenanceExportData),
    exportDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.maintenanceExportDiagnostics),
  },
};

contextBridge.exposeInMainWorld("sahkarmi", sahkarmiApi);
