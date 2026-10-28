// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAgentClient } from "./claude-client";
import { isInterruptMarker, parseTranscriptLines } from "./claude-transcript";
import { snapshotFromThread } from "./conversation-snapshots";
import type { ThreadResponse } from "./protocol";

const SESSION = "d7119100-0000-4000-8000-000000000001";
let root: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

function line(
  uuid: string,
  parentUuid: string | null,
  type: "user" | "assistant",
  text: string,
  timestamp: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    parentUuid,
    isSidechain: false,
    type,
    uuid,
    timestamp,
    sessionId: SESSION,
    cwd: "C:\\coworker",
    message:
      type === "user"
        ? { role: "user", content: text }
        : {
            id: `msg-${uuid}`,
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            content: [{ type: "text", text }],
          },
    ...extra,
  });
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const TRANSCRIPT = [
  line(id(1), null, "user", "Check the install page", "2026-10-28T03:00:00.000Z"),
  line(id(2), id(1), "assistant", "Checked: not indexed yet.", "2026-10-28T03:00:05.000Z"),
  line(id(3), id(2), "user", "[Request interrupted by user]", "2026-10-28T03:10:00.000Z"),
  line(
    id(4),
    id(3),
    "user",
    "<task-notification> done </task-notification>",
    "2026-10-28T03:20:00.000Z",
    {
      origin: { kind: "task-notification" },
    },
  ),
  line(id(5), id(4), "assistant", "Background check finished.", "2026-10-28T03:20:04.000Z"),
  line(
    id(6),
    id(5),
    "user",
    "This session is being continued from a previous conversation…",
    "2026-10-28T04:00:00.000Z",
    {
      isCompactSummary: true,
    },
  ),
  line(id(7), id(6), "assistant", "Install page is now indexed.", "2026-10-28T04:00:09.000Z"),
  line(id(8), id(7), "user", "Thanks, now Reddit", "2026-10-28T05:00:00.000Z"),
  line(id(9), id(8), "assistant", "On it.", "2026-10-28T05:00:03.000Z"),
].join("\n");

describe("Claude transcript times", () => {
  it("reads times and Claude Code's own notes from transcript lines", () => {
    const lines = parseTranscriptLines(TRANSCRIPT);
    expect(lines.get(id(1))).toEqual({
      time: Date.parse("2026-10-28T03:00:00.000Z"),
      internal: false,
    });
    expect(lines.get(id(4))?.internal).toBe(true);
    expect(lines.get(id(6))?.internal).toBe(true);
    expect(isInterruptMarker("[Request interrupted by user for tool use]")).toBe(true);
    expect(isInterruptMarker("[Request interrupted by user] please redo it")).toBe(false);
  });

  it("keeps a reopened chat in order and hides Claude Code's notes", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-transcript-"));
    const project = join(root, "projects", "C--coworker");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, `${SESSION}.jsonl`), `${TRANSCRIPT}\n`);
    vi.stubEnv("CLAUDE_CONFIG_DIR", root);

    const client = new ClaudeAgentClient({ executable: "unused", version: "test" });
    client.start();
    const read = async () => {
      const response = await client.request<ThreadResponse>("thread/read", { threadId: SESSION });
      return snapshotFromThread("bot", response.thread, () => null).messages.map((message) => [
        message.author,
        message.text,
        message.createdAt,
      ]);
    };

    const first = await read();
    expect(first.map(([author, text]) => [author, text])).toEqual([
      ["user", "Check the install page"],
      ["assistant", "Checked: not indexed yet."],
      ["assistant", "Background check finished."],
      ["assistant", "Install page is now indexed."],
      ["user", "Thanks, now Reddit"],
      ["assistant", "On it."],
    ]);
    expect(first[3]?.[2]).toBe("2026-10-28T04:00:00.000Z");

    // Coming back later must give the same chat, not move anything to "now".
    vi.useFakeTimers({ now: Date.parse("2026-10-29T12:00:00.000Z"), toFake: ["Date"] });
    expect(await read()).toEqual(first);
  });
});
