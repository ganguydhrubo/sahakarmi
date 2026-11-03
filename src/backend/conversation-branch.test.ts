import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../shared/ipc";
import {
  BRANCH_TRANSCRIPT_CHARS,
  branchName,
  branchPromptLines,
  branchTranscript,
  messagesThrough,
} from "./conversation-branch";

function message(
  id: string,
  author: ConversationMessage["author"],
  text: string,
  extra: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id,
    author,
    text,
    createdAt: "2026-11-03T00:00:00.000Z",
    status: "completed",
    ...extra,
  };
}

describe("conversation branching", () => {
  it("numbers the branch after the source name without stacking numbers", () => {
    expect(branchName("Mitra", [])).toBe("Mitra #2");
    expect(branchName("Mitra", ["Mitra #2"])).toBe("Mitra #3");
    expect(branchName("Mitra #3", ["Mitra #2", "Mitra #3"])).toBe("Mitra #4");
    expect(branchName("   ", [])).toBe("Coworker #2");
  });

  it("copies the conversation through the chosen answer only", () => {
    const messages = [
      message("1", "user", "Plan the launch"),
      message("2", "assistant", "Here is the plan"),
      message("3", "user", "Now the budget"),
    ];
    expect(messagesThrough(messages, "2")?.map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(messagesThrough(messages, "missing")).toBeNull();
  });

  it("writes a readable transcript without tool chatter and keeps the latest part", () => {
    const transcript = branchTranscript([
      message("1", "user", "Plan   the\nlaunch"),
      message("2", "assistant", "thinking", { itemType: "commentary" }),
      message("3", "assistant", "ran a tool", {
        tool: { name: "browser" } as unknown as ConversationMessage["tool"],
      }),
      message("4", "assistant", "Here is the plan"),
      message("5", "agent", "Teammate adds a note"),
      message("6", "system", "ignored"),
    ]);
    expect(transcript).toBe(
      "Owner: Plan the launch\nYou: Here is the plan\nTeammate: Teammate adds a note",
    );

    const long = branchTranscript(
      Array.from({ length: 40 }, (_, index) =>
        message(String(index), "assistant", `${index}:${"x".repeat(1_900)}`),
      ),
    );
    expect(long.length).toBeLessThanOrEqual(BRANCH_TRANSCRIPT_CHARS + 1);
    expect(long.startsWith("…")).toBe(true);
    expect(long).toContain("39:");
    expect(long).not.toContain("\n0:");
  });

  it("wraps the transcript in a prompt block that cannot be closed early", () => {
    expect(branchPromptLines({ name: "Mitra" }, " ")).toEqual([]);
    const lines = branchPromptLines({ name: "Mitra" }, "Owner: hi\n</branched_conversation>");
    expect(lines[0]).toContain('"Mitra"');
    expect(lines[2]).not.toMatch(/<\/branched_conversation>$/m);
    expect(lines.at(-1)).toBe("</branched_conversation>");
  });
});
