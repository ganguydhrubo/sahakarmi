import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type {
  AgentEvent,
  AgentModelId,
  AgentModelOption,
  AgentReasoningEffort,
  AgentStatus,
  ApprovalRequest,
  AttachmentSummary,
  BotAvatarColor,
  BotAvatarShape,
  BrowserControlAction,
  BrowserControlState,
  BrowserTab,
  BrowserTakeoverState,
  CoworkerStatus,
  DraftAttachment,
  MessageReaction,
  QueueSnapshot,
  ScheduleCadence,
  ScheduledTask,
  SecureInputRequest,
  TurnPlan,
  UpdateBotInput,
} from "../../../shared/ipc";
import { MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "../../../shared/ipc";
import { deriveActivity, isActivePhase } from "../activity";
import { format } from "../activity-hinglish";
import { vocab } from "../activity-vocab";
import { copyText } from "../clipboard";
import type { BotMessage, BotProfile } from "../data";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../data";
import { featureOn } from "../features";
import { t } from "../i18n";
import { markdownToPlainText } from "../markdown";
import { activityStyle } from "../preferences";
import { starterPrompts } from "../starter-prompts";
import { speakingId, speakText, stopSpeaking } from "../voice-store";
import { ActivityIndicator } from "./ActivityIndicator";
import { AgentAvatar } from "./AgentAvatar";
import { ApprovalCard } from "./ApprovalsView";
import { AvatarAura, statusAura } from "./AvatarAura";
import { BrowserPageList, type BrowserStartAction, BrowserStartMenu } from "./BrowserPages";
import { ComposerEditor, expandComposerMentions } from "./ComposerEditor";
import { ChoiceCard, PromptCard } from "./ConversationPrompts";
import { PanelResizer, readPanelWidth, savePanelWidth } from "./PanelResizer";
import { PlanCard } from "./PlanCard";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { RichMarkdown } from "./RichMarkdown";
import {
  type CadenceDraft,
  CadencePicker,
  cadenceFromDraft,
  defaultCadenceDraft,
  ScheduleList,
} from "./ScheduleControls";
import { SecureInputCard } from "./SecureInputCard";
import { SidebarToggleIcon } from "./Sidebar";
import { StatusDot, statusLabel } from "./StatusDot";
import { TaskQueueStrip } from "./TaskQueueStrip";
import { ToolCallCard, type ToolCallSummary, ToolGroupCard } from "./ToolCallCard";
import { VoiceRecorder } from "./VoiceRecorder";

interface ConversationProps {
  agentStatus: AgentStatus;
  bot: BotProfile | undefined;
  bots: BotProfile[];
  status: CoworkerStatus;
  schedules: ScheduledTask[];
  takeover: BrowserTakeoverState;
  /** This coworker's password/OTP requests, answered in a secure card in the chat. */
  secureInputs?: SecureInputRequest[];
  /** The coworker's own task list, shown while the turn it belongs to runs. */
  plan?: TurnPlan | null;
  onSubmitSecureInput?: (id: string, value: string) => Promise<void>;
  onTakeOverSecureInput?: (id: string) => void;
  onDismissSecureInput?: (id: string) => void;
  modelOptions: AgentModelOption[];
  messages: BotMessage[];
  loaded: boolean;
  activeTurnId: string | null | undefined;
  agentPickerOpen: boolean;
  creatingAgent: boolean;
  settingsRequest: { botId: string; nonce: number } | null;
  onboardingRequest: { botId: string; nonce: number } | null;
  queue: QueueSnapshot | undefined;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserControlState: BrowserControlState;
  leftSidebarCollapsed: boolean;
  prompt: Extract<AgentEvent, { type: "prompt" }> | undefined;
  /** A provider said it will retry the current request (real retry event). */
  activityRetry?: { attempt: number | null; maxRetries: number | null } | null;
  /** Outcome of the coworker's latest turn, from the turn-completed event. */
  turnOutcome?: { status: "completed" | "interrupted" | "failed"; at: number } | null;
  /** A tool call of this coworker is paused in Approvals. */
  waitingForApproval?: boolean;
  /** This coworker's pending approvals, decided right here in the chat. */
  pendingApprovals?: ApprovalRequest[];
  onDecideApproval?: (
    approvalId: string,
    decision: "approved" | "rejected",
    note: string,
  ) => Promise<void>;
  onCloseAgentPicker: () => void;
  onCreateAgent: () => void;
  onSelectAgent: (botId: string) => void;
  onUpdateBot: (botId: string, updates: Omit<UpdateBotInput, "botId">) => Promise<void>;
  onDeleteBot?: (botId: string) => void;
  onSendMessage: (
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
  ) => Promise<boolean>;
  onScheduleMessage: (text: string, cadence: ScheduleCadence) => Promise<boolean>;
  onToggleSchedule: (task: ScheduledTask) => void;
  onDeleteSchedule: (task: ScheduledTask) => void;
  onRunSchedule: (task: ScheduledTask) => void;
  onPauseQueue: () => void;
  onTakeOverBrowser: () => void;
  onHandBackBrowser: (note: string | null) => void;
  onDeclineTakeover?: () => void;
  onCompleteOnboarding: (
    answer: string,
    model: AgentModelId,
    reasoningEffort: AgentReasoningEffort,
  ) => Promise<boolean>;
  onAnswerPrompt: (answers: Record<string, string[]>) => Promise<boolean>;
  onCancelQueuedMessage: (deliveryId: string) => void;
  /** Moves a queued message to the front and stops the current turn so it runs next. */
  onSendQueuedNow?: (deliveryId: string) => void;
  onResumeQueue: () => void;
  onActivateBrowserTab: (tabId: string) => void;
  onCloseBrowserTab: (tabId: string) => void;
  onToggleLeftSidebar: () => void;
  /** Opens Settings → AI and models, where providers are connected. */
  onOpenAiSettings?: () => void;
  /** Opens one of the app's own views (the browser start menu's Files and Tasks). */
  onOpenView?: (view: "files" | "tasks") => void;
  onOpenAgentSetup: () => Promise<void>;
  onStop: () => void;
}

interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  replyToMessageId: string | null;
}

interface MediaPreview {
  attachment: AttachmentSummary;
  text: string | null;
  loading: boolean;
  error: string | null;
}

type RightPanelMode = "none" | "browser" | "settings";

const EMPTY_DRAFT: ComposerDraft = { text: "", attachments: [], replyToMessageId: null };
/** A long chat opens with its latest messages only; "Show earlier" adds this many at a time. */
export const MESSAGE_WINDOW = 80;
const ONBOARDING_CHOICES = ["Accounts", "Sales", "Support", "Something else"];
const SETTINGS_PANEL_STORAGE_KEY = "sahkarmi:settings-panel-width";
const SETTINGS_PANEL_DEFAULT = 296;
const SETTINGS_PANEL_MIN = 180;
const SETTINGS_PANEL_MAX = 1600;
const BROWSER_PANEL_STORAGE_KEY = "sahkarmi:browser-panel-width";
const BROWSER_COMPACT_STORAGE_KEY = "sahkarmi:browser-compact";
const BROWSER_PREVIEW_REFRESH_MS = 2_500;
/** Pages other than the active one get a fresh picture every this many refreshes. */
const BROWSER_BACKGROUND_PREVIEW_EVERY = 3;
const BROWSER_PANEL_DEFAULT = 380;
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;
/** An expanded browser still leaves this much of the chat visible. */
const EXPANDED_CHAT_MIN = 280;

const BROWSER_ACTION_LABELS: Record<BrowserControlAction, string> = {
  open: "Page khola ja raha hai…",
  "list-tabs": "Tabs check ho rahe hain…",
  snapshot: "Page padha ja raha hai…",
  click: "Click ho raha hai…",
  type: "Type ho raha hai…",
  key: "Keyboard se action ho raha hai…",
  scroll: "Page scroll ho raha hai…",
  upload: "File upload ho rahi hai…",
  back: "Pichhle page par ja rahe hain…",
  forward: "Agle page par ja rahe hain…",
  reload: "Page reload ho raha hai…",
  screenshot: "Screenshot liya ja raha hai…",
  "close-tab": "Tab band ho raha hai…",
};

const BROWSER_ACTION_LABELS_EN: Record<BrowserControlAction, string> = {
  open: "Opening a page…",
  "list-tabs": "Checking tabs…",
  snapshot: "Reading the page…",
  click: "Clicking…",
  type: "Typing…",
  key: "Pressing a key…",
  scroll: "Scrolling…",
  upload: "Uploading a file…",
  back: "Going back…",
  forward: "Going forward…",
  reload: "Reloading…",
  screenshot: "Taking a screenshot…",
  "close-tab": "Closing a tab…",
};

function browserActionLabel(action: BrowserControlAction): string {
  return (activityStyle() === "english" ? BROWSER_ACTION_LABELS_EN : BROWSER_ACTION_LABELS)[action];
}

const AVATAR_COLOR_LABELS: Record<BotAvatarColor, string> = {
  black: "Black",
  brown: "Brown",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  violet: "Violet",
  magenta: "Magenta",
  gray: "Gray",
};

const AVATAR_SHAPE_LABELS: Record<BotAvatarShape, string> = {
  blob: "blob",
  pebble: "pebble",
  squircle: "squircle",
  tablet: "tablet",
  wedge: "wedge",
  hex: "hex",
  cloud: "cloud",
  teardrop: "teardrop",
};

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path d="m5 5 10 10M15 5 5 15" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path
        d="M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5 11 9M3.5 16.5 9 11"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path
        d="M16.5 8.5h-5v-5M3.5 11.5h5v5M11.5 8.5 17 3M8.5 11.5 3 17"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CompactIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke-width="1.4" />
      <rect x="10" y="10" width="5" height="4" rx="1" stroke-width="1.4" />
    </svg>
  );
}

function readBrowserCompact(): boolean {
  try {
    return localStorage.getItem(BROWSER_COMPACT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-current">
      <rect x="6" y="6" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="settings-back-icon fill-none stroke-current">
      <path d="m12.5 4-6 6 6 6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path d="M10 4v12M4 10h12" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" class="message-link-fallback">
      <path
        d="M6.6 9.4 9.4 6.6M5.2 10.8l-1 .9a2.2 2.2 0 0 1-3.1-3.1l2.1-2.1a2.2 2.2 0 0 1 3.1 0M10.8 5.2l1-.9a2.2 2.2 0 1 1 3.1 3.1l-2.1 2.1a2.2 2.2 0 0 1-3.1 0"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.3"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="file-icon fill-none stroke-current">
      <path d="M5 2.5h6l4 4V17.5H5z" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M11 2.5v4h4M7.5 11h5M7.5 14h5" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

function ReactionIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M7.25 8h.01M12.75 8h.01M6.9 11.5c.85 1.25 1.88 1.85 3.1 1.85s2.25-.6 3.1-1.85" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m8.25 5-4.5 4.1 4.5 4.1V10c4.1 0 6.45 1.35 8 4.35-.25-5.2-2.9-7.65-8-7.65z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="5" cy="10" r="1" />
      <circle cx="10" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M3.5 8h2.5l3.5-3v10L6 12H3.5z" />
      <path d="M12.5 7.5a3.5 3.5 0 0 1 0 5M14.5 5.5a6.4 6.4 0 0 1 0 9" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M13 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4.5 10.5 3.25 3.25L15.5 6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="composer-glyph">
      <path d="M15.5 9.3 10 14.8a3.6 3.6 0 0 1-5.1-5.1l5.9-5.9a2.4 2.4 0 0 1 3.4 3.4l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7l5.3-5.3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="composer-glyph">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.6" />
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <rect x="2.5" y="3" width="15" height="10" rx="1.5" stroke-width="1.3" />
      <path d="M7 17h6M10 13v4" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function BrowserControlIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" class="browser-tab-control-icon">
      <path d="M3.25 2.5 11 8.2 7.55 9.3l-1.5 3.45z" />
      <circle cx="11.75" cy="3.75" r="1.45" />
    </svg>
  );
}

function BrowserBackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="browser-toolbar-icon fill-none stroke-current"
    >
      <path d="m12 4-6 6 6 6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function BrowserForwardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="browser-toolbar-icon fill-none stroke-current"
    >
      <path d="m8 4 6 6-6 6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function BrowserReloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="browser-toolbar-icon fill-none stroke-current"
    >
      <path d="M15.5 7.5A6 6 0 1 0 16 11" stroke-width="1.3" stroke-linecap="round" />
      <path d="M15.5 4.5v3h-3" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function AttachmentCards(props: {
  attachments: AttachmentSummary[];
  onPreview: (attachment: AttachmentSummary) => void;
  onAction: (attachment: AttachmentSummary, action: "open" | "reveal") => void;
}) {
  return (
    <div class="message-attachments">
      <For each={props.attachments}>
        {(attachment) => (
          <div class="message-attachment">
            <button
              type="button"
              class="attachment-preview-button"
              disabled={attachment.previewKind === "none"}
              aria-label={`Preview ${attachment.name}`}
              onClick={() => props.onPreview(attachment)}
            >
              <Show
                when={attachment.previewKind === "image"}
                fallback={<span class="file-type-badge">{fileBadge(attachment)}</span>}
              >
                <img src={attachment.previewUrl ?? ""} alt="" />
              </Show>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
            </button>
            <div class="attachment-actions">
              <button type="button" onClick={() => props.onAction(attachment, "open")}>
                Open
              </button>
              <button type="button" onClick={() => props.onAction(attachment, "reveal")}>
                Finder
              </button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function ExchangeAgentAvatar(props: { bot: BotProfile | undefined }) {
  return <AgentAvatar bot={props.bot} class="exchange-agent-avatar" />;
}

function ExchangeSystemRow(props: {
  message: BotMessage;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
}) {
  const [agentsOpen, setAgentsOpen] = createSignal(false);
  const exchange = () => props.message.exchange;
  const recipients = () => exchange()?.recipientBotIds ?? [];
  const sender = () => {
    const senderId = exchange()?.senderBotId;
    return props.bots.find((bot) => bot.id === senderId);
  };
  const singleRecipient = () => {
    const recipientId = recipients()[0];
    return recipientId ? props.bots.find((bot) => bot.id === recipientId) : undefined;
  };
  const agentCountLabel = () => `${recipients().length} agents`;

  return (
    <div class="exchange-system-row">
      <Show
        when={exchange()?.direction === "outgoing"}
        fallback={
          <>
            <span class="exchange-system-label">Message from</span>
            <button
              type="button"
              class="exchange-agent-trigger exchange-agent-trigger-incoming"
              aria-label={`Open exchange with ${sender()?.name ?? exchange()?.senderBotId ?? "agent"}`}
              onClick={() => {
                const senderId = exchange()?.senderBotId;
                if (senderId) props.onSelectAgent(senderId);
              }}
            >
              <ExchangeAgentAvatar bot={sender()} />
              <span>{sender()?.name ?? exchange()?.senderBotId ?? "Agent"}</span>
            </button>
          </>
        }
      >
        <span class="exchange-system-label">Messaged</span>
        <Show
          when={recipients().length === 1}
          fallback={
            <div class="exchange-agent-picker">
              <button
                type="button"
                class="exchange-agent-trigger exchange-agent-trigger-outgoing"
                aria-haspopup="menu"
                aria-expanded={agentsOpen()}
                aria-label={`${agentCountLabel()}, show list`}
                onClick={() => setAgentsOpen((open) => !open)}
              >
                <span class="exchange-avatar-stack" aria-hidden="true">
                  <For each={recipients().slice(0, 3)}>
                    {(recipientId) => (
                      <ExchangeAgentAvatar bot={props.bots.find((bot) => bot.id === recipientId)} />
                    )}
                  </For>
                </span>
                <span>{agentCountLabel()}</span>
              </button>
              <Show when={agentsOpen()}>
                <button
                  type="button"
                  class="exchange-agent-backdrop"
                  aria-label="Close list"
                  onClick={() => setAgentsOpen(false)}
                />
                <div class="exchange-agent-menu" role="menu">
                  <For each={recipients()}>
                    {(recipientId) => {
                      const recipient = () => props.bots.find((bot) => bot.id === recipientId);
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          class="exchange-agent-menu-item"
                          onClick={() => {
                            setAgentsOpen(false);
                            props.onSelectAgent(recipientId);
                          }}
                        >
                          <ExchangeAgentAvatar bot={recipient()} />
                          <span>{recipient()?.name ?? recipientId}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          }
        >
          <button
            type="button"
            class="exchange-agent-trigger exchange-agent-trigger-single"
            aria-label={`Open exchange with ${singleRecipient()?.name ?? recipients()[0] ?? "agent"}`}
            title={singleRecipient()?.name ?? recipients()[0] ?? "Agent"}
            onClick={() => {
              const recipientId = recipients()[0];
              if (recipientId) props.onSelectAgent(recipientId);
            }}
          >
            <ExchangeAgentAvatar bot={singleRecipient()} />
            <span>{singleRecipient()?.name ?? recipients()[0] ?? "Agent"}</span>
          </button>
        </Show>
      </Show>
      <time dateTime={props.message.time}>{props.message.time}</time>
    </div>
  );
}

function MessageBody(props: {
  message: BotMessage;
  referencedMessage?: BotMessage;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal") => void;
  onResend?: (body: string) => void;
}) {
  const canResend = () =>
    props.message.author === "you" &&
    Boolean(props.message.body.trim()) &&
    /^(Failed|Interrupted|Cancelled)$/.test(props.message.status ?? "");
  // Long instructions from the owner fold to a few lines so the reply stays in view.
  const [expanded, setExpanded] = createSignal(false);
  const collapsible = () =>
    props.message.author === "you" &&
    (props.message.body.length > 700 || props.message.body.split("\n").length > 12);
  const collapsed = () => collapsible() && !expanded();
  return (
    <>
      <Show when={props.referencedMessage}>
        {(referenced) => (
          <div class="message-reply-context">
            <span>{referenced().author === "you" ? "You" : "Agent"}</span>
            <p>{referenced().body || "Attachment"}</p>
          </div>
        )}
      </Show>
      <Show when={props.message.body}>
        <Show
          when={featureOn("rich-replies")}
          fallback={
            <p class="message-copy" classList={{ "message-collapsed": collapsed() }}>
              <RichMessageText
                body={props.message.body}
                bots={props.bots}
                onSelectAgent={props.onSelectAgent}
                onOpenLink={props.onOpenLink}
              />
            </p>
          }
        >
          <div class="message-copy message-rich" classList={{ "message-collapsed": collapsed() }}>
            <RichMarkdown
              body={props.message.body}
              inline={(text) => (
                <RichMessageText
                  body={text}
                  bots={props.bots}
                  onSelectAgent={props.onSelectAgent}
                  onOpenLink={props.onOpenLink}
                />
              )}
            />
          </div>
        </Show>
        <Show when={collapsible()}>
          <button
            type="button"
            class="message-expand"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? t("showLess") : t("marketShowMore")}
          </button>
        </Show>
      </Show>
      <Show when={props.message.status}>
        <div class="message-status">
          <span />
          {props.message.status}
          <Show when={canResend() && props.onResend}>
            <button
              type="button"
              class="message-resend"
              onClick={() => props.onResend?.(props.message.body)}
            >
              {t("sendAgain")}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={props.message.attachments?.length}>
        <AttachmentCards
          attachments={props.message.attachments ?? []}
          onPreview={props.onPreview}
          onAction={props.onAttachmentAction}
        />
      </Show>
    </>
  );
}

/**
 * The run of consecutive tool calls shown by the tool row at `index`, or null when that row
 * continues the run of the row above it (the first row of a run shows the whole run).
 */
export function toolRunAt(messages: BotMessage[], index: number): ToolCallSummary[] | null {
  const isTool = (message: BotMessage | undefined) => message?.kind === "tool" && !!message.tool;
  if (!isTool(messages[index]) || isTool(messages[index - 1])) return null;
  const tools: ToolCallSummary[] = [];
  for (let next = index; isTool(messages[next]); next++) {
    tools.push(messages[next]?.tool as ToolCallSummary);
  }
  return tools;
}

function sameTools(left: ToolCallSummary[] | null, right: ToolCallSummary[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((tool, index) => tool === right[index]);
}

/** Window event the app sends to bring an older message into the rendered window. */
export const REVEAL_MESSAGE_EVENT = "sahkarmi:reveal-message";

/** Notes the app sends a coworker for the owner (approval results, browser hand-back). */
const SYSTEM_NOTE =
  /^\[(Approval (APPROVED|REJECTED)|Browser handed back|Browser takeover declined|Secure input (entered|declined))\]/;

function isSystemNote(message: BotMessage): boolean {
  return message.author === "you" && SYSTEM_NOTE.test(message.body);
}

function MessageActions(props: {
  message: BotMessage;
  pickerOpen: boolean;
  moreOpen: boolean;
  expandedEmoji: boolean;
  copied: boolean;
  onTogglePicker: () => void;
  onToggleMore: () => void;
  onExpandEmoji: () => void;
  onReact: (emoji: MessageReaction | null) => void;
  onReply: () => void;
  onCopy: () => void;
  onCopyPlain: () => void;
  speaking: boolean;
  onReadAloud: () => void;
}) {
  return (
    <div
      class="message-actions"
      classList={{ "message-actions-open": props.pickerOpen || props.moreOpen }}
      role="toolbar"
      aria-label={`${props.message.author === "you" ? "User" : "Agent"} message actions`}
    >
      <div class="message-action-popover-anchor">
        <button
          type="button"
          class="message-action-button"
          aria-label="Add reaction"
          aria-expanded={props.pickerOpen}
          onClick={props.onTogglePicker}
        >
          <ReactionIcon />
        </button>
        <Show when={props.pickerOpen}>
          <div class="reaction-picker" role="menu" aria-label="Choose a reaction">
            <div class="reaction-picker-row">
              <For each={MESSAGE_REACTIONS}>
                {(emoji) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={props.message.reaction === emoji}
                    aria-label={`React with ${emoji}`}
                    onClick={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                  >
                    {emoji}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="reaction-more-button"
                aria-label="More emoji"
                aria-expanded={props.expandedEmoji}
                onClick={props.onExpandEmoji}
              >
                <PlusIcon />
              </button>
            </div>
            <Show when={props.expandedEmoji}>
              <div class="reaction-picker-row reaction-picker-more">
                <For each={MORE_MESSAGE_REACTIONS}>
                  {(emoji) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={props.message.reaction === emoji}
                      aria-label={`React with ${emoji}`}
                      onClick={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="message-action-button"
        aria-label={`Reply to ${props.message.author === "you" ? "User" : "Agent"} message`}
        onClick={props.onReply}
      >
        <ReplyIcon />
      </button>
      <div class="message-action-popover-anchor">
        <button
          type="button"
          class="message-action-button"
          aria-label="More message actions"
          aria-expanded={props.moreOpen}
          onClick={props.onToggleMore}
        >
          <MoreIcon />
        </button>
        <Show when={props.moreOpen}>
          <div class="message-more-menu" role="menu">
            <button type="button" role="menuitem" onClick={props.onCopy}>
              {props.copied ? <CheckIcon /> : <CopyIcon />}
              <span>{props.copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" role="menuitem" onClick={props.onCopyPlain}>
              <CopyIcon />
              <span>{t("copyPlain")}</span>
            </button>
            <Show when={props.message.author === "bot"}>
              <button type="button" role="menuitem" onClick={props.onReadAloud}>
                <SpeakerIcon />
                <span>{props.speaking ? t("voiceStopReading") : t("voiceReadAloud")}</span>
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

function RichMessageText(props: {
  body: string;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const parts = createMemo(() => richMessageParts(props.body, props.bots));
  return (
    <For each={parts()}>
      {(part) => {
        if (part.image) {
          return (
            <img
              class="message-inline-image"
              src={part.image}
              alt={part.text}
              title={part.text}
              loading="lazy"
              decoding="async"
            />
          );
        }
        if (part.url) {
          return (
            <a
              class="message-link"
              href={part.url}
              title={part.url}
              onClick={(event) => {
                event.preventDefault();
                props.onOpenLink(part.url ?? "");
              }}
            >
              <span class="message-link-icon" aria-hidden="true">
                <LinkIcon />
                <img
                  src={faviconUrl(part.url)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(event) => event.currentTarget.remove()}
                />
              </span>
              {part.text}
            </a>
          );
        }
        if (part.bot) {
          return (
            <button
              type="button"
              class="message-agent-tag"
              aria-label={`Open agent ${part.bot.name}`}
              onClick={() => props.onSelectAgent(part.bot?.id ?? "")}
            >
              <AgentAvatar bot={part.bot} />
              <span>{part.bot.name}</span>
            </button>
          );
        }
        if (part.emphasis === "strong") return <strong>{part.text}</strong>;
        if (part.emphasis === "code") return <code class="message-inline-code">{part.text}</code>;
        return part.text;
      }}
    </For>
  );
}

interface RichMessagePart {
  text: string;
  bot?: BotProfile;
  url?: string;
  image?: string;
  emphasis?: "strong" | "code";
}

/** Image sources a reply may show inline: web, Sahkarmi's attachment protocol, or a local file. */
function inlineImageSource(raw: string): string | null {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith("sahkarmi-attachment://")) return value;
  const local = value.startsWith("file:///")
    ? decodeURIComponent(value.slice("file:///".length))
    : value;
  if (/^([a-zA-Z]:[\\/]|\/)/.test(local) && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(local)) {
    const bytes = new TextEncoder().encode(local.replace(/\//g, "\\"));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const id = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `sahkarmi-attachment://local/${id}`;
  }
  return null;
}

function richMessageParts(body: string, bots: BotProfile[]): RichMessagePart[] {
  const parts: RichMessagePart[] = [];
  for (const part of linkedMessageParts(body)) {
    if (part.url) parts.push(part);
    else {
      for (const tagged of taggedMessageParts(part.text, bots)) {
        if (tagged.bot) parts.push(tagged);
        else parts.push(...emphasisParts(tagged.text));
      }
    }
  }
  return parts;
}

/** Inline **bold** and `code`, the Markdown coworkers use most in short replies. */
function emphasisParts(text: string): RichMessagePart[] {
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*|`([^`\n]+)`/g)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    if (match[1] !== undefined) parts.push({ text: match[1], emphasis: "strong" });
    else parts.push({ text: match[2] ?? "", emphasis: "code" });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

function linkedMessageParts(body: string): RichMessagePart[] {
  const expression =
    /!\[([^\]\n]*)\]\(([^\s)]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/giu;
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index) });
    if (match[2] !== undefined) {
      const image = inlineImageSource(match[2]);
      parts.push(image ? { text: match[1] ?? "", image } : { text: match[0] });
      cursor = index + match[0].length;
      continue;
    }
    const markdownUrl = match[4];
    const rawUrl = match[5];
    const rawLink = markdownUrl ?? rawUrl ?? "";
    const cleanLink = rawLink.replace(/[.,!?;:]+$/u, "");
    const url = safeBrowserUrl(cleanLink);
    if (!url) {
      parts.push({ text: match[0] });
    } else {
      parts.push({ text: match[3] ?? cleanLink, url });
      const trailingText = rawLink.slice(cleanLink.length);
      if (trailingText) parts.push({ text: trailingText });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: body }];
}

function safeBrowserUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function faviconUrl(value: string): string {
  return `${new URL(value).origin}/favicon.ico`;
}

function taggedMessageParts(body: string, bots: BotProfile[]) {
  const orderedBots = [...bots].sort((left, right) => right.name.length - left.name.length);
  if (orderedBots.length === 0) return [{ text: body, bot: undefined }];
  const botsByName = new Map(orderedBots.map((bot) => [bot.name.toLocaleLowerCase(), bot]));
  const expression = new RegExp(
    `@(${orderedBots.map((bot) => escapeExpression(bot.name)).join("|")})(?=$|[\\s.,!?;:()\\[\\]{}])`,
    "giu",
  );
  const parts: Array<{ text: string; bot: BotProfile | undefined }> = [];
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index), bot: undefined });
    const name = match[1] ?? "";
    const bot = botsByName.get(name.toLocaleLowerCase());
    parts.push({ text: match[0], bot });
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), bot: undefined });
  return parts.length > 0 ? parts : [{ text: body, bot: undefined }];
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ThinkingDisclosure(props: { message: BotMessage }) {
  const stepCount = () => props.message.items?.length ?? 0;
  return (
    <article class="thinking-entry">
      <details class="thinking-disclosure">
        <summary aria-label={`${vocab().LABELS.thinking}: details dekhein`}>
          <span class="thinking-mark" aria-hidden="true">
            <ThinkingIcon />
          </span>
          <span>{vocab().LABELS.thinking}</span>
          <Show when={props.message.streaming}>
            <span class="thinking-live-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </Show>
          <Show when={!props.message.streaming && stepCount() > 1}>
            <small>{format(vocab().LABELS.thinkingSteps, { count: stepCount() })}</small>
          </Show>
          <span class="thinking-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </summary>
        <div class="thinking-details">
          <For each={props.message.items ?? []}>{(item) => <p>{item}</p>}</For>
        </div>
      </details>
    </article>
  );
}

export function Conversation(props: ConversationProps) {
  const titleAura = statusAura(() => props.status);
  const agentReady = () => props.agentStatus.phase === "ready";
  const [drafts, setDrafts] = createSignal<Record<string, ComposerDraft>>({});
  const [showAttachments, setShowAttachments] = createSignal(false);
  const [attachmentBusy, setAttachmentBusy] = createSignal(false);
  const [composerError, setComposerError] = createSignal<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [rightPanels, setRightPanels] = createSignal<Record<string, RightPanelMode>>({});
  const [settingsName, setSettingsName] = createSignal("");
  const [settingsTitle, setSettingsTitle] = createSignal("");
  const [settingsDescription, setSettingsDescription] = createSignal("");
  const [settingsNotifications, setSettingsNotifications] = createSignal(true);
  const [settingsModel, setSettingsModel] = createSignal<AgentModelId>("gpt-5.6-luna");
  const [settingsReasoning, setSettingsReasoning] = createSignal<AgentReasoningEffort>("medium");
  const [headerModelOpen, setHeaderModelOpen] = createSignal(false);
  const [onboardingBots, setOnboardingBots] = createSignal<Record<string, true>>({});
  const [modelConfirmedBots, setModelConfirmedBots] = createSignal<Record<string, true>>({});
  const [completedOnboardingBots, setCompletedOnboardingBots] = createSignal<Record<string, true>>(
    {},
  );
  const [avatarPickerOpen, setAvatarPickerOpen] = createSignal(false);
  const [avatarShape, setAvatarShape] = createSignal<BotAvatarShape>("blob");
  const [avatarColor, setAvatarColor] = createSignal<BotAvatarColor>("orange");
  const [browserAddress, setBrowserAddress] = createSignal("https://www.google.com");
  const [scheduleMode, setScheduleMode] = createSignal(false);
  const [cadenceDraft, setCadenceDraft] = createSignal<CadenceDraft>(defaultCadenceDraft());
  const [scheduleNotice, setScheduleNotice] = createSignal<string | null>(null);
  const [handBackNote, setHandBackNote] = createSignal("");
  const [mediaPreview, setMediaPreview] = createSignal<MediaPreview | null>(null);
  const [pickerQuery, setPickerQuery] = createSignal("");
  const [activePickerOption, setActivePickerOption] = createSignal(0);
  const [openReactionMessageId, setOpenReactionMessageId] = createSignal<string | null>(null);
  const [openMoreMessageId, setOpenMoreMessageId] = createSignal<string | null>(null);
  const [expandedEmojiMessageId, setExpandedEmojiMessageId] = createSignal<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = createSignal<string | null>(null);
  const [settingsPanelWidth, setSettingsPanelWidth] = createSignal(
    readPanelWidth(
      SETTINGS_PANEL_STORAGE_KEY,
      SETTINGS_PANEL_DEFAULT,
      SETTINGS_PANEL_MIN,
      SETTINGS_PANEL_MAX,
    ),
  );
  const [browserCompact, setBrowserCompactSignal] = createSignal(readBrowserCompact());
  /** Width to go back to after "Expand browser"; null while not expanded. */
  const [browserExpandedFrom, setBrowserExpandedFrom] = createSignal<number | null>(null);
  const [browserSizing, setBrowserSizing] = createSignal(false);
  const [browserPreviews, setBrowserPreviews] = createSignal<Record<string, string>>({});
  const [voiceStartRequest, setVoiceStartRequest] = createSignal(0);
  const [browserPanelWidth, setBrowserPanelWidth] = createSignal(
    readPanelWidth(
      BROWSER_PANEL_STORAGE_KEY,
      BROWSER_PANEL_DEFAULT,
      BROWSER_PANEL_MIN,
      BROWSER_PANEL_MAX,
    ),
  );
  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.id === settingsModel()),
  );
  const reasoningOptions = createMemo(
    () => selectedModel()?.supportedReasoningEfforts ?? ["medium" as const],
  );
  /** "Luna · Medium": the model and reasoning this coworker runs on. */
  const headerModelLabel = () =>
    `${selectedModel()?.name ?? settingsModel()} · ${reasoningLabel(settingsReasoning())}`;
  const onboardingActive = createMemo(() => {
    const botId = props.bot?.id;
    return Boolean(botId && onboardingBots()[botId]);
  });
  const onboardingModelConfirmed = createMemo(() => {
    const botId = props.bot?.id;
    return Boolean(botId && onboardingActive() && modelConfirmedBots()[botId]);
  });
  const onboardingModelRequired = createMemo(
    () => agentReady() && onboardingActive() && !onboardingModelConfirmed(),
  );
  const currentDraft = createMemo(() => {
    const id = props.bot?.id;
    return id ? (drafts()[id] ?? EMPTY_DRAFT) : EMPTY_DRAFT;
  });
  // Messages hidden above the window, per coworker. Fixed when a chat first loads, so new
  // messages extend the window instead of pushing older ones out while you read.
  const [hiddenBefore, setHiddenBefore] = createSignal<Record<string, number>>({});
  createEffect(() => {
    const botId = props.bot?.id;
    const count = props.messages.length;
    if (!botId || !props.loaded || count === 0) return;
    if (untrack(hiddenBefore)[botId] !== undefined) return;
    setHiddenBefore((current) => ({ ...current, [botId]: Math.max(0, count - MESSAGE_WINDOW) }));
  });
  const hiddenCount = createMemo(() =>
    Math.min(hiddenBefore()[props.bot?.id ?? ""] ?? 0, props.messages.length),
  );
  const shownMessages = createMemo(() =>
    hiddenCount() === 0 ? props.messages : props.messages.slice(hiddenCount()),
  );
  function showEarlier(toIndex?: number) {
    const botId = props.bot?.id;
    if (!botId || !scrollElement) return;
    const element = scrollElement;
    const fromBottom = element.scrollHeight - element.scrollTop;
    setHiddenBefore((current) => ({
      ...current,
      [botId]: Math.max(
        0,
        toIndex === undefined ? hiddenCount() - MESSAGE_WINDOW : Math.min(hiddenCount(), toIndex),
      ),
    }));
    // Keep what you were reading in place while older messages appear above it.
    if (toIndex === undefined) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight - fromBottom;
      });
    }
  }
  const messagesById = createMemo(
    () => new Map(props.messages.map((message) => [message.id, message] as const)),
  );
  const replyTarget = createMemo(() => {
    const id = currentDraft().replyToMessageId;
    return id ? messagesById().get(id) : undefined;
  });
  const filteredPickerBots = createMemo(() => {
    const query = pickerQuery().trim().toLowerCase();
    return query
      ? props.bots.filter((bot) => `${bot.name} ${bot.role}`.toLowerCase().includes(query))
      : props.bots;
  });
  const activeRightPanel = createMemo<RightPanelMode>(() => {
    if (props.agentPickerOpen) return "none";
    const botId = props.bot?.id;
    return botId ? (rightPanels()[botId] ?? "none") : "none";
  });
  const screenOpen = () => activeRightPanel() === "browser";
  /** The full browser panel is on screen (not shrunk to the compact preview card). */
  const browserLive = () => screenOpen() && !browserCompact();
  const settingsOpen = () => activeRightPanel() === "settings";
  const browserTabs = createMemo(() => {
    const bot = props.bot;
    if (!bot) return [];
    return props.browserTabs.filter((tab) =>
      tab.ownerBotId
        ? tab.ownerBotId === bot.id
        : Boolean(bot.threadId && tab.ownerThreadId === bot.threadId),
    );
  });
  const activeBrowserTab = createMemo(
    () => browserTabs().find((tab) => tab.id === props.activeBrowserTabId) ?? browserTabs()[0],
  );
  const activeBrowserControl = createMemo(() => {
    const sessions = props.browserControlState.sessions;
    const activeTab = activeBrowserTab();
    const forActiveTab = activeTab?.ownerThreadId
      ? sessions.filter((session) => session.threadId === activeTab.ownerThreadId)
      : [];
    const forActiveBot = props.bot?.threadId
      ? sessions.filter((session) => session.threadId === props.bot?.threadId)
      : [];
    const candidates = forActiveTab.length > 0 ? forActiveTab : forActiveBot;
    return (
      [...candidates]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .find((session) => session.phase === "acting") ?? candidates.at(-1)
    );
  });
  const browserControlBot = createMemo(() => {
    const control = activeBrowserControl();
    return control ? props.bots.find((bot) => bot.threadId === control.threadId) : undefined;
  });
  const browserControlForTab = (tab: BrowserTab) => {
    const sessions = props.browserControlState.sessions;
    return (
      sessions.find((session) => session.tabId === tab.id) ??
      sessions.find(
        (session) =>
          session.tabId === null &&
          tab.id === activeBrowserTab()?.id &&
          session.threadId === tab.ownerThreadId,
      )
    );
  };
  const browserControllerForTab = (tab: BrowserTab) => {
    const control = browserControlForTab(tab);
    return control ? props.bots.find((bot) => bot.threadId === control.threadId) : undefined;
  };
  const agentActivity = createMemo<"Queued" | "Working" | null>(() => {
    if (
      props.activeTurnId ||
      props.queue?.deliveries.some(
        (delivery) => delivery.status === "starting" || delivery.status === "running",
      )
    ) {
      return "Working";
    }
    if (
      !props.queue?.paused &&
      props.queue?.deliveries.some((delivery) => delivery.status === "queued")
    ) {
      return "Queued";
    }
    return null;
  });
  // Live activity: derived from real events; the clock only ticks while something is shown.
  const [activityNow, setActivityNow] = createSignal(Date.now());
  const activity = createMemo(() =>
    deriveActivity({
      queue: props.queue,
      activeTurnId: props.activeTurnId,
      messages: props.messages,
      retry: props.activityRetry ?? null,
      waitingForUser: Boolean(props.prompt),
      waitingForApproval: props.waitingForApproval === true,
      outcome: props.turnOutcome ?? null,
      now: activityNow(),
      sending: submitting(),
    }),
  );
  const [activeSince, setActiveSince] = createSignal<number | null>(null);
  createEffect(() => {
    const active = isActivePhase(activity().phase);
    if (active && activeSince() === null) setActiveSince(Date.now());
    if (!active && activeSince() !== null) setActiveSince(null);
  });
  createEffect(
    on(
      () => props.turnOutcome?.at,
      () => setActivityNow(Date.now()),
    ),
  );
  createEffect(() => {
    if (activity().phase === "idle") return;
    const timer = window.setInterval(() => setActivityNow(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(timer));
  });
  const takeoverRequests = createMemo(() =>
    props.takeover.requests.map((request) => ({
      ...request,
      bot: props.bots.find((bot) => bot.id === request.botId),
    })),
  );
  const seenMessageIds = new Set<string>();
  const [fadeAtTop, setFadeAtTop] = createSignal(false);
  const [fadeAtBottom, setFadeAtBottom] = createSignal(false);
  let scrollElement: HTMLDivElement | undefined;
  let conversationPanel: HTMLElement | undefined;
  let browserSurface: HTMLDivElement | undefined;
  let browserResizeObserver: ResizeObserver | undefined;
  let browserWindowResizeHandler: (() => void) | undefined;
  let browserVisibilityFrame: number | undefined;
  let browserBoundsFrame: number | undefined;
  let browserVisibilityGeneration = 0;
  let pickerInput: HTMLInputElement | undefined;
  let stickToLatest = true;
  let lastScrollTop = 0;
  let lastMessageCount = 0;
  let lastLoaded = false;
  const [awayFromLatest, setAwayFromLatest] = createSignal(false);
  const [unseenWhileAway, setUnseenWhileAway] = createSignal(false);
  let lastConversationBotId: string | undefined;
  let lastPanelBotId: string | undefined;
  let lastHandledSettingsRequestNonce: number | undefined;
  let lastHandledOnboardingRequestNonce: number | undefined;
  let lastSettingsSignature: string | undefined;
  const importTargetBots = new Map<string, string>();

  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  async function saveBotPatch(updates: Omit<UpdateBotInput, "botId">): Promise<boolean> {
    const botId = props.bot?.id;
    if (!botId) return false;
    setSettingsSaveError(null);
    try {
      await props.onUpdateBot(botId, updates);
      return true;
    } catch (error) {
      setSettingsSaveError(
        error instanceof Error ? error.message : "Could not save agent settings.",
      );
      return false;
    }
  }

  async function selectModel(
    model: AgentModelId,
    persist = true,
    reportComposerError = false,
  ): Promise<boolean> {
    const option = props.modelOptions.find((candidate) => candidate.id === model);
    if (!option) return false;
    const reasoningEffort = option.supportedReasoningEfforts.includes(settingsReasoning())
      ? settingsReasoning()
      : option.defaultReasoningEffort;
    const previousModel = settingsModel();
    const previousReasoning = settingsReasoning();
    setSettingsModel(model);
    setSettingsReasoning(reasoningEffort);
    if (!persist) return true;
    if (reportComposerError) setComposerError(null);
    const saved = await saveBotPatch({ model, reasoningEffort });
    if (saved) return true;
    setSettingsModel(previousModel);
    setSettingsReasoning(previousReasoning);
    if (reportComposerError) setComposerError("Could not change model. Try again.");
    return false;
  }

  async function selectAndConfirmModel(model: AgentModelId): Promise<void> {
    if (!(await selectModel(model, true, true))) return;
    const botId = props.bot?.id;
    if (botId) setModelConfirmedBots((current) => ({ ...current, [botId]: true }));
  }

  function finishOnboarding(botId: string): void {
    setCompletedOnboardingBots((current) => ({ ...current, [botId]: true }));
    setOnboardingBots((current) => {
      if (!current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
    setModelConfirmedBots((current) => {
      if (!current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
  }

  /** Follows new messages only while the owner is at the bottom; scrolling up stops it. */
  function trackScrollPosition(element: HTMLDivElement) {
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= 80) stickToLatest = true;
    else if (element.scrollTop < lastScrollTop - 1) stickToLatest = false;
    lastScrollTop = element.scrollTop;
    const away = !stickToLatest && remaining > 80;
    setAwayFromLatest(away);
    if (!away) setUnseenWhileAway(false);
  }

  function scrollToLatest(behavior: ScrollBehavior) {
    const element = scrollElement;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 1) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduceMotion ? "auto" : behavior });
  }

  function jumpToLatest() {
    stickToLatest = true;
    setAwayFromLatest(false);
    setUnseenWhileAway(false);
    scrollToLatest("smooth");
  }

  function updateScrollFade(element = scrollElement) {
    if (!element) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    setFadeAtTop(element.scrollTop > 2);
    setFadeAtBottom(remaining > 2);
  }

  const markMessageSeen = (messageId: string): boolean => {
    const key = `${props.bot?.id ?? "none"}:${messageId}`;
    if (seenMessageIds.has(key)) return false;
    seenMessageIds.add(key);
    return true;
  };

  const updateCurrentDraft = (patch: Partial<ComposerDraft>) => {
    const id = props.bot?.id;
    if (!id) return;
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY_DRAFT), ...patch } }));
  };

  onMount(() => {
    // Search asks for a message that may be above the window: show from a little before it.
    const revealMessage = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const index = props.messages.findIndex((message) => message.id === id);
      if (index >= 0 && index < hiddenCount()) showEarlier(Math.max(0, index - 5));
    };
    window.addEventListener(REVEAL_MESSAGE_EVENT, revealMessage);
    onCleanup(() => window.removeEventListener(REVEAL_MESSAGE_EVENT, revealMessage));
    const unsubscribeImport = window.sahkarmi.agent.onAttachmentImport((event) => {
      if (event.type === "started") {
        const botId = props.bot?.id;
        if (botId) importTargetBots.set(event.requestId, botId);
        setAttachmentBusy(true);
        setComposerError(null);
      } else if (event.type === "error") {
        importTargetBots.delete(event.requestId);
        setAttachmentBusy(false);
        setComposerError(event.message);
      } else {
        setAttachmentBusy(false);
        const botId = importTargetBots.get(event.requestId);
        importTargetBots.delete(event.requestId);
        if (botId && props.bots.some((bot) => bot.id === botId)) {
          addAttachments(event.attachments, botId);
        } else {
          for (const attachment of event.attachments) {
            void window.sahkarmi.agent.discardDraftAttachment(attachment.id);
          }
        }
      }
    });
    // Escape closes only the top-most layer, and never the browser while the owner is typing.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (headerModelOpen()) {
        setHeaderModelOpen(false);
        return;
      }
      if (mediaPreview()) {
        setMediaPreview(null);
        return;
      }
      const menuOpen = Boolean(
        openReactionMessageId() || openMoreMessageId() || avatarPickerOpen(),
      );
      setOpenReactionMessageId(null);
      setOpenMoreMessageId(null);
      setExpandedEmojiMessageId(null);
      setAvatarPickerOpen(false);
      props.onCloseAgentPicker();
      if (menuOpen) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) {
        return;
      }
      hideBrowserPanel();
    };
    const closeMessageMenus = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".header-model-root, .provider-model-popover")) {
        setHeaderModelOpen(false);
      }
      if (target?.closest(".message-actions")) return;
      setOpenReactionMessageId(null);
      setOpenMoreMessageId(null);
      setExpandedEmojiMessageId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeMessageMenus);
    const scrollResizeObserver = new ResizeObserver(() => updateScrollFade());
    if (scrollElement) scrollResizeObserver.observe(scrollElement);
    requestAnimationFrame(() => updateScrollFade());
    onCleanup(() => {
      scrollResizeObserver.disconnect();
      unsubscribeImport();
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeMessageMenus);
    });
  });

  createEffect(() => {
    const request = props.onboardingRequest;
    if (
      !request ||
      props.bot?.id !== request.botId ||
      request.nonce === lastHandledOnboardingRequestNonce
    )
      return;
    lastHandledOnboardingRequestNonce = request.nonce;
    setOnboardingBots((current) => ({ ...current, [request.botId]: true }));
    setModelConfirmedBots((current) => ({ ...current, [request.botId]: true }));
    setActiveRightPanel("none");
  });

  createEffect(() => {
    const botId = props.bot?.id;
    const lastMessage = props.messages[props.messages.length - 1];
    props.activeTurnId;
    props.queue?.deliveries.map((delivery) => `${delivery.id}:${delivery.status}`).join("|");
    lastMessage?.body;
    lastMessage?.status;
    lastMessage?.exchange?.deliveries
      .map((delivery) => `${delivery.id}:${delivery.status}:${delivery.position}`)
      .join("|");
    props.loaded;
    props.agentPickerOpen;
    props.prompt;
    // Opening a chat or its history landing jumps straight down; live updates glide.
    let instant = !lastLoaded && props.loaded;
    lastLoaded = props.loaded;
    if (botId !== lastConversationBotId) {
      lastConversationBotId = botId;
      stickToLatest = true;
      instant = true;
      setAwayFromLatest(false);
      setUnseenWhileAway(false);
    }
    const count = props.messages.length;
    const grew = count > lastMessageCount;
    if (lastMessageCount === 0) instant = true;
    lastMessageCount = count;
    requestAnimationFrame(() => {
      if (!scrollElement) return;
      if (stickToLatest) scrollToLatest(instant ? "auto" : "smooth");
      else if (grew) setUnseenWhileAway(true);
      updateScrollFade(scrollElement);
    });
  });

  createEffect(() => {
    const bot = props.bot;
    if (!bot) return;
    const signature = [
      bot.id,
      bot.name,
      bot.role,
      bot.description,
      String(bot.notifications),
      bot.model,
      bot.reasoningEffort,
      bot.avatarShape,
      bot.avatarColor,
    ].join("\u0000");
    if (signature === lastSettingsSignature) return;
    lastSettingsSignature = signature;
    setSettingsName(bot.name);
    setSettingsTitle(bot.role);
    setSettingsDescription(bot.description);
    setSettingsNotifications(bot.notifications);
    setSettingsModel(bot.model);
    setSettingsReasoning(bot.reasoningEffort);
    setAvatarShape(bot.avatarShape);
    setAvatarColor(bot.avatarColor);
    setAvatarPickerOpen(false);
  });

  createEffect(() => {
    const botId = props.bot?.id;
    if (
      !botId ||
      !props.loaded ||
      !agentReady() ||
      props.activeTurnId ||
      props.messages.length > 0 ||
      props.bot?.role.trim() ||
      props.onboardingRequest?.botId === botId ||
      completedOnboardingBots()[botId] ||
      onboardingBots()[botId]
    )
      return;
    setOnboardingBots((current) => ({ ...current, [botId]: true }));
  });

  createEffect(() => {
    const botId = props.bot?.id;
    if (botId === lastPanelBotId) return;
    const previousBotId = lastPanelBotId;
    lastPanelBotId = botId;
    if (!previousBotId || !botId || rightPanels()[botId] !== "settings") return;
    setRightPanels((current) => ({ ...current, [botId]: "none" }));
  });

  createEffect(() => {
    const request = props.settingsRequest;
    if (
      !request ||
      props.bot?.id !== request.botId ||
      request.nonce === lastHandledSettingsRequestNonce
    )
      return;
    lastHandledSettingsRequestNonce = request.nonce;
    setActiveRightPanel("settings");
  });

  createEffect(() => {
    if (!props.agentPickerOpen) return;
    setPickerQuery("");
    setActivePickerOption(0);
    requestAnimationFrame(() => pickerInput?.focus());
  });

  createEffect(() => {
    props.bot?.id;
    const activeTab = activeBrowserTab();
    setBrowserAddress(activeTab?.url ?? "https://www.google.com");
    if (screenOpen() && activeTab && activeTab.id !== props.activeBrowserTabId) {
      props.onActivateBrowserTab(activeTab.id);
    }
  });

  createEffect(() => {
    const requested = props.takeover.requests.map((request) => request.botId);
    if (requested.length === 0 && !props.takeover.humanInControl) return;
    setBrowserCompact(false);
    if (requested.length === 0) return;
    setRightPanels((current) => {
      const next = { ...current };
      for (const botId of requested) next[botId] = "browser";
      return next;
    });
  });

  createEffect(() => {
    const controlledBotIds = new Set(
      props.browserControlState.sessions
        .map((session) => props.bots.find((bot) => bot.threadId === session.threadId)?.id)
        .filter((botId): botId is string => Boolean(botId)),
    );
    if (controlledBotIds.size === 0) return;
    setRightPanels((current) => {
      const next = { ...current };
      let changed = false;
      for (const botId of controlledBotIds) {
        if (next[botId] === "browser") continue;
        next[botId] = "browser";
        changed = true;
      }
      return changed ? next : current;
    });
  });

  createEffect(() => {
    const botId = props.bot?.id;
    const visible = browserLive();
    const generation = ++browserVisibilityGeneration;
    if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
    browserResizeObserver?.disconnect();
    browserResizeObserver = undefined;
    if (browserWindowResizeHandler)
      window.removeEventListener("resize", browserWindowResizeHandler);
    browserWindowResizeHandler = undefined;
    if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
    browserBoundsFrame = undefined;
    if (!visible) {
      void window.sahkarmi.browser.setVisible({ visible: false });
      return;
    }
    browserVisibilityFrame = requestAnimationFrame(() => {
      browserVisibilityFrame = undefined;
      if (
        generation !== browserVisibilityGeneration ||
        props.bot?.id !== botId ||
        !browserLive() ||
        !browserSurface
      ) {
        return;
      }
      const syncBounds = () => {
        if (
          generation !== browserVisibilityGeneration ||
          props.bot?.id !== botId ||
          !browserLive() ||
          !browserSurface
        ) {
          return;
        }
        const bounds = browserSurface.getBoundingClientRect();
        void window.sahkarmi.browser.setVisible({
          visible: true,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        });
      };
      syncBounds();
      const scheduleBoundsSync = () => {
        if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
        browserBoundsFrame = requestAnimationFrame(() => {
          browserBoundsFrame = undefined;
          syncBounds();
        });
      };
      browserResizeObserver = new ResizeObserver(scheduleBoundsSync);
      browserResizeObserver.observe(browserSurface);
      browserWindowResizeHandler = scheduleBoundsSync;
      window.addEventListener("resize", browserWindowResizeHandler);
    });
  });

  // The page cards: the active page refreshes often, the others in turn, one per refresh.
  createEffect(() => {
    if (!screenOpen() || !browserCompact()) return;
    const tabs = browserTabs();
    const activeId = activeBrowserTab()?.id;
    if (tabs.length === 0) return;
    let cancelled = false;
    let tick = 0;
    let nextBackground = 0;
    const capture = (tabId: string) => {
      void window.sahkarmi.browser
        .preview(tabId)
        .then((image) => {
          if (cancelled || !image) return;
          setBrowserPreviews((current) =>
            current[tabId] === image ? current : { ...current, [tabId]: image },
          );
        })
        .catch(() => undefined);
    };
    const refresh = () => {
      if (activeId) capture(activeId);
      const others = tabs.filter((tab) => tab.id !== activeId);
      if (others.length > 0) {
        if (tick === 0) {
          for (const tab of others) capture(tab.id);
        } else if (tick % BROWSER_BACKGROUND_PREVIEW_EVERY === 0) {
          capture(others[nextBackground % others.length].id);
          nextBackground += 1;
        }
      }
      tick += 1;
    };
    refresh();
    const timer = window.setInterval(refresh, BROWSER_PREVIEW_REFRESH_MS);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(timer);
    });
  });

  // Forget pictures of pages that were closed.
  createEffect(() => {
    const open = new Set(props.browserTabs.map((tab) => tab.id));
    setBrowserPreviews((current) => {
      const kept = Object.entries(current).filter(([tabId]) => open.has(tabId));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  });

  onCleanup(() => {
    browserVisibilityGeneration += 1;
    if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
    if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
    browserResizeObserver?.disconnect();
    if (browserWindowResizeHandler)
      window.removeEventListener("resize", browserWindowResizeHandler);
    void window.sahkarmi.browser.setVisible({ visible: false });
  });

  function addAttachments(selected: DraftAttachment[], botId = props.bot?.id) {
    if (!botId) return;
    const draft = drafts()[botId] ?? EMPTY_DRAFT;
    const available = Math.max(0, 10 - draft.attachments.length);
    const accepted = selected.slice(0, available);
    for (const attachment of selected.slice(available)) {
      void window.sahkarmi.agent.discardDraftAttachment(attachment.id);
    }
    setDrafts((current) => ({
      ...current,
      [botId]: {
        ...(current[botId] ?? EMPTY_DRAFT),
        attachments: [...draft.attachments, ...accepted],
      },
    }));
    if (selected.length > accepted.length) setComposerError("You can attach at most 10 files.");
    setShowAttachments(false);
  }

  async function chooseAttachments() {
    if (attachmentBusy()) return;
    setAttachmentBusy(true);
    setComposerError(null);
    try {
      addAttachments(await window.sahkarmi.agent.chooseAttachments());
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function submitMessage(override?: string) {
    const botId = props.bot?.id;
    const draft = currentDraft();
    const text = override ?? expandComposerMentions(draft.text);
    const attachments = override ? [] : draft.attachments;
    if (
      !botId ||
      submitting() ||
      onboardingModelRequired() ||
      (!text.trim() && attachments.length === 0)
    )
      return;
    stickToLatest = true;
    setSubmitting(true);
    setComposerError(null);
    if (scheduleMode() && !override) {
      let cadence: ScheduleCadence;
      try {
        cadence = cadenceFromDraft(cadenceDraft());
      } catch {
        setSubmitting(false);
        setComposerError("Pick a valid date and time.");
        return;
      }
      const scheduled = await props.onScheduleMessage(text, cadence);
      setSubmitting(false);
      if (scheduled) {
        setDrafts((current) => ({ ...current, [botId]: EMPTY_DRAFT }));
        setScheduleNotice(t("scheduleSaved"));
        window.setTimeout(() => setScheduleNotice(null), 2_500);
      }
      return;
    }
    // Like a chat app: the box clears at once and you can type the next message while this
    // one is sent. If sending fails, the draft comes back unless you have typed something new.
    if (!override) setDrafts((current) => ({ ...current, [botId]: EMPTY_DRAFT }));
    jumpToLatest();
    const sent = await props.onSendMessage(
      text,
      attachments.map((item) => item.id),
      override ? null : draft.replyToMessageId,
    );
    setSubmitting(false);
    if (sent) {
      // Your own message always comes into view, even if you had scrolled up to read.
      jumpToLatest();
      finishOnboarding(botId);
    } else if (!override) {
      setDrafts((current) => {
        const now = current[botId] ?? EMPTY_DRAFT;
        if (now.text.trim() || now.attachments.length) return current;
        return { ...current, [botId]: draft };
      });
    }
  }

  function replyToMessage(message: BotMessage) {
    updateCurrentDraft({ replyToMessageId: message.id });
    setOpenReactionMessageId(null);
    setOpenMoreMessageId(null);
  }

  async function reactToMessage(message: BotMessage, emoji: MessageReaction | null) {
    const botId = props.bot?.id;
    if (!botId) return;
    setOpenReactionMessageId(null);
    setExpandedEmojiMessageId(null);
    try {
      await window.sahkarmi.agent.setMessageReaction({ botId, messageId: message.id, emoji });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyMessage(message: BotMessage, plain = false) {
    const text = plain ? markdownToPlainText(message.body) : message.body;
    if (!text) return;
    try {
      await copyText(text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        if (copiedMessageId() === message.id) setCopiedMessageId(null);
      }, 1_400);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not copy the message.");
    }
  }

  async function readAloud(message: BotMessage) {
    setOpenMoreMessageId(null);
    if (speakingId() === message.id) {
      stopSpeaking();
      return;
    }
    try {
      if (!(await speakText(message.id, message.body))) setComposerError(t("voiceNoVoice"));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    }
  }

  function removeAttachment(id: string) {
    updateCurrentDraft({
      attachments: currentDraft().attachments.filter((attachment) => attachment.id !== id),
    });
    void window.sahkarmi.agent.discardDraftAttachment(id);
  }

  async function openBrowserAddress() {
    const value = browserAddress().trim();
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const tab = await window.sahkarmi.browser.open({
        url,
        ownerThreadId: props.bot?.threadId ?? null,
        ownerBotId: props.bot?.id ?? null,
      });
      setBrowserAddress(tab.url);
      setActiveRightPanel("browser");
    } catch {
      setBrowserAddress(url);
    }
  }

  async function openMessageLink(url: string) {
    try {
      await window.sahkarmi.openUrl(url);
    } catch {
      setComposerError("Could not open the link.");
    }
  }

  function setBrowserCompact(compact: boolean) {
    setBrowserCompactSignal(compact);
    try {
      localStorage.setItem(BROWSER_COMPACT_STORAGE_KEY, compact ? "1" : "0");
    } catch {
      // Storage is optional; the choice just won't survive a restart.
    }
  }

  function maxBrowserPanelWidth() {
    return Math.min(
      BROWSER_PANEL_MAX,
      Math.max(
        BROWSER_PANEL_MIN,
        (conversationPanel?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
      ),
    );
  }

  /** Expand fills the room the chat can spare; pressing it again restores the dragged width. */
  function toggleBrowserExpanded() {
    const from = browserExpandedFrom();
    setBrowserSizing(true);
    window.setTimeout(() => setBrowserSizing(false), 260);
    if (from !== null) {
      setBrowserExpandedFrom(null);
      setBrowserPanelWidth(from);
      return;
    }
    setBrowserExpandedFrom(browserPanelWidth());
    setBrowserPanelWidth(
      Math.min(
        BROWSER_PANEL_MAX,
        Math.max(
          BROWSER_PANEL_MIN,
          (conversationPanel?.clientWidth || window.innerWidth) - EXPANDED_CHAT_MIN,
        ),
      ),
    );
  }

  function showBrowserPanel() {
    setBrowserCompact(false);
    setActiveRightPanel("browser");
  }

  function openBrowserPage(tabId: string) {
    props.onActivateBrowserTab(tabId);
    showBrowserPanel();
  }

  function openNewBrowserPage() {
    setBrowserAddress("https://www.google.com");
    void openBrowserAddress().then(() => setBrowserCompact(false));
  }

  function runBrowserStartAction(action: BrowserStartAction) {
    switch (action) {
      case "browser":
        openNewBrowserPage();
        return;
      case "files":
      case "tasks":
        props.onOpenView?.(action);
        return;
      case "settings":
        setActiveRightPanel("settings");
        return;
      case "voice":
        setVoiceStartRequest((request) => request + 1);
        return;
    }
  }

  const controlledBrowserTabIds = createMemo(
    () =>
      new Set(
        browserTabs()
          .filter((tab) => Boolean(browserControlForTab(tab)))
          .map((tab) => tab.id),
      ),
  );

  function hideBrowserPanel() {
    setActiveRightPanel("none");
    void window.sahkarmi.browser.setVisible({ visible: false });
  }

  function setActiveRightPanel(mode: RightPanelMode) {
    const botId = props.bot?.id;
    if (!botId) return;
    setRightPanels((current) =>
      current[botId] === mode ? current : { ...current, [botId]: mode },
    );
  }

  async function previewAttachment(attachment: AttachmentSummary) {
    if (!attachment.previewUrl || attachment.previewKind === "none") return;
    setMediaPreview({
      attachment,
      text: null,
      loading: attachment.previewKind === "text",
      error: null,
    });
    if (attachment.previewKind !== "text") return;
    try {
      const response = await fetch(attachment.previewUrl);
      if (!response.ok) throw new Error("Preview is unavailable.");
      const text = await response.text();
      setMediaPreview((current) =>
        current?.attachment.id === attachment.id
          ? { ...current, text: text.slice(0, 1_000_000), loading: false }
          : current,
      );
    } catch (error) {
      setMediaPreview((current) =>
        current?.attachment.id === attachment.id
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  }

  function attachmentAction(attachment: AttachmentSummary, action: "open" | "reveal") {
    void window.sahkarmi.agent
      .openAttachment({ attachmentId: attachment.id, action })
      .catch((error) => setComposerError(error instanceof Error ? error.message : String(error)));
  }

  function handlePickerKeyDown(event: KeyboardEvent) {
    const optionCount = filteredPickerBots().length + 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActivePickerOption((current) => (current + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActivePickerOption((current) => (current - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const bot = filteredPickerBots()[activePickerOption() - 1];
      if (activePickerOption() === 0) props.onCreateAgent();
      else if (bot) props.onSelectAgent(bot.id);
    } else if (event.key === "Escape") props.onCloseAgentPicker();
  }

  return (
    <main
      ref={(element) => (conversationPanel = element)}
      aria-label="Conversation"
      class="conversation-panel"
      classList={{
        "conversation-drop-active": dropActive(),
        "browser-panel-active": browserLive(),
        "browser-panel-expanded": browserLive() && browserExpandedFrom() !== null,
      }}
      style={`--settings-panel-width: ${settingsPanelWidth()}px; --browser-panel-width: ${browserPanelWidth()}px`}
      onDragEnter={(event) => {
        if (event.dataTransfer?.types.includes("Files")) setDropActive(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
      }}
    >
      <Show when={dropActive()}>
        <div class="attachment-drop-overlay">Drop files to attach</div>
      </Show>
      <header class="window-drag conversation-header">
        <Show when={props.leftSidebarCollapsed}>
          <button
            type="button"
            class="sidebar-icon-button sidebar-restore-button no-drag"
            aria-label="Show sidebar"
            aria-controls="bot-sidebar"
            aria-expanded="false"
            title="Show sidebar"
            onClick={props.onToggleLeftSidebar}
          >
            <SidebarToggleIcon />
          </button>
        </Show>
        <Show
          when={props.agentPickerOpen}
          fallback={
            <>
              <Show when={props.bot}>
                {(bot) => (
                  <button
                    type="button"
                    class="conversation-title no-drag"
                    aria-label="View coworker settings"
                    onClick={() => {
                      setActiveRightPanel("settings");
                    }}
                  >
                    <span class="conversation-title-avatar">
                      <AvatarAura state={titleAura()} size="medium">
                        <AgentAvatar bot={bot()} />
                      </AvatarAura>
                      <StatusDot status={props.status} class="conversation-title-status" />
                    </span>
                    <span class="conversation-title-copy">
                      <h1>{bot().name}</h1>
                      <span>
                        {bot().role || t("newCoworker")} · {statusLabel(props.status)}
                      </span>
                    </span>
                  </button>
                )}
              </Show>
              <div class="conversation-header-actions no-drag">
                <Show when={props.bot}>
                  <div class="header-model-root">
                    <button
                      type="button"
                      class="header-model-button"
                      aria-label={`${t("headerModel")}: ${headerModelLabel()}`}
                      aria-expanded={headerModelOpen()}
                      title={agentReady() ? t("headerModel") : t("modelConnectHint")}
                      onClick={() => setHeaderModelOpen((open) => !open)}
                    >
                      <span>{headerModelLabel()}</span>
                      <svg aria-hidden="true" viewBox="0 0 20 20" class="header-model-chevron">
                        <path d="m6 8 4 4 4-4" />
                      </svg>
                    </button>
                    <Show when={headerModelOpen()}>
                      <div
                        class="header-model-popover"
                        role="dialog"
                        aria-label={t("headerModel")}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setHeaderModelOpen(false);
                        }}
                      >
                        <Show
                          when={agentReady()}
                          fallback={
                            <p class="header-model-connect">
                              {t("modelConnectHint")}{" "}
                              <button
                                type="button"
                                class="link-button"
                                onClick={() => {
                                  setHeaderModelOpen(false);
                                  props.onOpenAiSettings?.();
                                }}
                              >
                                {t("modelConnect")}
                              </button>
                            </p>
                          }
                        >
                          <ProviderModelPicker
                            variant="field"
                            ariaLabel="Header model"
                            value={settingsModel()}
                            agentStatus={props.agentStatus}
                            modelOptions={props.modelOptions}
                            disabled={agentActivity() === "Working"}
                            disabledReason={t("modelLockedWhileWorking")}
                            onChange={(model) => void selectAndConfirmModel(model)}
                          />
                          <label class="header-model-reasoning">
                            <span>{t("headerReasoning")}</span>
                            <select
                              value={settingsReasoning()}
                              aria-label={t("headerReasoning")}
                              onChange={(event) => {
                                const reasoningEffort = event.currentTarget
                                  .value as AgentReasoningEffort;
                                setSettingsReasoning(reasoningEffort);
                                void saveBotPatch({ reasoningEffort });
                              }}
                            >
                              <For each={reasoningOptions()}>
                                {(effort) => (
                                  <option value={effort}>{reasoningLabel(effort)}</option>
                                )}
                              </For>
                            </select>
                          </label>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
                <button
                  type="button"
                  class="header-panel-toggle computer-button browser-toggle"
                  classList={{
                    "computer-button-agent-active": Boolean(activeBrowserControl()),
                    "browser-toggle-open": screenOpen(),
                  }}
                  aria-label={
                    activeBrowserControl()
                      ? `${browserControlBot()?.name ?? "Coworker"} is controlling the browser`
                      : screenOpen()
                        ? t("hideBrowser")
                        : t("showBrowser")
                  }
                  aria-expanded={screenOpen()}
                  onClick={() => {
                    if (screenOpen()) hideBrowserPanel();
                    else showBrowserPanel();
                  }}
                >
                  <ComputerIcon />
                  <span class="browser-toggle-label">{t("browser")}</span>
                  <Show when={activeBrowserControl()}>
                    <span class="computer-control-dot" aria-hidden="true" />
                  </Show>
                </button>
              </div>
            </>
          }
        >
          <div class="agent-picker-root no-drag">
            <label class="agent-recipient-field">
              <span>To:</span>
              <input
                ref={(element) => (pickerInput = element)}
                role="combobox"
                aria-label="To:"
                aria-expanded="true"
                placeholder="Search or create agents"
                value={pickerQuery()}
                onInput={(event) => {
                  setPickerQuery(event.currentTarget.value);
                  setActivePickerOption(0);
                }}
                onKeyDown={handlePickerKeyDown}
              />
            </label>
            <div class="agent-picker-menu" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={activePickerOption() === 0}
                class="agent-picker-option agent-picker-create"
                disabled={props.creatingAgent}
                onClick={props.onCreateAgent}
              >
                <span class="agent-picker-plus">
                  <PlusIcon />
                </span>
                <span>{props.creatingAgent ? "Creating agent…" : "Create new agent"}</span>
              </button>
              <For each={filteredPickerBots()}>
                {(bot, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activePickerOption() === index() + 1}
                    class="agent-picker-option"
                    onClick={() => props.onSelectAgent(bot.id)}
                  >
                    <AgentAvatar bot={bot} />
                    <span>{bot.name}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </header>

      <Show when={props.bot && !props.agentPickerOpen}>
        <TaskQueueStrip
          queue={props.queue}
          activeTurnId={props.activeTurnId}
          onPause={props.onPauseQueue}
          onResume={props.onResumeQueue}
          onCancel={props.onCancelQueuedMessage}
          onStop={props.onStop}
          onSteer={(deliveryId) => props.onSendQueuedNow?.(deliveryId)}
        />
      </Show>

      <div
        class="conversation-scroll"
        classList={{
          "scroll-fade-top": fadeAtTop(),
          "scroll-fade-bottom": fadeAtBottom(),
        }}
        ref={(element) => (scrollElement = element)}
        onScroll={(event) => {
          const element = event.currentTarget;
          trackScrollPosition(element);
          updateScrollFade(element);
        }}
      >
        <Show when={!props.agentPickerOpen && props.loaded}>
          <Show when={!agentReady()}>
            <section class="agent-setup-card" role="status">
              <div>
                <strong>
                  {props.agentStatus.phase === "starting" ||
                  props.agentStatus.phase === "restarting"
                    ? t("agentConnecting")
                    : t("agentSetupRequired")}
                </strong>
                <p>{props.agentStatus.message ?? t("agentSetupHint")}</p>
              </div>
              <Show
                when={
                  props.agentStatus.phase !== "starting" && props.agentStatus.phase !== "restarting"
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    void props
                      .onOpenAgentSetup()
                      .catch((error) =>
                        setComposerError(error instanceof Error ? error.message : String(error)),
                      )
                  }
                >
                  {t("agentSetupGuide")}
                </button>
              </Show>
            </section>
          </Show>
          <Show when={props.messages.length > 0}>
            <div class="time-marker">
              <span>{props.messages[0]?.time ?? "now"}</span>
            </div>
          </Show>
          <Show
            when={
              agentReady() &&
              props.loaded &&
              props.messages.length === 0 &&
              !onboardingActive() &&
              !props.activeTurnId
            }
          >
            <section class="starter-prompts message-entry-animated" aria-label={t("starterTitle")}>
              <p class="starter-prompts-title">{t("starterTitle")}</p>
              <div class="starter-prompts-list">
                <For each={starterPrompts(props.bot)}>
                  {(prompt) => (
                    <button
                      type="button"
                      class="starter-prompt"
                      onClick={() => {
                        updateCurrentDraft({ text: prompt });
                        requestAnimationFrame(() =>
                          document.querySelector<HTMLElement>(".composer-editor-surface")?.focus(),
                        );
                      }}
                    >
                      {prompt}
                    </button>
                  )}
                </For>
              </div>
            </section>
          </Show>
          <Show when={agentReady() && onboardingActive() && !props.activeTurnId}>
            <article class="message-entry message-entry-animated message-entry-bot onboarding-message">
              <div class="bot-bubble">
                <p class="message-copy">Choose a model to get started.</p>
              </div>
              <div class="onboarding-model-picker">
                <ProviderModelPicker
                  ariaLabel="Onboarding model"
                  value={settingsModel()}
                  agentStatus={props.agentStatus}
                  modelOptions={props.modelOptions}
                  onChange={(model) => void selectAndConfirmModel(model)}
                />
              </div>
              <Show when={onboardingModelConfirmed()}>
                <div class="onboarding-specialty-step message-entry-animated">
                  <ChoiceCard
                    title="What do you want me helping with most?"
                    hint="This becomes my ongoing specialty. You can change it later in Settings."
                    choices={ONBOARDING_CHOICES}
                    customChoice="Something else"
                    pending={submitting()}
                    onSubmit={async (answer) => {
                      if (submitting()) return false;
                      setSubmitting(true);
                      setComposerError(null);
                      const completed = await props.onCompleteOnboarding(
                        answer,
                        settingsModel(),
                        settingsReasoning(),
                      );
                      if (completed) {
                        const botId = props.bot?.id;
                        if (botId) finishOnboarding(botId);
                      }
                      setSubmitting(false);
                      return completed;
                    }}
                  />
                </div>
              </Show>
            </article>
          </Show>
          <Show when={hiddenCount() > 0}>
            <button type="button" class="show-earlier" onClick={() => showEarlier()}>
              {t("showEarlier", { count: String(Math.min(MESSAGE_WINDOW, hiddenCount())) })}
            </button>
          </Show>
          <For each={shownMessages()}>
            {(message, index) => {
              const animateEntrance = message.animate === true && markMessageSeen(message.id);
              if (message.kind === "tool" && message.tool) {
                // Recomputed as tool calls stream in: <For> maps each row only once.
                const run = createMemo(() => toolRunAt(shownMessages(), index()), undefined, {
                  equals: sameTools,
                });
                return (
                  <Show when={run()}>
                    {(tools) => (
                      <div classList={{ "thinking-entry-animated": animateEntrance }}>
                        <Show
                          when={tools().length > 1}
                          fallback={<ToolCallCard tool={tools()[0] as ToolCallSummary} />}
                        >
                          <ToolGroupCard tools={tools()} />
                        </Show>
                      </div>
                    )}
                  </Show>
                );
              }
              return (
                <Show
                  when={message.exchange}
                  fallback={
                    <Show
                      when={message.kind === "thinking"}
                      fallback={
                        <article
                          class="message-entry"
                          data-message-id={message.id}
                          classList={{
                            "message-entry-animated": animateEntrance,
                            "message-entry-user": message.author === "you",
                            "message-entry-bot": message.author === "bot",
                            "message-entry-system": isSystemNote(message),
                          }}
                        >
                          <div class="message-shell">
                            <div
                              class={message.author === "you" ? "user-bubble" : "bot-bubble"}
                              classList={{ "bot-bubble-streaming": message.streaming === true }}
                            >
                              <MessageBody
                                message={message}
                                referencedMessage={
                                  message.replyToMessageId
                                    ? messagesById().get(message.replyToMessageId)
                                    : undefined
                                }
                                bots={props.bots}
                                onSelectAgent={props.onSelectAgent}
                                onOpenLink={(url) => void openMessageLink(url)}
                                onPreview={(attachment) => void previewAttachment(attachment)}
                                onAttachmentAction={attachmentAction}
                                onResend={(body) => void props.onSendMessage(body, [], null)}
                              />
                            </div>
                            <MessageActions
                              message={message}
                              pickerOpen={openReactionMessageId() === message.id}
                              moreOpen={openMoreMessageId() === message.id}
                              expandedEmoji={expandedEmojiMessageId() === message.id}
                              copied={copiedMessageId() === message.id}
                              onTogglePicker={() => {
                                setOpenReactionMessageId((current) =>
                                  current === message.id ? null : message.id,
                                );
                                setOpenMoreMessageId(null);
                                setExpandedEmojiMessageId(null);
                              }}
                              onToggleMore={() => {
                                setOpenMoreMessageId((current) =>
                                  current === message.id ? null : message.id,
                                );
                                setOpenReactionMessageId(null);
                                setExpandedEmojiMessageId(null);
                              }}
                              onExpandEmoji={() =>
                                setExpandedEmojiMessageId((current) =>
                                  current === message.id ? null : message.id,
                                )
                              }
                              onReact={(emoji) => void reactToMessage(message, emoji)}
                              onReply={() => replyToMessage(message)}
                              onCopy={() => void copyMessage(message)}
                              onCopyPlain={() => void copyMessage(message, true)}
                              speaking={speakingId() === message.id}
                              onReadAloud={() => void readAloud(message)}
                            />
                          </div>
                          <Show when={message.reaction}>
                            {(reaction) => (
                              <button
                                type="button"
                                class="message-reaction-pill"
                                aria-label={`Remove reaction ${reaction()}`}
                                onClick={() => void reactToMessage(message, null)}
                              >
                                {reaction()}
                              </button>
                            )}
                          </Show>
                        </article>
                      }
                    >
                      <div classList={{ "thinking-entry-animated": animateEntrance }}>
                        <ThinkingDisclosure message={message} />
                      </div>
                    </Show>
                  }
                >
                  {(exchange) => (
                    <article
                      class="exchange-message-entry"
                      classList={{ "exchange-message-entry-animated": animateEntrance }}
                    >
                      <ExchangeSystemRow
                        message={message}
                        bots={props.bots}
                        onSelectAgent={props.onSelectAgent}
                      />
                      <Show
                        when={
                          exchange().direction === "incoming" &&
                          (message.attachments?.length ?? 0) > 0
                        }
                      >
                        <div class="exchange-agent-attachments">
                          <AttachmentCards
                            attachments={message.attachments ?? []}
                            onPreview={(attachment) => void previewAttachment(attachment)}
                            onAction={attachmentAction}
                          />
                        </div>
                      </Show>
                    </article>
                  )}
                </Show>
              );
            }}
          </For>
          <ActivityIndicator
            bot={props.bot}
            activity={activity()}
            now={activityNow()}
            activeSince={activeSince()}
          />
          <Show when={props.pendingApprovals?.length && props.onDecideApproval}>
            <ul class="approval-list inline-approvals" aria-label={t("approvals")}>
              <For each={props.pendingApprovals}>
                {(approval) => (
                  <ApprovalCard
                    approval={approval}
                    bot={props.bot}
                    onDecide={(id, decision, note) =>
                      props.onDecideApproval?.(id, decision, note) ?? Promise.resolve()
                    }
                    onOpenCoworker={() => undefined}
                  />
                )}
              </For>
            </ul>
          </Show>
          <Show when={props.prompt}>
            {(prompt) => (
              <PromptCard questions={prompt().questions} onSubmit={props.onAnswerPrompt} />
            )}
          </Show>
          <For each={props.secureInputs ?? []}>
            {(request) => (
              <SecureInputCard
                request={request}
                onSubmit={(id, value) =>
                  props.onSubmitSecureInput?.(id, value) ?? Promise.resolve()
                }
                onTakeOver={(id) => props.onTakeOverSecureInput?.(id)}
                onDismiss={(id) => props.onDismissSecureInput?.(id)}
              />
            )}
          </For>
        </Show>
      </div>

      <div class="composer-wrap">
        <Show
          when={
            props.plan?.steps.length && props.plan.turnId === props.activeTurnId ? props.plan : null
          }
        >
          {(plan) => <PlanCard plan={plan()} />}
        </Show>
        <Show when={awayFromLatest() && !props.agentPickerOpen}>
          <button
            type="button"
            class="jump-to-latest"
            classList={{ "jump-to-latest-unseen": unseenWhileAway() }}
            aria-label={t("jumpToLatest")}
            title={t("jumpToLatest")}
            onClick={jumpToLatest}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              class="size-[16px] fill-none stroke-current"
            >
              <path
                d="M10 4v11m0 0-4.5-4.5M10 15l4.5-4.5"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </Show>
        <Show when={showAttachments()}>
          <button
            type="button"
            class="attachment-menu-backdrop"
            aria-label="Close attachment menu"
            onClick={() => setShowAttachments(false)}
          />
          <div class="attachment-menu">
            <button
              type="button"
              disabled={attachmentBusy()}
              onClick={() => {
                setShowAttachments(false);
                void chooseAttachments();
              }}
            >
              <FileIcon />
              {attachmentBusy() ? "Importing…" : "Attach files"}
            </button>
            <span class="attachment-menu-hint">You can also drop files or paste an image</span>
          </div>
        </Show>
        <For each={currentDraft().attachments}>
          {(attachment) => (
            <div class="composer-attachment">
              <span class={attachment.kind === "file" ? "file-type-badge" : "attachment-thumb"}>
                <Show when={attachment.kind === "image"} fallback={fileBadge(attachment)}>
                  <img src={attachment.previewUrl ?? ""} alt="" />
                </Show>
              </span>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment.id)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </For>
        <Show when={replyTarget()}>
          {(message) => (
            <div class="composer-reply-preview">
              <div>
                <span>Replying to {message().author === "you" ? "your message" : "Agent"}</span>
                <p>{message().body || "Attachment"}</p>
              </div>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => updateCurrentDraft({ replyToMessageId: null })}
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </Show>
        <Show when={composerError()}>
          <div class="composer-error" role="alert">
            {composerError()}
          </div>
        </Show>
        <Show when={scheduleMode()}>
          <div class="schedule-panel">
            <CadencePicker draft={cadenceDraft()} onChange={setCadenceDraft} />
            <ScheduleList
              schedules={props.schedules}
              onToggle={props.onToggleSchedule}
              onDelete={props.onDeleteSchedule}
              onRunNow={props.onRunSchedule}
            />
          </div>
        </Show>
        <Show when={scheduleNotice()}>
          <div class="composer-notice" role="status">
            {scheduleNotice()}
          </div>
        </Show>
        <div class="composer" classList={{ "composer-scheduling": scheduleMode() }}>
          <div class="composer-input-label">
            <ComposerEditor
              botId={props.bot?.id}
              bots={props.bots}
              value={currentDraft().text}
              disabled={props.agentPickerOpen || !agentReady() || onboardingModelRequired()}
              placeholder={
                !agentReady()
                  ? "Complete AI provider setup to start"
                  : onboardingModelRequired()
                    ? "Choose a model to continue"
                    : replyTarget()
                      ? "Reply…"
                      : scheduleMode()
                        ? t("schedulePlaceholder", { name: props.bot?.name ?? "" })
                        : t("messagePlaceholder", { name: props.bot?.name ?? "" })
              }
              ariaLabel={t("messagePlaceholder", { name: props.bot?.name ?? "" })}
              onValueChange={(text) => updateCurrentDraft({ text })}
              onSubmit={() => void submitMessage()}
              onEscape={() => {
                // Like Claude Code: Esc in the box stops a working coworker.
                if (props.activeTurnId && !scheduleMode()) props.onStop();
              }}
            />
          </div>
          <div class="composer-toolbar">
            <button
              type="button"
              class="composer-icon-button"
              aria-label={t("attachFile")}
              title={t("attachFile")}
              disabled={
                props.agentPickerOpen ||
                attachmentBusy() ||
                !agentReady() ||
                onboardingModelRequired()
              }
              onClick={() => setShowAttachments((value) => !value)}
            >
              <PaperclipIcon />
            </button>
            <Show when={props.bot}>
              <ProviderModelPicker
                value={settingsModel()}
                modelOptions={props.modelOptions}
                agentStatus={props.agentStatus}
                disabled={!agentReady() || agentActivity() === "Working"}
                disabledReason={
                  agentActivity() === "Working"
                    ? t("modelLockedWhileWorking")
                    : t("modelConnectHint")
                }
                onChange={(model) => void selectAndConfirmModel(model)}
              />
              <Show when={!agentReady() && props.onOpenAiSettings}>
                <button
                  type="button"
                  class="composer-connect-link"
                  title={t("modelConnectHint")}
                  onClick={() => props.onOpenAiSettings?.()}
                >
                  {t("modelConnect")}
                </button>
              </Show>
            </Show>
            <VoiceRecorder
              disabled={!agentReady() || submitting()}
              startRequest={voiceStartRequest()}
              onAttach={(attachments, transcript) => {
                addAttachments(attachments);
                if (transcript) {
                  updateCurrentDraft({
                    text: currentDraft().text
                      ? `${currentDraft().text.trimEnd()}\n${transcript}`
                      : transcript,
                  });
                }
              }}
              onError={setComposerError}
            />
            <button
              type="button"
              role="switch"
              class="schedule-toggle"
              classList={{ "schedule-toggle-on": scheduleMode() }}
              aria-checked={scheduleMode()}
              onClick={() => setScheduleMode((value) => !value)}
            >
              <span class="schedule-toggle-track" aria-hidden="true">
                <span />
              </span>
              {t("runOnSchedule")}
            </button>
            <span class="composer-toolbar-spacer" />
            <Show when={props.activeTurnId && !scheduleMode()}>
              <button
                type="button"
                class="voice-button voice-button-active"
                aria-label="Stop coworker"
                title={t("stopHint")}
                onClick={props.onStop}
              >
                <StopIcon />
              </button>
            </Show>
            {/* While a coworker works, Send stays: the message waits in its queue. */}
            <Show
              when={
                !props.activeTurnId ||
                scheduleMode() ||
                currentDraft().text.trim() ||
                currentDraft().attachments.length
              }
            >
              <button
                type="button"
                class="voice-button send-button"
                aria-label={scheduleMode() ? t("scheduleLabel") : "Send message"}
                title={props.activeTurnId && !scheduleMode() ? t("queueHint") : undefined}
                disabled={submitting() || !agentReady() || onboardingModelRequired()}
                onClick={() => void submitMessage()}
              >
                <Show when={scheduleMode()} fallback={submitting() ? "…" : "↑"}>
                  <ClockIcon />
                </Show>
              </button>
            </Show>
          </div>
        </div>
      </div>

      <Show when={mediaPreview()}>
        {(preview) => (
          <div class="media-backdrop" role="presentation">
            <button
              type="button"
              class="media-dismiss"
              aria-label="Close media preview"
              onClick={() => setMediaPreview(null)}
            />
            <section
              class="media-modal"
              role="dialog"
              aria-modal="true"
              aria-label={preview().attachment.name}
            >
              <button
                type="button"
                class="media-close"
                aria-label="Close media preview"
                onClick={() => setMediaPreview(null)}
              >
                <CloseIcon />
              </button>
              <Show when={preview().attachment.previewKind === "image"}>
                <img
                  class="media-image"
                  src={preview().attachment.previewUrl ?? ""}
                  alt={preview().attachment.name}
                />
              </Show>
              <Show when={preview().attachment.previewKind === "pdf"}>
                <iframe
                  class="media-document"
                  title={preview().attachment.name}
                  src={preview().attachment.previewUrl ?? ""}
                />
              </Show>
              <Show when={preview().attachment.previewKind === "text"}>
                <pre class="media-text">
                  {preview().loading ? "Loading…" : (preview().error ?? preview().text)}
                </pre>
              </Show>
              <div class="media-caption">
                <span>{preview().attachment.name}</span>
                <button
                  type="button"
                  onClick={() => attachmentAction(preview().attachment, "open")}
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => attachmentAction(preview().attachment, "reveal")}
                >
                  Show in Finder
                </button>
              </div>
            </section>
          </div>
        )}
      </Show>

      <Show when={screenOpen() && browserCompact()}>
        <aside
          class="browser-compact"
          classList={{ "browser-compact-controlled": Boolean(activeBrowserControl()) }}
          aria-label={t("browserPages")}
        >
          <header class="browser-compact-header">
            <span class="browser-compact-heading">
              <ComputerIcon />
              {t("browser")}
            </span>
            <button
              type="button"
              class="browser-compact-action"
              aria-label={t("browserNewPage")}
              title={t("browserNewPage")}
              onClick={openNewBrowserPage}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              class="browser-compact-action"
              aria-label={t("browserExpand")}
              title={t("browserExpand")}
              onClick={showBrowserPanel}
            >
              <ExpandIcon />
            </button>
            <button
              type="button"
              class="browser-compact-action"
              aria-label={t("hideBrowser")}
              title={t("hideBrowser")}
              onClick={hideBrowserPanel}
            >
              <CloseIcon />
            </button>
          </header>
          <Show
            when={browserTabs().length > 0}
            fallback={<BrowserStartMenu onAction={runBrowserStartAction} />}
          >
            <BrowserPageList
              tabs={browserTabs()}
              activeTabId={activeBrowserTab()?.id ?? null}
              previews={browserPreviews()}
              controlledTabIds={controlledBrowserTabIds()}
              onOpen={openBrowserPage}
              onClose={props.onCloseBrowserTab}
            />
          </Show>
        </aside>
      </Show>

      <Show when={browserLive()}>
        <aside
          id="browser-side-panel"
          class="browser-panel"
          classList={{
            "browser-panel-controlled": Boolean(activeBrowserControl()),
            "browser-panel-sizing": browserSizing(),
          }}
          aria-label="Browser"
        >
          <PanelResizer
            class="right-panel-resizer"
            label="Resize right panel"
            controls="browser-side-panel"
            direction="right"
            value={browserPanelWidth()}
            defaultValue={BROWSER_PANEL_DEFAULT}
            min={BROWSER_PANEL_MIN}
            max={maxBrowserPanelWidth}
            onResize={setBrowserPanelWidth}
            onResizeEnd={(value) => {
              setBrowserExpandedFrom(null);
              savePanelWidth(BROWSER_PANEL_STORAGE_KEY, value);
            }}
          />
          <header class="browser-panel-header">
            <div class="browser-tabs">
              <div class="browser-tab-strip" role="tablist" aria-label="Browser tabs">
                <For each={browserTabs()}>
                  {(tab) => {
                    const control = () => browserControlForTab(tab);
                    const controller = () => browserControllerForTab(tab);
                    const title = () => (tab.loading ? "Loading…" : tab.title || tab.url);
                    return (
                      <div
                        class="browser-tab-wrap"
                        classList={{ "browser-tab-controlled": Boolean(control()) }}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-label={
                            control()
                              ? `${title()}, controlled by ${controller()?.name ?? "agent"}`
                              : title()
                          }
                          aria-selected={props.activeBrowserTabId === tab.id}
                          class="browser-tab"
                          classList={{
                            "browser-tab-active": activeBrowserTab()?.id === tab.id,
                          }}
                          onClick={() => props.onActivateBrowserTab(tab.id)}
                        >
                          <Show when={control()}>
                            {(session) => (
                              <span
                                class="browser-tab-control"
                                classList={{
                                  "browser-tab-control-acting": session().phase === "acting",
                                }}
                                title={`${controller()?.name ?? "Agent"}: ${browserActionLabel(session().action)}`}
                              >
                                <BrowserControlIcon />
                              </span>
                            )}
                          </Show>
                          <span class="browser-tab-title">{title()}</span>
                        </button>
                        <button
                          type="button"
                          class="browser-tab-close"
                          aria-label={`Close ${tab.title || "browser tab"}`}
                          onClick={() => props.onCloseBrowserTab(tab.id)}
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    );
                  }}
                </For>
                <button
                  type="button"
                  class="browser-new-tab"
                  aria-label="New browser tab"
                  onClick={openNewBrowserPage}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
            <div class="browser-panel-actions">
              <button
                type="button"
                class="browser-panel-action"
                aria-label={t("browserCompact")}
                title={t("browserCompact")}
                onClick={() => {
                  setBrowserExpandedFrom((from) => {
                    if (from !== null) setBrowserPanelWidth(from);
                    return null;
                  });
                  setBrowserCompact(true);
                }}
              >
                <CompactIcon />
              </button>
              <button
                type="button"
                class="browser-panel-action"
                aria-pressed={browserExpandedFrom() !== null}
                aria-label={
                  browserExpandedFrom() !== null ? t("browserRestore") : t("browserExpand")
                }
                title={browserExpandedFrom() !== null ? t("browserRestore") : t("browserExpand")}
                onClick={toggleBrowserExpanded}
              >
                <Show when={browserExpandedFrom() !== null} fallback={<ExpandIcon />}>
                  <CollapseIcon />
                </Show>
              </button>
            </div>
          </header>
          <div class="browser-toolbar">
            <button type="button" aria-label="Go back" class="browser-toolbar-button" disabled>
              <BrowserBackIcon />
            </button>
            <button type="button" aria-label="Go forward" class="browser-toolbar-button" disabled>
              <BrowserForwardIcon />
            </button>
            <button
              type="button"
              aria-label="Reload page"
              class="browser-toolbar-button"
              onClick={() => void openBrowserAddress()}
            >
              <BrowserReloadIcon />
            </button>
            <form
              class="browser-address-bar"
              onSubmit={(event) => {
                event.preventDefault();
                void openBrowserAddress();
              }}
            >
              <input
                value={browserAddress()}
                aria-label="Browser address"
                onInput={(event) => setBrowserAddress(event.currentTarget.value)}
              />
            </form>
            <Show
              when={props.takeover.humanInControl}
              fallback={
                <button
                  type="button"
                  class="takeover-button"
                  classList={{ "takeover-button-requested": takeoverRequests().length > 0 }}
                  onClick={props.onTakeOverBrowser}
                >
                  {t("takeOver")}
                </button>
              }
            >
              <button
                type="button"
                class="takeover-button takeover-button-active"
                onClick={() => {
                  props.onHandBackBrowser(handBackNote().trim() || null);
                  setHandBackNote("");
                }}
              >
                {t("handBack")}
              </button>
            </Show>
          </div>
          <Show
            when={
              !props.takeover.humanInControl &&
              takeoverRequests().length === 0 &&
              activeBrowserControl()
            }
          >
            {(control) => (
              <div class="browser-control-strip" role="status">
                <span class="browser-control-dot" aria-hidden="true" />
                <strong>{browserControlBot()?.name ?? "Coworker"}</strong>
                <span>{browserActionLabel(control().action)}</span>
              </div>
            )}
          </Show>
          <Show when={props.takeover.humanInControl || takeoverRequests().length > 0}>
            <div
              class="takeover-banner"
              classList={{ "takeover-banner-active": props.takeover.humanInControl }}
              role="status"
            >
              <For each={takeoverRequests()}>
                {(request) => (
                  <p>
                    <strong>{request.bot?.name ?? request.botId}</strong> {t("takeoverRequested")}:{" "}
                    {request.reason}
                  </p>
                )}
              </For>
              <Show when={!props.takeover.humanInControl && takeoverRequests().length > 0}>
                <div class="takeover-banner-actions">
                  <button type="button" class="button-primary" onClick={props.onTakeOverBrowser}>
                    {t("takeOver")}
                  </button>
                  <button type="button" onClick={() => props.onDeclineTakeover?.()}>
                    {t("takeoverDecline")}
                  </button>
                </div>
              </Show>
              <Show when={props.takeover.humanInControl}>
                <p>{t("youAreInControl")}</p>
                <input
                  value={handBackNote()}
                  placeholder={t("handBackNote")}
                  aria-label={t("handBackNote")}
                  onInput={(event) => setHandBackNote(event.currentTarget.value)}
                />
              </Show>
            </div>
          </Show>
          <div class="browser-surface" ref={(element) => (browserSurface = element)}>
            <Show when={browserTabs().length === 0}>
              <BrowserStartMenu onAction={runBrowserStartAction} />
            </Show>
          </div>
        </aside>
      </Show>

      <Show when={settingsOpen() && props.bot}>
        <aside id="settings-side-panel" class="agent-settings-panel" aria-label="Agent settings">
          <PanelResizer
            class="right-panel-resizer"
            label="Resize right panel"
            controls="settings-side-panel"
            direction="right"
            value={settingsPanelWidth()}
            defaultValue={SETTINGS_PANEL_DEFAULT}
            min={SETTINGS_PANEL_MIN}
            max={() =>
              Math.min(
                SETTINGS_PANEL_MAX,
                Math.max(
                  SETTINGS_PANEL_MIN,
                  (conversationPanel?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
                ),
              )
            }
            onResize={setSettingsPanelWidth}
            onResizeEnd={(value) => savePanelWidth(SETTINGS_PANEL_STORAGE_KEY, value)}
          />
          <header class="agent-settings-header">
            <button
              type="button"
              class="agent-settings-nav-button"
              aria-label="Back to details"
              onClick={() => setActiveRightPanel("none")}
            >
              <BackIcon />
            </button>
            <h2>Settings</h2>
            <button
              type="button"
              class="agent-settings-nav-button"
              aria-label="Close details"
              onClick={() => setActiveRightPanel("none")}
            >
              <CloseIcon />
            </button>
          </header>
          <div class="agent-settings-content">
            <button
              type="button"
              class="agent-settings-avatar"
              aria-label="Edit agent avatar"
              aria-expanded={avatarPickerOpen()}
              onClick={() => setAvatarPickerOpen((open) => !open)}
            >
              <AgentAvatar shape={avatarShape()} color={avatarColor()} bot={props.bot} />
            </button>
            <Show when={avatarPickerOpen()}>
              <section class="avatar-editor" aria-label="Avatar editor">
                <fieldset class="avatar-shape-grid" aria-label="Character shape">
                  <For each={AVATAR_SHAPES}>
                    {(shape) => (
                      <button
                        type="button"
                        class="avatar-shape-choice"
                        classList={{ "avatar-choice-selected": avatarShape() === shape }}
                        aria-label={`${AVATAR_SHAPE_LABELS[shape]} character shape`}
                        aria-pressed={avatarShape() === shape}
                        onClick={() => {
                          setAvatarShape(shape);
                          saveBotPatch({ avatarShape: shape });
                        }}
                      >
                        <AgentAvatar shape={shape} color={avatarColor()} bot={props.bot} />
                      </button>
                    )}
                  </For>
                </fieldset>
                <div class="avatar-editor-divider" />
                <fieldset class="avatar-color-grid" aria-label="Character color">
                  <For each={AVATAR_COLORS}>
                    {(color) => (
                      <button
                        type="button"
                        class="avatar-color-choice"
                        classList={{ "avatar-choice-selected": avatarColor() === color }}
                        aria-label={`${AVATAR_COLOR_LABELS[color]} character color`}
                        aria-pressed={avatarColor() === color}
                        onClick={() => {
                          setAvatarColor(color);
                          saveBotPatch({ avatarColor: color });
                        }}
                      >
                        <span class={`avatar-color-swatch avatar-color-swatch-${color}`} />
                      </button>
                    )}
                  </For>
                </fieldset>
              </section>
            </Show>
            <label class="agent-settings-field">
              <span>Name</span>
              <input
                value={settingsName()}
                aria-label="Agent name"
                onInput={(event) => setSettingsName(event.currentTarget.value)}
                onBlur={() => saveBotPatch({ name: settingsName().trim() || "New agent" })}
              />
            </label>
            <label class="agent-settings-field">
              <span>Title</span>
              <input
                value={settingsTitle()}
                aria-label="Agent title"
                placeholder="Describe what your agent does"
                onInput={(event) => setSettingsTitle(event.currentTarget.value)}
                onBlur={() => saveBotPatch({ role: settingsTitle().trim() })}
              />
            </label>
            <label class="agent-settings-field agent-settings-description">
              <span>Description</span>
              <textarea
                rows="4"
                value={settingsDescription()}
                aria-label="Agent description"
                placeholder="What this agent is for"
                onInput={(event) => setSettingsDescription(event.currentTarget.value)}
                onBlur={() => saveBotPatch({ description: settingsDescription() })}
              />
            </label>
            <section class="agent-settings-model" aria-labelledby="agent-model-heading">
              <div class="agent-settings-section-heading">
                <strong id="agent-model-heading">Runtime</strong>
                <span>Choose how this agent runs</span>
              </div>
              <div class="agent-settings-model-controls">
                <div class="agent-settings-model-option">
                  <ProviderModelPicker
                    variant="field"
                    ariaLabel="Agent model"
                    value={settingsModel()}
                    agentStatus={props.agentStatus}
                    modelOptions={props.modelOptions}
                    disabled={!agentReady() || agentActivity() === "Working"}
                    disabledReason={
                      agentActivity() === "Working"
                        ? t("modelLockedWhileWorking")
                        : t("modelConnectHint")
                    }
                    onChange={(model) => void selectAndConfirmModel(model)}
                  />
                  <Show when={selectedModel()} keyed>
                    {(model) => <p class="agent-settings-model-description">{model.description}</p>}
                  </Show>
                </div>
                <label class="agent-settings-model-row agent-settings-thinking-row">
                  <span>Reasoning</span>
                  <select
                    value={settingsReasoning()}
                    aria-label="Agent reasoning level"
                    onChange={(event) => {
                      const reasoningEffort = event.currentTarget.value as AgentReasoningEffort;
                      setSettingsReasoning(reasoningEffort);
                      saveBotPatch({ reasoningEffort });
                    }}
                  >
                    <For each={reasoningOptions()}>
                      {(effort) => <option value={effort}>{reasoningLabel(effort)}</option>}
                    </For>
                  </select>
                </label>
              </div>
            </section>
            <Show when={settingsSaveError()}>
              {(message) => (
                <p class="agent-settings-save-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={props.onDeleteBot && props.bot}>
              {(bot) => (
                <section class="agent-settings-danger">
                  <strong>{t("dangerZone")}</strong>
                  <Show
                    when={confirmingDelete()}
                    fallback={
                      <button type="button" onClick={() => setConfirmingDelete(true)}>
                        {t("deleteCoworker")}
                      </button>
                    }
                  >
                    <p>{t("deleteCoworkerConfirm", { name: bot().name })}</p>
                    <div class="agent-settings-danger-actions">
                      <button
                        type="button"
                        class="agent-settings-danger-confirm"
                        onClick={() => {
                          setConfirmingDelete(false);
                          props.onDeleteBot?.(bot().id);
                        }}
                      >
                        {t("deleteCoworker")}
                      </button>
                      <button type="button" onClick={() => setConfirmingDelete(false)}>
                        {t("cancel")}
                      </button>
                    </div>
                  </Show>
                </section>
              )}
            </Show>
            <div class="agent-settings-notifications">
              <div>
                <strong>Notifications</strong>
                <span>Get notified when this agent finishes or needs input</span>
              </div>
              <button
                type="button"
                role="switch"
                class="settings-switch"
                classList={{ "settings-switch-on": settingsNotifications() }}
                aria-label="Notifications"
                aria-checked={settingsNotifications()}
                onClick={() => {
                  const next = !settingsNotifications();
                  setSettingsNotifications(next);
                  saveBotPatch({ notifications: next });
                }}
              >
                <span />
              </button>
            </div>
          </div>
        </aside>
      </Show>
    </main>
  );
}

function reasoningLabel(effort: AgentReasoningEffort): string {
  if (effort === "xhigh") return "Extra high";
  return `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}`;
}

function ThinkingIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.75a4.65 4.65 0 0 0-2.85 8.33c.47.36.73.78.78 1.17h4.14c.05-.39.31-.81.78-1.17A4.65 4.65 0 0 0 8 1.75Z" />
      <path d="M6.3 13h3.4M6.9 14.5h2.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5.75 6.5 2.25 2.25 2.25-2.25" />
    </svg>
  );
}

function fileBadge(attachment: AttachmentSummary): string {
  if (attachment.previewKind === "pdf") return "PDF";
  if (attachment.previewKind === "text") return "TXT";
  return attachment.name.split(".").at(-1)?.slice(0, 4).toUpperCase() || "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
