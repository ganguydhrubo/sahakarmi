import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentEvent,
  ConversationMessage,
  ConversationSnapshot,
  DecideApprovalInput,
  SecureInputRequest,
} from "../shared/ipc";
import { ApprovalStore } from "./approval-store";
import { SecretCodec } from "./secret-store";
import {
  PAIRING_COOLDOWN_MS,
  PAIRING_MAX_ATTEMPTS,
  type TelegramAgent,
  TelegramBridge,
  telegramChunks,
} from "./telegram-bridge";

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz0123456";
const OWNER = { id: 42, type: "private", first_name: "Dhrubo" };
const STRANGER = { id: 99, type: "private", first_name: "Someone" };

function fakeTelegram(options: { failSend?: () => boolean } = {}) {
  const inbox: Array<{
    update_id: number;
    message: {
      message_id: number;
      reply_to_message?: { message_id: number };
      text: string;
      chat: typeof OWNER;
      from?: { id: number; is_bot?: boolean };
    };
  }> = [];
  const deleted: number[] = [];
  let nextOwnMessage = 9000;
  const sent: Array<{ chat_id: number; text: string; reply_markup?: unknown }> = [];
  const edits: Array<{ message_id: number; text: string }> = [];
  const answered: string[] = [];
  let nextMessage = 500;
  let nextId = 1;
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(String(init.body ?? "{}"));
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    if (method === "getMe") return reply({ username: "sahkarmi_test_bot" });
    if (method === "sendMessage") {
      if (options.failSend?.()) {
        return new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
          status: 400,
        });
      }
      sent.push({ chat_id: body.chat_id, text: body.text, reply_markup: body.reply_markup });
      nextMessage += 1;
      return reply({ message_id: nextMessage });
    }
    if (method === "sendChatAction") return reply(true);
    if (method === "deleteMessage") {
      deleted.push(body.message_id);
      return reply(true);
    }
    if (method === "answerCallbackQuery") {
      answered.push(body.callback_query_id);
      return reply(true);
    }
    if (method === "editMessageText") {
      edits.push({ message_id: body.message_id, text: body.text });
      return reply({});
    }
    if (method === "getUpdates") {
      const ready = inbox.filter((update) => update.update_id >= body.offset);
      if (ready.length) return reply(ready);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 20);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return reply([]);
    }
    return new Response(JSON.stringify({ ok: false, description: "unknown" }), { status: 404 });
  }) as unknown as typeof fetch;
  return {
    fetcher,
    sent,
    edits,
    answered,
    deleted,
    /** A tap on an inline button. */
    tap(chat: typeof OWNER, data: string, as?: { id: number }) {
      const id = nextId++;
      inbox.push({
        update_id: id,
        callback_query: {
          id: `tap-${id}`,
          from: as ?? { id: chat.id },
          data,
          message: { message_id: 1, chat },
        },
      } as never);
    },
    /** A real Telegram message always names its sender; `as` spoofs a different one. */
    say(
      chat: typeof OWNER,
      text: string,
      as?: { id: number; is_bot?: boolean },
      replyTo?: number,
    ): number {
      const messageId = nextOwnMessage++;
      inbox.push({
        update_id: nextId++,
        message: {
          message_id: messageId,
          ...(replyTo === undefined ? {} : { reply_to_message: { message_id: replyTo } }),
          text,
          chat,
          from: as ?? { id: chat.id },
        },
      });
      return messageId;
    },
  };
}

/**
 * The approval half of the fake agent is backed by the real ApprovalStore and mirrors what
 * AgentService.decideApproval does, so these tests exercise the actual rules (expiry, the
 * duplicate-decision guard) rather than a mock that agrees with the bridge.
 */
function approvalHarness(store: ApprovalStore) {
  const told: Array<{ botId: string; text: string }> = [];
  const released: Array<{ id: string; outcome: string }> = [];
  const waiters = new Set<string>();
  return {
    told,
    released,
    waiters,
    methods: {
      listApprovals: () => store.list(),
      decideApproval: async (input: DecideApprovalInput) => {
        const approval = await store.decide(input);
        if (approval.kind === "permission") {
          if (waiters.delete(approval.id)) {
            released.push({ id: approval.id, outcome: approval.status });
          }
          return approval;
        }
        told.push({
          botId: approval.botId,
          text: `[Approval ${approval.status === "approved" ? "APPROVED" : "REJECTED"}] "${approval.title}"`,
        });
        return approval;
      },
      permissionPolicy: () => ({
        levels: { payments: "ask" } as never,
        grants: [],
        autoMode: false,
      }),
      sweepExpiredApprovals: () => store.sweepExpired(),
      recordApprovalDelivery: (approvalId: string, error: string | null) =>
        store.recordDelivery(approvalId, error),
      workspaceName: (id: string) => (id === "my-business" ? "My Business" : null),
    } satisfies Partial<TelegramAgent>,
  };
}

function fakeAgent(extra: Partial<TelegramAgent> = {}) {
  const listeners = new Set<(event: AgentEvent) => void>();
  const messages: ConversationMessage[] = [];
  const asked: Array<{ botId: string; text: string }> = [];
  let delivery = 0;
  const agent: TelegramAgent = {
    listBots: () => [
      { id: "bot-a", name: "Asha", role: "Sales", workspaceId: "my-business" },
      { id: "bot-b", name: "1xl reporting", role: "Reports", workspaceId: "my-business" },
    ],
    sendMessage: async (input) => {
      asked.push(input);
      const id = `delivery-${++delivery}`;
      messages.push({
        id,
        author: "user",
        text: input.text,
        createdAt: new Date().toISOString(),
        status: "completed",
        delivery: { id, status: "queued", position: 1 },
      });
      return { deliveries: [{ id }] };
    },
    readConversation: async (botId): Promise<ConversationSnapshot> => ({
      botId,
      threadId: "thread",
      activeTurnId: null,
      revision: 1,
      messages,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...extra,
  };
  return {
    agent,
    asked,
    /** The coworker answers the latest message in one turn. */
    finishTurn(botId: string, turnId: string, replies: string[]) {
      const asking = messages.findLast((message) => message.author === "user");
      if (asking?.delivery) asking.delivery.status = "completed";
      messages.push({
        id: `${turnId}-note`,
        turnId,
        author: "assistant",
        itemType: "commentary",
        text: "Thinking about it",
        createdAt: new Date().toISOString(),
        status: "completed",
      });
      for (const [index, text] of replies.entries()) {
        messages.push({
          id: `${turnId}-${index}`,
          turnId,
          author: "assistant",
          itemType: "agentMessage",
          text,
          createdAt: new Date().toISOString(),
          status: "completed",
        });
      }
      for (const listener of listeners) {
        listener({
          type: "turn-completed",
          botId,
          threadId: "thread",
          turnId,
          status: "completed",
        });
      }
    },
    emit(event: AgentEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}

async function until(check: () => boolean): Promise<void> {
  // Generous: the whole suite runs these in parallel, and a long-poll round trip plus a
  // persisted write is slow on a loaded machine.
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const bridges: TelegramBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.map((bridge) => bridge.stop()));
  bridges.length = 0;
});

async function connected(
  options: {
    approvals?: boolean;
    ownerUserId?: number;
    failSend?: () => boolean;
    agent?: Partial<TelegramAgent>;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "sahkarmi-telegram-"));
  const telegram = fakeTelegram({ failSend: options.failSend });
  const store = new ApprovalStore(dir);
  await store.initialize();
  const harness = approvalHarness(store);
  const coworkers = fakeAgent({
    ...(options.approvals === false ? {} : harness.methods),
    ...options.agent,
  });
  const bridge = new TelegramBridge({
    userDataPath: dir,
    agent: coworkers.agent,
    fetch: telegram.fetcher,
    envOwnerUserId: options.ownerUserId ?? null,
  });
  bridges.push(bridge);
  const status = await bridge.setToken(TOKEN);
  return { dir, telegram, coworkers, bridge, status, store, harness };
}

/** Pairs the owner's chat and returns once the bridge confirms it. */
async function paired(options: Parameters<typeof connected>[0] = {}) {
  const context = await connected(options);
  context.telegram.say(OWNER, `/start ${context.status.pairingCode}`);
  await until(() => context.telegram.sent.some((item) => item.text.startsWith("Paired.")));
  return context;
}

/** The newest message the bridge sent, once it has sent one more than `before`. */
async function nextReply(
  telegram: { sent: Array<{ text: string }> },
  before: number,
): Promise<string> {
  await until(() => telegram.sent.length > before);
  return telegram.sent.at(-1)?.text ?? "";
}

async function pendingApproval(
  store: ApprovalStore,
  overrides: Parameters<ApprovalStore["create"]>[0] extends infer T ? Partial<T> : never = {},
) {
  return store.create({
    botId: "bot-a",
    title: "Pay the GST invoice",
    details: "Vendor: Acme. Invoice 42.",
    category: "payment",
    amount: "Rs. 18,000",
    kind: "permission",
    permissionCategory: "payments",
    workspaceId: "my-business",
    ...overrides,
  } as Parameters<ApprovalStore["create"]>[0]);
}

describe("TelegramBridge", () => {
  it("rejects text that is not a bot token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-telegram-"));
    const bridge = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent().agent,
      fetch: fakeTelegram().fetcher,
    });
    await expect(bridge.setToken("my password")).rejects.toThrow(/BotFather/);
  });

  it("pairs only the chat that sends the code, and keeps the token private", async () => {
    const { dir, telegram, bridge, status } = await connected();
    expect(status).toMatchObject({ configured: true, botUsername: "sahkarmi_test_bot" });
    expect(status.pairingCode).toMatch(/^\d{6}$/);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "telegram.json")).mode & 0o077).toBe(0);
    }

    telegram.say(STRANGER, "/start 000000");
    await until(() => telegram.sent.length === 1);
    expect(telegram.sent[0]?.text).toMatch(/not paired/);

    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
    expect(bridge.status()).toMatchObject({ chatName: "Dhrubo", pairingCode: null });
    expect(telegram.sent.at(-1)).toMatchObject({ chat_id: 42 });
    expect(telegram.sent.at(-1)?.text).toMatch(/Paired\. You are talking to Asha/);

    // After pairing, a stranger gets no answer at all.
    const before = telegram.sent.length;
    telegram.say(STRANGER, "hello?");
    telegram.say(OWNER, "/help");
    await until(() => telegram.sent.length === before + 1);
    expect(telegram.sent.at(-1)?.chat_id).toBe(42);
    expect(JSON.parse(readFileSync(join(dir, "telegram.json"), "utf8")).chatId).toBe(42);
  });

  it("keeps the bot token encrypted on disk and seals a token saved in plain text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-telegram-"));
    const codec = new SecretCodec({
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(`x${[...text].reverse().join("")}`),
      decryptString: (buffer) => [...buffer.toString().slice(1)].reverse().join(""),
    });
    // What 0.23.0 wrote.
    writeFileSync(
      join(dir, "telegram.json"),
      JSON.stringify({ token: TOKEN, botUsername: "sahkarmi_test_bot", pairingCode: "123456" }),
    );
    const telegram = fakeTelegram();
    const bridge = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent().agent,
      fetch: telegram.fetcher,
      codec,
    });
    bridges.push(bridge);
    await bridge.initialize();
    expect(bridge.status()).toMatchObject({ configured: true, pairingCode: "123456" });
    const stored = readFileSync(join(dir, "telegram.json"), "utf8");
    expect(stored).not.toContain(TOKEN);
    expect(JSON.parse(stored).token).toMatch(/^sahkarmi-sealed:v1:/);
    await bridge.stop();
    const reopened = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent().agent,
      fetch: telegram.fetcher,
      codec,
    });
    bridges.push(reopened);
    await reopened.initialize();
    expect(reopened.status()).toMatchObject({ configured: true, botUsername: "sahkarmi_test_bot" });
  });

  it("burns the pairing code after five wrong guesses and pauses pairing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-telegram-"));
    const telegram = fakeTelegram();
    let clock = 1_000_000;
    const bridge = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent().agent,
      fetch: telegram.fetcher,
      now: () => clock,
    });
    bridges.push(bridge);
    const status = await bridge.setToken(TOKEN);
    const original = status.pairingCode ?? "";
    const wrong = original === "111111" ? "222222" : "111111";
    for (let attempt = 1; attempt <= PAIRING_MAX_ATTEMPTS; attempt += 1) {
      telegram.say(STRANGER, `/start ${wrong}`);
      await until(() => telegram.sent.length === attempt);
    }
    const renewed = bridge.status().pairingCode;
    expect(renewed).toMatch(/^\d{6}$/);
    expect(renewed).not.toBe(original);
    // During the pause even the right (new) code does not pair.
    telegram.say(OWNER, `/start ${renewed}`);
    await until(() => telegram.sent.length === PAIRING_MAX_ATTEMPTS + 1);
    expect(telegram.sent.at(-1)?.text).toMatch(/Too many wrong codes/);
    expect(bridge.status().chatName).toBeNull();
    // The old code is burnt for good.
    clock += PAIRING_COOLDOWN_MS + 1;
    telegram.say(OWNER, `/start ${original}`);
    await until(() => telegram.sent.length === PAIRING_MAX_ATTEMPTS + 2);
    expect(telegram.sent.at(-1)?.text).toMatch(/not paired/);
    telegram.say(OWNER, `/start ${renewed}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
  });

  it("sends the owner's message to the coworker and only its finished reply back", async () => {
    const { telegram, coworkers, status } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));

    telegram.say(OWNER, "/use 1xl");
    await until(() => telegram.sent.at(-1)?.text === "Now talking to 1xl reporting.");
    telegram.say(OWNER, "Send me today's report status");
    await until(() => coworkers.asked.length === 1);
    expect(coworkers.asked[0]).toEqual({
      botId: "bot-b",
      text: "Send me today's report status",
      // Labels the approval card "from your phone"; nothing else changes.
      remote: true,
    });

    const before = telegram.sent.length;
    coworkers.finishTurn("bot-b", "turn-1", ["Draft saved for 26 Oct.", "3 of 4 people sent it."]);
    await until(() => telegram.sent.length === before + 1);
    expect(telegram.sent.at(-1)?.text).toBe("Draft saved for 26 Oct.\n\n3 of 4 people sent it.");
    expect(telegram.sent.at(-1)?.text).not.toContain("Thinking");
  });

  it("tells the owner about new approvals once", async () => {
    const { telegram, coworkers, status } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
    const before = telegram.sent.length;
    const approval = {
      id: "approval-1",
      botId: "bot-a",
      title: "Pay the GST invoice",
      details: "",
      category: "payment",
      amount: "Rs. 18,000",
      status: "pending",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      decidedAt: null,
      note: null,
    } as const;
    coworkers.emit({ type: "approvals-changed", approvals: [approval] as never });
    coworkers.emit({ type: "approvals-changed", approvals: [approval] as never });
    await until(() => telegram.sent.length === before + 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(telegram.sent.length).toBe(before + 1);
    const text = telegram.sent.at(-1)?.text ?? "";
    expect(text).toContain("Asha needs your approval.");
    expect(text).toContain("Action: Pay the GST invoice");
    expect(text).toContain("Amount: Rs. 18,000");
  });

  it("lists, details and decides an approval from Telegram, reaching the coworker", async () => {
    const { telegram, store, harness } = await paired();
    const approval = await pendingApproval(store, {
      kind: "action",
      permissionCategory: undefined,
    });

    let before = telegram.sent.length;
    telegram.say(OWNER, "/pending");
    const list = await nextReply(telegram, before);
    const handle = approval.id.replaceAll("-", "").slice(0, 8);
    expect(list).toContain(handle);
    expect(list).toContain("Pay the GST invoice");
    expect(list).toContain("My Business");
    expect(list).toContain("Rs. 18,000");

    before = telegram.sent.length;
    telegram.say(OWNER, `/details ${handle}`);
    const details = await nextReply(telegram, before);
    expect(details).toContain("Vendor: Acme");
    expect(details).toContain("Asha");

    before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`);
    const done = await nextReply(telegram, before);
    expect(done).toContain("Approved");
    // The decision went through the same call the desktop makes, and reached the coworker.
    expect(store.get(approval.id)).toMatchObject({
      status: "approved",
      decidedBy: "telegram:42",
    });
    expect(harness.told).toEqual([
      { botId: "bot-a", text: '[Approval APPROVED] "Pay the GST invoice"' },
    ]);
  });

  it("releases a parked tool call when the owner approves from Telegram", async () => {
    const { telegram, store, harness } = await paired();
    const approval = await pendingApproval(store);
    harness.waiters.add(approval.id);
    const handle = approval.id.replaceAll("-", "").slice(0, 8);

    const before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`);
    await nextReply(telegram, before);
    expect(harness.released).toEqual([{ id: approval.id, outcome: "approved" }]);
    // A parked tool call gets no chat message; it simply continues.
    expect(harness.told).toEqual([]);
  });

  it("rejects, and tells the coworker not to act", async () => {
    const { telegram, store, harness } = await paired();
    const approval = await pendingApproval(store, {
      kind: "action",
      permissionCategory: undefined,
    });
    const handle = approval.id.replaceAll("-", "").slice(0, 8);

    const before = telegram.sent.length;
    telegram.say(OWNER, `/reject ${handle}`);
    const reply = await nextReply(telegram, before);
    expect(reply).toContain("Refused");
    expect(store.get(approval.id)?.status).toBe("rejected");
    expect(harness.told[0]?.text).toContain("REJECTED");
  });

  it("refuses an approval command from anyone but the paired numeric user id", async () => {
    const { telegram, store, harness } = await paired();
    const approval = await pendingApproval(store);
    const handle = approval.id.replaceAll("-", "").slice(0, 8);

    // Same chat, different sender: a group member, or someone who got hold of the chat.
    const before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`, { id: 99 });
    const reply = await nextReply(telegram, before);
    expect(reply).toBe("Not allowed.");
    expect(store.get(approval.id)?.status).toBe("pending");
    expect(harness.released).toEqual([]);

    // A bot in the chat cannot decide either, even with the owner's id.
    const second = telegram.sent.length;
    telegram.say(OWNER, `/pending`, { id: 42, is_bot: true });
    expect(await nextReply(telegram, second)).toBe("Not allowed.");
  });

  it("approves and rejects from the buttons, updating the store and the message", async () => {
    const { telegram, status, store, coworkers } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));

    for (const [button, outcome] of [
      ["approve", "approved"],
      ["reject", "rejected"],
    ] as const) {
      const approval = await store.create({
        botId: "asha",
        title: `Request to ${button}`,
        details: "",
        category: "payment",
      });
      coworkers.emit({ type: "approvals-changed", approvals: store.list() } as never);
      await until(() =>
        telegram.sent.some(
          (item) => item.text.includes(`Request to ${button}`) && item.reply_markup,
        ),
      );
      const card = telegram.sent.find((item) => item.text.includes(`Request to ${button}`));
      expect(JSON.stringify(card?.reply_markup)).toContain(`${button}:${approval.id}`);

      const edited = telegram.edits.length;
      telegram.tap(OWNER, `${button}:${approval.id}`);
      await until(() => store.get(approval.id)?.status === outcome);
      expect(store.get(approval.id)?.decidedBy).toBe(`telegram:${OWNER.id}`);
      expect(telegram.answered.length).toBeGreaterThan(0);
      coworkers.emit({ type: "approvals-changed", approvals: store.list() } as never);
      await until(() => telegram.edits.length > edited);
      expect(telegram.edits.at(-1)?.text).toContain(`Outcome: ${outcome}`);
    }
  });

  it("ignores a button from anyone but the owner", async () => {
    const { telegram, status, store } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
    const approval = await pendingApproval(store);
    const before = telegram.sent.length;
    telegram.tap(OWNER, `approve:${approval.id}`, { id: STRANGER.id });
    expect(await nextReply(telegram, before)).toBe("Not allowed.");
    telegram.tap(STRANGER, `approve:${approval.id}`);
    await until(() => telegram.answered.length >= 2);
    expect(store.get(approval.id)?.status).toBe("pending");
  });

  it("shows on Telegram when a request is decided on the desktop", async () => {
    const { telegram, status, store, coworkers } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
    const approval = await store.create({
      botId: "asha",
      title: "Decided elsewhere",
      details: "",
      category: "data",
    });
    coworkers.emit({ type: "approvals-changed", approvals: store.list() } as never);
    await until(() => telegram.sent.some((item) => item.text.includes("Decided elsewhere")));
    await store.decide({ approvalId: approval.id, decision: "rejected", decidedBy: "desktop" });
    coworkers.emit({ type: "approvals-changed", approvals: store.list() } as never);
    await until(() => telegram.edits.length > 0);
    expect(telegram.edits[0]?.text).toContain("on your computer");
  });

  it("recognises the owner of a private chat paired before user ids were recorded", async () => {
    const { dir, telegram, bridge, status, store } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));
    await bridge.stop();
    // Simulate the old on-disk shape, which had no ownerUserId.
    const legacy = JSON.parse(readFileSync(join(dir, "telegram.json"), "utf8"));
    delete legacy.ownerUserId;
    writeFileSync(join(dir, "telegram.json"), JSON.stringify(legacy));

    const revived = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent(approvalHarness(store).methods).agent,
      fetch: telegram.fetcher,
    });
    bridges.push(revived);
    await revived.initialize();
    expect(revived.status().ownerIdVerified).toBe(false);
    const approval = await pendingApproval(store);
    // Someone else cannot use the upgrade: in a private chat the chat id is the user's id.
    const stranger = telegram.sent.length;
    telegram.say(OWNER, `/approve ${approval.id.replaceAll("-", "").slice(0, 8)}`, { id: 7 });
    expect(await nextReply(telegram, stranger)).toMatch(/pair again/i);
    expect(store.get(approval.id)?.status).toBe("pending");

    const before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${approval.id.replaceAll("-", "").slice(0, 8)}`);
    expect(await nextReply(telegram, before)).toMatch(/^Approved/);
    expect(store.get(approval.id)?.status).toBe("approved");
    expect(revived.status().ownerIdVerified).toBe(true);
  });

  it("refuses to pair anyone but the configured OWNER_TELEGRAM_ID", async () => {
    const { telegram, status } = await connected({ ownerUserId: 1234 });
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    const reply = await nextReply(telegram, 0);
    expect(reply).toMatch(/different Telegram account/);
  });

  it("will not approve an expired request", async () => {
    const { telegram, store } = await paired();
    const approval = await pendingApproval(store, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const handle = approval.id.replaceAll("-", "").slice(0, 8);

    const before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`);
    const reply = await nextReply(telegram, before);
    expect(reply).toMatch(/expired/i);
    expect(store.get(approval.id)?.status).toBe("expired");
  });

  it("decides once, however many times the command arrives", async () => {
    const { telegram, store, harness } = await paired();
    const approval = await pendingApproval(store, {
      kind: "action",
      permissionCategory: undefined,
    });
    const handle = approval.id.replaceAll("-", "").slice(0, 8);

    let before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`);
    expect(await nextReply(telegram, before)).toContain("Approved");

    before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${handle}`);
    expect(await nextReply(telegram, before)).toMatch(/Already handled/);
    // The coworker was told exactly once.
    expect(harness.told).toHaveLength(1);
  });

  it("never guesses between two requests with the same short id", async () => {
    const { telegram, store } = await paired();
    const first = await pendingApproval(store);
    const second = await pendingApproval(store, { title: "Pay the rent" });
    // Ask with a prefix both ids share.
    const shared = first.id.slice(0, 1);
    const before = telegram.sent.length;
    telegram.say(OWNER, `/approve ${shared}`);
    const reply = await nextReply(telegram, before);
    if (second.id.startsWith(shared)) {
      expect(reply).toMatch(/matches 2 requests/);
      expect(store.get(first.id)?.status).toBe("pending");
      expect(store.get(second.id)?.status).toBe("pending");
    }
  });

  it("reports an unknown id instead of acting", async () => {
    const { telegram, store } = await paired();
    await pendingApproval(store);
    const before = telegram.sent.length;
    telegram.say(OWNER, "/approve deadbeef");
    expect(await nextReply(telegram, before)).toMatch(/No request matches/);
  });

  it("says approvals are unavailable rather than failing silently", async () => {
    const { telegram } = await paired({ approvals: false });
    const before = telegram.sent.length;
    telegram.say(OWNER, "/pending");
    expect(await nextReply(telegram, before)).toMatch(/not available/i);
  });

  it("shows the policy read-only and offers no way to change it", async () => {
    const { telegram } = await paired();
    const before = telegram.sent.length;
    telegram.say(OWNER, "/policy");
    const reply = await nextReply(telegram, before);
    expect(reply).toMatch(/Read-only here/);
    expect(reply).toMatch(/payments: ask/);
  });

  it("reports status including who decided it", async () => {
    const { telegram, store } = await paired();
    const approval = await pendingApproval(store, { kind: "action" });
    const handle = approval.id.replaceAll("-", "").slice(0, 8);
    // Decided at the computer, then asked about from Telegram.
    await store.decide({ approvalId: approval.id, decision: "approved", decidedBy: "desktop" });
    const before = telegram.sent.length;
    telegram.say(OWNER, `/status ${handle}`);
    const reply = await nextReply(telegram, before);
    expect(reply).toContain("Status: approved");
    expect(reply).toContain("By: desktop");
  });

  it("records a failed notification and never counts it as approval", async () => {
    // Pairing must succeed first; the outage starts after it.
    let failing = false;
    const { telegram, coworkers, store } = await paired({ failSend: () => failing });
    failing = true;
    const approval = await pendingApproval(store);
    coworkers.emit({ type: "approvals-changed", approvals: store.list() });
    await until(() => store.get(approval.id)?.deliveryError != null);
    expect(store.get(approval.id)).toMatchObject({
      status: "pending",
      notifiedAt: null,
    });
    expect(store.get(approval.id)?.deliveryError).toMatch(/chat not found/);

    // When Telegram recovers, the owner still learns about it.
    failing = false;
    const before = telegram.sent.length;
    coworkers.emit({ type: "approvals-changed", approvals: store.list() });
    const reply = await nextReply(telegram, before);
    expect(reply).toContain("needs your approval");
    await until(() => store.get(approval.id)?.notifiedAt != null);
    expect(store.get(approval.id)?.deliveryError).toBeNull();
  });

  it("offers the approve command in the notification, with risk and consequence", async () => {
    const { telegram, coworkers, store } = await paired();
    const approval = await pendingApproval(store);
    coworkers.emit({ type: "approvals-changed", approvals: store.list() });
    const reply = await nextReply(telegram, telegram.sent.length - 1);
    expect(reply).toContain("Risk: HIGH");
    expect(reply).toContain("Money may leave your account.");
    expect(reply).toContain(`/approve ${approval.id.replaceAll("-", "").slice(0, 8)}`);
  });

  it("splits long replies at line breaks within Telegram's limit", () => {
    const text = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
    const chunks = telegramChunks(text);
    expect(chunks).toEqual(["a".repeat(3000), "b".repeat(3000)]);
    expect(telegramChunks("x".repeat(9000)).every((chunk) => chunk.length <= 4096)).toBe(true);
  });
});

/** The desktop's secure cards, as AgentService keeps them. */
function secureCards() {
  let open: SecureInputRequest[] = [];
  const submitted: Array<{ id: string; value: string }> = [];
  const dismissed: string[] = [];
  const takenOver: string[] = [];
  let emit: (event: AgentEvent) => void = () => {};
  const close = (id: string) => {
    open = open.filter((request) => request.id !== id);
    emit({ type: "secure-inputs-changed", requests: open });
  };
  return {
    submitted,
    dismissed,
    takenOver,
    bind(next: (event: AgentEvent) => void) {
      emit = next;
    },
    ask(kind: SecureInputRequest["kind"], id = `req-${open.length + 1}`) {
      open = [
        ...open,
        {
          id,
          botId: "bot-a",
          kind,
          label: kind === "username" ? "Gmail email" : kind,
          origin: "https://accounts.google.com",
          tabId: "tab-1",
          createdAt: new Date(Date.now() + 1_000).toISOString(),
        },
      ];
      emit({ type: "secure-inputs-changed", requests: open });
    },
    close,
    methods: {
      listSecureInputs: () => open,
      submitSecureInput: async (id: string, value: string) => {
        submitted.push({ id, value });
        close(id);
      },
      dismissSecureInput: async (id: string) => {
        dismissed.push(id);
        close(id);
      },
      takeOverSecureInput: (id: string) => {
        takenOver.push(id);
        close(id);
      },
    } satisfies Partial<TelegramAgent>,
  };
}

async function pairedWithCards() {
  const cards = secureCards();
  const context = await paired({ agent: cards.methods });
  cards.bind((event) => context.coworkers.emit(event));
  return { ...context, cards };
}

/** The message (and its id) the bridge sent asking for a secure value. */
async function askedFor(telegram: ReturnType<typeof fakeTelegram>, noun: string, before: number) {
  await until(() => telegram.sent.slice(before).some((item) => item.text.includes(`your ${noun}`)));
  const index = telegram.sent.findIndex(
    (item, at) => at >= before && item.text.includes(`your ${noun}`),
  );
  // The fake numbers sent messages from 501 in order.
  return { message: telegram.sent[index], messageId: 501 + index };
}

describe("Telegram: codes, login IDs and passwords a coworker asks for", () => {
  it("asks for an OTP, types the reply into the page and deletes the owner's message", async () => {
    const { telegram, cards, coworkers } = await pairedWithCards();
    const before = telegram.sent.length;
    cards.ask("otp");
    const { message, messageId } = await askedFor(telegram, "OTP", before);
    expect(message?.text).toContain("Asha needs your OTP for accounts.google.com");
    expect(message?.reply_markup).toMatchObject({ force_reply: true });
    const reply = telegram.say(OWNER, "482913", undefined, messageId);
    await until(() => cards.submitted.length === 1);
    expect(cards.submitted).toEqual([{ id: "req-1", value: "482913" }]);
    await until(() => telegram.deleted.includes(reply));
    await until(() => telegram.sent.some((item) => item.text.startsWith("Typed into")));
    // The code never goes to the coworker and is never echoed back.
    expect(coworkers.asked).toEqual([]);
    expect(telegram.sent.some((item) => item.text.includes("482913"))).toBe(false);
    // The request message gives way once it is answered.
    await until(() => telegram.edits.some((edit) => edit.message_id === messageId));
  });

  it("answers a login ID sent without replying when it is the only request open", async () => {
    const { telegram, cards } = await pairedWithCards();
    const before = telegram.sent.length;
    cards.ask("username");
    await askedFor(telegram, "login ID", before);
    telegram.say(OWNER, "owner@example.com");
    await until(() => cards.submitted.length === 1);
    expect(cards.submitted[0]?.value).toBe("owner@example.com");
  });

  it("keeps a chat sentence out of the page while a request is open", async () => {
    const { telegram, cards, coworkers } = await pairedWithCards();
    const before = telegram.sent.length;
    cards.ask("otp");
    await askedFor(telegram, "OTP", before);
    telegram.say(OWNER, "what is the status of the report?");
    await until(() => coworkers.asked.length === 1);
    expect(coworkers.asked[0]?.text).toBe("what is the status of the report?");
    expect(cards.submitted).toEqual([]);
  });

  it("refuses passwords from Telegram until the owner allows them", async () => {
    const { telegram, cards, bridge } = await pairedWithCards();
    expect(bridge.status().allowPasswords).toBe(false);
    let before = telegram.sent.length;
    cards.ask("password", "pw-1");
    const first = await askedFor(telegram, "password", before);
    expect(first.message?.text).toContain("typed only on your computer");
    expect(first.message?.reply_markup).toBeUndefined();
    before = telegram.sent.length;
    const reply = telegram.say(OWNER, "hunter2", undefined, first.messageId);
    await until(() => telegram.sent.length > before);
    expect(telegram.sent.at(-1)?.text).toContain("Not used");
    expect(telegram.deleted).toContain(reply);
    expect(cards.submitted).toEqual([]);
    cards.close("pw-1");

    await bridge.setAllowPasswords(true);
    expect(bridge.status().allowPasswords).toBe(true);
    before = telegram.sent.length;
    cards.ask("password", "pw-2");
    const second = await askedFor(telegram, "password", before);
    expect(second.message?.reply_markup).toMatchObject({ force_reply: true });
    telegram.say(OWNER, "hunter2", undefined, second.messageId);
    await until(() => cards.submitted.length === 1);
    expect(cards.submitted).toEqual([{ id: "pw-2", value: "hunter2" }]);
    expect(telegram.sent.some((item) => item.text.includes("hunter2"))).toBe(false);
  });

  it("only the paired owner's reply is typed", async () => {
    const { telegram, cards } = await pairedWithCards();
    const before = telegram.sent.length;
    cards.ask("otp");
    const { messageId } = await askedFor(telegram, "OTP", before);
    const spoofed = telegram.say(OWNER, "111111", { id: STRANGER.id }, messageId);
    await until(() =>
      telegram.sent.some((item) => item.text.startsWith("Only the Telegram account")),
    );
    expect(cards.submitted).toEqual([]);
    expect(telegram.deleted).toContain(spoofed);
  });

  it("/skip says no and /pc hands the page to the owner at the computer", async () => {
    const { telegram, cards, coworkers } = await pairedWithCards();
    let before = telegram.sent.length;
    cards.ask("otp", "a");
    await askedFor(telegram, "OTP", before);
    telegram.say(OWNER, "/skip");
    await until(() => cards.dismissed.length === 1);
    expect(cards.dismissed).toEqual(["a"]);

    before = telegram.sent.length;
    cards.ask("otp", "b");
    await askedFor(telegram, "OTP", before);
    telegram.say(OWNER, "/pc");
    await until(() => cards.takenOver.length === 1);
    // The take-over that follows was the owner's own choice: no "needs you" notice for it.
    const sentBefore = telegram.sent.length;
    coworkers.emit({
      type: "browser-takeover-changed",
      state: {
        humanInControl: true,
        requests: [
          {
            id: "t-own",
            botId: "bot-a",
            reason: "OTP on https://accounts.google.com",
            createdAt: new Date(Date.now() + 1_000).toISOString(),
          },
        ],
      },
    });
    // A coworker's own take-over request (a human check) is announced.
    coworkers.emit({
      type: "browser-takeover-changed",
      state: {
        humanInControl: false,
        requests: [
          {
            id: "t-captcha",
            botId: "bot-b",
            reason: "CAPTCHA on the booking page",
            createdAt: new Date(Date.now() + 1_000).toISOString(),
          },
        ],
      },
    });
    await until(() =>
      telegram.sent.some((item) => item.text.includes("needs you at your computer")),
    );
    const notices = telegram.sent
      .slice(sentBefore)
      .filter((item) => item.text.includes("needs you"));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toContain("1xl reporting needs you at your computer: CAPTCHA");
  });
});

describe("Telegram: picking a coworker", () => {
  it("/coworkers shows a button per coworker; a tap switches who gets the next message", async () => {
    const { telegram, coworkers, bridge } = await paired();
    const before = telegram.sent.length;
    telegram.say(OWNER, "/coworkers");
    await until(() => telegram.sent.length > before);
    const picker = telegram.sent.at(-1);
    expect(picker?.text).toContain("Tap a coworker");
    expect(picker?.reply_markup).toMatchObject({
      inline_keyboard: [
        [
          { text: "✓ Asha", callback_data: "use:bot-a" },
          { text: "1xl reporting", callback_data: "use:bot-b" },
        ],
      ],
    });
    telegram.tap(OWNER, "use:bot-b");
    await until(() =>
      telegram.sent.some((item) => item.text.startsWith("Now talking to 1xl reporting")),
    );
    expect(bridge.status().coworkerId).toBe("bot-b");
    telegram.say(OWNER, "send me today's numbers");
    await until(() => coworkers.asked.length === 1);
    expect(coworkers.asked[0]).toMatchObject({ botId: "bot-b", text: "send me today's numbers" });
  });
});

describe("Telegram: the password switch", () => {
  it("is off by default and kept across a restart once turned on", async () => {
    const { dir, telegram, bridge } = await connected();
    expect(bridge.status().allowPasswords).toBe(false);
    await bridge.setAllowPasswords(true);
    await bridge.stop();
    const again = new TelegramBridge({
      userDataPath: dir,
      agent: fakeAgent().agent,
      fetch: telegram.fetcher,
    });
    bridges.push(again);
    await again.initialize();
    expect(again.status().allowPasswords).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "telegram.json"), "utf8")).allowPasswords).toBe(true);
  });
});
