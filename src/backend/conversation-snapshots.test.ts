import { describe, expect, it } from "vitest";
import type { ConversationMessage, ConversationSnapshot } from "../shared/ipc";
import { conversationFingerprint, windowedSnapshot } from "./conversation-snapshots";

function message(id: string, text = id): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-11-06T10:00:00Z", status: "completed" };
}

function snapshot(count: number): ConversationSnapshot {
  return {
    botId: "chief",
    threadId: "t1",
    activeTurnId: null,
    revision: 3,
    messages: Array.from({ length: count }, (_, index) => message(`m${index}`)),
  };
}

describe("chat windows and fingerprints", () => {
  it("keeps only the newest messages and says how many are earlier", () => {
    const full = snapshot(200);
    const window = windowedSnapshot(full, 80);
    expect(window.messages).toHaveLength(80);
    expect(window.messages[0].id).toBe("m120");
    expect(window.earlierCount).toBe(120);
    // A copy: changing it leaves the live chat alone.
    window.messages[0].text = "changed";
    expect(full.messages[120].text).toBe("m120");
    expect(windowedSnapshot(full, undefined).messages).toHaveLength(200);
    expect(windowedSnapshot(snapshot(10), 80).earlierCount).toBeUndefined();
  });

  it("changes the fingerprint when what the window shows changes", () => {
    const base = snapshot(3);
    const same = structuredClone(base);
    expect(conversationFingerprint(same)).toBe(conversationFingerprint(base));
    const longer = structuredClone(base);
    longer.messages[2].text += " more";
    expect(conversationFingerprint(longer)).not.toBe(conversationFingerprint(base));
    const status = structuredClone(base);
    status.messages[1].status = "failed";
    expect(conversationFingerprint(status)).not.toBe(conversationFingerprint(base));
    // The revision alone is not a change the window shows.
    expect(conversationFingerprint({ ...base, revision: 9 })).toBe(conversationFingerprint(base));
  });
});
