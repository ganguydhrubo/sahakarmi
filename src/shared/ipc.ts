import type { ResourceAccess, ResourceKind } from "./resource-access";
export const IPC_CHANNELS = {
  setTheme: "app:set-theme",
  getAppInfo: "app:get-info",
  getSetupState: "app:get-setup-state",
  saveSetup: "app:save-setup",
  getMacPermissions: "app:get-mac-permissions",
  requestMacPermission: "app:request-mac-permission",
  openExternal: "app:open-external",
  openUrl: "app:open-url",
  usageCountGet: "app:usage-count-get",
  usageCountSet: "app:usage-count-set",
  updateGetStatus: "update:get-status",
  updateCheck: "update:check",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateEvent: "update:event",
  aiRuntimeGetStatus: "ai-runtime:get-status",
  aiRuntimeCheck: "ai-runtime:check",
  aiRuntimeUpdate: "ai-runtime:update",
  aiRuntimeEvent: "ai-runtime:event",
  maintenanceExportData: "maintenance:export-data",
  maintenanceExportDiagnostics: "maintenance:export-diagnostics",
  maintenanceStorageUsage: "maintenance:storage-usage",
  maintenanceStorageClean: "maintenance:storage-clean",
  agentGetStatus: "agent:get-status",
  agentGetUsage: "agent:get-usage",
  agentListModels: "agent:list-models",
  agentRefreshModels: "agent:refresh-models",
  agentProbeProviders: "agent:probe-providers",
  agentListBots: "agent:list-bots",
  agentCreateBot: "agent:create-bot",
  agentUpdateBot: "agent:update-bot",
  agentDeleteBot: "agent:delete-bot",
  agentReadConversation: "agent:read-conversation",
  agentSearchMessages: "agent:search-messages",
  agentSendMessage: "agent:send-message",
  agentSetMessageReaction: "agent:set-message-reaction",
  agentChooseAttachments: "agent:choose-attachments",
  agentImportAttachments: "agent:import-attachments",
  agentDiscardDraftAttachment: "agent:discard-draft-attachment",
  agentOpenAttachment: "agent:open-attachment",
  agentReadInstructions: "agent:read-instructions",
  agentSaveInstructions: "agent:save-instructions",
  agentRevealInstructions: "agent:reveal-instructions",
  agentBranchConversation: "agent:branch-conversation",
  knowledgeList: "knowledge:list",
  knowledgeCreate: "knowledge:create",
  knowledgeUpdate: "knowledge:update",
  knowledgeDelete: "knowledge:delete",
  knowledgeAddFiles: "knowledge:add-files",
  knowledgeAddFolder: "knowledge:add-folder",
  knowledgeRemoveFolder: "knowledge:remove-folder",
  knowledgeRemoveSource: "knowledge:remove-source",
  knowledgeSetSourceEnabled: "knowledge:set-source-enabled",
  knowledgeSync: "knowledge:sync",
  knowledgeSearch: "knowledge:search",
  knowledgeOpenSource: "knowledge:open-source",
  knowledgeSemanticStatus: "knowledge:semantic-status",
  knowledgeSemanticInstall: "knowledge:semantic-install",
  knowledgeSemanticRemove: "knowledge:semantic-remove",
  agentListQueue: "agent:list-queue",
  agentCancelQueuedMessage: "agent:cancel-queued-message",
  agentSendQueuedNow: "agent:send-queued-now",
  agentSetQueuePaused: "agent:set-queue-paused",
  agentInterrupt: "agent:interrupt",
  agentRespondToPrompt: "agent:respond-to-prompt",
  agentEvent: "agent:event",
  browserOpen: "browser:open",
  browserActivate: "browser:activate",
  browserClose: "browser:close",
  browserListTabs: "browser:list-tabs",
  browserGetControlState: "browser:get-control-state",
  browserSetVisible: "browser:set-visible",
  browserGetTakeover: "browser:get-takeover",
  browserTakeOver: "browser:take-over",
  browserHandBack: "browser:hand-back",
  browserDeclineTakeover: "browser:decline-takeover",
  browserPreview: "browser:preview",
  secureInputList: "secure-input:list",
  secureInputSubmit: "secure-input:submit",
  secureInputDismiss: "secure-input:dismiss",
  secureInputTakeOver: "secure-input:take-over",
  teamListWorkspaces: "team:list-workspaces",
  teamCreateWorkspace: "team:create-workspace",
  teamRenameWorkspace: "team:rename-workspace",
  teamSetActiveWorkspace: "team:set-active-workspace",
  teamDeleteWorkspace: "team:delete-workspace",
  teamSetWorkspaceCeo: "team:set-workspace-ceo",
  teamUnbindPublishingAccount: "team:unbind-publishing-account",
  teamCreateFolder: "team:create-folder",
  teamRenameFolder: "team:rename-folder",
  teamMoveFolder: "team:move-folder",
  teamReorderFolder: "team:reorder-folder",
  teamDeleteFolder: "team:delete-folder",
  teamSetBotFolder: "team:set-bot-folder",
  approvalsListAuthority: "approvals:list-authority",
  approvalsGrantAuthority: "approvals:grant-authority",
  approvalsRevokeAuthority: "approvals:revoke-authority",
  approvalsList: "approvals:list",
  approvalsDecide: "approvals:decide",
  schedulesList: "schedules:list",
  schedulesCreate: "schedules:create",
  schedulesSetEnabled: "schedules:set-enabled",
  schedulesDelete: "schedules:delete",
  schedulesRunNow: "schedules:run-now",
  routinesList: "routines:list",
  routinesSave: "routines:save",
  routinesDelete: "routines:delete",
  routinesSetEnabled: "routines:set-enabled",
  routinesRunNow: "routines:run-now",
  routinesPickFolder: "routines:pick-folder",
  filesList: "files:list",
  filesAdd: "files:add",
  filesOpen: "files:open",
  permissionsGet: "permissions:get",
  permissionsSetLevel: "permissions:set-level",
  permissionsAddGrant: "permissions:add-grant",
  permissionsRevokeGrant: "permissions:revoke-grant",
  permissionsAudit: "permissions:audit",
  permissionsClearAudit: "permissions:clear-audit",
  permissionsSetAutoMode: "permissions:set-auto-mode",

  providerSetupList: "provider-setup:list",
  providerSetupConnect: "provider-setup:connect",
  providerSetupSubmitCode: "provider-setup:submit-code",
  providerSetupSetApiKey: "provider-setup:set-api-key",
  providerSetupCheck: "provider-setup:check",
  providerSetupEvent: "provider-setup:event",
  geminiAccountsList: "gemini-accounts:list",
  geminiAccountsAdd: "gemini-accounts:add",
  geminiAccountsSignIn: "gemini-accounts:sign-in",
  geminiAccountsUse: "gemini-accounts:use",
  geminiAccountsRemove: "gemini-accounts:remove",
  usageOverview: "usage:overview",
  usageRefresh: "usage:refresh",
  usageClear: "usage:clear",
  featuresList: "features:list",
  featuresSetEnabled: "features:set-enabled",
  featuresPreviewManifest: "features:preview-manifest",
  featuresApplyManifest: "features:apply-manifest",
  featuresResetCatalogue: "features:reset-catalogue",
  businessIntegrations: "business:integrations",
  marketplaceInstalledSkills: "marketplace:installed-skills",
  marketplaceInstallSkill: "marketplace:install-skill",
  marketplaceUninstallSkill: "marketplace:uninstall-skill",
  marketplaceLearnedSkills: "marketplace:learned-skills",
  marketplaceRemoveLearnedSkill: "marketplace:remove-learned-skill",
  businessListTargets: "business:list-targets",
  businessSaveTarget: "business:save-target",
  businessDeleteTarget: "business:delete-target",
  orchestratorGetRuns: "orchestrator:get-runs",
  orchestratorGetRun: "orchestrator:get-run",
  orchestratorStartRun: "orchestrator:start-run",
  orchestratorPauseRun: "orchestrator:pause-run",
  orchestratorResumeRun: "orchestrator:resume-run",
  orchestratorCancelRun: "orchestrator:cancel-run",
  orchestratorGetEngineSettings: "orchestrator:get-engine-settings",
  orchestratorSetEngineSettings: "orchestrator:set-engine-settings",
  orchestratorPerformance: "orchestrator:performance",
  orchestratorResourceStatus: "orchestrator:resource-status",
  assignmentsOverview: "assignments:overview",
  assignmentsSet: "assignments:set",
  agentRerunInterrupted: "agent:rerun-interrupted",
  agentDismissInterrupted: "agent:dismiss-interrupted",
  memoryList: "memory:list",
  memorySave: "memory:save",
  memoryDelete: "memory:delete",
  composioGetStatus: "composio:get-status",
  composioSetApiKey: "composio:set-api-key",
  composioListApps: "composio:list-apps",
  composioConnectApp: "composio:connect-app",
  composioConnectionStatus: "composio:connection-status",
  composioDisconnectApp: "composio:disconnect-app",
  apisList: "apis:list",
  apisDiscover: "apis:discover",
  apisUpdate: "apis:update",
  apisRunTests: "apis:run-tests",
  apisActivate: "apis:activate",
  apisSetEnabled: "apis:set-enabled",
  apisSetAccess: "apis:set-access",
  apisActivity: "apis:activity",
  apisRevoke: "apis:revoke",
  telegramStatus: "telegram:status",
  telegramSetToken: "telegram:set-token",
  telegramSetCoworker: "telegram:set-coworker",
  telegramUnpair: "telegram:unpair",
  customSkillsList: "custom-skills:list",
  customSkillsAdd: "custom-skills:add",
  customSkillsPreviewGithub: "custom-skills:preview-github",
  customSkillsInstallGithub: "custom-skills:install-github",
  customSkillsRemove: "custom-skills:remove",
  customSkillsMarkReviewed: "custom-skills:mark-reviewed",
  mcpList: "mcp:list",
  mcpSave: "mcp:save",
  mcpImportJson: "mcp:import-json",
  mcpGithubJson: "mcp:github-json",
  mcpSetEnabled: "mcp:set-enabled",
  mcpRemove: "mcp:remove",
  mcpRecheck: "mcp:recheck",
  mcpTest: "mcp:test",
  mcpSetCoworkers: "mcp:set-coworkers",
  mcpAnalyzeGithub: "mcp:analyze-github",
  mcpAddCandidate: "mcp:add-candidate",
  mcpPlanInstall: "mcp:plan-install",
  mcpPlanSkill: "mcp:plan-skill",
  mcpPlanTool: "mcp:plan-tool",
  mcpRunInstall: "mcp:run-install",
  mcpInstallStatus: "mcp:install-status",
  mcpCancelInstall: "mcp:cancel-install",
  mcpSetShared: "mcp:set-shared",
  mcpAddAdapter: "mcp:add-adapter",
  workflowExport: "workflow:export",
  workflowReadImport: "workflow:read-import",
  voiceGetState: "voice:get-state",
  voiceInstall: "voice:install",
  voiceCancel: "voice:cancel",
  voiceRemove: "voice:remove",
  voiceSetSettings: "voice:set-settings",
  voiceTranscribe: "voice:transcribe",
  voiceSpeak: "voice:speak",
  voiceEvent: "voice:event",
} as const;

export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface AppInfo {
  name: string;
  version: string;
  platform: DesktopPlatform;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "up-to-date"
  | "error"
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  checkedAt: string | null;
  message: string | null;
}

export interface ExportResult {
  saved: boolean;
}

export type AiRuntimePhase =
  | "idle"
  | "checking"
  | "available"
  | "updating"
  | "updated"
  | "up-to-date"
  | "error";

export const AI_TOOL_IDS = ["opencode", "codex", "claude", "antigravity"] as const;
export type AiToolId = (typeof AI_TOOL_IDS)[number];

export function isAiToolId(value: unknown): value is AiToolId {
  return typeof value === "string" && AI_TOOL_IDS.includes(value as AiToolId);
}

export interface AiToolUpdate {
  id: AiToolId;
  label: string;
  installed: string | null;
  latest: string | null;
  /** Sahkarmi can install this update itself. */
  managed: boolean;
  /** The command that updates the tool when Sahkarmi cannot do it. */
  command: string | null;
  /** A short, honest note, such as why upstream code is not merged. */
  note: string | null;
  /** The newer version is already downloaded and is used once coworkers are idle. */
  ready?: boolean;
}

export interface AiRuntimeStatus {
  phase: AiRuntimePhase;
  /** Version of the OpenCode runtime the app is running right now. */
  currentVersion: string | null;
  /** Version available for the bundled OpenCode runtime. */
  availableVersion: string | null;
  progress: number | null;
  checkedAt: string | null;
  message: string | null;
  tools: AiToolUpdate[];
}

export type AgentPhase = "idle" | "starting" | "ready" | "restarting" | "blocked" | "stopped";

export type CapabilityState = "ready" | "setup-required" | "unavailable";

/**
 * Other AI agents Sahkarmi drives over the Agent Client Protocol, the same way as OpenCode and
 * Antigravity: each is the vendor's own command-line tool, signed in with the owner's account.
 */
export const ACP_AGENT_PROVIDERS = [
  "cursor",
  "copilot",
  "kimi",
  "cline",
  "qwen",
  "grok",
  "droid",
  "qoder",
  "goose",
  "vibe",
  "kiro",
] as const;
export type AcpAgentProviderId = (typeof ACP_AGENT_PROVIDERS)[number];

export const AGENT_PROVIDERS = [
  "codex",
  "claude",
  "antigravity",
  "opencode",
  ...ACP_AGENT_PROVIDERS,
] as const;
export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

export function isAcpAgentProvider(value: unknown): value is AcpAgentProviderId {
  return typeof value === "string" && ACP_AGENT_PROVIDERS.includes(value as AcpAgentProviderId);
}

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return typeof value === "string" && AGENT_PROVIDERS.includes(value as AgentProviderId);
}

/** Human-facing provider names. OpenCode is bundled with Sahkarmi and has free models. */
export const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  codex: "ChatGPT (Codex)",
  claude: "Claude",
  opencode: "OpenCode (free)",
  antigravity: "Google Antigravity",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  kimi: "Kimi Code",
  cline: "Cline",
  qwen: "Qwen Code",
  grok: "Grok Build",
  droid: "Factory Droid",
  qoder: "Qoder",
  goose: "Goose",
  vibe: "Mistral Vibe",
  kiro: "Kiro",
};
export type AgentProviderState =
  | "not-started"
  | "checking"
  | "available"
  | "sign-in-required"
  | "not-installed"
  | "outdated"
  | "error";

export interface AgentProviderStatus {
  id: AgentProviderId;
  state: AgentProviderState;
  version: string | null;
  message: string | null;
  email?: string | null;
}

export interface AppSetupState {
  completed: boolean;
  preferredProvider: AgentProviderId | null;
}

export interface SaveSetupInput {
  preferredProvider: AgentProviderId;
}

export type MacPermissionId = "screen-recording" | "accessibility";
export type MacPermissionState = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export interface MacPermissionsState {
  screenRecording: MacPermissionState;
  accessibility: MacPermissionState;
}

export type AgentAuthState =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "unsupported"; accountType: string }
  | { kind: "chatgpt"; email: string | null }
  | { kind: "claude"; email: string | null }
  | { kind: "opencode"; email: string | null }
  | { kind: "antigravity"; email: string | null; tier?: string | null }
  | { kind: AcpAgentProviderId; email: string | null };

export interface AccountUsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface AccountUsageLimit {
  id: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
}

export interface AccountUsage {
  limits: AccountUsageLimit[];
}

/**
 * How trustworthy a usage number is. verified: reported by the provider for this account.
 * estimated: computed by the provider or Sahkarmi, not a billing statement. unavailable: the
 * provider does not expose it. stale: last verified value is too old to rely on.
 */
export type UsageDataLabel = "verified" | "estimated" | "unavailable" | "stale";

export interface UsageLimitWindow {
  id: string;
  /** e.g. "5-hour window", "Weekly". */
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  status: "ok" | "warning" | "limited" | "unknown";
  source: string;
  observedAt: string;
  dataLabel: UsageDataLabel;
}

export interface ProviderUsageSummary {
  provider: AgentProviderId;
  connection: AgentProviderState | "unknown";
  plan: string | null;
  limits: UsageLimitWindow[];
  limitsLabel: UsageDataLabel;
  limitsNote: string;
  tokensToday: number | null;
  tokens7d: number | null;
  tokens30d: number | null;
  tokensLabel: UsageDataLabel;
  costUsd30d: number | null;
  costLabel: UsageDataLabel;
  context: { used: number; size: number; observedAt: string } | null;
  lastActivityAt: string | null;
}

export interface UsageDay {
  date: string;
  provider: AgentProviderId;
  tokens: number;
  costUsd: number | null;
}

export interface UsageByBot {
  botId: string;
  provider: AgentProviderId;
  tokens30d: number;
  turns30d: number;
  lastAt: string;
}

export interface UsageAlert {
  id: string;
  level: "info" | "warning" | "critical";
  provider: AgentProviderId;
  message: string;
}

export interface UsageOverview {
  generatedAt: string;
  providers: ProviderUsageSummary[];
  days: UsageDay[];
  bots: UsageByBot[];
  alerts: UsageAlert[];
  /** First day Sahkarmi recorded usage on this computer. */
  ledgerSince: string | null;
}

export const FEATURE_CATEGORIES = ["core", "providers", "workspace", "business", "labs"] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

/** What a feature needs. Data only: a requirement can never carry code or a download. */
export type FeatureRequirement =
  | { type: "provider"; provider: AgentProviderId }
  | { type: "any-provider" }
  | { type: "platform"; platforms: DesktopPlatform[] }
  | { type: "app-version"; minimum: string };

export type FeatureAvailability = "available" | "needs-setup" | "unavailable" | "coming-later";

export interface FeatureState {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  /** built-in: shipped in this app. catalogue: announced in an imported list, not installed. */
  origin: "built-in" | "catalogue";
  availability: FeatureAvailability;
  reason: string | null;
  enabled: boolean;
  /** Owner can switch it off (core safety features cannot be). */
  canDisable: boolean;
}

export interface FeatureManifestPreview {
  ok: boolean;
  errors: string[];
  added: Array<{ id: string; name: string }>;
  changed: Array<{ id: string; name: string; change: string }>;
  ignored: Array<{ id: string; reason: string }>;
  catalogueVersion: string | null;
}

export type IntegrationSupport =
  | "supported"
  | "manual-import"
  | "browser-assisted"
  | "not-supported";

export interface BusinessIntegration {
  id: string;
  name: string;
  support: IntegrationSupport;
  summary: string;
  /** What access an official integration would need. */
  accessNeeded: string;
  /** What works today without breaking the platform's rules. */
  workaround: string;
}

export type TargetPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

/** Owner-defined goal. Never mixed with provider quotas or platform data. */
export interface BusinessTarget {
  id: string;
  title: string;
  metric: string;
  unit: string;
  targetValue: number;
  /** Entered by the owner (or a coworker after approval); null until reported. */
  currentValue: number | null;
  period: TargetPeriod;
  dueDate: string | null;
  botId: string | null;
  notes: string;
  updatedAt: string;
}

export interface SaveBusinessTargetInput {
  id?: string;
  title: string;
  metric: string;
  unit: string;
  targetValue: number;
  currentValue: number | null;
  period: TargetPeriod;
  dueDate: string | null;
  botId: string | null;
  notes: string;
}

export type ExternalDestination = "agent-setup" | "feedback" | "message";

export interface AgentStatus {
  phase: AgentPhase;
  cliVersion: string | null;
  auth: AgentAuthState;
  providers?: AgentProviderStatus[];
  capabilities: {
    chat: CapabilityState;
    browser: CapabilityState;
    computerUse: CapabilityState;
  };
  message: string | null;
  fullAccess: true;
}

export interface BotSummary {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  description: string;
  notifications: boolean;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
  /** A 3D crew robot shown instead of the drawn shape; null or missing = the shape. */
  avatarModel?: CrewAvatar | null;
  /** The Marketplace template this coworker was added from, if any. */
  template?: BotTemplateRef;
  /**
   * The only social accounts this coworker may publish through, bound by the owner. There is no
   * fallback: when the account in use is not one of these, publishing stops.
   */
  publishingAccounts?: PublishingAccount[];
  /** A model or effort chosen while the coworker worked; it starts with the next turn. */
  pendingRuntime?: PendingBotRuntime | null;
  /** The sidebar folder this coworker sits in; none means the top of its workspace. */
  folderId?: string | null;
  /** Set on a coworker made by branching another one's chat. */
  branchedFrom?: BranchOrigin | null;
}

export interface BranchOrigin {
  botId: string;
  name: string;
  messageId: string;
  createdAt: string;
}

export interface BranchConversationInput {
  botId: string;
  messageId: string;
}

/** A coworker's standing rules file, read from its folder. */
export interface CoworkerInstructionsView {
  file: "AGENTS.md" | "CLAUDE.md";
  folder: string;
  text: string;
  hash: string;
  exists: boolean;
}

export interface SaveInstructionsInput {
  botId: string;
  text: string;
  /** The hash the editor loaded; null replaces whatever is there. */
  expectedHash: string | null;
}

/** A folder in the sidebar; folders nest to three levels inside one workspace. */
export interface SidebarFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
}

export const MAX_FOLDER_DEPTH = 3;

export interface CreateFolderInput {
  workspaceId: string;
  name: string;
  parentId: string | null;
}

export interface PendingBotRuntime {
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface PublishingAccount {
  platform: SocialPlatform;
  /** "browser": signed in to this coworker's browser. "composio": a connected app account. */
  source: "browser" | "composio";
  /** The platform's own account id (browser) or the Composio connection id. */
  accountId: string;
  boundAt: string;
}

/**
 * Which Marketplace template and version a coworker came from, and a hash of the brief it was
 * given, so a newer template can update it without overwriting the owner's own edits.
 */
export interface BotTemplateRef {
  id: string;
  version: number;
  briefHash: string;
}

export function isBotTemplateRef(value: unknown): value is BotTemplateRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.id === "string" &&
    /^[a-z0-9][a-z0-9-]{0,79}$/.test(ref.id) &&
    typeof ref.version === "number" &&
    Number.isInteger(ref.version) &&
    ref.version > 0 &&
    typeof ref.briefHash === "string" &&
    /^[0-9a-f]{8}$/.test(ref.briefHash)
  );
}

export const AGENT_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "opencode-free",
  "opencode-default",
  "antigravity-default",
] as const;
export type KnownAgentModelId = (typeof AGENT_MODELS)[number];
export type AgentModelId = KnownAgentModelId | `${AgentProviderId}:${string}`;

export const AGENT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

export interface AgentModelOption {
  id: AgentModelId;
  name: string;
  description: string;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: AgentReasoningEffort[];
}

export const BOT_AVATAR_SHAPES = [
  "blob",
  "pebble",
  "squircle",
  "tablet",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;
export type BotAvatarShape = (typeof BOT_AVATAR_SHAPES)[number];

export const BOT_AVATAR_COLORS = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;
export type BotAvatarColor = (typeof BOT_AVATAR_COLORS)[number];

/** The five 3D crew robots a coworker can use as its face instead of a drawn shape. */
export const CREW_AVATARS = ["startup", "publisher", "outreach", "mailer", "whatsapp"] as const;
export type CrewAvatar = (typeof CREW_AVATARS)[number];

export function isCrewAvatar(value: unknown): value is CrewAvatar {
  return typeof value === "string" && CREW_AVATARS.includes(value as CrewAvatar);
}

export function isAgentModel(value: unknown): value is AgentModelId {
  if (typeof value !== "string") return false;
  if (AGENT_MODELS.some((model) => model === value)) return true;
  const prefix = value.slice(0, value.indexOf(":"));
  return (
    AGENT_PROVIDERS.some((provider) => provider === prefix) &&
    /^[a-z]+:[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,179}$/.test(value)
  );
}

/**
 * Models from providers Sahkarmi no longer ships (Gemini CLI was removed in 0.6.0). A saved coworker on
 * one of these moves to the bundled free model instead of being treated as corrupt.
 */
export function legacyModelReplacement(model: unknown): AgentModelId | null {
  if (typeof model !== "string") return null;
  return model === "gemini-auto" ||
    model === "gemini-pro" ||
    model === "gemini-flash" ||
    model.startsWith("gemini:")
    ? "opencode-free"
    : null;
}

export function isClaudeModel(model: AgentModelId): boolean {
  return providerForModel(model) === "claude";
}

export function modelWireId(model: AgentModelId): string {
  const prefix = model.slice(0, Math.max(model.indexOf(":"), 0));
  return AGENT_PROVIDERS.some((provider) => provider === prefix)
    ? model.slice(model.indexOf(":") + 1)
    : model;
}

export function modelIdForProvider(provider: AgentProviderId, wireId: string): AgentModelId | null {
  const known = AGENT_MODELS.find((model) => model === wireId);
  if (known && providerForModel(known) === provider) return known;
  const id = `${provider}:${wireId}`;
  return isAgentModel(id) ? id : null;
}

export function providerForModel(model: AgentModelId): AgentProviderId {
  const prefix = model.split(":", 1)[0];
  if (AGENT_PROVIDERS.some((provider) => provider === prefix)) return prefix as AgentProviderId;
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("opencode-")) return "opencode";
  if (model.startsWith("antigravity-")) return "antigravity";
  return "codex";
}

/** The model a new coworker gets when this provider is the one available. */
export const DEFAULT_MODEL_FOR_PROVIDER: Record<AgentProviderId, AgentModelId> = {
  codex: "gpt-5.6-sol",
  claude: "claude-opus-5",
  opencode: "opencode-free",
  antigravity: "antigravity-default",
  ...(Object.fromEntries(
    ACP_AGENT_PROVIDERS.map((provider): [AcpAgentProviderId, AgentModelId] => [
      provider,
      `${provider}:default`,
    ]),
  ) as Record<AcpAgentProviderId, AgentModelId>),
};

/** "<agent>:default" keeps whatever model the agent itself is set to use. */
export const ACP_AGENT_DEFAULT_MODEL = "default";

export function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return (
    typeof value === "string" && AGENT_REASONING_EFFORTS.includes(value as AgentReasoningEffort)
  );
}

export function isAvatarShape(value: unknown): value is BotAvatarShape {
  return typeof value === "string" && BOT_AVATAR_SHAPES.includes(value as BotAvatarShape);
}

export function isAvatarColor(value: unknown): value is BotAvatarColor {
  return typeof value === "string" && BOT_AVATAR_COLORS.includes(value as BotAvatarColor);
}

export interface UpdateBotInput {
  botId: string;
  name?: string;
  role?: string;
  description?: string;
  notifications?: boolean;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  avatarShape?: BotAvatarShape;
  avatarColor?: BotAvatarColor;
  avatarModel?: CrewAvatar | null;
  template?: BotTemplateRef;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: string;
  /** The coworker the owner made CEO: it coordinates every other coworker in this workspace. */
  ceoBotId?: string | null;
}

/** What happens to a workspace's coworkers when it is deleted. */
export interface DeleteWorkspaceInput {
  workspaceId: string;
  /** Move them to this workspace, or null to delete them with it. */
  moveCoworkersTo: string | null;
}

/**
 * Authority to decide coworkers' approvals. It only ever starts with the owner, who grants the
 * CEO named categories for a limited time; the CEO can pass on part of that to an employee.
 */
export interface ApprovalAuthorityGrant {
  id: string;
  workspaceId: string;
  botId: string;
  categories: ApprovalCategory[];
  /** "owner", or the id of the CEO that passed it on. */
  grantedBy: string;
  /** The grant this was passed on from; revoking that one ends this one too. */
  parentGrantId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface GrantApprovalAuthorityInput {
  workspaceId: string;
  categories: ApprovalCategory[];
  hours: number;
}

export interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  /** Sidebar folders of every workspace, in display order (always sent by the app). */
  folders?: SidebarFolder[];
}

/** Live status shown as a dot next to each coworker in the team list. */
export type CoworkerStatus = "idle" | "working" | "waiting" | "error";

export const APPROVAL_CATEGORIES = ["payment", "message", "submission", "data", "other"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];
/**
 * "expired" is distinct from "rejected": the owner never answered, so the action did not run.
 * A missing answer must never read as consent, nor as a deliberate refusal.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/** Coarse risk band derived from the permission category; shown in Telegram summaries. */
export const APPROVAL_RISK_LEVELS = ["low", "medium", "high"] as const;
export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

export interface ApprovalRequest {
  id: string;
  botId: string;
  title: string;
  details: string;
  category: ApprovalCategory;
  amount: string | null;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  /**
   * "action": a coworker asked before doing something (its turn continues later).
   * "permission": the app paused a tool call until the owner decides.
   */
  kind?: "action" | "permission";
  permissionCategory?: PermissionCategory;
  /** The exact command or tool call, shown folded under "Technical details". */
  technical?: string;
  /** Which workspace the asking coworker belongs to, so a remote decision names the right one. */
  workspaceId?: string;
  /** The coworker's turn this request belongs to, when it was raised inside one. */
  taskId?: string | null;
  /** After this moment the request is dead: it can be read, never approved. */
  expiresAt?: string | null;
  /** How risky the action is, derived from permissionCategory. Never widens the policy. */
  riskLevel?: ApprovalRiskLevel;
  /** Who decided: "desktop", "telegram:<numeric user id>" or "coworker:<bot id>". Audit only. */
  decidedBy?: string | null;
  /** The coworker holding authority for this request, told about it. The owner can always decide. */
  routedToBotId?: string | null;
  /** Only the owner can decide this (binding an account, for one). Never routed or delegated. */
  ownerOnly?: boolean;
  /** Set on a request to bind this account; approving it binds it. */
  bindsAccount?: PublishingAccount;
  /** When Telegram accepted the notification for this request. */
  notifiedAt?: string | null;
  /** Why the Telegram notification could not be delivered, if it failed. */
  deliveryError?: string | null;
  /** Where the request came from ("approval-provenance"). Absent on older requests. */
  provenance?: ApprovalProvenance;
}

/**
 * "Where this request came from" on an approval card. `label` is data (a coworker's name, a
 * site's domain, an app's name), never instructions; the card words it by `kind`.
 */
export interface ApprovalProvenance {
  kind:
    | "owner"
    | "remote"
    | "routine"
    | "schedule"
    | "team-run"
    | "coworker"
    | "system"
    | "web"
    | "app"
    | "file";
  label?: string;
}

/** Operations the permission engine distinguishes. Order is the Settings display order. */
export const PERMISSION_CATEGORIES = [
  "research",
  "file_read",
  "file_create",
  "file_modify",
  "file_delete",
  "shell",
  "browser_navigation",
  "browser_interaction",
  "desktop_control",
  "downloads",
  "external_messages",
  "publication",
  "business_actions",
  "payments",
  "account_settings",
  "official_forms",
  "app_updates",
] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/**
 * ask: owner approves each action · auto: allowed · workspace: allowed inside the coworker's
 * folder and Shared, asked elsewhere · deny: always blocked.
 */
export const PERMISSION_LEVELS = ["ask", "auto", "workspace", "deny"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** High-impact categories: never "auto"; only ask, deny, or a narrow time-limited grant. */
export const SENSITIVE_PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  "external_messages",
  "publication",
  "business_actions",
  "payments",
  "account_settings",
  "official_forms",
];

export interface PermissionGrant {
  id: string;
  category: PermissionCategory;
  /** null = any coworker. */
  botId: string | null;
  expiresAt: string;
  /** null = unlimited uses until expiry. */
  usesLeft: number | null;
  note: string;
  createdAt: string;
}

/** Progress of a one-click "Connect" for an AI provider. */
export interface ProviderSetupState {
  provider: AgentProviderId;
  /**
   * installing: downloading the provider's tool. waiting: sign-in page is open in the browser.
   * needs-code: paste the code the sign-in page shows. terminal: finish in the opened window.
   */
  phase:
    | "idle"
    | "installing"
    | "waiting"
    | "needs-code"
    | "needs-api-key"
    | "terminal"
    | "checking"
    | "connected"
    | "failed";
  message: string | null;
  /** The provider's own sign-in link, shown in case the browser did not open. */
  url: string | null;
  progress: number | null;
}

/** One Google account Gemini (Antigravity) can use. */
export interface GeminiAccount {
  id: string;
  email: string | null;
  tier: string | null;
  signedIn: boolean;
  /** The account coworkers on Gemini use now. */
  active: boolean;
}

export interface GeminiAccountsState {
  accounts: GeminiAccount[];
}

export interface GeminiAccountsDesktopApi {
  list: () => Promise<GeminiAccountsState>;
  /** Adds a Google account and starts its sign-in; progress arrives as provider-setup events. */
  add: () => Promise<GeminiAccountsState>;
  signIn: (id: string) => Promise<GeminiAccountsState>;
  /** Gemini coworkers use this account from now on (Google's server restarts on it). */
  use: (id: string) => Promise<GeminiAccountsState>;
  remove: (id: string) => Promise<GeminiAccountsState>;
}

export interface ProviderSetupDesktopApi {
  list: () => Promise<ProviderSetupState[]>;
  connect: (provider: AgentProviderId) => Promise<ProviderSetupState>;
  submitCode: (provider: AgentProviderId, code: string) => Promise<ProviderSetupState>;
  setApiKey: (provider: AgentProviderId, apiKey: string) => Promise<ProviderSetupState>;
  check: (provider: AgentProviderId) => Promise<ProviderSetupState>;
  onEvent: (listener: (state: ProviderSetupState) => void) => () => void;
}

export interface PermissionPolicyState {
  levels: Record<PermissionCategory, PermissionLevel>;
  grants: PermissionGrant[];
  /**
   * Auto mode: everyday work (files anywhere, commands, browsing, downloads) never asks.
   * Money, messages, publishing, orders, account changes and government forms still ask,
   * and anything set to "Block" stays blocked.
   */
  autoMode: boolean;
}

export interface PermissionAuditEntry {
  id: string;
  at: string;
  botId: string | null;
  provider: string;
  category: PermissionCategory;
  /** Short, redacted description of the action (no secrets). */
  action: string;
  level: PermissionLevel;
  effective: "allow" | "ask" | "deny";
  decision: "allowed" | "denied" | "approved" | "rejected" | "timed-out";
  reason: string;
}

export interface AddPermissionGrantInput {
  category: PermissionCategory;
  botId: string | null;
  hours: number;
  maxUses: number | null;
  note: string;
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  /**
   * Who authenticated the decision: "desktop" (the trusted renderer) or
   * "telegram:<numeric user id>". Recorded for the audit trail; it never affects the policy.
   */
  decidedBy?: string | null;
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type ScheduleCadence =
  | { kind: "once"; at: string }
  | { kind: "hourly" }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: Weekday; time: string };

export interface ScheduledTask {
  id: string;
  botId: string;
  text: string;
  cadence: ScheduleCadence;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

/** Routines also accept "every N minutes" (N >= 1; under 5 needs explicit confirmation). */
export type RoutineCadence = ScheduleCadence | { kind: "interval"; minutes: number };

export interface RoutineStep {
  id: string;
  botId: string;
  instruction: string;
}

/** "When a file is added to this folder (or a subfolder)". */
export interface RoutineFolderTrigger {
  kind: "folder";
  /** Absolute path of the watched folder. */
  folder: string;
}

export type RoutineTrigger = RoutineFolderTrigger;

/** A named multi-step automation: each step goes to one coworker, in order. */
export interface Routine {
  id: string;
  name: string;
  steps: RoutineStep[];
  /** null = only runs with Run now. */
  cadence: RoutineCadence | null;
  /** An event that starts the routine instead of a cadence (cadence is then null). */
  trigger?: RoutineTrigger | null;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export type RoutineStepStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface RoutineRunStep {
  stepId: string;
  botId: string;
  instruction: string;
  status: RoutineStepStatus;
  deliveryId: string | null;
  /** Short excerpt of the coworker's final reply, or the failure reason. */
  result: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  trigger: "schedule" | "manual" | "folder";
  /** For folder-triggered runs: the files that were added. */
  files?: string[];
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  steps: RoutineRunStep[];
}

export interface RoutinesState {
  routines: Routine[];
  /** Newest first, capped. */
  runs: RoutineRun[];
}

export interface SaveRoutineInput {
  /** Omit to create a new routine. */
  id?: string;
  name: string;
  steps: Array<{ id?: string; botId: string; instruction: string }>;
  cadence: RoutineCadence | null;
  /** Omit or null for no event trigger. */
  trigger?: RoutineTrigger | null;
  enabled: boolean;
  /** Required to save a cadence that repeats more often than every 5 minutes. */
  confirmFrequent?: boolean;
}

export interface CreateScheduleInput {
  botId: string;
  text: string;
  cadence: ScheduleCadence;
}

export interface SharedFileEntry {
  name: string;
  /** Path relative to the shared folder, using "/" separators. */
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
}

export interface SharedFolderListing {
  root: string;
  directory: string;
  entries: SharedFileEntry[];
}

export interface OpenSharedFileInput {
  path: string;
  action: "open" | "reveal";
}

export type ToolCallKind =
  | "command"
  | "file"
  | "browser"
  | "web"
  | "coworker"
  | "approval"
  | "tool";

export interface ToolCallSummary {
  name: string;
  kind: ToolCallKind;
  status: "running" | "completed" | "failed";
  input: string | null;
  output: string | null;
}

export interface BrowserTakeoverRequest {
  id: string;
  botId: string;
  reason: string;
  createdAt: string;
}

export interface BrowserTakeoverState {
  /** True while the human is driving the browser; coworker browser tools are paused. */
  humanInControl: boolean;
  /** Coworkers that asked the human to take over (login, 2FA, CAPTCHA, payment page). */
  requests: BrowserTakeoverRequest[];
}

export type SecureInputKind = "password" | "otp" | "pin" | "other";

/** A coworker asked the owner to type a password or OTP into a page field it cannot fill itself. */
export interface SecureInputRequest {
  id: string;
  botId: string;
  kind: SecureInputKind;
  /** Short label shown on the card, e.g. "Rediffmail password". */
  label: string;
  /** Origin the value may be typed into; the card refuses if the page moved elsewhere. */
  origin: string;
  tabId: string;
  createdAt: string;
}

export interface SubmitSecureInput {
  id: string;
  value: string;
}

export type ConversationMessageAuthor = "user" | "assistant" | "agent" | "system";

export type AttachmentKind = "image" | "file";
export type AttachmentPreviewKind = "image" | "pdf" | "text" | "none";

export interface AttachmentSummary {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  mimeType: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string | null;
}

export type DraftAttachment = AttachmentSummary;

export interface AttachmentDataInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ImportAttachmentsInput {
  paths: string[];
  data: AttachmentDataInput[];
}

export type AttachmentImportEvent =
  | { type: "started"; requestId: string }
  | { type: "completed"; requestId: string; attachments: DraftAttachment[] }
  | { type: "error"; requestId: string; message: string };

export interface OpenAttachmentInput {
  attachmentId: string;
  action: "open" | "reveal";
}

export type QueueDeliveryStatus =
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface QueueDelivery {
  id: string;
  messageId: string;
  recipientBotId: string;
  sender: { kind: "user" } | { kind: "bot"; botId: string };
  /** Who really sent a "user" message: the owner, or the app on the owner's behalf. */
  origin?: MessageOrigin;
  /** Coworker-to-coworker messages in a row that led here (0 or absent for the owner). */
  hops?: number;
  /** This copy failed and the same message was sent again as this delivery. */
  retriedAs?: string;
  /** Interrupted when Sahkarmi closed: the chat offers to run it again. */
  offerRerun?: boolean;
  text: string;
  attachments: AttachmentSummary[];
  replyToMessageId: string | null;
  status: QueueDeliveryStatus;
  position: number | null;
  turnId: string | null;
  error: string | null;
  createdAt: string;
}

export interface QueueSnapshot {
  botId: string;
  paused: boolean;
  deliveries: QueueDelivery[];
}

export interface ConversationMessage {
  id: string;
  turnId?: string;
  author: ConversationMessageAuthor;
  text: string;
  createdAt: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
  itemType?: string;
  source?: "user" | "assistant" | "agent" | "system";
  senderBotId?: string;
  replyToMessageId?: string | null;
  attachments?: AttachmentSummary[];
  delivery?: Pick<QueueDelivery, "id" | "status" | "position">;
  exchange?: AgentExchangeSummary;
  reaction?: MessageReaction | null;
  tool?: ToolCallSummary;
  /** Knowledge Base excerpts this message was grounded with; answers cite them as [S1], [S2]. */
  citations?: KnowledgeCitation[];
}

export const MESSAGE_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;
export const MORE_MESSAGE_REACTIONS = ["🔥", "👏", "🙏", "🤔", "👀", "✅", "🚀", "💯"] as const;
export const ALL_MESSAGE_REACTIONS = [...MESSAGE_REACTIONS, ...MORE_MESSAGE_REACTIONS] as const;
export type MessageReaction =
  | (typeof MESSAGE_REACTIONS)[number]
  | (typeof MORE_MESSAGE_REACTIONS)[number];

export function isMessageReaction(value: unknown): value is MessageReaction {
  return typeof value === "string" && ALL_MESSAGE_REACTIONS.includes(value as MessageReaction);
}

export interface AgentExchangeSummary {
  direction: "incoming" | "outgoing";
  messageId: string;
  senderBotId: string;
  recipientBotIds: string[];
  replyToMessageId: string | null;
  deliveries: Array<Pick<QueueDelivery, "id" | "recipientBotId" | "status" | "position" | "error">>;
}

export type TurnPlanStepStatus = "pending" | "in_progress" | "completed";

export interface TurnPlanStep {
  text: string;
  status: TurnPlanStepStatus;
}

/** The coworker's own task list for a turn (Codex plan, Claude to-dos, ACP plan). */
export interface TurnPlan {
  turnId: string;
  explanation: string | null;
  steps: TurnPlanStep[];
}

export interface ConversationSnapshot {
  botId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messages: ConversationMessage[];
  plan?: TurnPlan | null;
  /** Older messages left out of this snapshot (the window shows the newest ones). */
  earlierCount?: number;
}

export interface ReadConversationOptions {
  /** Newest messages to include; the rest load with "Load earlier". */
  limit?: number;
}

export interface SearchMessagesInput {
  query: string;
  workspaceId?: string;
  limit?: number;
}

export interface MessageSearchHit {
  botId: string;
  botName: string;
  messageId: string;
  author: ConversationMessageAuthor;
  excerpt: string;
  createdAt: string;
}

/**
 * Where a message really came from. The owner's own messages carry "owner" (or nothing, for
 * older data); the team-run engine, routines and schedules send on the owner's behalf.
 */
export type MessageOrigin = "owner" | "team-run" | "routine" | "schedule" | "system";

export interface SendMessageInput {
  botId: string;
  text: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string | null;
  /**
   * The owner typed this in the composer while the coworker works: join the running turn
   * (Codex/Claude) instead of waiting. Only the composer sets it; everything else queues.
   */
  steer?: boolean;
  /** Set by the app (never the renderer) for messages it sends on the owner's behalf. */
  origin?: MessageOrigin;
  /** Set by the app (never the renderer): the owner sent this from their phone. Labels only. */
  remote?: boolean;
}

export interface SetMessageReactionInput {
  botId: string;
  messageId: string;
  emoji: MessageReaction | null;
}

export interface QueuedMessageReceipt {
  messageId: string;
  deliveries: Array<{
    id: string;
    recipientBotId: string;
    status: QueueDeliveryStatus;
    position: number | null;
  }>;
}

export interface CancelQueuedMessageInput {
  botId: string;
  deliveryId: string;
}

export interface SetQueuePausedInput {
  botId: string;
  paused: boolean;
}

export interface InterruptTurnInput {
  botId: string;
  turnId: string;
}

export interface AgentPromptQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
}

export type TaskExecutionStrategy = "single-agent" | "multi-agent";

export type OrchestratorTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "repairing";

export type OrchestratorSpecialistRole =
  | "orchestrator"
  | "architect"
  | "frontend"
  | "backend"
  | "code"
  | "qa"
  | "security"
  | "research"
  | "finance"
  | "ops";

export interface OrchestratorDeliverable {
  name: string;
  path?: string;
  summary?: string;
  bytes?: number;
}

/** "unverified": nothing outside the coworker's own word could be checked. Never "passed". */
export type OrchestratorVerificationVerdict = "passed" | "failed" | "unverified";

export interface OrchestratorVerificationEvidence {
  type: "lint" | "typecheck" | "test" | "build" | "review" | "files" | "check";
  passed: boolean;
  /** Absent in runs from before 0.24: read `passed`. */
  verdict?: OrchestratorVerificationVerdict;
  summary: string;
  output?: string;
  timestamp: string;
}

export interface OrchestratorTask {
  id: string;
  runId: string;
  title: string;
  description: string;
  role: OrchestratorSpecialistRole;
  assignedBotId: string;
  assignedInstanceId: string | null;
  dependencies: string[];
  inputs: Record<string, unknown>;
  deliverables: OrchestratorDeliverable[];
  acceptanceCriteria: string[];
  status: OrchestratorTaskStatus;
  attemptCount: number;
  maxAttempts: number;
  error: string | null;
  evidence: OrchestratorVerificationEvidence[];
  /** After completion: "verified" by outside evidence, or "unverified" (nothing to check). */
  verification?: "verified" | "unverified" | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecutionInstance {
  instanceId: string;
  botId: string;
  botName: string;
  role: OrchestratorSpecialistRole;
  assignedTaskId: string | null;
  status: "idle" | "running" | "waiting" | "completed" | "failed";
  workspacePath: string;
  /** Older runs only; permissions are decided per tool call. */
  toolPermissions?: string[];
  turnCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentCollaborationMessage {
  id: string;
  runId: string;
  senderInstanceId: string;
  senderBotId: string;
  senderRole: OrchestratorSpecialistRole;
  recipientInstanceId: string | null;
  recipientBotId: string;
  recipientRole: OrchestratorSpecialistRole;
  type:
    | "task_delegation"
    | "task_handoff"
    | "clarification_request"
    | "clarification_reply"
    | "status_update"
    | "review_request"
    | "review_verdict"
    | "escalation";
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestratorRun {
  id: string;
  workspaceId: string;
  objective: string;
  strategy: TaskExecutionStrategy;
  status: "planning" | "running" | "paused" | "completed" | "failed";
  tasks: OrchestratorTask[];
  instances: AgentExecutionInstance[];
  messages: AgentCollaborationMessage[];
  deliverables: OrchestratorDeliverable[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  /** "graph": the durable team-run engine drives it; absent or "legacy": the older in-memory loop. */
  engine?: "graph" | "legacy";
  /** Set while the run is paused on an approval the owner has not decided yet. */
  waitingOn?: OrchestratorWait | null;
  /** The owner's check command for this run, if any. */
  checkCommand?: string | null;
  /** How the task list was made: the CEO coworker's plan, or the built-in template. */
  plannedBy?: "ceo" | "template";
  /** Revised plans made after a failure (at most 2). */
  replans?: number;
}

export interface OrchestratorWait {
  approvalId: string;
  botId: string;
  taskId: string;
  title: string;
}

export interface StartOrchestratorRunInput {
  workspaceId?: string;
  objective: string;
  forcedStrategy?: TaskExecutionStrategy;
  /** The owner's own check (e.g. "npm test"), run after each task through the permission rules. */
  checkCommand?: string | null;
}

export interface RespondToPromptInput {
  requestId: string | number;
  answers: Record<string, string[]>;
}

export type AgentEvent =
  | {
      type: "provider-models-refreshed";
      provider: AgentProviderId;
      checkedAt: string;
      addedModels: number;
    }
  | { type: "models-changed"; models: AgentModelOption[] }
  | { type: "status"; status: AgentStatus }
  /** The provider will retry the current request after a transient error (real event). */
  | {
      type: "turn-retrying";
      botId: string;
      attempt: number | null;
      maxRetries: number | null;
      delayMs: number | null;
    }
  | { type: "usage-changed"; usage: AccountUsage }
  | { type: "bots-changed"; bots: BotSummary[] }
  | { type: "conversation"; snapshot: ConversationSnapshot }
  /**
   * One message (or the plan) changed during a turn. Cheaper than a full snapshot on every tool
   * step; the full snapshot still follows at the turn's end. `afterId` is the message just before
   * it in the chat (null: first). A window that missed a change reads the chat again.
   */
  | {
      type: "message-upsert";
      botId: string;
      threadId: string | null;
      activeTurnId: string | null;
      revision: number;
      message?: ConversationMessage;
      afterId?: string | null;
      plan?: TurnPlan | null;
    }
  | {
      type: "conversation-delta";
      botId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "queue-changed"; snapshot: QueueSnapshot }
  | { type: "turn-started"; botId: string; threadId: string; turnId: string }
  | {
      type: "turn-completed";
      botId: string;
      threadId: string;
      turnId: string;
      status: string;
    }
  | {
      type: "prompt";
      requestId: string | number;
      botId: string;
      threadId: string;
      turnId: string;
      questions: AgentPromptQuestion[];
    }
  | { type: "browser-changed"; tabs: BrowserTab[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: BrowserControlState }
  | { type: "browser-takeover-changed"; state: BrowserTakeoverState }
  | { type: "secure-inputs-changed"; requests: SecureInputRequest[] }
  | { type: "workspaces-changed"; state: WorkspaceState }
  | { type: "approvals-changed"; approvals: ApprovalRequest[] }
  | { type: "schedules-changed"; schedules: ScheduledTask[] }
  | { type: "routines-changed"; state: RoutinesState }
  /** Main asks the window to open a coworker's chat, e.g. after a notification was clicked. */
  | { type: "open-requested"; botId: string | null; approvalId?: string }
  | { type: "orchestrator-run-updated"; run: OrchestratorRun }
  | { type: "orchestrator-task-updated"; runId: string; task: OrchestratorTask }
  | { type: "orchestrator-handoff"; message: AgentCollaborationMessage }
  | { type: "error"; botId?: string; code: string; message: string }
  /** Something worth a line in the chat that is not a failure. */
  | { type: "notice"; botId: string; code: string; message: string }
  | { type: "knowledge-changed"; bases: KnowledgeBaseSummary[] }
  | { type: "knowledge-progress"; progress: KnowledgeProgress }
  | { type: "knowledge-semantic"; status: KnowledgeSemanticStatus };

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  ownerThreadId: string | null;
  ownerBotId: string | null;
}

export type BrowserControlPhase = "acting" | "waiting";

export type BrowserControlAction =
  | "open"
  | "list-tabs"
  | "snapshot"
  | "click"
  | "type"
  | "key"
  | "paste"
  | "scroll"
  | "upload"
  | "back"
  | "forward"
  | "reload"
  | "screenshot"
  | "close-tab";

export interface BrowserControlSession {
  id: string;
  threadId: string;
  turnId: string;
  callId: string;
  tabId: string | null;
  action: BrowserControlAction;
  phase: BrowserControlPhase;
  startedAt: string;
}

export interface BrowserControlState {
  sessions: BrowserControlSession[];
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserOpenInput {
  url: string;
  ownerThreadId?: string | null;
  ownerBotId?: string | null;
}

export interface BrowserVisibilityInput {
  visible: boolean;
  bounds?: BrowserBounds;
  /** The coworker whose chat shows the panel: only its pages are shown there. */
  botId?: string | null;
  threadId?: string | null;
}

export interface AgentDesktopApi {
  getStatus: () => Promise<AgentStatus>;
  getUsage: () => Promise<AccountUsage>;
  listModels: () => Promise<AgentModelOption[]>;
  refreshModels: () => Promise<AgentModelOption[]>;
  listBots: () => Promise<BotSummary[]>;
  createBot: (workspaceId?: string) => Promise<BotSummary>;
  updateBot: (input: UpdateBotInput) => Promise<BotSummary>;
  deleteBot: (botId: string) => Promise<void>;
  /** `limit`: only the newest messages (the snapshot's earlierCount says how many were left out). */
  readConversation: (
    botId: string,
    options?: ReadConversationOptions,
  ) => Promise<ConversationSnapshot>;
  /** Checks every AI provider not checked yet (Settings > AI and models, setup). */
  probeProviders: () => Promise<void>;
  searchMessages: (input: SearchMessagesInput) => Promise<MessageSearchHit[]>;
  chooseAttachments: () => Promise<DraftAttachment[]>;
  /** Imports in-memory files (voice notes) as draft attachments. */
  importData: (data: AttachmentDataInput[]) => Promise<DraftAttachment[]>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  discardDraftAttachment: (attachmentId: string) => Promise<void>;
  openAttachment: (input: OpenAttachmentInput) => Promise<void>;
  readInstructions: (botId: string) => Promise<CoworkerInstructionsView>;
  saveInstructions: (input: SaveInstructionsInput) => Promise<CoworkerInstructionsView>;
  revealInstructions: (botId: string) => Promise<void>;
  /** A new coworker, a copy of this one, that starts from the chat through that message. */
  branchConversation: (input: BranchConversationInput) => Promise<BotSummary>;
  sendMessage: (input: SendMessageInput) => Promise<QueuedMessageReceipt>;
  setMessageReaction: (input: SetMessageReactionInput) => Promise<void>;
  listQueue: (botId: string) => Promise<QueueSnapshot>;
  cancelQueuedMessage: (input: CancelQueuedMessageInput) => Promise<void>;
  /** Sends a task that was interrupted when Sahkarmi closed again, as a new message. */
  rerunInterrupted: (input: CancelQueuedMessageInput) => Promise<void>;
  /** Hides the "run again" offer for an interrupted task. */
  dismissInterrupted: (input: CancelQueuedMessageInput) => Promise<void>;
  sendQueuedNow: (input: CancelQueuedMessageInput) => Promise<void>;
  setQueuePaused: (input: SetQueuePausedInput) => Promise<void>;
  interrupt: (input: InterruptTurnInput) => Promise<void>;
  respondToPrompt: (input: RespondToPromptInput) => Promise<void>;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export interface BrowserDesktopApi {
  open: (input: BrowserOpenInput) => Promise<BrowserTab>;
  activate: (tabId: string) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  listTabs: () => Promise<BrowserTab[]>;
  getControlState: () => Promise<BrowserControlState>;
  setVisible: (input: BrowserVisibilityInput) => Promise<void>;
  getTakeover: () => Promise<BrowserTakeoverState>;
  takeOver: () => Promise<BrowserTakeoverState>;
  handBack: (note?: string | null) => Promise<BrowserTakeoverState>;
  /** Says no to every pending "please take over" request; coworkers are told not to continue. */
  declineTakeover: (note?: string | null) => Promise<BrowserTakeoverState>;
  /** A small picture of a tab for the compact browser card; null when it cannot be captured. */
  preview: (tabId: string) => Promise<string | null>;
  listSecureInputs: () => Promise<SecureInputRequest[]>;
  /** Types the value straight into the page; it never reaches the coworker or the chat. */
  submitSecureInput: (input: SubmitSecureInput) => Promise<SecureInputRequest[]>;
  dismissSecureInput: (id: string) => Promise<SecureInputRequest[]>;
  /** The owner would rather type it in the browser themselves. */
  takeOverSecureInput: (id: string) => Promise<SecureInputRequest[]>;
}

export interface TeamDesktopApi {
  listWorkspaces: () => Promise<WorkspaceState>;
  createWorkspace: (name: string) => Promise<WorkspaceState>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceState>;
  setActiveWorkspace: (workspaceId: string) => Promise<WorkspaceState>;
  deleteWorkspace: (input: DeleteWorkspaceInput) => Promise<WorkspaceState>;
  setWorkspaceCeo: (workspaceId: string, botId: string | null) => Promise<WorkspaceState>;
  createFolder: (input: CreateFolderInput) => Promise<WorkspaceState>;
  renameFolder: (folderId: string, name: string) => Promise<WorkspaceState>;
  moveFolder: (folderId: string, parentId: string | null) => Promise<WorkspaceState>;
  reorderFolder: (folderId: string, direction: "up" | "down") => Promise<WorkspaceState>;
  /** Removes the folder; its coworkers and folders move up one level. */
  deleteFolder: (folderId: string) => Promise<WorkspaceState>;
  setBotFolder: (botId: string, folderId: string | null) => Promise<BotSummary>;
  unbindPublishingAccount: (
    botId: string,
    platform: SocialPlatform,
    source: PublishingAccount["source"],
  ) => Promise<void>;
}

export interface PermissionsDesktopApi {
  get: () => Promise<PermissionPolicyState>;
  setLevel: (
    category: PermissionCategory,
    level: PermissionLevel,
  ) => Promise<PermissionPolicyState>;
  addGrant: (input: AddPermissionGrantInput) => Promise<PermissionPolicyState>;
  revokeGrant: (grantId: string) => Promise<PermissionPolicyState>;
  audit: () => Promise<PermissionAuditEntry[]>;
  clearAudit: () => Promise<void>;
  setAutoMode: (enabled: boolean) => Promise<PermissionPolicyState>;
}

export interface UsageDesktopApi {
  overview: () => Promise<UsageOverview>;
  refresh: () => Promise<UsageOverview>;
  clear: () => Promise<UsageOverview>;
}

export interface FeaturesDesktopApi {
  list: () => Promise<FeatureState[]>;
  setEnabled: (featureId: string, enabled: boolean) => Promise<FeatureState[]>;
  previewManifest: (json: string) => Promise<FeatureManifestPreview>;
  applyManifest: (json: string) => Promise<FeatureState[]>;
  resetCatalogue: () => Promise<FeatureState[]>;
}

export interface BusinessDesktopApi {
  integrations: () => Promise<BusinessIntegration[]>;
  listTargets: () => Promise<BusinessTarget[]>;
  saveTarget: (input: SaveBusinessTargetInput) => Promise<BusinessTarget[]>;
  deleteTarget: (targetId: string) => Promise<BusinessTarget[]>;
}

export interface MarketplaceDesktopApi {
  /** Ids of catalog skills installed in Shared/Skills. */
  installedSkills: () => Promise<string[]>;
  installSkill: (skillId: string) => Promise<string[]>;
  uninstallSkill: (skillId: string) => Promise<string[]>;
  /** Skills coworkers wrote for themselves in Shared/Skills/Learned, newest first. */
  learnedSkills: () => Promise<LearnedSkillSummary[]>;
  removeLearnedSkill: (skillId: string) => Promise<LearnedSkillSummary[]>;
}

export interface LearnedSkillSummary {
  id: string;
  name: string;
  whenToUse: string;
  version: number;
  updatedAt: string;
  author: string;
  /** Path inside the Shared folder, for files.open. */
  sharedPath: string;
}

export interface ApprovalsDesktopApi {
  list: () => Promise<ApprovalRequest[]>;
  decide: (input: DecideApprovalInput) => Promise<ApprovalRequest>;
  listAuthority: () => Promise<ApprovalAuthorityGrant[]>;
  grantAuthority: (input: GrantApprovalAuthorityInput) => Promise<ApprovalAuthorityGrant[]>;
  revokeAuthority: (grantId: string) => Promise<ApprovalAuthorityGrant[]>;
}

export interface RoutinesDesktopApi {
  list: () => Promise<RoutinesState>;
  save: (input: SaveRoutineInput) => Promise<RoutinesState>;
  delete: (routineId: string) => Promise<RoutinesState>;
  setEnabled: (routineId: string, enabled: boolean) => Promise<RoutinesState>;
  /** Starts a run in the background and returns at once. */
  runNow: (routineId: string) => Promise<RoutinesState>;
  /** Asks the owner to choose a folder for a "file added" trigger; null when cancelled. */
  pickFolder: () => Promise<string | null>;
}

export interface SchedulesDesktopApi {
  list: () => Promise<ScheduledTask[]>;
  create: (input: CreateScheduleInput) => Promise<ScheduledTask>;
  setEnabled: (scheduleId: string, enabled: boolean) => Promise<ScheduledTask>;
  delete: (scheduleId: string) => Promise<void>;
  runNow: (scheduleId: string) => Promise<void>;
}

export interface FilesDesktopApi {
  list: (directory?: string) => Promise<SharedFolderListing>;
  add: (directory?: string) => Promise<SharedFolderListing>;
  open: (input: OpenSharedFileInput) => Promise<void>;
}

export interface UpdateDesktopApi {
  getStatus: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
  install: () => Promise<void>;
  onEvent: (listener: (status: UpdateStatus) => void) => () => void;
}

export interface AiRuntimeDesktopApi {
  getStatus: () => Promise<AiRuntimeStatus>;
  check: () => Promise<AiRuntimeStatus>;
  update: (toolId: AiToolId) => Promise<AiRuntimeStatus>;
  onEvent: (listener: (status: AiRuntimeStatus) => void) => () => void;
}

export interface MaintenanceDesktopApi {
  exportData: () => Promise<ExportResult>;
  exportDiagnostics: () => Promise<ExportResult>;
  /** Settings > Storage: how much space each kind of data takes. */
  storageUsage: () => Promise<StorageUsage>;
  /** Removes only data that is safe to remove for that category (see StorageCleanInput). */
  cleanStorage: (input: StorageCleanInput) => Promise<StorageCleanResult>;
}

export const STORAGE_CATEGORY_IDS = [
  "browser",
  "runtimes",
  "accounts",
  "attachments",
  "knowledge",
  "logs",
  "mailboxArchive",
] as const;
export type StorageCategoryId = (typeof STORAGE_CATEGORY_IDS)[number];

export interface StorageCategory {
  id: StorageCategoryId;
  bytes: number;
  /** Too many files to count them all: the real size is at least `bytes`. */
  partial: boolean;
}

export interface StorageUsage {
  categories: StorageCategory[];
  measuredAt: string;
}

/**
 * browser: data of deleted coworkers; runtimes: AI tool versions no longer used; accounts:
 * folders of removed Google accounts; attachments: files sent with messages older than
 * `olderThanDays`; logs: older log files.
 */
export type StorageCleanInput =
  | { category: "browser" | "runtimes" | "accounts" | "logs" }
  | { category: "attachments"; olderThanDays: number };

export interface StorageCleanResult {
  removedItems: number;
  /** Space freed (may be an estimate). */
  bytes: number;
  /** Items still in use; tried again at the next start. */
  skipped: number;
}

export interface OrchestratorDesktopApi {
  getRuns: () => Promise<OrchestratorRun[]>;
  getRun: (runId: string) => Promise<OrchestratorRun | null>;
  startRun: (input: StartOrchestratorRunInput) => Promise<OrchestratorRun>;
  pauseRun: (runId: string) => Promise<OrchestratorRun | null>;
  resumeRun: (runId: string) => Promise<OrchestratorRun | null>;
  cancelRun: (runId: string) => Promise<OrchestratorRun | null>;
  getEngineSettings: () => Promise<EngineSettings>;
  setEngineSettings: (input: Partial<EngineSettings>) => Promise<EngineSettings>;
  performance: () => Promise<PerformanceSummary>;
  /** Live memory use, the owner's limit and a recommendation (Settings > Features). */
  resourceStatus: () => Promise<ResourceStatus>;
}

/** How hard the agent engine may work this PC. Owner-editable in Settings > Features. */
export interface EngineSettings {
  /** Coworker turns that may run at the same time (1-8). */
  maxConcurrentTurns: number;
  /** A turn with no sign of life (no text, no tool) this long is stopped (5-240 minutes). */
  watchdogMinutes: number;
  /**
   * The most memory (MB) Sahkarmi and the coworker programs it starts may use together. 0 is
   * Automatic: no app limit, only the PC's own free memory is watched (the old behaviour).
   */
  memoryLimitMb: number;
  /** Warn and start saving memory when use reaches this share of the limit (50-95 %). */
  memoryWarnPercent: number;
  /** The most steps (tool calls) one Claude turn may take before it pauses (50-1000). */
  maxStepsPerTurn: number;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  maxConcurrentTurns: 3,
  watchdogMinutes: 45,
  memoryLimitMb: 0,
  memoryWarnPercent: 80,
  maxStepsPerTurn: 200,
};

export const ENGINE_SETTINGS_LIMITS = {
  // Up to 64: Codex and ACP agents share one process, so many can work at once; a Claude
  // coworker's own process waits for free memory instead of being stopped by this number.
  maxConcurrentTurns: { min: 1, max: 64 },
  watchdogMinutes: { min: 5, max: 240 },
  // 0 (Automatic) or 1 GB up to the PC's RAM; the store also caps it at the installed RAM.
  memoryLimitMb: { min: 0, max: 1_048_576 },
  memoryWarnPercent: { min: 50, max: 95 },
  maxStepsPerTurn: { min: 50, max: 1000 },
} as const;

/** The smallest memory limit the owner can set; below it the app itself does not fit. */
export const MIN_MEMORY_LIMIT_MB = 1024;

/** Where Sahkarmi's memory goes right now, grouped by the program that uses it. */
export interface ResourceUsageGroup {
  kind: "app" | "claude" | "codex" | "antigravity" | "opencode" | "gemini" | "tools";
  label: string;
  mb: number;
  processes: number;
}

export type ResourceLevel = "ok" | "warn" | "over";

export interface ResourceRecommendation {
  /** The limit Sahkarmi suggests for this PC, in MB. */
  limitMb: number;
  /** Claude coworkers that fit side by side under the suggested limit. */
  claudeCoworkers: number;
  reason: string;
}

/** Settings > Features memory view: measured, never estimated, except the forecast. */
export interface ResourceStatus {
  totalMb: number;
  freeMb: number;
  /** The PC as a whole: "ok", "low" or "critical" free memory. */
  systemPressure: "ok" | "low" | "critical";
  /** Sahkarmi plus every program it started; null until the first measurement. */
  appUsedMb: number | null;
  groups: ResourceUsageGroup[];
  limitMb: number;
  warnPercent: number;
  /** "warn" from the warning share of the limit, "over" at or above the limit. */
  level: ResourceLevel;
  /** Growth over the last few minutes (MB per minute); null with too few readings. */
  trendMbPerMin: number | null;
  /** At this growth, minutes until the limit is reached; null when not growing or no limit. */
  minutesToLimit: number | null;
  recommendation: ResourceRecommendation;
  /** Ready-made limits that fit this PC, in MB. */
  presetsMb: number[];
  sampledAt: string | null;
}

/** One finished coworker turn, recorded on this PC only (never sent anywhere). */
export interface RunEvent {
  id: number;
  botId: string;
  botName: string | null;
  provider: string | null;
  model: string | null;
  origin: MessageOrigin;
  outcome: "completed" | "failed" | "interrupted" | "cancelled";
  startedAt: string;
  durationMs: number;
  toolCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface PerformanceRow {
  key: string;
  turns: number;
  completed: number;
  failed: number;
  medianDurationMs: number;
  averageTools: number;
}

export interface PerformanceSummary {
  since: string | null;
  totalTurns: number;
  byCoworker: PerformanceRow[];
  byModel: PerformanceRow[];
  recent: RunEvent[];
}

/** A task that was running when Sahkarmi closed, offered to the owner to run again. */
export interface InterruptedTask {
  deliveryId: string;
  botId: string;
  text: string;
  createdAt: string;
}

export interface SahkarmiDesktopApi {
  setTheme?: (theme: "system" | "light" | "dark") => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  getSetupState: () => Promise<AppSetupState>;
  saveSetup: (input: SaveSetupInput) => Promise<AppSetupState>;
  getMacPermissions: () => Promise<MacPermissionsState>;
  requestMacPermission: (permission: MacPermissionId) => Promise<MacPermissionsState>;
  openExternal: (destination: ExternalDestination) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  /**
   * The anonymous daily user number: asked once in the sidebar, changeable in Settings > About.
   * "ask" until answered; null in copies that never count (development and test builds).
   */
  usageCount: {
    get: () => Promise<"ask" | "on" | "off" | null>;
    set: (enabled: boolean) => Promise<"ask" | "on" | "off">;
  };
  agent: AgentDesktopApi;
  browser: BrowserDesktopApi;
  team: TeamDesktopApi;
  approvals: ApprovalsDesktopApi;
  permissions: PermissionsDesktopApi;
  providerSetup: ProviderSetupDesktopApi;
  geminiAccounts: GeminiAccountsDesktopApi;
  usage: UsageDesktopApi;
  features: FeaturesDesktopApi;
  business: BusinessDesktopApi;
  marketplace: MarketplaceDesktopApi;
  schedules: SchedulesDesktopApi;
  routines: RoutinesDesktopApi;
  files: FilesDesktopApi;
  update: UpdateDesktopApi;
  aiRuntime: AiRuntimeDesktopApi;
  maintenance: MaintenanceDesktopApi;
  orchestrator: OrchestratorDesktopApi;
  memory: MemoryDesktopApi;
  knowledge: KnowledgeDesktopApi;
  composio: ComposioDesktopApi;
  apis: ApiIntegrationsDesktopApi;
  assignments: AssignmentsDesktopApi;
  telegram: TelegramDesktopApi;
  customSkills: CustomSkillsDesktopApi;
  mcp: McpDesktopApi;
  workflow: WorkflowDesktopApi;
  voice: VoiceDesktopApi;
}

export type WorkflowFormat = "md" | "txt" | "json";

/** What to export: one coworker's chat (its last task or all), a team run, or a routine. */
export type WorkflowExportSource =
  | { kind: "chat"; botId: string; scope: "last" | "all" }
  | { kind: "team-run"; runId: string }
  | { kind: "routine"; routineId: string };

export interface WorkflowTimelineEntry {
  at?: string;
  by: string;
  kind: "asked" | "said" | "note" | "step" | "message" | "task";
  text: string;
  detail?: string;
  status?: string;
}

/** An exported workflow ("sahkarmi.workflow/v1"); the .json export is exactly this. */
export interface WorkflowDoc {
  format: "sahkarmi.workflow/v1";
  name: string;
  exportedAt: string;
  source: "chat" | "team-run" | "routine";
  goal?: string;
  coworkers: Array<{ name: string; role?: string; model?: string }>;
  /** The reusable recipe: what each coworker is asked to do, in order. */
  steps: Array<{ by: string; do: string }>;
  schedule?: RoutineCadence;
  /** What actually happened, oldest first. */
  timeline: WorkflowTimelineEntry[];
  result?: { status: string; summary?: string; files: string[] };
  run?: {
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    toolCalls: number | null;
  };
}

export interface WorkflowImportPreview {
  doc: WorkflowDoc;
  /** Coworker name in the file → the owner's coworker id that best matches it. */
  suggestions: Record<string, string>;
}

export interface WorkflowDesktopApi {
  /** Asks where to save; null when the owner cancels. */
  export: (
    source: WorkflowExportSource,
    format: WorkflowFormat,
  ) => Promise<{ path: string } | null>;
  /** Asks for a .json workflow and reads it; null when the owner cancels. */
  readImport: () => Promise<WorkflowImportPreview | null>;
}

/** A skill the owner added (pasted or from a GitHub repo), kept in Shared/Skills/Custom/<id>/. */
export interface CustomSkill {
  id: string;
  name: string;
  description: string;
  /** "pasted" or "github.com/owner/repo/folder". */
  source: string;
  installedAt: string;
  /** Path inside the Shared folder, e.g. "Skills/Custom/frontend-design/SKILL.md". */
  sharedPath: string;
  /** The import looked risky (pipes a download into a shell, says not to ask): not trusted yet. */
  reviewNeeded?: boolean;
  /** What was flagged, in plain English. */
  risks?: string[];
}

/** One skill folder (with a SKILL.md) found in a GitHub repo. */
export interface GithubSkillCandidate {
  /** Folder inside the repo ("" for the repo root). */
  path: string;
  name: string;
  description: string;
  files: number;
  bytes: number;
  tooBig: boolean;
  installed: boolean;
}

export interface GithubSkillPreview {
  repo: string;
  ref: string;
  url: string;
  truncated: boolean;
  skills: GithubSkillCandidate[];
}

export interface CustomSkillsDesktopApi {
  list: () => Promise<CustomSkill[]>;
  add: (text: string) => Promise<CustomSkill[]>;
  previewGithub: (url: string) => Promise<GithubSkillPreview>;
  installGithub: (url: string, paths: string[]) => Promise<CustomSkill[]>;
  remove: (id: string) => Promise<CustomSkill[]>;
  /** The owner has read a flagged skill and trusts it. */
  markReviewed: (id: string) => Promise<CustomSkill[]>;
}

/** What the owner can press to fix an MCP server problem. */
export type McpFixAction =
  | "edit"
  | "recheck"
  | "install-uv"
  | "install-node"
  | "install-python"
  | "retry-long"
  | "reinstall"
  | "use-skill-route"
  | "shared-mode";

/** A problem Settings can see before any coworker starts the server (MCP-1, -5, -6, -9, -13). */
export interface McpProblem {
  kind:
    | "placeholder"
    | "missing-command"
    | "store-stub"
    | "missing-folder"
    | "missing-file"
    | "missing-env";
  /** The command, folder, file, env name or template text the problem is about. */
  subject: string;
  detail?: string;
  /** Where to download a missing program. */
  link?: string;
  fix?: McpFixAction;
}

/** Plain-English causes of a failed test (audit §11.7); the window words each one. */
export type McpDiagnosisCode =
  | "command-not-found"
  | "store-stub"
  | "module-missing"
  | "not-mcp"
  | "no-reply"
  | "stdout-noise"
  | "auth"
  | "port-in-use"
  | "first-run-timeout"
  | "path-not-found"
  | "long-path"
  | "build-tools"
  | "python-version"
  | "exited"
  | "unknown";

export interface McpDiagnosis {
  code: McpDiagnosisCode;
  fix?: McpFixAction;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

/** The last "Test server" result (MCP-18). */
export interface McpServerStatus {
  lastCheckedAt: string;
  ok: boolean;
  toolCount: number;
  /** Up to 20 names. */
  toolNames: string[];
  tools?: McpToolInfo[];
  error: string | null;
  stderrTail: string;
  diagnosis?: McpDiagnosis | null;
  durationMs?: number;
}

/** An env value (or header) a server says it needs, from its server.json (MCP-13). */
export interface McpEnvRequirement {
  name: string;
  description: string;
  isRequired: boolean;
  isSecret: boolean;
}

/** An MCP server as Settings shows it: secret values (env, headers) are never sent here. */
export interface McpServerSummary {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  envKeys: string[];
  headerKeys: string[];
  source: string;
  /** A local server whose command is not on this PC (not installed, or a wrong path). */
  missingCommand?: boolean;
  /** Folder the server starts in. */
  cwd?: string;
  /** Everything wrong that can be seen without starting it. */
  problems: McpProblem[];
  status?: McpServerStatus | null;
  /** Added after the "test first" rule: it can be turned on only after a passing test. */
  needsTest?: boolean;
  /** Coworkers that get it; null or missing means every coworker. */
  coworkerIds?: string[] | null;
  /** Started once for all coworkers instead of once per chat (MCP-7). */
  shared?: boolean;
  /** Big install or imports heavy libraries: better shared. */
  heavy?: boolean;
  requiredEnv?: McpEnvRequirement[];
}

export interface McpServerInput {
  /** Set when editing; a blank env or header value then keeps the saved one. */
  id?: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  /** Folder to start in (stdio only). */
  cwd?: string;
  requiredEnv?: McpEnvRequirement[];
  /** Imports heavy libraries (video, speech, ML): Settings suggests shared mode. */
  heavy?: boolean;
}

export interface McpImportResult {
  servers: McpServerSummary[];
  added: string[];
  skipped: string[];
  /** Names that already exist; import again with them in `replace` to overwrite (MCP-14). */
  conflicts: string[];
}

/** What "Connect from GitHub" found a repo to be (audit §11.5). */
export type McpRepoKind = "mcp-stdio" | "mcp-http" | "mcp-needs-build" | "not-mcp" | "unknown";
export type McpNotMcpKind = "cli" | "http-api" | "webapp";

/** How a candidate gets onto this PC; every source is pinned to a version or a commit. */
export type McpInstallSource =
  | { type: "npm"; package: string; version: string }
  | { type: "pypi"; package: string; version: string; script: string; requiresPython?: string }
  | { type: "oci"; image: string }
  | {
      type: "clone-node";
      repoUrl: string;
      commit: string;
      subPath: string;
      bin: string;
      build: boolean;
    }
  | {
      type: "clone-python";
      repoUrl: string;
      commit: string;
      subPath: string;
      script: string | null;
      entry: string | null;
      requiresPython?: string;
    };

/** One way to run the server, with where each part came from. */
export interface McpCandidate {
  id: string;
  label: string;
  runtime: "node" | "python" | "docker" | "remote" | "other";
  /** Ready-to-save settings; missing when the server must be installed first. */
  server?: McpServerInput;
  install: McpInstallSource | null;
  evidence: string[];
  requiredEnv: McpEnvRequirement[];
  /** Template values still in the settings (MCP-1). */
  placeholders: string[];
  /** Programs it needs on this PC: node, uv, python, docker, git. */
  needs: string[];
}

export interface McpRepoAnalysis {
  id: string;
  /** owner/repo */
  repo: string;
  url: string;
  commit: string;
  subPath: string;
  kind: McpRepoKind;
  notMcp: McpNotMcpKind[];
  evidence: string[];
  candidates: McpCandidate[];
  /** A command-line program from PyPI it ships, for the "Use as a Skill" route. */
  cli: { package: string; version: string; script: string; requiresPython?: string } | null;
  /** Big libraries (video, speech, ML): better run once, shared, or as a Skill. */
  heavy: boolean;
  warnings: string[];
  truncated: boolean;
  /** Smart import switched off: the repo's .mcp.json files, merged, for the paste box. */
  legacyJson?: string;
}

/** One step of a guided install, as the approval card shows it (audit §11.8). */
export interface McpInstallStepView {
  kind:
    | "download-uv"
    | "download-node"
    | "python-install"
    | "venv"
    | "pip"
    | "npm"
    | "clone"
    | "build"
    | "docker-pull"
    | "verify"
    | "skill"
    | "save"
    | "test";
  /** The exact command (or download address) that will run. */
  command: string;
}

/** What the owner approves before anything is downloaded or run. */
export interface McpInstallPlan {
  id: string;
  kind: "server" | "skill" | "tool";
  name: string;
  /** Repo + pinned commit, or package + version. */
  source: string;
  folder: string;
  /** Rough download size in MB, when known. */
  sizeMb: { min: number; max: number } | null;
  heavy: boolean;
  steps: McpInstallStepView[];
  warnings: string[];
}

export interface McpInstallJob {
  id: string;
  planId: string;
  state: "running" | "done" | "failed" | "cancelled";
  steps: { kind: McpInstallStepView["kind"]; state: "waiting" | "running" | "done" | "failed" }[];
  /** The last lines the programs printed. */
  log: string;
  error: string | null;
  diagnosis: McpDiagnosis | null;
  /** The server list after a server install (with the automatic test result). */
  servers?: McpServerSummary[];
  /** The skill written by the Skill route. */
  skillName?: string;
}

export interface McpDesktopApi {
  list: () => Promise<McpServerSummary[]>;
  save: (input: McpServerInput) => Promise<McpServerSummary[]>;
  importJson: (text: string, replace?: string[]) => Promise<McpImportResult>;
  /** The .mcp.json files of a GitHub repo, merged, for the owner to review before importing. */
  githubJson: (url: string) => Promise<string>;
  setEnabled: (id: string, enabled: boolean) => Promise<McpServerSummary[]>;
  remove: (id: string) => Promise<McpServerSummary[]>;
  /** Re-reads Windows' PATH (after installing something) and checks every server again. */
  recheck: () => Promise<McpServerSummary[]>;
  /** Starts the server once, lists its tools, stops it, and stores the result. */
  test: (id: string) => Promise<McpServerSummary[]>;
  /** null = every coworker. */
  setCoworkers: (id: string, coworkerIds: string[] | null) => Promise<McpServerSummary[]>;
  /** Reads a GitHub repo (and the MCP Registry) and says what it is and how it could run. */
  analyzeGithub: (url: string) => Promise<McpRepoAnalysis>;
  /** Saves one ready-made candidate (switched off until tested), with the env values filled in. */
  addCandidate: (
    analysisId: string,
    candidateId: string,
    name: string,
    env: Record<string, string>,
  ) => Promise<McpServerSummary[]>;
  /** Builds (does not run) the plan to install a candidate into its own folder. */
  planInstall: (
    analysisId: string,
    candidateId: string,
    name: string,
    env: Record<string, string>,
  ) => Promise<McpInstallPlan>;
  /** Builds the "Use as a Skill (CLI)" plan for a repo that is not an MCP server. */
  planSkill: (analysisId: string) => Promise<McpInstallPlan>;
  /** Builds the plan to download a missing tool (uv, Python 3.11 or Node.js). */
  planTool: (tool: "uv" | "python" | "node") => Promise<McpInstallPlan>;
  /** Runs a plan the owner approved. */
  runInstall: (planId: string) => Promise<McpInstallJob>;
  installStatus: (jobId: string) => Promise<McpInstallJob>;
  cancelInstall: (jobId: string) => Promise<McpInstallJob>;
  /** Shared mode (MCP-7): start once for all coworkers instead of once per chat. */
  setShared: (id: string, shared: boolean) => Promise<McpServerSummary[]>;
  /** Writes a small MCP adapter for a repo whose local web API coworkers should call. */
  addAdapter: (analysisId: string, name: string) => Promise<McpServerSummary[]>;
}

/** One app (a Composio toolkit) as shown on the Marketplace's Apps tab. */
export interface ComposioAppMeta {
  /** The toolkit slug, e.g. "github". */
  id: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  toolsCount: number | null;
  auth: "oauth" | "api-key" | "none" | "other";
  /** Connect works without the owner's own developer app keys. */
  oneClick: boolean;
  isConnected: boolean;
  connectedAccountId: string | null;
  connectionStatus: string | null;
}

export interface ComposioStatus {
  configured: boolean;
  apiKeyMasked: string | null;
  connectedCount: number;
  freeTierActive: boolean;
  monthlyQuota: number;
  planName: string;
  catalogueSize: number;
  catalogueError: string | null;
  /** The last connection check failed; apps show their last known state meanwhile. */
  connectionsError?: string | null;
}

export interface ComposioConnectionInitiateResult {
  connectionId: string;
  redirectUrl: string;
}

export type ComposioConnectionState = "connecting" | "connected" | "failed" | "unknown";

export interface ComposioConnectionStatus {
  connectionId: string;
  status: string;
  state: ComposioConnectionState;
}

/** Chatting with coworkers from Telegram, as Settings > Telegram shows it (never the token). */
export interface TelegramStatus {
  configured: boolean;
  botUsername: string | null;
  paired: boolean;
  chatName: string | null;
  /** The code to send as "/start <code>" while no chat is paired. */
  pairingCode: string | null;
  coworkerId: string | null;
  running: boolean;
  error: string | null;
  /**
   * True once the paired chat's numeric Telegram user id is known. Approval commands are
   * refused without it, so a chat paired by an older build must pair again before it can decide.
   */
  ownerIdVerified?: boolean;
  /** True when approvals may be decided from Telegram at all. */
  approvalsEnabled?: boolean;
}

export interface TelegramDesktopApi {
  status: () => Promise<TelegramStatus>;
  setToken: (token: string) => Promise<TelegramStatus>;
  setCoworker: (botId: string) => Promise<TelegramStatus>;
  unpair: () => Promise<TelegramStatus>;
}

export interface ComposioDesktopApi {
  getStatus: () => Promise<ComposioStatus>;
  setKey: (key: string) => Promise<ComposioStatus>;
  listApps: (refresh?: boolean) => Promise<ComposioAppMeta[]>;
  connect: (appId: string) => Promise<ComposioConnectionInitiateResult>;
  connectionStatus: (connectionId: string) => Promise<ComposioConnectionStatus>;
  disconnect: (connectionId: string) => Promise<boolean>;
}

/** Where an API key goes on every request. */
export type ApiAuthKind = "bearer" | "header" | "query" | "basic" | "none";

export interface ApiAuth {
  kind: ApiAuthKind;
  /** The header or query parameter name (for "header" and "query"). */
  name: string | null;
}

export interface ApiParam {
  name: string;
  in: "path" | "query" | "header" | "body";
  required: boolean;
  type: string;
  description: string;
  /** A value the specification gives (default, example or first allowed value). */
  example?: string;
}

/** One endpoint a coworker may call. */
export interface ApiOperation {
  id: string;
  method: string;
  path: string;
  summary: string;
  params: ApiParam[];
  /** Sends, creates, changes or deletes something: asks the owner first. */
  risky: boolean;
}

/** What discovery could not find on its own; the owner is asked only for these. */
export type ApiMissingField = "provider" | "baseUrl" | "example";

export type ApiIntegrationStatus =
  | "needs-info"
  | "ready-to-test"
  | "tested"
  | "failed"
  | "active"
  | "disabled";

export type ApiTestId =
  | "auth"
  | "connectivity"
  | "endpoint"
  | "request"
  | "parsing"
  | "permissions"
  | "errors";

export interface ApiTestResult {
  id: ApiTestId;
  outcome: "passed" | "failed" | "skipped";
  detail: string;
}

/** Who may use an API. Nobody may until the owner chooses. */
export interface ApiAccess {
  everyone: boolean;
  ceo: boolean;
  botIds: string[];
  workspaceIds: string[];
  /** Engines (e.g. "claude", "antigravity"): every coworker running on one. */
  providers?: string[];
}

export interface ApiActivityEntry {
  at: string;
  botId: string | null;
  operation: string;
  status: number | null;
  ok: boolean;
  ms: number;
  error: string | null;
}

export interface ApiIntegrationSummary {
  id: string;
  name: string;
  provider: string | null;
  baseUrl: string | null;
  docsUrl: string | null;
  specUrl: string | null;
  auth: ApiAuth;
  /** The key with all but its last 4 characters hidden. */
  keyMasked: string;
  operations: ApiOperation[];
  /** How many endpoints the specification had (only the first ones are kept). */
  operationTotal: number;
  /** The request the tests use, for example "GET /data/2.5/weather?q=Kolkata". */
  testRequest: string | null;
  status: ApiIntegrationStatus;
  missing: ApiMissingField[];
  /** What discovery did, in plain words. */
  notes: string[];
  tests: ApiTestResult[];
  testedAt: string | null;
  access: ApiAccess;
  createdAt: string;
  activatedAt: string | null;
  calls: number;
  errors: number;
  lastUsedAt: string | null;
}

export interface ApiDiscoverInput {
  apiKey: string;
  name?: string;
  docsUrl?: string;
  specUrl?: string;
}

/** The owner's answers to what discovery asked for. */
export interface ApiIntegrationPatch {
  name?: string;
  provider?: string;
  baseUrl?: string;
  docsUrl?: string;
  specUrl?: string;
  /** A full example request URL (with real values), or a path on the base address. */
  example?: string;
  auth?: ApiAuth;
}

/**
 * One resource coworkers can use, as Settings > Assignments shows it: is it connected, who did
 * the owner give it to, and can anyone actually use it now (and if not, why).
 */
export interface ResourceOverviewItem {
  kind: ResourceKind;
  /** The id assignments use: API id, app slug, "market:<id>"/"custom:<id>"/"learned:<id>", MCP id. */
  id: string;
  name: string;
  connected: boolean;
  /** Who may use it; "everyone" for anything the owner never limited. */
  access: ResourceAccess;
  available: boolean;
  /** Plain words: why it is not available, or a caveat (e.g. "last known state"). */
  note: string | null;
}

export interface AssignmentsDesktopApi {
  overview: () => Promise<ResourceOverviewItem[]>;
  /** Saves who may use one resource; null gives it back to everyone. */
  set: (kind: ResourceKind, id: string, access: ResourceAccess | null) => Promise<void>;
}

export interface ApiIntegrationsDesktopApi {
  list: () => Promise<ApiIntegrationSummary[]>;
  discover: (input: ApiDiscoverInput) => Promise<ApiIntegrationSummary>;
  update: (id: string, patch: ApiIntegrationPatch) => Promise<ApiIntegrationSummary>;
  runTests: (id: string) => Promise<ApiIntegrationSummary>;
  activate: (id: string) => Promise<ApiIntegrationSummary>;
  setEnabled: (id: string, enabled: boolean) => Promise<ApiIntegrationSummary>;
  setAccess: (id: string, access: ApiAccess) => Promise<ApiIntegrationSummary>;
  activity: (id: string) => Promise<ApiActivityEntry[]>;
  revoke: (id: string) => Promise<boolean>;
}

/** One downloadable voice model as Settings → Voice shows it. */
export interface VoiceModelInfo {
  id: string;
  type: "dictation" | "speech";
  group: "indic" | "hinglish" | "world" | "speech";
  name: string;
  summary: string;
  licence: string;
  languages: string[];
  sizeBytes: number;
  punctuates: boolean;
  speakers: { id: number; name: string; languages: string[] }[];
  installed: boolean;
  phase: "idle" | "downloading" | "installing" | "failed";
  receivedBytes: number;
  message: string | null;
}

export interface VoiceSettings {
  /** Dictation model in use, or null for none. */
  dictationModel: string | null;
  /** Language for Whisper turbo; "" lets it detect the language. */
  dictationLanguage: string;
  /** Speaker per spoken-reply language, e.g. { hi: 2, en: 3 }. */
  speakers: Record<string, number>;
  readAloud: boolean;
  speed: number;
}

export interface VoiceState {
  engineInstalled: boolean;
  engineSizeBytes: number;
  settings: VoiceSettings;
  models: VoiceModelInfo[];
}

export interface VoiceDesktopApi {
  getState: () => Promise<VoiceState>;
  install: (modelId: string) => Promise<VoiceState>;
  cancel: (modelId: string) => Promise<VoiceState>;
  remove: (modelId: string) => Promise<VoiceState>;
  setSettings: (settings: Partial<VoiceSettings>) => Promise<VoiceState>;
  /** 16 kHz mono float samples in; text out. */
  transcribe: (samples: Float32Array) => Promise<{ text: string; modelId: string }>;
  /** Returns a WAV file, or null when no voice for the text is installed. */
  speak: (text: string) => Promise<Uint8Array | null>;
  onEvent: (listener: (state: VoiceState) => void) => () => void;
}

export interface AgentMemory {
  id: string;
  /** The workspace the memory belongs to (memories never cross workspaces). */
  workspaceId?: string;
  category: "architecture" | "preference" | "decision" | "fact";
  key: string;
  content: string;
  authorBotId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type AgentMemoryCategory = AgentMemory["category"];

// ---------------------------------------------------------------------------------------------
// Knowledge Bases ("Granthagar"): the owner's documents, indexed locally for grounded answers.

export type KnowledgeSourceKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "csv"
  | "markdown"
  | "text"
  | "json"
  | "html";

export type KnowledgeSourceStatus = "pending" | "indexing" | "ready" | "failed" | "missing";

/** "coworkers": coworkers may read excerpts. "owner": only the owner's own searches in the app. */
export type KnowledgePrivacy = "coworkers" | "owner";

export interface KnowledgeSourceSummary {
  id: string;
  path: string;
  name: string;
  kind: KnowledgeSourceKind;
  size: number;
  pages: number | null;
  chunkCount: number;
  status: KnowledgeSourceStatus;
  error: string | null;
  enabled: boolean;
  /** Set when the file came in through a linked folder. */
  folderId: string | null;
  indexedAt: string | null;
}

export interface KnowledgeFolderSummary {
  id: string;
  path: string;
  fileCount: number;
}

export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  workspaceId: string;
  /** Empty means every coworker of the workspace. */
  botIds: string[];
  privacy: KnowledgePrivacy;
  createdAt: string;
  updatedAt: string;
  sources: KnowledgeSourceSummary[];
  folders: KnowledgeFolderSummary[];
  chunkCount: number;
  /** A file of this base is being indexed right now. */
  indexing: boolean;
}

export interface KnowledgeCitation {
  /** Turn-local anchor the coworker cites: "S1", "S2", ... */
  id: string;
  kbId: string;
  kbName: string;
  documentId: string;
  fileName: string;
  path: string;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  heading: string | null;
  chunkIndex: number;
  excerpt: string;
}

export interface KnowledgeHit {
  citation: KnowledgeCitation;
  /** Higher is better; comparable only within one search. */
  score: number;
}

export interface KnowledgeSearchInput {
  query: string;
  kbIds?: string[];
  limit?: number;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  /** The bases that were searched. */
  kbIds: string[];
}

export interface KnowledgeProgress {
  kbId: string;
  documentId: string;
  name: string;
  status: KnowledgeSourceStatus;
  /** Files finished and files queued for this base, for a progress bar. */
  done: number;
  total: number;
}

/** The optional "smarter search" embedding model: downloaded once by the owner, local only. */
export interface KnowledgeSemanticStatus {
  state: "absent" | "downloading" | "ready" | "error";
  modelName: string;
  license: string;
  source: string;
  sizeBytes: number;
  /** Bytes downloaded so far, while downloading. */
  received: number;
  error: string | null;
  /** Passages with a vector, and passages in all, across every base. */
  vectors: number;
  chunks: number;
  /** The model is in memory right now (it is dropped after idle minutes). */
  loaded: boolean;
}

export interface CreateKnowledgeBaseInput {
  name: string;
  workspaceId: string;
}

export interface UpdateKnowledgeBaseInput {
  id: string;
  name?: string;
  botIds?: string[];
  privacy?: KnowledgePrivacy;
}

export interface KnowledgeDesktopApi {
  list: () => Promise<KnowledgeBaseSummary[]>;
  create: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBaseSummary[]>;
  update: (input: UpdateKnowledgeBaseInput) => Promise<KnowledgeBaseSummary[]>;
  delete: (id: string) => Promise<KnowledgeBaseSummary[]>;
  /** Opens a file picker; the chosen files are added and indexed. */
  /** Without paths, a file picker opens; with paths (dropped files), they are added directly. */
  addFiles(kbId: string, paths?: string[]): Promise<KnowledgeBaseSummary[]>;
  /** Local paths of files dropped on the window (empty for pasted data). */
  pathsForFiles(files: File[]): string[];
  /** Opens a folder picker; the folder is linked and kept in sync. */
  addFolder: (kbId: string) => Promise<KnowledgeBaseSummary[]>;
  removeFolder: (kbId: string, folderId: string) => Promise<KnowledgeBaseSummary[]>;
  removeSource: (kbId: string, sourceId: string) => Promise<KnowledgeBaseSummary[]>;
  setSourceEnabled: (
    kbId: string,
    sourceId: string,
    enabled: boolean,
  ) => Promise<KnowledgeBaseSummary[]>;
  sync: (kbId: string) => Promise<KnowledgeBaseSummary[]>;
  search: (input: KnowledgeSearchInput) => Promise<KnowledgeSearchResult>;
  openSource: (kbId: string, documentId: string) => Promise<void>;
  semanticStatus: () => Promise<KnowledgeSemanticStatus>;
  /** Downloads the embedding model (about 30 MB) and prepares vectors; resolves when installed. */
  installSemantic: () => Promise<KnowledgeSemanticStatus>;
  removeSemantic: () => Promise<KnowledgeSemanticStatus>;
}

export interface MemoryListInput {
  workspaceId: string;
  /** Words to search for; empty lists the newest. */
  query?: string;
  category?: AgentMemoryCategory;
  limit?: number;
  offset?: number;
}

export interface MemoryListResult {
  memories: AgentMemory[];
  /** All memories of the workspace (and category), not only this page. */
  total: number;
  offset: number;
}

export interface MemoryDesktopApi {
  list: (input: MemoryListInput) => Promise<MemoryListResult>;
  save: (
    entry: Omit<AgentMemory, "id" | "createdAt" | "updatedAt" | "workspaceId"> & {
      id?: string;
      workspaceId: string;
    },
  ) => Promise<AgentMemory>;
  delete: (id: string, workspaceId: string) => Promise<boolean>;
}
