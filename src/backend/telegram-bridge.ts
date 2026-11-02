import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentEvent,
  ApprovalRequest,
  ConversationSnapshot,
  DecideApprovalInput,
  PermissionPolicyState,
  TelegramStatus,
} from "../shared/ipc";

const STATE_FILE = "telegram.json";
const API = "https://api.telegram.org";
/** Telegram refuses longer messages. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;
const POLL_SECONDS = 25;
const MAX_BACKOFF_MS = 60_000;
/** A reply that never comes (the app was busy for ages) is forgotten after this long. */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const TYPING_REPEAT_MS = 4_500;
const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled"]);

interface StoredTelegram {
  token: string;
  botUsername: string | null;
  pairingCode: string;
  chatId: number | null;
  chatName: string | null;
  coworkerId: string | null;
  /**
   * The numeric Telegram user id of whoever paired. Approval commands check this, never the
   * username: usernames can be changed and reused, numeric ids cannot.
   */
  ownerUserId: number | null;
}

export interface TelegramAgent {
  /** The coworker each workspace's owner made CEO. */
  ceos?(): Array<{ id: string; name: string; role: string }>;
  listBots(): Array<{ id: string; name: string; role: string; workspaceId?: string }>;
  sendMessage(input: {
    botId: string;
    text: string;
  }): Promise<{ deliveries: Array<{ id: string }> }>;
  readConversation(botId: string): Promise<ConversationSnapshot>;
  /** Calls the listener for every agent event; returns a function that stops it. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /**
   * Remote approvals. Optional so an embedder that only wants chat still satisfies this
   * interface; without them the approval commands report that they are unavailable rather
   * than failing silently.
   */
  listApprovals?(): ApprovalRequest[];
  /** Must be the same call the desktop UI makes, so both routes obey one set of rules. */
  decideApproval?(input: DecideApprovalInput): Promise<ApprovalRequest>;
  /** Read-only. There is deliberately no way to change policy from Telegram. */
  permissionPolicy?(): PermissionPolicyState | null;
  sweepExpiredApprovals?(): Promise<ApprovalRequest[]>;
  recordApprovalDelivery?(approvalId: string, error: string | null): Promise<void>;
  workspaceName?(workspaceId: string): string | null;
}

export interface TelegramBridgeOptions {
  userDataPath: string;
  agent: TelegramAgent;
  fetch?: typeof fetch;
  log?: (level: "info" | "warn" | "error", message: string, detail?: unknown) => void;
  onStatus?: (status: TelegramStatus) => void;
  /**
   * A bot token from secure configuration (TELEGRAM_BOT_TOKEN), used only when nothing has
   * been set up in the app yet. Never logged and never echoed back to a chat.
   */
  envToken?: string | null;
  /**
   * OWNER_TELEGRAM_ID. When set, only this numeric user may pair or decide, whatever is
   * already stored. Lets a managed install pin the owner instead of trusting first-come pairing.
   */
  envOwnerUserId?: number | null;
  /** Turns remote decisions off while leaving notifications on. Defaults to on. */
  approvalsEnabled?: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
    chat: { id: number; type: string; first_name?: string; title?: string; username?: string };
  };
  /** A tap on one of the buttons under an approval message. */
  callback_query?: {
    id: string;
    from: { id: number; username?: string; is_bot?: boolean };
    data?: string;
    message?: { message_id: number; chat: { id: number; type: string } };
  };
}

interface PendingReply {
  botId: string;
  deliveryId: string;
  createdAt: number;
}

/** Splits a long reply into Telegram-sized pieces, at a line break where it can. */
export function telegramChunks(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = rest.lastIndexOf("\n", limit);
    const end = cut > limit / 2 ? cut : limit;
    chunks.push(rest.slice(0, end).trimEnd());
    rest = rest.slice(end).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function newPairingCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

const HELP = [
  "Write to your Sahkarmi coworker here, as in the app.",
  "/coworkers - list your coworkers",
  "/use <name or number> - talk to another coworker",
  "/ceo - talk to the CEO of your workspace",
  "",
  "Approvals, when you are away from your computer:",
  "/pending - approvals waiting for you",
  "/details <id> - everything about one request",
  "/approve <id> - allow it",
  "/reject <id> - refuse it",
  "/cancel <id> - refuse it and tell the coworker to stop",
  "/status <id> - what happened to a request",
  "/policy - your current permission settings",
  "/help - show this help",
  "",
  "Sahkarmi must be open on your computer to answer.",
].join("\n");

/** Short handle, as shown and accepted in Telegram. */
function handleOf(approval: ApprovalRequest): string {
  return approval.id.replaceAll("-", "").slice(0, 8);
}

function matchesHandle(approval: ApprovalRequest, wanted: string): boolean {
  return approval.id === wanted || approval.id.replaceAll("-", "").startsWith(wanted);
}

const RISK_LABEL: Record<string, string> = {
  low: "low",
  medium: "MEDIUM",
  high: "HIGH",
};

/** What the owner stands to lose by saying yes. Mirrors the desktop approval card. */
const CONSEQUENCE: Record<string, string> = {
  payments: "Money may leave your account.",
  external_messages: "Once sent, a message cannot be taken back.",
  publication: "Anything published can be seen by others straight away.",
  official_forms: "This submits information to an official body.",
  account_settings: "This changes how an account works.",
  business_actions: "This may place, change or cancel something for real.",
  file_delete: "Deleted files may not be recoverable.",
  shell: "Commands can change files or settings on that computer.",
};

function ageOf(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function expiryOf(approval: ApprovalRequest, now = Date.now()): string {
  if (!approval.expiresAt) return "no deadline";
  const left = Date.parse(approval.expiresAt) - now;
  if (left <= 0) return "expired";
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/**
 * Lets the owner chat with their coworkers from Telegram. The owner makes a bot with
 * @BotFather and pastes its token in Settings; then one chat is paired with a 6-digit code, and
 * only that chat is ever answered. Messages go into the coworker's normal queue, and the
 * coworker's finished reply comes back. Nothing is sent anywhere but api.telegram.org.
 */
export class TelegramBridge {
  readonly #path: string;
  readonly #agent: TelegramAgent;
  readonly #fetch: typeof fetch;
  readonly #log: NonNullable<TelegramBridgeOptions["log"]>;
  readonly #onStatus: TelegramBridgeOptions["onStatus"];
  #state: StoredTelegram | null = null;
  #running = false;
  #error: string | null = null;
  #abort: AbortController | null = null;
  #loop: Promise<void> | null = null;
  #offset = 0;
  #unsubscribe: (() => void) | null = null;
  readonly #pending: PendingReply[] = [];
  #typingTimer: ReturnType<typeof setInterval> | null = null;
  readonly #notifiedApprovals = new Set<string>();
  /** The message carrying each approval's buttons, so they go once it is decided anywhere. */
  readonly #approvalMessages = new Map<string, number>();
  /** Coworkers the owner is following here: their next replies come to Telegram too. */
  readonly #following = new Map<string, number>();
  /** Approvals asked before the bridge started were already there for the owner to see. */
  #startedAt = new Date().toISOString();
  readonly #envToken: string | null;
  readonly #envOwnerUserId: number | null;
  readonly #approvalsEnabled: boolean;
  /** Commands already acted on, so a retried or double-tapped command cannot decide twice. */
  readonly #handledCommands = new Set<string>();
  #sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TelegramBridgeOptions) {
    this.#path = join(options.userDataPath, STATE_FILE);
    this.#agent = options.agent;
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.log ?? (() => {});
    this.#onStatus = options.onStatus;
    this.#envToken = options.envToken?.trim() || null;
    this.#envOwnerUserId = Number.isFinite(options.envOwnerUserId)
      ? (options.envOwnerUserId as number)
      : null;
    this.#approvalsEnabled = options.approvalsEnabled !== false;
  }

  async initialize(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#path, "utf8")) as Partial<StoredTelegram>;
      if (typeof raw.token === "string" && raw.token) {
        this.#state = {
          token: raw.token,
          botUsername: typeof raw.botUsername === "string" ? raw.botUsername : null,
          pairingCode: typeof raw.pairingCode === "string" ? raw.pairingCode : newPairingCode(),
          chatId: typeof raw.chatId === "number" ? raw.chatId : null,
          chatName: typeof raw.chatName === "string" ? raw.chatName : null,
          coworkerId: typeof raw.coworkerId === "string" ? raw.coworkerId : null,
          ownerUserId: typeof raw.ownerUserId === "number" ? raw.ownerUserId : null,
        };
      }
    } catch {
      // Not set up yet.
    }
    if (!this.#state && this.#envToken) {
      // Configured by the environment, so a managed install needs no trip through Settings.
      try {
        await this.setToken(this.#envToken);
        return;
      } catch (error) {
        this.#log("warn", "TELEGRAM_BOT_TOKEN was not accepted", error);
      }
    }
    if (this.#state) this.#start();
  }

  status(): TelegramStatus {
    const state = this.#state;
    const coworker = this.#coworker();
    return {
      configured: state !== null,
      botUsername: state?.botUsername ?? null,
      paired: state?.chatId != null,
      chatName: state?.chatName ?? null,
      pairingCode: state && state.chatId == null ? state.pairingCode : null,
      coworkerId: coworker?.id ?? null,
      running: this.#running,
      error: this.#error,
      ownerIdVerified: this.#ownerUserId() != null,
      approvalsEnabled: this.#approvalsEnabled && typeof this.#agent.decideApproval === "function",
    };
  }

  /** The id allowed to decide: the pinned one from configuration, else whoever paired. */
  #ownerUserId(): number | null {
    return this.#envOwnerUserId ?? this.#state?.ownerUserId ?? null;
  }

  /** Checks the token with Telegram, saves it and starts listening. An empty token turns it off. */
  async setToken(token: string): Promise<TelegramStatus> {
    const trimmed = token.trim();
    if (!trimmed) {
      await this.#stop();
      this.#state = null;
      this.#error = null;
      await this.#save();
      return this.#changed();
    }
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) {
      throw new Error("That does not look like a bot token from @BotFather.");
    }
    const me = await this.#call<{ username?: string }>(trimmed, "getMe", {});
    await this.#stop();
    const sameBot = this.#state?.token === trimmed;
    this.#state = {
      token: trimmed,
      botUsername: me.username ?? null,
      pairingCode: newPairingCode(),
      chatId: sameBot ? (this.#state?.chatId ?? null) : null,
      chatName: sameBot ? (this.#state?.chatName ?? null) : null,
      coworkerId: this.#state?.coworkerId ?? null,
      ownerUserId: sameBot ? (this.#state?.ownerUserId ?? null) : null,
    };
    this.#error = null;
    await this.#save();
    this.#start();
    return this.#changed();
  }

  async setCoworker(botId: string): Promise<TelegramStatus> {
    if (!this.#state) throw new Error("Connect a Telegram bot first.");
    if (!this.#agent.listBots().some((bot) => bot.id === botId)) {
      throw new Error("Unknown coworker.");
    }
    this.#state.coworkerId = botId;
    await this.#save();
    return this.#changed();
  }

  /** Forgets the paired chat; a new code is made for the next one. */
  async unpair(): Promise<TelegramStatus> {
    if (!this.#state) return this.status();
    this.#state.chatId = null;
    this.#state.chatName = null;
    this.#state.ownerUserId = null;
    this.#state.pairingCode = newPairingCode();
    this.#pending.length = 0;
    await this.#save();
    return this.#changed();
  }

  async stop(): Promise<void> {
    await this.#stop();
  }

  #start(): void {
    if (this.#running || !this.#state) return;
    this.#running = true;
    this.#startedAt = new Date().toISOString();
    this.#unsubscribe = this.#agent.subscribe((event) => void this.#onAgentEvent(event));
    this.#loop = this.#poll();
    if (this.#agent.sweepExpiredApprovals) {
      // Deadlines must pass even when no one touches Telegram for hours.
      this.#sweepTimer = setInterval(
        () => void this.#agent.sweepExpiredApprovals?.().catch(() => []),
        60_000,
      );
      this.#sweepTimer.unref?.();
    }
  }

  async #stop(): Promise<void> {
    this.#running = false;
    this.#abort?.abort();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#typingTimer) clearInterval(this.#typingTimer);
    this.#typingTimer = null;
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#sweepTimer = null;
    await this.#loop?.catch(() => {});
    this.#loop = null;
  }

  async #poll(): Promise<void> {
    let backoff = 2_000;
    while (this.#running && this.#state) {
      const token = this.#state.token;
      this.#abort = new AbortController();
      try {
        const updates = await this.#call<TelegramUpdate[]>(
          token,
          "getUpdates",
          {
            offset: this.#offset,
            timeout: POLL_SECONDS,
            allowed_updates: ["message", "callback_query"],
          },
          AbortSignal.any([this.#abort.signal, AbortSignal.timeout((POLL_SECONDS + 15) * 1000)]),
        );
        if (this.#error) {
          this.#error = null;
          this.#changed();
        }
        backoff = 2_000;
        for (const update of updates) {
          this.#offset = Math.max(this.#offset, update.update_id + 1);
          await this.#handleUpdate(update).catch((error) =>
            this.#log("warn", "Telegram message not handled", error),
          );
        }
      } catch (error) {
        if (!this.#running) return;
        const message = error instanceof Error ? error.message : String(error);
        if (/401|Unauthorized/i.test(message)) {
          // A revoked token never starts working again; stop instead of hammering Telegram.
          this.#error = "Telegram rejected the bot token. Paste a new one from @BotFather.";
          this.#running = false;
          this.#unsubscribe?.();
          this.#unsubscribe = null;
          this.#changed();
          return;
        }
        if (this.#error !== message) {
          this.#error = message;
          this.#changed();
        }
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /**
   * A button is the same as typing the command: the same owner check, the same decision call. It
   * only ever answers the paired chat, and always answers, or Telegram shows a spinner for ever.
   */
  async #handleButton(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query;
    const state = this.#state;
    if (!query || !state) return;
    const chatId = query.message?.chat.id;
    const button = query.data?.match(/^(approve|reject|details):([0-9a-f-]{8,36})$/);
    const answer = (text?: string) =>
      this.#call(state.token, "answerCallbackQuery", {
        callback_query_id: query.id,
        ...(text ? { text } : {}),
      }).catch(() => {});
    if (chatId == null || chatId !== state.chatId || !button) {
      await answer();
      return;
    }
    this.#adoptPrivateChatOwner(query.message?.chat.type, chatId, query.from?.id);
    await answer("Working on it...");
    await this.#handleApprovalCommand(
      chatId,
      query.from,
      button[1] as string,
      button[2] as string,
      update.update_id,
    );
  }

  /**
   * Older versions stored only the chat. They paired private chats alone, where Telegram's chat
   * id is the user's id, so the owner is known without pairing again. A group never qualifies.
   */
  #adoptPrivateChatOwner(chatType: string | undefined, chatId: number, fromId?: number): void {
    const state = this.#state;
    if (!state || state.ownerUserId != null || this.#envOwnerUserId != null) return;
    if (chatType !== "private" || fromId !== chatId || chatId !== state.chatId) return;
    state.ownerUserId = fromId;
    void this.#save();
    this.#changed();
  }

  async #handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.#handleButton(update);
      return;
    }
    const message = update.message;
    const state = this.#state;
    if (!message || !state || typeof message.text !== "string") return;
    const chat = message.chat;
    const from = message.from;
    const text = message.text.trim();
    if (state.chatId == null) {
      // Only a private chat that sends the code shown in Settings can pair.
      if (chat.type !== "private") return;
      const code = text.match(/^\/start(?:@\w+)?\s+(\d{6})$/)?.[1];
      if (code !== state.pairingCode) {
        await this.#send(
          chat.id,
          "This Sahkarmi is not paired yet. In Sahkarmi, open Settings > Telegram and send the /start code shown there.",
        );
        return;
      }
      // A pinned OWNER_TELEGRAM_ID outranks the code: knowing the code is not enough.
      if (this.#envOwnerUserId != null && from?.id !== this.#envOwnerUserId) {
        this.#log("warn", "Telegram pairing refused: not the configured owner id");
        await this.#send(chat.id, "This Sahkarmi is set up for a different Telegram account.");
        return;
      }
      if (from?.is_bot) return;
      state.chatId = chat.id;
      state.chatName = chat.first_name ?? chat.username ?? chat.title ?? null;
      state.ownerUserId = typeof from?.id === "number" ? from.id : null;
      state.coworkerId = this.#coworker()?.id ?? null;
      await this.#save();
      this.#changed();
      const coworker = this.#coworker();
      await this.#send(
        chat.id,
        `Paired. ${coworker ? `You are talking to ${coworker.name}.` : "Add a coworker in Sahkarmi first."}\n\n${HELP}`,
      );
      return;
    }
    // Everyone else is ignored: answering would tell a stranger this bot is alive.
    if (chat.id !== state.chatId) return;

    if (/^\/(help|start)\b/.test(text)) {
      await this.#send(chat.id, HELP);
      return;
    }
    if (/^\/coworkers\b/.test(text)) {
      const current = this.#coworker();
      const lines = this.#agent
        .listBots()
        .map(
          (bot, index) =>
            `${index + 1}. ${bot.name}${bot.role ? ` - ${bot.role}` : ""}${bot.id === current?.id ? " (current)" : ""}`,
        );
      await this.#send(chat.id, lines.length ? lines.join("\n") : "You have no coworkers yet.");
      return;
    }
    const use = text.match(/^\/use(?:@\w+)?\s+(.+)$/)?.[1]?.trim();
    if (use) {
      const bots = this.#agent.listBots();
      const number = Number.parseInt(use, 10);
      const bot =
        (String(number) === use ? bots[number - 1] : undefined) ??
        bots.find((item) => item.name.toLowerCase() === use.toLowerCase()) ??
        bots.find((item) => item.name.toLowerCase().includes(use.toLowerCase()));
      if (!bot) {
        await this.#send(chat.id, `No coworker called "${use}". Send /coworkers to see them.`);
        return;
      }
      state.coworkerId = bot.id;
      await this.#save();
      this.#changed();
      await this.#send(chat.id, `Now talking to ${bot.name}.`);
      return;
    }
    if (/^\/ceo\b/.test(text)) {
      const ceos = this.#agent.ceos?.() ?? [];
      const ceo = ceos[0];
      if (!ceo) {
        await this.#send(chat.id, "No workspace has a CEO yet. Choose one in Sahkarmi.");
      } else if (ceos.length > 1) {
        await this.#send(
          chat.id,
          `Which one? ${ceos.map((item) => `/use ${item.name}`).join(" · ")}`,
        );
      } else {
        state.coworkerId = ceo.id;
        await this.#save();
        this.#changed();
        await this.#send(chat.id, `Now talking to ${ceo.name}, your CEO.`);
      }
      return;
    }
    const approvalCommand = text.match(
      /^\/(pending|details|approve|reject|status|cancel|policy)(?:@\w+)?(?:\s+(.*))?$/i,
    );
    if (approvalCommand) {
      this.#adoptPrivateChatOwner(chat.type, chat.id, from?.id);
      await this.#handleApprovalCommand(
        chat.id,
        from,
        (approvalCommand[1] as string).toLowerCase(),
        approvalCommand[2]?.trim() ?? "",
        update.update_id,
      );
      return;
    }
    if (text.startsWith("/")) {
      await this.#send(chat.id, HELP);
      return;
    }
    const coworker = this.#coworker();
    if (!coworker) {
      await this.#send(
        chat.id,
        state.coworkerId
          ? "The coworker you were talking to is gone. Send /coworkers and pick another with /use."
          : "Add a coworker in Sahkarmi first.",
      );
      return;
    }
    // Stay with this coworker: new coworkers join the top of the list, and the chat must not
    // drift to one of them.
    if (!state.coworkerId) {
      state.coworkerId = coworker.id;
      await this.#save();
    }
    this.#following.set(coworker.id, Date.now() + PENDING_TTL_MS);
    const receipt = await this.#agent.sendMessage({ botId: coworker.id, text });
    const deliveryId = receipt.deliveries[0]?.id;
    if (deliveryId) this.#pending.push({ botId: coworker.id, deliveryId, createdAt: Date.now() });
    this.#showTyping();
  }

  /**
   * The approval commands. Every one of them re-checks the numeric user id: the paired chat id
   * alone is not proof, because a chat can be a group and a group can gain members.
   *
   * Decisions go through the agent's own `decideApproval`, the same call the desktop UI makes,
   * so the permission policy, the expiry check, the duplicate-decision guard and the audit log
   * are all the existing ones. Nothing here can approve something the policy never asked about,
   * and there is deliberately no command that changes policy.
   */
  async #handleApprovalCommand(
    chatId: number,
    from: { id: number; username?: string; is_bot?: boolean } | undefined,
    command: string,
    argument: string,
    updateId: number,
  ): Promise<void> {
    const ownerId = this.#ownerUserId();
    if (ownerId == null) {
      await this.#send(
        chatId,
        "I cannot confirm who you are in this chat. In Sahkarmi open Settings > Telegram, choose Unpair, then pair again from your own private chat with the bot. Approvals from Telegram stay off until then.",
      );
      return;
    }
    if (from?.id !== ownerId || from.is_bot === true) {
      // Never say what was wrong, and never list anything: silence is the safe answer.
      this.#log("warn", "Telegram approval command refused: wrong user id");
      await this.#send(chatId, "Not allowed.");
      return;
    }
    if (!this.#agent.listApprovals || !this.#agent.decideApproval) {
      await this.#send(chatId, "Approvals are not available in this build.");
      return;
    }

    if (command === "policy") {
      await this.#send(chatId, this.#describePolicy());
      return;
    }
    await this.#agent.sweepExpiredApprovals?.().catch(() => []);
    if (command === "pending") {
      await this.#send(chatId, this.#describePending());
      return;
    }

    if (!argument) {
      await this.#send(chatId, `Which request? Use /${command} <id>, or /pending to see them.`);
      return;
    }
    const wanted = argument.split(/\s+/)[0]?.toLowerCase().replaceAll("-", "") ?? "";
    const all = this.#agent.listApprovals();
    const matches = all.filter((approval) => matchesHandle(approval, wanted));
    if (matches.length === 0) {
      await this.#send(chatId, `No request matches "${argument}". Send /pending to see them.`);
      return;
    }
    if (matches.length > 1) {
      // Approving the wrong request is exactly the mistake worth refusing to make.
      await this.#send(
        chatId,
        `"${argument}" matches ${matches.length} requests. Send a longer id:\n${matches
          .map((approval) => `${handleOf(approval)} - ${approval.title}`)
          .join("\n")}`,
      );
      return;
    }
    const approval = matches[0] as ApprovalRequest;

    if (command === "details") {
      await this.#send(chatId, this.#describeApproval(approval));
      return;
    }
    if (command === "status") {
      await this.#send(chatId, this.#describeStatus(approval));
      return;
    }

    if (!this.#approvalsEnabled) {
      await this.#send(
        chatId,
        "Remote approvals are switched off for this Sahkarmi. Decide it on your computer.",
      );
      return;
    }
    // A retried command (Telegram redelivers on a network hiccup) must not decide twice.
    const fingerprint = `${command}:${approval.id}`;
    if (this.#handledCommands.has(fingerprint)) {
      await this.#send(
        chatId,
        `Already handled ${handleOf(approval)}. Send /status ${handleOf(approval)} to see the outcome.`,
      );
      return;
    }
    if (approval.status !== "pending") {
      await this.#send(
        chatId,
        `${handleOf(approval)} is already ${approval.status}; nothing to decide.${
          approval.decidedBy ? ` Decided by ${approval.decidedBy}.` : ""
        }`,
      );
      return;
    }
    this.#handledCommands.add(fingerprint);
    void updateId;
    const decision = command === "approve" ? "approved" : "rejected";
    const note =
      command === "cancel"
        ? "Cancelled by the owner from Telegram."
        : command === "reject"
          ? "Rejected by the owner from Telegram."
          : "Approved by the owner from Telegram.";
    try {
      // What it does next, the owner should hear about here too.
      this.#following.set(approval.botId, Date.now() + PENDING_TTL_MS);
      const decided = await this.#agent.decideApproval({
        approvalId: approval.id,
        decision,
        note,
        decidedBy: `telegram:${ownerId}`,
      });
      await this.#send(
        chatId,
        `${decided.status === "approved" ? "Approved" : "Refused"}: ${decided.title} (${handleOf(decided)}).\n${
          decided.status === "approved"
            ? "The coworker has been told to go ahead."
            : "The coworker has been told not to do it."
        }`,
      );
    } catch (error) {
      // The store refuses expired and already-decided requests; say so plainly and let the
      // owner try again rather than leaving them guessing.
      this.#handledCommands.delete(fingerprint);
      const message = error instanceof Error ? error.message : String(error);
      this.#log("warn", "Telegram approval decision failed", error);
      await this.#send(chatId, `Could not record that: ${message}`);
    }
  }

  #describePending(): string {
    const approvals = (this.#agent.listApprovals?.() ?? []).filter(
      (approval) => approval.status === "pending",
    );
    if (approvals.length === 0) return "Nothing is waiting for you.";
    const names = new Map(this.#agent.listBots().map((bot) => [bot.id, bot.name]));
    const lines = approvals.slice(0, 20).map((approval) => {
      const who = names.get(approval.botId) ?? "A coworker";
      const risk = RISK_LABEL[approval.riskLevel ?? "medium"] ?? "medium";
      return [
        `${handleOf(approval)} - ${approval.title}`,
        `  ${who}${approval.workspaceId ? ` · ${this.#workspaceLabel(approval.workspaceId)}` : ""}`,
        `  risk ${risk}${approval.amount ? ` · ${approval.amount}` : ""} · ${ageOf(approval.createdAt)} · ${expiryOf(approval)}`,
      ].join("\n");
    });
    const more =
      approvals.length > 20 ? `\n\n…and ${approvals.length - 20} more. Decide some first.` : "";
    return `${approvals.length} waiting:\n\n${lines.join("\n\n")}${more}\n\n/details <id> · /approve <id> · /reject <id>`;
  }

  #describeApproval(approval: ApprovalRequest): string {
    const who = this.#agent.listBots().find((bot) => bot.id === approval.botId);
    const consequence = approval.permissionCategory
      ? CONSEQUENCE[approval.permissionCategory]
      : undefined;
    return [
      `Request ${handleOf(approval)}`,
      `Status: ${approval.status}`,
      `Coworker: ${who?.name ?? approval.botId}${who?.role ? ` (${who.role})` : ""}`,
      approval.workspaceId ? `Workspace: ${this.#workspaceLabel(approval.workspaceId)}` : null,
      approval.taskId ? `Task: ${approval.taskId}` : null,
      "",
      `Action: ${approval.title}`,
      approval.details ? approval.details : null,
      approval.amount ? `Amount: ${approval.amount}` : null,
      `Risk: ${RISK_LABEL[approval.riskLevel ?? "medium"] ?? "medium"}`,
      consequence ? `Consequence: ${consequence}` : null,
      approval.technical ? `\nTechnical: ${approval.technical}` : null,
      "",
      `Asked ${ageOf(approval.createdAt)} · ${expiryOf(approval)}`,
      approval.status === "pending"
        ? `/approve ${handleOf(approval)} · /reject ${handleOf(approval)}`
        : null,
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  #describeStatus(approval: ApprovalRequest): string {
    return [
      `Request ${handleOf(approval)} - ${approval.title}`,
      `Status: ${approval.status}`,
      approval.decidedAt ? `Decided: ${approval.decidedAt}` : `Asked: ${approval.createdAt}`,
      approval.decidedBy ? `By: ${approval.decidedBy}` : null,
      approval.note ? `Note: ${approval.note}` : null,
      approval.status === "pending" ? expiryOf(approval) : null,
      approval.deliveryError ? `Telegram delivery failed: ${approval.deliveryError}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  #describePolicy(): string {
    const policy = this.#agent.permissionPolicy?.();
    if (!policy) return "No permission policy is configured.";
    const levels = Object.entries(policy.levels)
      .map(([category, level]) => `  ${category}: ${level}`)
      .join("\n");
    const grants = policy.grants.length
      ? policy.grants
          .map(
            (grant) =>
              `  ${grant.category}${grant.botId ? ` (${grant.botId})` : " (any coworker)"} until ${grant.expiresAt}${
                grant.usesLeft === null ? "" : `, ${grant.usesLeft} use(s) left`
              }`,
          )
          .join("\n")
      : "  none";
    return [
      `Auto mode: ${policy.autoMode ? "on" : "off"} (never applies to sensitive actions)`,
      "",
      "Permission levels:",
      levels,
      "",
      "Pre-authorisations:",
      grants,
      "",
      "Read-only here. Change these in Sahkarmi on your computer.",
    ].join("\n");
  }

  #workspaceLabel(workspaceId: string): string {
    return this.#agent.workspaceName?.(workspaceId) ?? workspaceId;
  }

  /**
   * Telegram shows "typing..." for only 5 seconds, so it is sent again until every reply is
   * back: the owner can see the coworker is still working on a long task.
   */
  #showTyping(): void {
    const tick = () => {
      const state = this.#state;
      if (!state || state.chatId == null || this.#pending.length === 0) {
        if (this.#typingTimer) clearInterval(this.#typingTimer);
        this.#typingTimer = null;
        return;
      }
      void this.#call(state.token, "sendChatAction", {
        chat_id: state.chatId,
        action: "typing",
      }).catch(() => {});
    };
    tick();
    if (!this.#typingTimer && this.#pending.length > 0) {
      this.#typingTimer = setInterval(tick, TYPING_REPEAT_MS);
    }
  }

  async #onAgentEvent(event: AgentEvent): Promise<void> {
    try {
      if (event.type === "turn-completed") await this.#deliverReplies(event.botId, event.turnId);
      if (event.type === "approvals-changed") {
        await this.#notifyApprovals(event.approvals);
        await this.#closeDecidedApprovals(event.approvals);
      }
    } catch (error) {
      this.#log("warn", "Telegram reply not sent", error);
    }
  }

  async #deliverReplies(botId: string, turnId: string): Promise<void> {
    const chatId = this.#state?.chatId;
    if (chatId == null) return;
    const now = Date.now();
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      if (now - (this.#pending[index]?.createdAt ?? now) > PENDING_TTL_MS) {
        this.#pending.splice(index, 1);
      }
    }
    const waiting = this.#pending.filter((item) => item.botId === botId);
    if (waiting.length === 0) {
      await this.#deliverFollowUp(chatId, botId, turnId);
      return;
    }
    const snapshot = await this.#agent.readConversation(botId);
    for (const item of waiting) {
      const at = snapshot.messages.findIndex((message) => message.id === item.deliveryId);
      const asked = snapshot.messages[at];
      if (!asked || !TERMINAL.has(asked.delivery?.status ?? "")) continue;
      const replies = snapshot.messages
        .slice(at + 1)
        .filter(
          (message) =>
            message.author === "assistant" &&
            message.turnId === turnId &&
            message.itemType !== "commentary" &&
            message.itemType !== "toolCall" &&
            !message.tool &&
            message.text.trim(),
        );
      const pendingIndex = this.#pending.indexOf(item);
      if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1);
      const status = asked.delivery?.status;
      const text =
        replies.map((message) => message.text.trim()).join("\n\n") ||
        (status === "completed"
          ? "Done (no written reply). Open Sahkarmi to see what changed."
          : `The coworker could not finish (${status}). Open Sahkarmi to see why.`);
      for (const chunk of telegramChunks(text)) await this.#send(chatId, chunk);
    }
  }

  /**
   * A later turn the owner did not ask for here: a CEO's consolidated report once its employees
   * reply, or a coworker going ahead after an approval. It would otherwise stay in the app.
   */
  async #deliverFollowUp(chatId: number, botId: string, turnId: string): Promise<void> {
    const until = this.#following.get(botId);
    if (until === undefined) return;
    if (until < Date.now()) {
      this.#following.delete(botId);
      return;
    }
    const snapshot = await this.#agent.readConversation(botId);
    const replies = snapshot.messages
      .filter(
        (message) =>
          message.author === "assistant" &&
          message.turnId === turnId &&
          message.itemType !== "commentary" &&
          message.itemType !== "toolCall" &&
          !message.tool &&
          message.text.trim(),
      )
      .map((message) => message.text.trim());
    if (replies.length === 0) return;
    const name = this.#agent.listBots().find((bot) => bot.id === botId)?.name ?? "Your coworker";
    for (const chunk of telegramChunks(`${name}: ${replies.join("\n\n")}`)) {
      await this.#send(chatId, chunk);
    }
  }

  /** Once a request is decided, on the desktop or here, its buttons give way to the outcome. */
  async #closeDecidedApprovals(approvals: ApprovalRequest[]): Promise<void> {
    const state = this.#state;
    if (!state || state.chatId == null) return;
    const names = new Map(this.#agent.listBots().map((bot) => [bot.id, bot.name]));
    for (const approval of approvals) {
      const messageId = this.#approvalMessages.get(approval.id);
      if (messageId === undefined || approval.status === "pending") continue;
      this.#approvalMessages.delete(approval.id);
      const by = approval.decidedBy?.startsWith("coworker:")
        ? ` by ${names.get(approval.decidedBy.slice("coworker:".length)) ?? "a coworker"}`
        : approval.decidedBy === "desktop"
          ? " on your computer"
          : "";
      await this.#call(state.token, "editMessageText", {
        chat_id: state.chatId,
        message_id: messageId,
        text: `${approval.title}\n\nOutcome: ${approval.status}${by}.`,
      }).catch((error) => this.#log("warn", "Telegram approval message not updated", error));
    }
  }

  async #notifyApprovals(approvals: ApprovalRequest[]): Promise<void> {
    const chatId = this.#state?.chatId;
    if (chatId == null) return;
    const names = new Map(this.#agent.listBots().map((bot) => [bot.id, bot.name]));
    const canDecide = this.#approvalsEnabled && typeof this.#agent.decideApproval === "function";
    for (const approval of approvals) {
      if (approval.status !== "pending" || approval.createdAt < this.#startedAt) continue;
      if (this.#notifiedApprovals.has(approval.id)) continue;
      this.#notifiedApprovals.add(approval.id);
      const who = names.get(approval.botId) ?? "A coworker";
      const consequence = approval.permissionCategory
        ? CONSEQUENCE[approval.permissionCategory]
        : undefined;
      const text = [
        `${who} needs your approval.`,
        approval.workspaceId ? `Workspace: ${this.#workspaceLabel(approval.workspaceId)}` : null,
        "",
        `Action: ${approval.title}`,
        approval.details ? approval.details : null,
        approval.amount ? `Amount: ${approval.amount}` : null,
        `Risk: ${RISK_LABEL[approval.riskLevel ?? "medium"] ?? "medium"}`,
        consequence ? `Consequence: ${consequence}` : null,
        `Deadline: ${expiryOf(approval)}`,
        "",
        approval.routedToBotId
          ? `${names.get(approval.routedToBotId) ?? "A coworker"} holds your authority for this and has been told. You can still decide.`
          : null,
        `Request ${handleOf(approval)}`,
        canDecide
          ? `/approve ${handleOf(approval)} · /reject ${handleOf(approval)} · /details ${handleOf(approval)}`
          : "Open Sahkarmi to allow or deny it.",
      ]
        .filter((line) => line !== null)
        .join("\n");
      // Delivery is recorded either way. A notification that never arrived is a diagnostic,
      // never a decision: the request stays pending until someone actually answers.
      try {
        const chunks = telegramChunks(text);
        const last = chunks.pop() ?? "";
        for (const chunk of chunks) await this.#send(chatId, chunk);
        const sent = await this.#call<{ message_id?: number }>(
          this.#state?.token ?? "",
          "sendMessage",
          {
            chat_id: chatId,
            text: last,
            ...(canDecide
              ? {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "Approve", callback_data: `approve:${approval.id}` },
                        { text: "Reject", callback_data: `reject:${approval.id}` },
                      ],
                      [{ text: "Details", callback_data: `details:${approval.id}` }],
                    ],
                  },
                }
              : {}),
          },
        );
        if (typeof sent?.message_id === "number") {
          this.#approvalMessages.set(approval.id, sent.message_id);
        }
        await this.#agent.recordApprovalDelivery?.(approval.id, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#log("warn", "Telegram approval notification not delivered", error);
        // Reopen the retry window first. Recording is awaited, and a retry that arrives in
        // between must not be dropped: the owner must never silently lose the request.
        this.#notifiedApprovals.delete(approval.id);
        await this.#agent.recordApprovalDelivery?.(approval.id, message).catch(() => {});
      }
    }
  }

  #coworker(): { id: string; name: string } | null {
    const bots = this.#agent.listBots();
    const chosen = this.#state?.coworkerId;
    // A coworker that is gone is never silently swapped for another one.
    return chosen ? (bots.find((bot) => bot.id === chosen) ?? null) : (bots[0] ?? null);
  }

  async #send(chatId: number, text: string): Promise<void> {
    if (!this.#state) return;
    await this.#call(this.#state.token, "sendMessage", { chat_id: chatId, text });
  }

  async #call<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.#fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (!response.ok || !data?.ok) {
      throw new Error(
        `Telegram ${method} failed (${response.status}): ${data?.description ?? "no reply"}`,
      );
    }
    return data.result as T;
  }

  async #save(): Promise<void> {
    // The token gives full control of the bot, so the file is readable by the owner only.
    await writeFile(this.#path, JSON.stringify(this.#state ?? {}), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  #changed(): TelegramStatus {
    const status = this.status();
    this.#onStatus?.(status);
    return status;
  }
}
