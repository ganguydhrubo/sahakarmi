import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../shared/ipc";
import {
  CodexThreadLedger,
  carryOverNote,
  joinThreadHistory,
  toolShape,
} from "./codex-tool-refresh";

function message(
  overrides: Partial<ConversationMessage> & Pick<ConversationMessage, "id">,
): ConversationMessage {
  return {
    author: "user",
    text: "",
    createdAt: "2026-10-26T10:00:00.000Z",
    status: "completed",
    ...overrides,
  };
}

const ACT = {
  name: "act",
  description: "Act on the page.",
  inputSchema: { type: "object", properties: { type: { enum: ["click", "type"] } } },
};

describe("toolShape", () => {
  it("ignores reworded descriptions but sees a new action or tool", () => {
    const base = toolShape([ACT]);
    expect(toolShape([{ ...ACT, description: "Click or type on the page." }])).toBe(base);
    const withUpload = {
      ...ACT,
      inputSchema: { type: "object", properties: { type: { enum: ["click", "type", "upload"] } } },
    };
    expect(toolShape([withUpload])).not.toBe(base);
    expect(toolShape([ACT, { name: "save_skill" }])).not.toBe(base);
  });
});

describe("CodexThreadLedger", () => {
  it("remembers each chat's tools and the chats it replaced, across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-ledger-"));
    const ledger = new CodexThreadLedger(dir);
    await ledger.record("thread-2", "shape-a", "thread-1");
    await ledger.record("thread-3", "shape-b", "thread-2");

    const reopened = new CodexThreadLedger(dir);
    expect((await reopened.get("thread-3"))?.shape).toBe("shape-b");
    expect(await reopened.get("thread-1")).toBeNull();
    expect(await reopened.previousThreads("thread-3")).toEqual(["thread-2", "thread-1"]);
  });
});

describe("carryOverNote", () => {
  it("keeps only what the owner and the coworker said", () => {
    const note = carryOverNote([
      message({ id: "1", text: "Post the Diwali banner on GoLiv" }),
      message({ id: "2", author: "assistant", itemType: "commentary", text: "Thinking" }),
      message({ id: "3", author: "assistant", itemType: "toolCall", text: "act click" }),
      message({ id: "4", author: "assistant", itemType: "agentMessage", text: "Posted it." }),
    ]);
    expect(note).toContain("Owner: Post the Diwali banner on GoLiv");
    expect(note).toContain("You: Posted it.");
    expect(note).not.toContain("Thinking");
    expect(note).not.toContain("act click");
  });

  it("has nothing to carry over from an empty chat", () => {
    expect(carryOverNote([])).toBeNull();
  });
});

describe("joinThreadHistory", () => {
  it("puts older chats first and never shows two messages with one id", () => {
    const joined = joinThreadHistory(
      [{ threadId: "thread-1", messages: [message({ id: "item-1", text: "old" })] }],
      [message({ id: "item-1", text: "new" })],
    );
    expect(joined.map((item) => [item.id, item.text])).toEqual([
      ["thread-1:item-1", "old"],
      ["item-1", "new"],
    ]);
  });
});
