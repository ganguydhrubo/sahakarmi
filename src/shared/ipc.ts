export const IPC_CHANNELS = {
  setTheme: "app:set-theme",
  getAppInfo: "app:get-info",
  getSetupState: "app:get-setup-state",
  saveSetup: "app:save-setup",
  getMacPermissions: "app:get-mac-permissions",
  requestMacPermission: "app:request-mac-permission",
  openExternal: "app:open-external",
  openUrl: "app:open-url",
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
  agentGetStatus: "agent:get-status",
  agentGetUsage: "agent:get-usage",
  agentListModels: "agent:list-models",
  agentRefreshModels: "agent:refresh-models",
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
  memoryList: "memory:list",
  memorySave: "memory:save",
  memoryDelete: "memory:delete",
  composioGetStatus: "composio:get-status",
  composioSetApiKey: "composio:set-api-key",
  composioListApps: "composio:list-apps",
  composioConnectApp: "composio:connect-app",
  composioConnectionStatus: "composio:connection-status",
  composioDisconnectApp: "composio:disconnect-app",
  telegramStatus: "telegram:status",
  telegramSetToken: "telegram:set-token",
  telegramSetCoworker: "telegram:set-coworker",
  telegramUnpair: "telegram:unpair",
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
  /** The Marketplace template this coworker was added from, if any. */
  template?: BotTemplateRef;
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

export const AGENT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
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
  codex: "gpt-5.6-luna",
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
  template?: BotTemplateRef;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
}

/** Live status shown as a dot next to each coworker in the team list. */
export type CoworkerStatus = "idle" | "working" | "waiting" | "error";

export const APPROVAL_CATEGORIES = ["payment", "message", "submission", "data", "other"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected";

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

/** A named multi-step automation: each step goes to one coworker, in order. */
export interface Routine {
  id: string;
  name: string;
  steps: RoutineStep[];
  /** null = only runs with Run now. */
  cadence: RoutineCadence | null;
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
  trigger: "schedule" | "manual";
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

export interface SendMessageInput {
  botId: string;
  text: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string | null;
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

export interface OrchestratorVerificationEvidence {
  type: "lint" | "typecheck" | "test" | "build" | "review";
  passed: boolean;
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
  toolPermissions: string[];
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
}

export interface StartOrchestratorRunInput {
  workspaceId?: string;
  objective: string;
  forcedStrategy?: TaskExecutionStrategy;
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
  | { type: "orchestrator-run-updated"; run: OrchestratorRun }
  | { type: "orchestrator-task-updated"; runId: string; task: OrchestratorTask }
  | { type: "orchestrator-handoff"; message: AgentCollaborationMessage }
  | { type: "error"; botId?: string; code: string; message: string };

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
  readConversation: (botId: string) => Promise<ConversationSnapshot>;
  searchMessages: (input: SearchMessagesInput) => Promise<MessageSearchHit[]>;
  chooseAttachments: () => Promise<DraftAttachment[]>;
  /** Imports in-memory files (voice notes) as draft attachments. */
  importData: (data: AttachmentDataInput[]) => Promise<DraftAttachment[]>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  discardDraftAttachment: (attachmentId: string) => Promise<void>;
  openAttachment: (input: OpenAttachmentInput) => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<QueuedMessageReceipt>;
  setMessageReaction: (input: SetMessageReactionInput) => Promise<void>;
  listQueue: (botId: string) => Promise<QueueSnapshot>;
  cancelQueuedMessage: (input: CancelQueuedMessageInput) => Promise<void>;
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
}

export interface RoutinesDesktopApi {
  list: () => Promise<RoutinesState>;
  save: (input: SaveRoutineInput) => Promise<RoutinesState>;
  delete: (routineId: string) => Promise<RoutinesState>;
  setEnabled: (routineId: string, enabled: boolean) => Promise<RoutinesState>;
  /** Starts a run in the background and returns at once. */
  runNow: (routineId: string) => Promise<RoutinesState>;
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
}

export interface OrchestratorDesktopApi {
  getRuns: () => Promise<OrchestratorRun[]>;
  getRun: (runId: string) => Promise<OrchestratorRun | null>;
  startRun: (input: StartOrchestratorRunInput) => Promise<OrchestratorRun>;
  pauseRun: (runId: string) => Promise<OrchestratorRun | null>;
  resumeRun: (runId: string) => Promise<OrchestratorRun | null>;
  cancelRun: (runId: string) => Promise<OrchestratorRun | null>;
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
  composio: ComposioDesktopApi;
  telegram: TelegramDesktopApi;
  voice: VoiceDesktopApi;
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
  category: "architecture" | "preference" | "decision" | "fact";
  key: string;
  content: string;
  authorBotId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type AgentMemoryCategory = AgentMemory["category"];

export interface MemoryDesktopApi {
  list: (category?: string) => Promise<AgentMemory[]>;
  save: (
    entry: Omit<AgentMemory, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ) => Promise<AgentMemory>;
  delete: (id: string) => Promise<boolean>;
}
