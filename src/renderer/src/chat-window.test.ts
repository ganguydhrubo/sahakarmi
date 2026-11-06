import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../shared/ipc";
import { upsertMessage } from "./App";

function message(id: string, text = id): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-11-06T10:00:00Z", status: "completed" };
}

describe("one-message chat updates", () => {
  it("puts one updated message in place without touching the rest", () => {
    const messages = [message("a"), message("b"), message("c")];
    upsertMessage(messages, message("b", "b2"), "a");
    expect(messages.map((item) => item.text)).toEqual(["a", "b2", "c"]);
    upsertMessage(messages, message("d"), "c");
    expect(messages.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    upsertMessage(messages, message("first"), null);
    expect(messages[0].id).toBe("first");
    // Its neighbour is outside the window: an existing message stays where it was.
    upsertMessage(messages, message("c", "c2"), "not-loaded");
    expect(messages.map((item) => item.text)).toEqual(["first", "a", "b2", "c2", "d"]);
  });
});
