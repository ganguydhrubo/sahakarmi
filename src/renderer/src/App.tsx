import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { createMutable } from "solid-js/store";
import type {
  AccountUsage,
  AgentEvent,
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentReasoningEffort,
  AgentStatus,
  AppInfo,
  ApprovalRequest,
  AppSetupState,
  BotSummary,
  BrowserControlState,
  BrowserTab,
  BrowserTakeoverState,
  ConversationMessage,
  ConversationSnapshot,
  CoworkerStatus,
  QueueSnapshot,
  ScheduleCadence,
  ScheduledTask,
  UpdateBotInput,
  UpdateStatus,
  WorkspaceState,
} from "../../shared/ipc";
import type { MarketplaceAgent } from "../../shared/marketplace";
import { ERROR_TITLES } from "./activity-hinglish";
import { ApprovalsView } from "./components/ApprovalsView";
import { Conversation } from "./components/Conversation";
import { InitialSetup } from "./components/InitialSetup";
import { PanelResizer, readPanelWidth, savePanelWidth } from "./components/PanelResizer";
import { SchedulesView } from "./components/SchedulesView";
import { SharedFilesView } from "./components/SharedFilesView";
import { type CenterView, Sidebar } from "./components/Sidebar";
import { UpdateControl } from "./components/UpdateControl";
import { accentForAvatarColor, accentForBot, type BotMessage, type BotProfile } from "./data";
import { loadFeatures } from "./features";

// Views opened from the rail load on demand, keeping start-up lean.
const ActivityView = lazy(() =>
  import("./components/ActivityView").then((module) => ({ default: module.ActivityView })),
);
const BusinessView = lazy(() =>
  import("./components/BusinessView").then((module) => ({ default: module.BusinessView })),
);
const MarketplaceView = lazy(() =>
  import("./components/MarketplaceView").then((module) => ({ default: module.MarketplaceView })),
);
const ModelUsageView = lazy(() =>
  import("./components/ModelUsageView").then((module) => ({ default: module.ModelUsageView })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((module) => ({ default: module.SettingsView })),
);

const FALLBACK_STATUS: AgentStatus = {
  phase: "starting",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: [
    { id: "codex", state: "not-started", version: null, message: null },
    { id: "claude", state: "not-started", version: null, message: null },
    { id: "gemini", state: "not-started", version: null, message: null },
    { id: "opencode", state: "not-started", version: null, message: null },
  ],
  capabilities: { chat: "unavailable", browser: "unavailable", computerUse: "unavailable" },
  message: "AI tools start ho rahe hain…",
  fullAccess: true,
};

const FALLBACK_UPDATE_STATUS: UpdateStatus = {
  phase: "unsupported",
  currentVersion: "",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: null,
};

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

const LEFT_PANEL_STORAGE_KEY = "sahkarmi:left-panel-width";
const LEFT_PANEL_COLLAPSED_STORAGE_KEY = "sahkarmi:left-panel-collapsed";
const LEFT_PANEL_DEFAULT = 260;
const LEFT_PANEL_MIN = 220;
const LEFT_PANEL_MAX = 360;

const ONBOARDING_PROFILES: Record<
  string,
  { role: string; description: string; firstMessage: string }
> = {
  Accounts: {
    role: "Accounts",
    description:
      "Handles invoices, GST-ready bookkeeping, payment follow-ups and reconciliations in INR. Never makes a payment without approval.",
    firstMessage:
      "You're my accounts coworker. Start by asking what books, invoices and payment follow-ups I need help with.",
  },
  Sales: {
    role: "Sales",
    description:
      "Researches leads, drafts outreach and follow-ups, and keeps the pipeline current. Asks for approval before contacting customers.",
    firstMessage:
      "You're my sales coworker. Ask me about my products, ideal customers and current pipeline.",
  },
  Support: {
    role: "Support",
    description:
      "Triages customer queries and drafts polite replies in English, Hindi or Bengali. Asks for approval before replying to customers.",
    firstMessage:
      "You're my customer support coworker. Ask how customers reach us and what questions come up most.",
  },
};

const EMPTY_TAKEOVER: BrowserTakeoverState = { humanInControl: false, requests: [] };

export function App() {
  const [botList, setBotList] = createSignal<BotProfile[]>([]);
  const [modelOptions, setModelOptions] = createSignal<AgentModelOption[]>([]);
  const [activeBotId, setActiveBotId] = createSignal("");
  const [liveMessages, setLiveMessages] = createSignal<Record<string, BotMessage[]>>({});
  const [uiErrors, setUiErrors] = createSignal<Record<string, BotMessage[]>>({});
  const [conversationLoaded, setConversationLoaded] = createSignal<Record<string, boolean>>({});
  const [conversationRevisions, setConversationRevisions] = createSignal<Record<string, number>>(
    {},
  );
  const [activeTurns, setActiveTurns] = createSignal<Record<string, string | null>>({});
  const [unreadReplies, setUnreadReplies] = createSignal<Record<string, number>>({});
  const [, setRecentReplies] = createSignal<Record<string, boolean>>({});
  const [queues, setQueues] = createSignal<Record<string, QueueSnapshot>>({});
  const [browserTabs, setBrowserTabs] = createSignal<BrowserTab[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = createSignal<string | null>(null);
  const [browserControlState, setBrowserControlState] = createSignal<BrowserControlState>({
    sessions: [],
  });
  const [agentPickerOpen, setAgentPickerOpen] = createSignal(false);
  const [creatingAgent, setCreatingAgent] = createSignal(false);
  const [settingsRequest, setSettingsRequest] = createSignal<{
    botId: string;
    nonce: number;
  } | null>(null);
  const [onboardingRequest, setOnboardingRequest] = createSignal<{
    botId: string;
    nonce: number;
  } | null>(null);
  const [pendingPrompts, setPendingPrompts] = createSignal<Record<string, PromptEvent | undefined>>(
    {},
  );
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null);
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>(FALLBACK_STATUS);
  const [, setAccountUsage] = createSignal<AccountUsage | null>(null);
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(FALLBACK_UPDATE_STATUS);
  const [leftPanelWidth, setLeftPanelWidth] = createSignal(
    readPanelWidth(LEFT_PANEL_STORAGE_KEY, LEFT_PANEL_DEFAULT, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = createSignal(
    window.localStorage.getItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY) === "true",
  );
  const [setupState, setSetupState] = createSignal<AppSetupState | null>(null);
  const [setupLoaded, setSetupLoaded] = createSignal(false);
  const [permissionsOpen, setPermissionsOpen] = createSignal(false);
  const [view, setView] = createSignal<CenterView>("coworker");
  const [workspaces, setWorkspaces] = createSignal<WorkspaceState>({
    workspaces: [],
    activeWorkspaceId: "",
  });
  const [approvals, setApprovals] = createSignal<ApprovalRequest[]>([]);
  const [schedules, setSchedules] = createSignal<ScheduledTask[]>([]);
  const [retries, setRetries] = createSignal<
    Record<string, { attempt: number | null; maxRetries: number | null } | null>
  >({});
  const [turnOutcomes, setTurnOutcomes] = createSignal<
    Record<string, { status: "completed" | "interrupted" | "failed"; at: number }>
  >({});
  const [takeover, setTakeover] = createSignal<BrowserTakeoverState>(EMPTY_TAKEOVER);
  const pendingConversationChanges: Array<{ botId: string; revision: number; apply: () => void }> =
    [];
  const recentReplyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let conversationFrame: number | undefined;

  const workspaceBots = createMemo(() => {
    const workspaceId = workspaces().activeWorkspaceId;
    return workspaceId ? botList().filter((bot) => bot.workspaceId === workspaceId) : botList();
  });
  const activeBot = createMemo(
    () => workspaceBots().find((bot) => bot.id === activeBotId()) ?? workspaceBots()[0],
  );
  const activeMessages = createMemo(() => {
    const bot = activeBot();
    return bot ? [...(liveMessages()[bot.id] ?? []), ...(uiErrors()[bot.id] ?? [])] : [];
  });

  onMount(() => {
    const unsubscribe = window.sahkarmi.agent.onEvent(handleAgentEvent);
    void window.sahkarmi.team
      .listWorkspaces()
      .then(setWorkspaces)
      .catch(() => undefined);
    void window.sahkarmi.approvals
      .list()
      .then(setApprovals)
      .catch(() => undefined);
    void window.sahkarmi.schedules
      .list()
      .then(setSchedules)
      .catch(() => undefined);
    void loadFeatures();
    void window.sahkarmi.browser
      .getTakeover()
      .then(setTakeover)
      .catch(() => undefined);
    const unsubscribeUpdate = window.sahkarmi.update.onEvent(setUpdateStatus);
    onCleanup(() => {
      unsubscribe();
      unsubscribeUpdate();
      if (conversationFrame !== undefined) cancelAnimationFrame(conversationFrame);
      for (const timer of recentReplyTimers.values()) clearTimeout(timer);
      recentReplyTimers.clear();
    });
    void window.sahkarmi.update
      .getStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    void window.sahkarmi
      .getSetupState()
      .then(setSetupState)
      .finally(() => setSetupLoaded(true));

    void Promise.all([
      window.sahkarmi
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => setAppInfo({ name: "Sahkarmi", version: "unavailable", platform: "darwin" })),
      window.sahkarmi.agent
        .getStatus()
        .then(setAgentStatus)
        .catch(() => undefined),
      window.sahkarmi.agent
        .listModels()
        .then(setModelOptions)
        .catch(() => undefined),
      window.sahkarmi.agent
        .listBots()
        .then(applyStoredBots)
        .catch((error) => {
          setAgentStatus((current) => ({ ...current, message: String(error) }));
        }),
    ]);
    void window.sahkarmi.browser
      .listTabs()
      .then((tabs) => {
        setBrowserTabs(tabs);
        setActiveBrowserTabId((current) => current ?? tabs[0]?.id ?? null);
      })
      .catch(() => undefined);
    void window.sahkarmi.browser
      .getControlState()
      .then(setBrowserControlState)
      .catch(() => undefined);
  });

  createEffect(() => {
    const botId = activeBotId();
    agentStatus().phase;
    if (!botId) return;
    void Promise.all([
      window.sahkarmi.agent.readConversation(botId),
      window.sahkarmi.agent.listQueue(botId),
    ])
      .then(([snapshot, queue]) => {
        setQueues((current) => ({ ...current, [botId]: queue }));
        scheduleConversation(snapshot);
      })
      .catch((error) => appendUiError(botId, error, ERROR_TITLES.load));
  });

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "status":
        setAgentStatus(event.status);
        if (event.status.phase === "ready") {
          void window.sahkarmi.agent
            .listModels()
            .then(setModelOptions)
            .catch(() => undefined);
        }
        return;
      case "usage-changed":
        setAccountUsage(event.usage);
        return;
      case "bots-changed":
        applyStoredBots(event.bots);
        return;
      case "conversation":
        clearRetry(event.snapshot.botId);
        scheduleConversation(event.snapshot);
        return;
      case "conversation-delta":
        clearRetry(event.botId);
        applyConversationDelta(event);
        return;
      case "turn-retrying":
        setRetries((current) => ({
          ...current,
          [event.botId]: { attempt: event.attempt, maxRetries: event.maxRetries },
        }));
        return;
      case "queue-changed":
        setQueues((current) => ({ ...current, [event.snapshot.botId]: event.snapshot }));
        return;
      case "browser-changed":
        setBrowserTabs(event.tabs);
        setActiveBrowserTabId(event.activeTabId);
        return;
      case "browser-control-changed":
        setBrowserControlState(event.state);
        return;
      case "browser-takeover-changed":
        setTakeover(event.state);
        return;
      case "workspaces-changed":
        setWorkspaces(event.state);
        return;
      case "approvals-changed":
        setApprovals(event.approvals);
        return;
      case "schedules-changed":
        setSchedules(event.schedules);
        return;
      case "turn-started":
        clearRetry(event.botId);
        clearRecentReply(event.botId);
        setActiveTurns((current) => ({ ...current, [event.botId]: event.turnId }));
        return;
      case "turn-completed":
        clearRetry(event.botId);
        setTurnOutcomes((current) => ({
          ...current,
          [event.botId]: { status: outcomeStatus(event.status), at: Date.now() },
        }));
        setActiveTurns((current) => ({ ...current, [event.botId]: null }));
        if (event.status === "completed") markReplyCompleted(event.botId);
        return;
      case "prompt":
        setPendingPrompts((current) => ({ ...current, [event.botId]: event }));
        return;
      case "error":
        if (event.botId) appendUiError(event.botId, event.message, ERROR_TITLES.error);
    }
  }

  function clearRetry(botId: string) {
    if (!retries()[botId]) return;
    setRetries((current) => ({ ...current, [botId]: null }));
  }

  function applyStoredBots(storedBots: BotSummary[]) {
    let profiles: BotProfile[] = [];
    setBotList((current) => {
      const currentById = new Map(current.map((bot) => [bot.id, bot]));
      profiles = storedBots.map((stored) => {
        const next = toBotProfile(stored);
        const existing = currentById.get(next.id);
        if (!existing) return createMutable(next);
        Object.assign(existing, next);
        return existing;
      });
      return profiles;
    });
    setActiveBotId((current) =>
      profiles.some((bot) => bot.id === current) ? current : (profiles[0]?.id ?? ""),
    );
    // Status dots need every coworker's queue, not only the one on screen.
    const known = queues();
    for (const profile of profiles) {
      if (known[profile.id]) continue;
      void window.sahkarmi.agent
        .listQueue(profile.id)
        .then((queue) =>
          setQueues((current) =>
            current[profile.id] ? current : { ...current, [profile.id]: queue },
          ),
        )
        .catch(() => undefined);
    }
  }

  function scheduleConversation(snapshot: ConversationSnapshot) {
    // A full snapshot supersedes earlier queued changes for the same coworker.
    // Coalescing also prevents an empty initial snapshot from animating loaded history.
    for (let index = pendingConversationChanges.length - 1; index >= 0; index -= 1) {
      const pending = pendingConversationChanges[index];
      if (pending.botId === snapshot.botId && pending.revision <= snapshot.revision) {
        pendingConversationChanges.splice(index, 1);
      }
    }
    scheduleConversationChange(snapshot.botId, snapshot.revision, () =>
      applyConversation(snapshot),
    );
  }

  function scheduleConversationChange(botId: string, revision: number, apply: () => void) {
    pendingConversationChanges.push({ botId, revision, apply });
    if (conversationFrame !== undefined) return;
    conversationFrame = requestAnimationFrame(() => {
      conversationFrame = undefined;
      const changes = pendingConversationChanges.splice(0);
      batch(() => {
        // Preserve revision order while rendering streamed tokens only once per frame.
        for (const change of changes) change.apply();
      });
    });
  }

  function applyConversationDelta(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
    scheduleConversationChange(event.botId, event.revision, () => applyConversationDeltaNow(event));
  }

  function applyConversationDeltaNow(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
    if (event.revision <= (conversationRevisions()[event.botId] ?? -1)) return;
    setConversationRevisions((current) => ({ ...current, [event.botId]: event.revision }));

    const existing = liveMessages()[event.botId]?.find((message) => message.id === event.messageId);
    if (existing) {
      existing.body += event.delta;
      existing.streaming = true;
    } else {
      const message = createMutable<BotMessage>({
        id: event.messageId,
        turnId: event.turnId,
        author: "bot",
        body: event.delta,
        time: formatTime(event.createdAt),
        streaming: true,
        animate: conversationLoaded()[event.botId] === true,
        kind: "text",
      });
      setLiveMessages((current) => ({
        ...current,
        [event.botId]: [...(current[event.botId] ?? []), message],
      }));
    }
    setConversationLoaded((current) => ({ ...current, [event.botId]: true }));
  }

  function applyConversation(snapshot: ConversationSnapshot) {
    const botId = snapshot.botId;
    if (snapshot.revision < (conversationRevisions()[botId] ?? -1)) return;
    const initialLoad = conversationLoaded()[botId] !== true;
    setConversationRevisions((current) => ({ ...current, [botId]: snapshot.revision }));
    setLiveMessages((current) => {
      const previous = current[botId] ?? [];
      const previousById = new Map(previous.map((message) => [message.id, message]));
      const mappedMessages = retainThinkingMessages(previous, toBotMessages(snapshot.messages));
      const next = mappedMessages.map((mapped) => {
        const existing = previousById.get(mapped.id);
        if (!existing) return createMutable({ ...mapped, animate: !initialLoad });
        if (!botMessagesEqual(existing, mapped)) Object.assign(existing, mapped);
        return existing;
      });
      if (
        previous.length === next.length &&
        previous.every((message, index) => message === next[index])
      ) {
        return current;
      }
      return { ...current, [botId]: next };
    });
    setConversationLoaded((current) => ({ ...current, [botId]: true }));
    setActiveTurns((current) => ({ ...current, [botId]: snapshot.activeTurnId }));
  }

  async function createAgent() {
    if (creatingAgent()) return;
    setCreatingAgent(true);
    try {
      const stored = await window.sahkarmi.agent.createBot(
        workspaces().activeWorkspaceId || undefined,
      );
      const newAgent = createMutable(toBotProfile(stored));
      setBotList((current) => [newAgent, ...current.filter((item) => item.id !== newAgent.id)]);
      setLiveMessages((current) => ({ ...current, [newAgent.id]: [] }));
      setConversationLoaded((current) => ({ ...current, [newAgent.id]: true }));
      setAgentPickerOpen(false);
      setView("coworker");
      setActiveBotId(newAgent.id);
      setOnboardingRequest({ botId: newAgent.id, nonce: Date.now() });
    } catch (error) {
      setAgentPickerOpen(false);
      if (activeBotId()) appendUiError(activeBotId(), error, ERROR_TITLES.create);
    } finally {
      setCreatingAgent(false);
    }
  }

  /** Creates a real coworker from a Marketplace entry, with its remit already set. */
  async function addMarketplaceAgent(agent: MarketplaceAgent): Promise<void> {
    const stored = await window.sahkarmi.agent.createBot(
      workspaces().activeWorkspaceId || undefined,
    );
    const updated = await window.sahkarmi.agent.updateBot({
      botId: stored.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      avatarShape: agent.avatarShape,
      avatarColor: agent.avatarColor,
    });
    const profile = createMutable(toBotProfile(updated));
    setBotList((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
    setLiveMessages((current) => ({ ...current, [profile.id]: [] }));
    setConversationLoaded((current) => ({ ...current, [profile.id]: true }));
  }

  function selectBot(botId: string) {
    const bot = botList().find((candidate) => candidate.id === botId);
    if (bot && bot.workspaceId !== workspaces().activeWorkspaceId) {
      void selectWorkspace(bot.workspaceId);
    }
    setView("coworker");
    setAgentPickerOpen(false);
    clearReplyIndicators(botId);
    setActiveBotId(botId);
  }

  function markReplyCompleted(botId: string) {
    if (activeBotId() !== botId) {
      setUnreadReplies((current) => ({
        ...current,
        [botId]: Math.min(99, (current[botId] ?? 0) + 1),
      }));
      return;
    }
    clearRecentReply(botId);
    setRecentReplies((current) => ({ ...current, [botId]: true }));
    recentReplyTimers.set(
      botId,
      setTimeout(() => {
        recentReplyTimers.delete(botId);
        setRecentReplies((current) => ({ ...current, [botId]: false }));
      }, 4000),
    );
  }

  function clearRecentReply(botId: string) {
    const timer = recentReplyTimers.get(botId);
    if (timer) clearTimeout(timer);
    recentReplyTimers.delete(botId);
    setRecentReplies((current) => (current[botId] ? { ...current, [botId]: false } : current));
  }

  function clearReplyIndicators(botId: string) {
    clearRecentReply(botId);
    setUnreadReplies((current) => (current[botId] ? { ...current, [botId]: 0 } : current));
  }

  function activateBrowserTab(tabId: string) {
    void window.sahkarmi.browser.activate(tabId);
  }

  function closeBrowserTab(tabId: string) {
    void window.sahkarmi.browser.close(tabId);
  }

  async function updateBot(botId: string, updates: Omit<UpdateBotInput, "botId">) {
    try {
      const stored = await window.sahkarmi.agent.updateBot({ botId, ...updates });
      const existing = botList().find((bot) => bot.id === botId);
      if (existing) Object.assign(existing, toBotProfile(stored));
      else setBotList((current) => [...current, createMutable(toBotProfile(stored))]);
    } catch (error) {
      appendUiError(botId, error, ERROR_TITLES.settings);
      throw error;
    }
  }

  function editBot(botId: string) {
    selectBot(botId);
    setSettingsRequest({ botId, nonce: Date.now() });
  }

  async function deleteBot(botId: string) {
    try {
      await window.sahkarmi.agent.deleteBot(botId);
      const remaining = botList().filter((bot) => bot.id !== botId);
      setBotList(remaining);
      setActiveBotId((current) => (current === botId ? (remaining[0]?.id ?? "") : current));
      setSettingsRequest((current) => (current?.botId === botId ? null : current));
      setLiveMessages((current) => withoutBot(current, botId));
      setUiErrors((current) => withoutBot(current, botId));
      setConversationLoaded((current) => withoutBot(current, botId));
      setConversationRevisions((current) => withoutBot(current, botId));
      setActiveTurns((current) => withoutBot(current, botId));
      setUnreadReplies((current) => withoutBot(current, botId));
      setRecentReplies((current) => withoutBot(current, botId));
      setQueues((current) => withoutBot(current, botId));
      setPendingPrompts((current) => withoutBot(current, botId));
      const replyTimer = recentReplyTimers.get(botId);
      if (replyTimer) clearTimeout(replyTimer);
      recentReplyTimers.delete(botId);
    } catch (error) {
      appendUiError(botId, error, ERROR_TITLES.delete);
      throw error;
    }
  }

  async function sendMessage(
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
  ): Promise<boolean> {
    const bot = activeBot();
    if (!bot || (!body.trim() && attachmentDraftIds.length === 0)) return false;
    return sendMessageToBot(bot.id, body, attachmentDraftIds, replyToMessageId);
  }

  async function sendMessageToBot(
    botId: string,
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null = null,
  ): Promise<boolean> {
    try {
      await window.sahkarmi.agent.sendMessage({
        botId,
        text: body.trim(),
        attachmentDraftIds,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      });
      setUiErrors((current) => ({ ...current, [botId]: [] }));
      return true;
    } catch (error) {
      appendUiError(botId, error, ERROR_TITLES.send);
      return false;
    }
  }

  async function completeOnboarding(
    answer: string,
    model: AgentModelId,
    reasoningEffort: AgentReasoningEffort,
  ): Promise<boolean> {
    const bot = activeBot();
    const topic = answer.trim();
    if (!bot || !topic) return false;
    const predefined = ONBOARDING_PROFILES[topic];
    const profile = predefined ?? {
      role: topic.length <= 60 ? topic : "Custom focus",
      description: `Primary focus: ${topic.slice(0, 1_900)}.`,
      firstMessage: `My main focus for you is: ${topic}. Treat this as your ongoing specialty.`,
    };
    try {
      await updateBot(bot.id, {
        role: profile.role,
        description: profile.description,
        model,
        reasoningEffort,
      });
    } catch {
      return false;
    }
    return sendMessageToBot(bot.id, profile.firstMessage, []);
  }

  async function answerPrompt(answers: Record<string, string[]>): Promise<boolean> {
    const bot = activeBot();
    const prompt = bot ? pendingPrompts()[bot.id] : undefined;
    if (!bot || !prompt) return false;
    try {
      await window.sahkarmi.agent.respondToPrompt({ requestId: prompt.requestId, answers });
      setPendingPrompts((current) => ({ ...current, [bot.id]: undefined }));
      return true;
    } catch (error) {
      appendUiError(bot.id, error, ERROR_TITLES.answer);
      return false;
    }
  }

  function cancelQueuedMessage(deliveryId: string) {
    const bot = activeBot();
    if (!bot) return;
    void window.sahkarmi.agent
      .cancelQueuedMessage({ botId: bot.id, deliveryId })
      .catch((error) => appendUiError(bot.id, error, ERROR_TITLES.cancel));
  }

  function setQueuePaused(paused: boolean) {
    const bot = activeBot();
    if (!bot) return;
    void window.sahkarmi.agent
      .setQueuePaused({ botId: bot.id, paused })
      .catch((error) =>
        appendUiError(bot.id, error, paused ? ERROR_TITLES.pause : ERROR_TITLES.resume),
      );
  }

  async function selectWorkspace(workspaceId: string) {
    const state = await window.sahkarmi.team.setActiveWorkspace(workspaceId);
    setWorkspaces(state);
    const first = botList().find((bot) => bot.workspaceId === state.activeWorkspaceId);
    if (first && activeBot()?.workspaceId !== state.activeWorkspaceId) setActiveBotId(first.id);
  }

  async function createWorkspace(name: string) {
    setWorkspaces(await window.sahkarmi.team.createWorkspace(name));
    setView("coworker");
  }

  async function renameWorkspace(workspaceId: string, name: string) {
    setWorkspaces(await window.sahkarmi.team.renameWorkspace(workspaceId, name));
  }

  async function decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    note: string,
  ) {
    await window.sahkarmi.approvals.decide({ approvalId, decision, note: note.trim() || null });
    setApprovals(await window.sahkarmi.approvals.list());
  }

  async function scheduleMessage(text: string, cadence: ScheduleCadence): Promise<boolean> {
    const bot = activeBot();
    if (!bot || !text.trim()) return false;
    try {
      await window.sahkarmi.schedules.create({ botId: bot.id, text: text.trim(), cadence });
      setSchedules(await window.sahkarmi.schedules.list());
      return true;
    } catch (error) {
      appendUiError(bot.id, error, ERROR_TITLES.schedule);
      return false;
    }
  }

  function scheduleAction(action: () => Promise<unknown>) {
    const botId = activeBot()?.id;
    void action()
      .then(() => window.sahkarmi.schedules.list().then(setSchedules))
      .catch((error) => botId && appendUiError(botId, error, ERROR_TITLES.schedule));
  }

  function resumeQueue() {
    const bot = activeBot();
    if (!bot) return;
    void window.sahkarmi.agent
      .setQueuePaused({ botId: bot.id, paused: false })
      .catch((error) => appendUiError(bot.id, error, ERROR_TITLES.resume));
  }

  function stopActiveTurn() {
    const bot = activeBot();
    const turnId = bot ? activeTurns()[bot.id] : null;
    if (!bot || !turnId) return;
    void window.sahkarmi.agent
      .interrupt({ botId: bot.id, turnId })
      .catch((error) => appendUiError(bot.id, error, ERROR_TITLES.stop));
  }

  function appendUiError(botId: string, error: unknown, status: string) {
    const body = error instanceof Error ? error.message : String(error);
    setUiErrors((current) => ({
      ...current,
      [botId]: [
        ...(current[botId] ?? []),
        {
          id: `ui-${Date.now()}-${Math.random()}`,
          author: "bot",
          body,
          time: formatTime(new Date().toISOString()),
          status,
        },
      ],
    }));
  }

  const activeQueue = createMemo(() => {
    const bot = activeBot();
    return bot ? queues()[bot.id] : undefined;
  });
  const pendingApprovals = createMemo(() =>
    approvals().filter((approval) => approval.status === "pending"),
  );
  const coworkerStatuses = createMemo<Record<string, CoworkerStatus>>(() => {
    const turns = activeTurns();
    const queueSnapshots = queues();
    const prompts = pendingPrompts();
    const errors = uiErrors();
    const waitingBots = new Set([
      ...pendingApprovals().map((approval) => approval.botId),
      ...takeover().requests.map((request) => request.botId),
    ]);
    const statuses: Record<string, CoworkerStatus> = {};
    for (const bot of botList()) {
      const deliveries = queueSnapshots[bot.id]?.deliveries ?? [];
      const isWorking =
        Boolean(turns[bot.id]) ||
        deliveries.some(
          (delivery) => delivery.status === "starting" || delivery.status === "running",
        );
      const latest = [...deliveries].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )[0];
      if (prompts[bot.id] || waitingBots.has(bot.id)) statuses[bot.id] = "waiting";
      else if (isWorking) statuses[bot.id] = "working";
      else if (latest?.status === "failed" || (errors[bot.id]?.length ?? 0) > 0) {
        statuses[bot.id] = "error";
      } else statuses[bot.id] = "idle";
    }
    return statuses;
  });

  function setSidebarCollapsed(collapsed: boolean) {
    setLeftPanelCollapsed(collapsed);
    window.localStorage.setItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
  }

  async function saveSetup(preferredProvider: AgentProviderId): Promise<void> {
    const state = await window.sahkarmi.saveSetup({ preferredProvider });
    setSetupState(state);
    setPermissionsOpen(false);
  }

  async function runUpdateAction(): Promise<void> {
    const phase = updateStatus().phase;
    if (phase === "ready") {
      await window.sahkarmi.update.install();
      return;
    }
    const status =
      phase === "available" || (phase === "error" && updateStatus().availableVersion)
        ? await window.sahkarmi.update.download()
        : await window.sahkarmi.update.check();
    setUpdateStatus(status);
  }

  return (
    <Show
      when={setupLoaded() && appInfo() !== null}
      fallback={<div class="initial-setup-screen" role="status" aria-label="Loading Sahkarmi" />}
    >
      <Show
        when={setupState()?.completed}
        fallback={
          <InitialSetup
            state={setupState() ?? { completed: false, preferredProvider: null }}
            agentStatus={agentStatus()}
            platform={appInfo()?.platform ?? "darwin"}
            onSave={saveSetup}
          />
        }
      >
        <div
          class="app-frame"
          classList={{ "app-frame-sidebar-collapsed": leftPanelCollapsed() }}
          style={`--left-panel-width: ${leftPanelCollapsed() ? 0 : leftPanelWidth()}px`}
        >
          <Show
            when={
              view() !== "settings" &&
              ["available", "downloading", "ready", "error", "installing"].includes(
                updateStatus().phase,
              )
            }
          >
            <aside class="update-notice" aria-label="Sahkarmi update">
              <UpdateControl status={updateStatus()} onAction={runUpdateAction} />
            </aside>
          </Show>
          <Show when={!leftPanelCollapsed()}>
            <Sidebar
              bots={workspaceBots()}
              activeBotId={activeBot()?.id ?? ""}
              view={view()}
              appInfo={appInfo()}
              workspaces={workspaces()}
              statuses={coworkerStatuses()}
              unread={unreadReplies()}
              pendingApprovals={pendingApprovals().length}
              onSelectBot={selectBot}
              onCreateBot={() => void createAgent()}
              onEditBot={editBot}
              onDeleteBot={deleteBot}
              onSelectView={(next) => {
                setAgentPickerOpen(false);
                setView(next);
              }}
              onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
              onCreateWorkspace={createWorkspace}
              onRenameWorkspace={renameWorkspace}
              onCollapse={() => setSidebarCollapsed(true)}
            />
            <PanelResizer
              class="left-panel-resizer"
              label="Resize left sidebar"
              controls="bot-sidebar"
              direction="left"
              value={leftPanelWidth()}
              defaultValue={LEFT_PANEL_DEFAULT}
              min={LEFT_PANEL_MIN}
              max={LEFT_PANEL_MAX}
              onResize={setLeftPanelWidth}
              onResizeEnd={(value) => savePanelWidth(LEFT_PANEL_STORAGE_KEY, value)}
            />
          </Show>
          <Suspense fallback={<section class="center-view" aria-busy="true" />}>
            <Switch>
              <Match when={view() === "approvals"}>
                <ApprovalsView
                  approvals={approvals()}
                  bots={botList()}
                  onDecide={decideApproval}
                  onOpenCoworker={selectBot}
                />
              </Match>
              <Match when={view() === "files"}>
                <SharedFilesView />
              </Match>
              <Match when={view() === "schedules"}>
                <SchedulesView
                  schedules={schedules()}
                  bots={botList()}
                  onToggle={(task) =>
                    scheduleAction(() =>
                      window.sahkarmi.schedules.setEnabled(task.id, !task.enabled),
                    )
                  }
                  onDelete={(task) =>
                    scheduleAction(() => window.sahkarmi.schedules.delete(task.id))
                  }
                  onRunNow={(task) =>
                    scheduleAction(() => window.sahkarmi.schedules.runNow(task.id))
                  }
                  onOpenCoworker={selectBot}
                />
              </Match>
              <Match when={view() === "usage"}>
                <ModelUsageView bots={botList()} />
              </Match>
              <Match when={view() === "business"}>
                <BusinessView bots={botList()} />
              </Match>
              <Match when={view() === "marketplace"}>
                <MarketplaceView
                  bots={workspaceBots()}
                  onAddAgent={addMarketplaceAgent}
                  onOpenCoworker={selectBot}
                />
              </Match>
              <Match when={view() === "activity"}>
                <ActivityView bots={botList()} />
              </Match>
              <Match when={view() === "settings"}>
                <SettingsView
                  appInfo={appInfo()}
                  agentStatus={agentStatus()}
                  updateStatus={updateStatus()}
                  bots={botList()}
                  modelOptions={modelOptions()}
                  onUpdateModel={(botId, model) => updateBot(botId, { model })}
                  onOpenPermissions={() => setPermissionsOpen(true)}
                  onUpdateAction={runUpdateAction}
                />
              </Match>
              <Match when={view() === "coworker"}>
                <Conversation
                  agentStatus={agentStatus()}
                  bot={activeBot()}
                  bots={botList()}
                  status={
                    activeBot() ? (coworkerStatuses()[activeBot()?.id ?? ""] ?? "idle") : "idle"
                  }
                  modelOptions={modelOptions()}
                  messages={activeMessages()}
                  loaded={
                    activeBot() ? conversationLoaded()[activeBot()?.id ?? ""] === true : false
                  }
                  queue={activeQueue()}
                  schedules={schedules().filter((task) => task.botId === activeBot()?.id)}
                  takeover={takeover()}
                  browserTabs={browserTabs()}
                  activeBrowserTabId={activeBrowserTabId()}
                  browserControlState={browserControlState()}
                  leftSidebarCollapsed={leftPanelCollapsed()}
                  prompt={activeBot() ? pendingPrompts()[activeBot()?.id ?? ""] : undefined}
                  activityRetry={retries()[activeBot()?.id ?? ""] ?? null}
                  turnOutcome={turnOutcomes()[activeBot()?.id ?? ""] ?? null}
                  waitingForApproval={pendingApprovals().some(
                    (approval) =>
                      approval.kind === "permission" && approval.botId === activeBot()?.id,
                  )}
                  activeTurnId={activeBot() ? activeTurns()[activeBot()?.id ?? ""] : null}
                  agentPickerOpen={agentPickerOpen()}
                  creatingAgent={creatingAgent()}
                  settingsRequest={settingsRequest()}
                  onboardingRequest={onboardingRequest()}
                  onCloseAgentPicker={() => setAgentPickerOpen(false)}
                  onCreateAgent={() => void createAgent()}
                  onSelectAgent={selectBot}
                  onUpdateBot={updateBot}
                  onSendMessage={sendMessage}
                  onScheduleMessage={scheduleMessage}
                  onToggleSchedule={(task) =>
                    scheduleAction(() =>
                      window.sahkarmi.schedules.setEnabled(task.id, !task.enabled),
                    )
                  }
                  onDeleteSchedule={(task) =>
                    scheduleAction(() => window.sahkarmi.schedules.delete(task.id))
                  }
                  onRunSchedule={(task) =>
                    scheduleAction(() => window.sahkarmi.schedules.runNow(task.id))
                  }
                  onCompleteOnboarding={completeOnboarding}
                  onAnswerPrompt={answerPrompt}
                  onCancelQueuedMessage={cancelQueuedMessage}
                  onPauseQueue={() => setQueuePaused(true)}
                  onResumeQueue={resumeQueue}
                  onActivateBrowserTab={activateBrowserTab}
                  onCloseBrowserTab={closeBrowserTab}
                  onTakeOverBrowser={() =>
                    void window.sahkarmi.browser.takeOver().then(setTakeover)
                  }
                  onHandBackBrowser={(note) =>
                    void window.sahkarmi.browser.handBack(note).then(setTakeover)
                  }
                  onToggleLeftSidebar={() => setSidebarCollapsed(false)}
                  onOpenAgentSetup={() => window.sahkarmi.openExternal("agent-setup")}
                  onStop={stopActiveTurn}
                />
              </Match>
            </Switch>
          </Suspense>
          <Show when={permissionsOpen()}>
            <InitialSetup
              reviewing
              state={setupState() ?? { completed: true, preferredProvider: "opencode" }}
              agentStatus={agentStatus()}
              platform={appInfo()?.platform ?? "darwin"}
              onSave={saveSetup}
              onClose={() => setPermissionsOpen(false)}
            />
          </Show>
        </div>
      </Show>
    </Show>
  );
}

function toBotProfile(stored: BotSummary): BotProfile {
  return {
    id: stored.id,
    workspaceId: stored.workspaceId,
    name: stored.name,
    role: stored.role,
    description: stored.description,
    notifications: stored.notifications,
    model: stored.model,
    reasoningEffort: stored.reasoningEffort,
    threadId: stored.threadId,
    accent:
      stored.name.toLowerCase() === "new coworker"
        ? "neutral"
        : stored.avatarColor
          ? accentForAvatarColor(stored.avatarColor)
          : accentForBot(stored.id),
    avatarShape: stored.avatarShape ?? "blob",
    avatarColor: stored.avatarColor ?? "orange",
    time: stored.updatedAt ? formatTime(stored.updatedAt) : "now",
    preview: cleanPreview(stored.preview),
  };
}

function toBotMessage(message: ConversationMessage): BotMessage {
  const exchangeSenderId = message.senderBotId ?? message.exchange?.senderBotId;
  return {
    id: message.id,
    turnId: message.turnId,
    author: message.author === "user" ? "you" : "bot",
    body: message.text,
    time: formatTime(message.createdAt),
    streaming: message.status === "streaming",
    itemType: message.itemType,
    kind: message.exchange ? "exchange" : "text",
    senderBotId: exchangeSenderId,
    replyToMessageId: message.replyToMessageId,
    attachments: message.attachments,
    exchange: message.exchange,
    reaction: message.reaction,
    status: message.exchange
      ? undefined
      : message.delivery?.status === "queued"
        ? `Line mein #${message.delivery.position}`
        : message.delivery?.status === "cancelled"
          ? "Cancel kar diya gaya"
          : message.status === "failed"
            ? "Poora nahi ho paya"
            : message.status === "interrupted"
              ? "Beech mein rok diya gaya"
              : undefined,
  };
}

function toBotMessages(messages: ConversationMessage[]): BotMessage[] {
  const result: BotMessage[] = [];
  const thinkingByTurn = new Map<string, BotMessage>();
  for (const message of messages) {
    if (message.tool) {
      result.push({ ...toBotMessage(message), kind: "tool", tool: message.tool });
      continue;
    }
    if (message.author !== "assistant" || message.itemType !== "commentary") {
      result.push(toBotMessage(message));
      continue;
    }

    const key = message.turnId ?? message.id;
    const existing = thinkingByTurn.get(key);
    if (existing) {
      if (message.text.trim()) existing.items = [...(existing.items ?? []), message.text];
      existing.streaming = existing.streaming || message.status === "streaming";
      continue;
    }

    const thinking: BotMessage = {
      id: `thinking:${key}`,
      turnId: message.turnId,
      author: "bot",
      body: "",
      time: formatTime(message.createdAt),
      streaming: message.status === "streaming",
      itemType: "commentary",
      kind: "thinking",
      items: message.text.trim() ? [message.text] : [],
    };
    thinkingByTurn.set(key, thinking);
    result.push(thinking);
  }
  return result;
}

function cleanPreview(preview: string): string {
  const cleaned = preview
    .replace(/\binbox\s+at\s+zero\b[:,]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || "No messages yet";
}

function botMessagesEqual(left: BotMessage, right: BotMessage): boolean {
  return (
    left.id === right.id &&
    left.turnId === right.turnId &&
    left.author === right.author &&
    left.body === right.body &&
    left.time === right.time &&
    left.kind === right.kind &&
    left.streaming === right.streaming &&
    left.itemType === right.itemType &&
    left.status === right.status &&
    left.senderBotId === right.senderBotId &&
    left.replyToMessageId === right.replyToMessageId &&
    left.reaction === right.reaction &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments) &&
    JSON.stringify(left.exchange) === JSON.stringify(right.exchange) &&
    JSON.stringify(left.items) === JSON.stringify(right.items) &&
    JSON.stringify(left.tool) === JSON.stringify(right.tool)
  );
}

function retainThinkingMessages(previous: BotMessage[], next: BotMessage[]): BotMessage[] {
  const result = [...next];
  const nextIds = new Set(result.map((message) => message.id));
  for (const thinking of previous) {
    if (thinking.kind !== "thinking" || nextIds.has(thinking.id) || !thinking.turnId) continue;
    const sameTurnIndexes = result.flatMap((message, index) =>
      message.turnId === thinking.turnId ? [index] : [],
    );
    if (sameTurnIndexes.length === 0) continue;
    const finalAnswerIndex = result.findIndex(
      (message) =>
        message.turnId === thinking.turnId &&
        message.author === "bot" &&
        message.kind !== "thinking",
    );
    const insertionIndex =
      finalAnswerIndex >= 0 ? finalAnswerIndex : (sameTurnIndexes.at(-1) ?? result.length - 1) + 1;
    result.splice(insertionIndex, 0, { ...thinking, streaming: false });
    nextIds.add(thinking.id);
  }
  return result;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function withoutBot<T>(values: Record<string, T>, botId: string): Record<string, T> {
  const next = { ...values };
  delete next[botId];
  return next;
}

function outcomeStatus(status: string): "completed" | "interrupted" | "failed" {
  if (status === "completed") return "completed";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  return "failed";
}
