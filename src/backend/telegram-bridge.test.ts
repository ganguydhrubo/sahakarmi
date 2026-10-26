import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, ConversationMessage, ConversationSnapshot } from "../shared/ipc";
import { type TelegramAgent, TelegramBridge, telegramChunks } from "./telegram-bridge";

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz0123456";
const OWNER = { id: 42, type: "private", first_name: "Dhrubo" };
const STRANGER = { id: 99, type: "private", first_name: "Someone" };

function fakeTelegram() {
  const inbox: Array<{ update_id: number; message: { text: string; chat: typeof OWNER } }> = [];
  const sent: Array<{ chat_id: number; text: string }> = [];
  let nextId = 1;
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(String(init.body ?? "{}"));
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    if (method === "getMe") return reply({ username: "sahkarmi_test_bot" });
    if (method === "sendMessage") {
      sent.push({ chat_id: body.chat_id, text: body.text });
      return reply({});
    }
    if (method === "sendChatAction") return reply(true);
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
    say(chat: typeof OWNER, text: string) {
      inbox.push({ update_id: nextId++, message: { text, chat } });
    },
  };
}

function fakeAgent() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const messages: ConversationMessage[] = [];
  const asked: Array<{ botId: string; text: string }> = [];
  let delivery = 0;
  const agent: TelegramAgent = {
    listBots: () => [
      { id: "bot-a", name: "Asha", role: "Sales" },
      { id: "bot-b", name: "1xl reporting", role: "Reports" },
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
  const deadline = Date.now() + 3_000;
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

async function connected() {
  const dir = mkdtempSync(join(tmpdir(), "sahkarmi-telegram-"));
  const telegram = fakeTelegram();
  const coworkers = fakeAgent();
  const bridge = new TelegramBridge({
    userDataPath: dir,
    agent: coworkers.agent,
    fetch: telegram.fetcher,
  });
  bridges.push(bridge);
  const status = await bridge.setToken(TOKEN);
  return { dir, telegram, coworkers, bridge, status };
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

  it("sends the owner's message to the coworker and only its finished reply back", async () => {
    const { telegram, coworkers, status } = await connected();
    telegram.say(OWNER, `/start ${status.pairingCode}`);
    await until(() => telegram.sent.some((item) => item.text.startsWith("Paired.")));

    telegram.say(OWNER, "/use 1xl");
    await until(() => telegram.sent.at(-1)?.text === "Now talking to 1xl reporting.");
    telegram.say(OWNER, "Send me today's report status");
    await until(() => coworkers.asked.length === 1);
    expect(coworkers.asked[0]).toEqual({ botId: "bot-b", text: "Send me today's report status" });

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
    expect(telegram.sent.at(-1)?.text).toBe(
      "Asha needs your approval: Pay the GST invoice (Rs. 18,000). Open Sahkarmi to allow or deny it.",
    );
  });

  it("splits long replies at line breaks within Telegram's limit", () => {
    const text = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
    const chunks = telegramChunks(text);
    expect(chunks).toEqual(["a".repeat(3000), "b".repeat(3000)]);
    expect(telegramChunks("x".repeat(9000)).every((chunk) => chunk.length <= 4096)).toBe(true);
  });
});
