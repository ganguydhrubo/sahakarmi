// @vitest-environment node

import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailboxStore } from "./mailbox-store";

let root: string;
let store: MailboxStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-mailbox-test-"));
  store = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
  await store.initialize();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("MailboxStore", () => {
  it("copies attachments once and fans out independent FIFO deliveries", async () => {
    const original = join(root, "report.csv");
    await writeFile(original, "account,value\nAcme,42\n");
    const drafts = await store.prepareAttachments([original]);
    const receipt = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief", "sales-outbound"],
      text: "Review this data",
      draftIds: drafts.map((draft) => draft.id),
    });
    await rm(original);

    expect(receipt.deliveries).toHaveLength(2);
    expect(receipt.deliveries.map((item) => item.position)).toEqual([1, 1]);
    const first = store.getDelivery(receipt.deliveries[0].id);
    const second = store.getDelivery(receipt.deliveries[1].id);
    expect(first?.delivery.attachments[0]?.id).toBe(second?.delivery.attachments[0]?.id);
    await expect(access(first?.managedAttachments[0]?.path ?? "missing")).resolves.toBeUndefined();
  });

  it("moves a queued message to the front of its coworker's queue only", async () => {
    const send = (text: string, recipient = "chief") =>
      store.enqueue({ sender: { kind: "user" }, recipientBotIds: [recipient], text });
    await send("first");
    await send("other coworker", "sales-outbound");
    await send("second");
    const third = await send("third");
    await store.moveToFront("chief", third.deliveries[0].id);
    expect(store.nextQueued("chief")?.delivery.text).toBe("third");
    expect(store.listQueue("chief").deliveries.map((item) => [item.text, item.position])).toEqual(
      expect.arrayContaining([
        ["third", 1],
        ["first", 2],
        ["second", 3],
      ]),
    );
    expect(store.nextQueued("sales-outbound")?.delivery.text).toBe("other coworker");
    await store.cancel("chief", third.deliveries[0].id);
    await expect(store.moveToFront("chief", third.deliveries[0].id)).rejects.toThrow(
      "Only queued messages can be sent now.",
    );
  });

  it("persists cancellation, pause state, and idempotent agent sends", async () => {
    const first = await store.enqueue({
      sender: { kind: "bot", botId: "chief" },
      recipientBotIds: ["sales-outbound"],
      text: "Prepare a report",
      idempotencyKey: "thread:turn:call",
    });
    const duplicate = await store.enqueue({
      sender: { kind: "bot", botId: "chief" },
      recipientBotIds: ["sales-outbound"],
      text: "Prepare a report",
      idempotencyKey: "thread:turn:call",
    });
    expect(duplicate).toEqual(first);

    await store.cancel("sales-outbound", first.deliveries[0].id);
    await store.setPaused("sales-outbound", true);
    const restored = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    await restored.initialize();
    expect(restored.listQueue("sales-outbound")).toMatchObject({
      paused: true,
      deliveries: [{ status: "cancelled" }],
    });
  });

  // chmod cannot make a directory unwritable for root (e.g. in CI containers).
  it.skipIf(process.getuid?.() === 0)(
    "rolls back a failed enqueue without losing its attachment draft",
    async () => {
      const original = join(root, "retry.txt");
      const userData = join(root, "user-data");
      await writeFile(original, "retry me\n");
      const [draft] = await store.prepareAttachments([original]);

      if (process.platform === "win32") {
        const stateFile = join(userData, "mailbox.json");
        await writeFile(stateFile, "{}\n");
        await chmod(stateFile, 0o444);
        try {
          await expect(
            store.enqueue({
              sender: { kind: "user" },
              recipientBotIds: ["chief"],
              text: "",
              draftIds: [draft.id],
            }),
          ).rejects.toThrow();
        } finally {
          await chmod(stateFile, 0o666);
          await rm(stateFile);
        }
      } else {
        await chmod(userData, 0o500);
        try {
          await expect(
            store.enqueue({
              sender: { kind: "user" },
              recipientBotIds: ["chief"],
              text: "",
              draftIds: [draft.id],
            }),
          ).rejects.toThrow();
        } finally {
          await chmod(userData, 0o700);
        }
      }

      expect(store.listQueue("chief").deliveries).toEqual([]);
      await expect(
        store.enqueue({
          sender: { kind: "user" },
          recipientBotIds: ["chief"],
          text: "",
          draftIds: [draft.id],
        }),
      ).resolves.toMatchObject({ deliveries: [{ recipientBotId: "chief" }] });
    },
  );

  it("fails closed instead of overwriting an unsupported mailbox state", async () => {
    const statePath = join(root, "user-data", "mailbox.json");
    const unsupported = '{"version":999,"messages":[{"important":true}]}\n';
    await writeFile(statePath, unsupported);

    const restored = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    await expect(restored.initialize()).rejects.toThrow("refusing to overwrite");
    await expect(readFile(statePath, "utf8")).resolves.toBe(unsupported);
  });

  it("persists reply metadata and one local reaction per conversation message", async () => {
    const receipt = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "Yes, continue",
      replyToMessageId: "assistant-1",
    });
    const deliveryId = receipt.deliveries[0].id;
    expect(store.conversationMessages("chief")[0]).toMatchObject({
      id: deliveryId,
      replyToMessageId: "assistant-1",
    });

    await store.setReaction("chief", "assistant-1", "❤️");
    const restored = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    await restored.initialize();
    expect(restored.reactionFor("chief", "assistant-1")).toBe("❤️");
    await restored.setReaction("chief", "assistant-1", null);
    expect(restored.reactionFor("chief", "assistant-1")).toBeNull();
  });

  it("tracks the initiating bot through a reply chain and detects explicit replies", async () => {
    const rootMessage = await store.enqueue({
      sender: { kind: "bot", botId: "researcher" },
      recipientBotIds: ["weather"],
      text: "Check tomorrow's weather.",
    });
    const weatherQuestion = await store.enqueue({
      sender: { kind: "bot", botId: "weather" },
      recipientBotIds: ["researcher"],
      text: "Which city?",
      replyToMessageId: rootMessage.messageId,
    });
    const locationReply = await store.enqueue({
      sender: { kind: "bot", botId: "researcher" },
      recipientBotIds: ["weather"],
      text: "Kraków.",
      replyToMessageId: weatherQuestion.messageId,
    });

    expect(store.chainOriginBotId(locationReply.messageId)).toBe("researcher");
    expect(store.hasReplyFrom("weather", locationReply.messageId)).toBe(false);
    await store.enqueue({
      sender: { kind: "bot", botId: "weather" },
      recipientBotIds: ["researcher"],
      text: "It will be sunny.",
      replyToMessageId: locationReply.messageId,
    });
    expect(store.hasReplyFrom("weather", locationReply.messageId)).toBe(true);
    await store.enqueue({
      sender: { kind: "bot", botId: "weather" },
      recipientBotIds: ["researcher"],
      text: "A second explicit update.",
      idempotencyKey: "thread-weather:turn-weather:call-1",
    });
    expect(store.hasBotMessageFromTurnTo("weather", "turn-weather", "researcher")).toBe(true);
    expect(store.hasBotMessageFromTurnTo("weather", "turn-weather", "other-agent")).toBe(false);
  });

  it("rejects directories and oversized recipient lists", async () => {
    const directory = join(root, "folder");
    await mkdir(directory);
    await expect(store.prepareAttachments([directory])).rejects.toThrow("regular files");
    await expect(
      store.enqueue({
        sender: { kind: "user" },
        recipientBotIds: Array.from({ length: 33 }, (_, index) => `bot-${index}`),
        text: "Too many",
      }),
    ).rejects.toThrow("32 recipients");
  });

  it("imports pathless image bytes and accepts an attachment-only user message", async () => {
    const [draft] = await store.prepareImportedAttachments(
      [],
      [
        {
          name: "clipboard.png",
          mimeType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    );
    expect(draft).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      previewKind: "image",
    });
    const receipt = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "",
      draftIds: [draft.id],
    });
    expect(store.getDelivery(receipt.deliveries[0].id)?.delivery).toMatchObject({
      text: "",
      attachments: [{ name: "clipboard.png" }],
    });
  });

  it("cleans unrecoverable attachment drafts when a new app session starts", async () => {
    const source = join(root, "abandoned.txt");
    await writeFile(source, "abandoned");
    const [draft] = await store.prepareAttachments([source]);
    expect(draft).toBeDefined();

    const restored = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    await restored.initialize();

    await expect(restored.resolveAttachment(draft.id)).resolves.toBeNull();
  });

  it("removes deleted bot deliveries while preserving messages visible to other bots", async () => {
    await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "Private to Chief",
    });
    await store.enqueue({
      sender: { kind: "bot", botId: "chief" },
      recipientBotIds: ["sales-outbound"],
      text: "Keep this for Sales",
    });

    await store.deleteBotData("chief");

    expect(store.listQueue("chief").deliveries).toEqual([]);
    expect(store.conversationMessages("chief").map((message) => message.text)).not.toContain(
      "Private to Chief",
    );
    expect(store.conversationMessages("sales-outbound")).toEqual([
      expect.objectContaining({ text: "Keep this for Sales", senderBotId: "chief" }),
    ]);
  });

  it("rejects managed attachments replaced by symlinks outside the transfer root", async () => {
    const source = join(root, "inside.txt");
    const outside = join(root, "outside.txt");
    await writeFile(source, "original");
    await writeFile(outside, "secret");
    const [draft] = await store.prepareAttachments([source]);
    const receipt = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "Review",
      draftIds: [draft.id],
    });
    const attachment = store.getDelivery(receipt.deliveries[0].id)?.managedAttachments[0];
    expect(attachment).toBeDefined();
    await rm(attachment?.path ?? "missing");
    try {
      await symlink(outside, attachment?.path ?? "missing");
    } catch (error) {
      if (process.platform === "win32" && (error as { code?: string })?.code === "EPERM") {
        return; // Windows unprivileged environment does not allow symlink creation
      }
      throw error;
    }

    await expect(store.resolveAttachment(attachment?.id ?? "")).resolves.toBeNull();
    await expect(store.listExportAttachments()).resolves.toEqual([]);
  });

  it("keeps the persisted MIME type as the single source for attachment serving", async () => {
    const [draft] = await store.prepareImportedAttachments(
      [],
      [
        {
          name: "clipboard.bin",
          mimeType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    );

    await expect(store.resolveAttachment(draft.id)).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("reconstructs persistent outgoing and incoming exchanges with live delivery states", async () => {
    const receipt = await store.enqueue({
      sender: { kind: "bot", botId: "chief" },
      recipientBotIds: ["sales-outbound", "inbox-manager"],
      text: "Prepare your reports",
      replyToMessageId: "previous-message",
    });
    await store.markStarting(receipt.deliveries[0].id);
    await store.markRunning(receipt.deliveries[0].id, "turn-sales");

    const outgoing = store.conversationMessages("chief")[0];
    expect(outgoing).toMatchObject({
      id: `outbox-${receipt.messageId}`,
      exchange: {
        direction: "outgoing",
        recipientBotIds: ["sales-outbound", "inbox-manager"],
        replyToMessageId: "previous-message",
        deliveries: [{ status: "running" }, { status: "queued" }],
      },
    });
    expect(store.conversationMessages("sales-outbound")[0]).toMatchObject({
      author: "agent",
      senderBotId: "chief",
      exchange: { direction: "incoming" },
    });

    const restored = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    await restored.initialize();
    expect(restored.conversationMessages("chief")[0]?.exchange?.deliveries).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "running" })]),
    );
  });
});

describe("MailboxStore archive", () => {
  const later = () => Date.now() + 40 * 24 * 60 * 60_000;
  const reopen = async (options = { now: later }) => {
    const next = new MailboxStore(join(root, "user-data"), join(root, "Shared"), options);
    await next.initialize();
    return next;
  };
  const finish = async (id: string) => {
    await store.markStarting(id);
    await store.markRunning(id, `turn-${id}`);
    await store.markTerminal(id, "completed");
  };

  it("archives finished messages older than 30 days and keeps them readable", async () => {
    const file = join(root, "brief.txt");
    await writeFile(file, "old brief");
    const question = await store.enqueue({
      sender: { kind: "bot", botId: "researcher" },
      recipientBotIds: ["weather"],
      text: "Old question",
      sourcePaths: [file],
      idempotencyKey: "thread-r:turn-old:call-1",
    });
    const reply = await store.enqueue({
      sender: { kind: "bot", botId: "weather" },
      recipientBotIds: ["researcher"],
      text: "Old answer",
      replyToMessageId: question.messageId,
    });
    const pending = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["weather"],
      text: "Still queued",
    });
    await finish(question.deliveries[0].id);
    await finish(reply.deliveries[0].id);
    const before = store.conversationMessages("weather").map((item) => item.text);

    const archived = await reopen();
    const saved = JSON.parse(await readFile(join(root, "user-data", "mailbox.json"), "utf8"));
    expect(saved.messages.map((item: { text: string }) => item.text)).toEqual(["Still queued"]);
    expect(saved.idempotency).toEqual({});
    const month = new Date().toISOString().slice(0, 7);
    const lines = (
      await readFile(join(root, "user-data", "mailbox-archive", `${month}.jsonl`), "utf8")
    )
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);

    expect(archived.conversationMessages("weather").map((item) => item.text)).toEqual(before);
    expect(archived.chainOriginBotId(reply.messageId)).toBe("researcher");
    expect(archived.hasReplyFrom("weather", question.messageId)).toBe(true);
    expect(archived.hasBotMessageFromTurnTo("researcher", "turn-old", "weather")).toBe(true);
    const attachmentId = archived.conversationMessages("weather")[0]?.attachments?.[0]?.id ?? "";
    await expect(archived.resolveAttachment(attachmentId)).resolves.toMatchObject({
      mimeType: "text/plain",
    });
    expect(await archived.listExportAttachments()).toHaveLength(1);
    expect(archived.nextQueued("weather")?.delivery.id).toBe(pending.deliveries[0].id);
  });

  it("ignores a duplicate archive line left by a crash between the two writes", async () => {
    const sent = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "Once",
    });
    await finish(sent.deliveries[0].id);
    const statePath = join(root, "user-data", "mailbox.json");
    const original = await readFile(statePath, "utf8");
    await reopen();
    // Simulate the crash: archive written, but mailbox.json still the old one.
    await writeFile(statePath, original);
    const again = await reopen();
    expect(again.conversationMessages("chief").map((item) => item.text)).toEqual(["Once"]);
  });

  it("removes a deleted coworker's archived messages and files", async () => {
    const file = join(root, "note.txt");
    await writeFile(file, "x");
    const sent = await store.enqueue({
      sender: { kind: "user" },
      recipientBotIds: ["chief"],
      text: "Bye",
      sourcePaths: [file],
    });
    await finish(sent.deliveries[0].id);
    const archived = await reopen();
    await archived.deleteBotData("chief");
    expect(archived.conversationMessages("chief")).toEqual([]);
    await expect(access(join(root, "Shared", "Transfers", sent.messageId))).rejects.toThrow();
    const month = new Date().toISOString().slice(0, 7);
    await expect(
      access(join(root, "user-data", "mailbox-archive", `${month}.jsonl`)),
    ).rejects.toThrow();
  });

  it("loads once when initialize is called twice", async () => {
    const fresh = new MailboxStore(join(root, "user-data"), join(root, "Shared"));
    const first = fresh.initialize();
    expect(fresh.initialize()).toBe(first);
    await first;
    const drafts = await fresh.prepareImportedAttachments(
      [],
      [{ name: "a.png", mimeType: "image/png", bytes: new Uint8Array([1]) }],
    );
    await fresh.initialize();
    await expect(fresh.resolveAttachment(drafts[0].id)).resolves.not.toBeNull();
  });

  it("keeps a large old mailbox small and fast to write after archiving", async () => {
    const userData = join(root, "big");
    await mkdir(userData, { recursive: true });
    const old = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    const count = 20_000;
    const filler = "x".repeat(400);
    const state = {
      version: 1,
      messages: Array.from({ length: count }, (_, index) => ({
        id: `m-${index}`,
        sender: { kind: "user" },
        text: `message ${index} ${filler}`,
        attachments: [],
        replyToMessageId: null,
        createdAt: old,
      })),
      deliveries: Array.from({ length: count }, (_, index) => ({
        id: `d-${index}`,
        messageId: `m-${index}`,
        recipientBotId: `bot-${index % 17}`,
        status: "completed",
        turnId: `t-${index}`,
        error: null,
        createdAt: old,
      })),
      drafts: [],
      pausedBotIds: [],
      idempotency: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`th:turn-${index}:c`, `m-${index}`]),
      ),
      reactions: [],
    };
    await writeFile(join(userData, "mailbox.json"), JSON.stringify(state));
    const measure = async (archiveAfterDays: number) => {
      const big = new MailboxStore(userData, join(root, "Shared"), { archiveAfterDays });
      let started = performance.now();
      await big.initialize();
      const loadMs = performance.now() - started;
      started = performance.now();
      for (let index = 0; index < 20; index += 1) {
        await big.enqueue({ sender: { kind: "user" }, recipientBotIds: ["bot-1"], text: "hi" });
      }
      const writeMs = (performance.now() - started) / 20;
      const size = (await readFile(join(userData, "mailbox.json"), "utf8")).length;
      return { big, loadMs, writeMs, size };
    };
    const before = await measure(Number.POSITIVE_INFINITY);
    const after = await measure(30);
    const reloaded = await measure(30);
    console.info(
      `[mailbox bench] ${count} msgs, ${(before.size / 1e6).toFixed(1)} MB: ` +
        `no archive load ${before.loadMs.toFixed(0)} ms, write ${before.writeMs.toFixed(1)} ms/msg; ` +
        `first archive pass ${after.loadMs.toFixed(0)} ms, then write ${after.writeMs.toFixed(1)} ms/msg, ` +
        `${(after.size / 1e3).toFixed(1)} kB; next load ${reloaded.loadMs.toFixed(0)} ms`,
    );
    expect(after.size).toBeLessThan(before.size / 100);
    expect(reloaded.writeMs).toBeLessThan(before.writeMs);
    expect(reloaded.big.conversationMessages("bot-3").length).toBeGreaterThan(1_000);
  }, 60_000);
});
