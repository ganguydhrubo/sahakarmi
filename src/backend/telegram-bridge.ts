import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentEvent,
  ApprovalRequest,
  ConversationSnapshot,
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
const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled"]);

interface StoredTelegram {
  token: string;
  botUsername: string | null;
  pairingCode: string;
  chatId: number | null;
  chatName: string | null;
  coworkerId: string | null;
}

export interface TelegramAgent {
  listBots(): Array<{ id: string; name: string; role: string }>;
  sendMessage(input: {
    botId: string;
    text: string;
  }): Promise<{ deliveries: Array<{ id: string }> }>;
  readConversation(botId: string): Promise<ConversationSnapshot>;
  /** Calls the listener for every agent event; returns a function that stops it. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

export interface TelegramBridgeOptions {
  userDataPath: string;
  agent: TelegramAgent;
  fetch?: typeof fetch;
  log?: (level: "info" | "warn" | "error", message: string, detail?: unknown) => void;
  onStatus?: (status: TelegramStatus) => void;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string; first_name?: string; title?: string; username?: string };
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
  "/help - show this help",
  "Sahkarmi must be open on your computer to answer.",
].join("\n");

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
  readonly #notifiedApprovals = new Set<string>();
  /** Approvals asked before the bridge started were already there for the owner to see. */
  #startedAt = new Date().toISOString();

  constructor(options: TelegramBridgeOptions) {
    this.#path = join(options.userDataPath, STATE_FILE);
    this.#agent = options.agent;
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.log ?? (() => {});
    this.#onStatus = options.onStatus;
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
        };
      }
    } catch {
      // Not set up yet.
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
    };
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
  }

  async #stop(): Promise<void> {
    this.#running = false;
    this.#abort?.abort();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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
          { offset: this.#offset, timeout: POLL_SECONDS, allowed_updates: ["message"] },
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

  async #handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const state = this.#state;
    if (!message || !state || typeof message.text !== "string") return;
    const chat = message.chat;
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
      state.chatId = chat.id;
      state.chatName = chat.first_name ?? chat.username ?? chat.title ?? null;
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
    if (text.startsWith("/")) {
      await this.#send(chat.id, HELP);
      return;
    }
    const coworker = this.#coworker();
    if (!coworker) {
      await this.#send(chat.id, "Add a coworker in Sahkarmi first.");
      return;
    }
    const receipt = await this.#agent.sendMessage({ botId: coworker.id, text });
    const deliveryId = receipt.deliveries[0]?.id;
    if (deliveryId) this.#pending.push({ botId: coworker.id, deliveryId, createdAt: Date.now() });
    await this.#call(state.token, "sendChatAction", { chat_id: chat.id, action: "typing" }).catch(
      () => {},
    );
  }

  async #onAgentEvent(event: AgentEvent): Promise<void> {
    try {
      if (event.type === "turn-completed") await this.#deliverReplies(event.botId, event.turnId);
      if (event.type === "approvals-changed") await this.#notifyApprovals(event.approvals);
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
    if (waiting.length === 0) return;
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

  async #notifyApprovals(approvals: ApprovalRequest[]): Promise<void> {
    const chatId = this.#state?.chatId;
    if (chatId == null) return;
    const names = new Map(this.#agent.listBots().map((bot) => [bot.id, bot.name]));
    for (const approval of approvals) {
      if (approval.status !== "pending" || approval.createdAt < this.#startedAt) continue;
      if (this.#notifiedApprovals.has(approval.id)) continue;
      this.#notifiedApprovals.add(approval.id);
      const who = names.get(approval.botId) ?? "A coworker";
      await this.#send(
        chatId,
        `${who} needs your approval: ${approval.title}${approval.amount ? ` (${approval.amount})` : ""}. Open Sahkarmi to allow or deny it.`,
      );
    }
  }

  #coworker(): { id: string; name: string } | null {
    const bots = this.#agent.listBots();
    return bots.find((bot) => bot.id === this.#state?.coworkerId) ?? bots[0] ?? null;
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
