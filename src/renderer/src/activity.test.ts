import { describe, expect, it } from "vitest";
import type { QueueDelivery, QueueSnapshot, ToolCallSummary } from "../../shared/ipc";
import { type ActivityInput, classifyTool, deriveActivity, OUTCOME_VISIBLE_MS } from "./activity";
import * as vocabulary from "./activity-hinglish";
import { formatElapsed, LONG_RUNNING, PRIMARY } from "./activity-hinglish";
import {
  LONG_WAIT_MS,
  primaryLine,
  ROTATE_MS,
  secondaryLine,
  secondaryPool,
} from "./components/ActivityIndicator";
import type { BotMessage } from "./data";

const NOW = 1_000_000;

function delivery(status: QueueDelivery["status"], position: number | null = null): QueueDelivery {
  return {
    id: `d-${status}`,
    messageId: "m",
    recipientBotId: "asha",
    sender: { kind: "user" },
    text: "Kaam",
    attachments: [],
    replyToMessageId: null,
    status,
    position,
    turnId: null,
    error: null,
    createdAt: "",
  };
}

function queue(...deliveries: QueueDelivery[]): QueueSnapshot {
  return { botId: "asha", paused: false, deliveries };
}

function input(overrides: Partial<ActivityInput> = {}): ActivityInput {
  return {
    queue: undefined,
    activeTurnId: null,
    messages: [],
    retry: null,
    waitingForUser: false,
    waitingForApproval: false,
    outcome: null,
    now: NOW,
    ...overrides,
  };
}

const request: BotMessage = { id: "u1", author: "you", body: "GST summary banao", time: "" };
const tool = (
  status: ToolCallSummary["status"],
  extra: Partial<ToolCallSummary> = {},
): BotMessage => ({
  id: `t-${status}`,
  author: "bot",
  body: "",
  time: "",
  kind: "tool",
  tool: { name: "Run command", kind: "command", status, input: "npm test", output: null, ...extra },
});

describe("deriveActivity: only real events move the state", () => {
  it("is idle with nothing going on, and queued when waiting in line", () => {
    expect(deriveActivity(input()).phase).toBe("idle");
    expect(deriveActivity(input({ queue: queue(delivery("queued", 1)) })).phase).toBe("queued");
    expect(
      deriveActivity(input({ queue: { ...queue(delivery("queued", 1)), paused: true } })).phase,
    ).toBe("paused");
  });

  it("goes initializing → thinking → tool → result → generating → finalizing", () => {
    const starting = deriveActivity(input({ queue: queue(delivery("starting")) }));
    expect(starting.phase).toBe("initializing");
    const turn = { queue: queue(delivery("running")), activeTurnId: "turn-1" };
    expect(deriveActivity(input({ ...turn, messages: [request] })).phase).toBe("thinking");
    const running = deriveActivity(input({ ...turn, messages: [request, tool("running")] }));
    expect(running).toMatchObject({
      phase: "executing_tool",
      category: "tests",
      detail: "npm test",
    });
    const done = deriveActivity(input({ ...turn, messages: [request, tool("completed")] }));
    expect(done).toMatchObject({ phase: "processing_result", toolFailed: false });
    const failed = deriveActivity(input({ ...turn, messages: [request, tool("failed")] }));
    expect(failed.toolFailed).toBe(true);
    const text: BotMessage = {
      id: "a1",
      author: "bot",
      body: "Ye raha",
      time: "",
      streaming: true,
    };
    expect(
      deriveActivity(input({ ...turn, messages: [request, tool("completed"), text] })).phase,
    ).toBe("generating");
    expect(
      deriveActivity(input({ ...turn, messages: [request, { ...text, itemType: "final_answer" }] }))
        .phase,
    ).toBe("finalizing");
  });

  it("shows research only for a real web or search tool", () => {
    const turn = { queue: queue(delivery("running")), activeTurnId: "turn-1" };
    const web = tool("running", { kind: "web", name: "Web search", input: "GST rate textiles" });
    expect(deriveActivity(input({ ...turn, messages: [request, web] })).phase).toBe("researching");
    expect(deriveActivity(input({ ...turn, messages: [request] })).phase).not.toBe("researching");
  });

  it("puts waiting for the owner and real retries ahead of everything else", () => {
    const turn = {
      queue: queue(delivery("running")),
      activeTurnId: "turn-1",
      messages: [request, tool("running")],
    };
    expect(deriveActivity(input({ ...turn, waitingForUser: true })).phase).toBe("waiting_user");
    expect(deriveActivity(input({ ...turn, waitingForApproval: true })).phase).toBe(
      "waiting_approval",
    );
    expect(deriveActivity(input({ ...turn, retry: { attempt: 2, maxRetries: 10 } }))).toMatchObject(
      { phase: "retrying", retry: { attempt: 2, maxRetries: 10 } },
    );
  });

  it("shows the real outcome briefly, then goes idle", () => {
    for (const [status, phase] of [
      ["completed", "completed"],
      ["interrupted", "cancelled"],
      ["failed", "failed"],
    ] as const) {
      const outcome = { status, at: NOW - 100 };
      expect(deriveActivity(input({ outcome })).phase).toBe(phase);
      expect(deriveActivity(input({ outcome, now: NOW + OUTCOME_VISIBLE_MS })).phase).toBe("idle");
    }
  });

  it("classifies tools by what actually runs", () => {
    const base = { status: "running" as const, output: null };
    expect(classifyTool({ ...base, kind: "command", name: "Run", input: "git status" })).toBe(
      "code",
    );
    expect(
      classifyTool({ ...base, kind: "command", name: "Run", input: "python reconcile.py" }),
    ).toBe("command");
    expect(classifyTool({ ...base, kind: "command", name: "Run", input: "dir C:\\" })).toBe(
      "command",
    );
    expect(classifyTool({ ...base, kind: "file", name: "Read invoices.csv", input: null })).toBe(
      "files_read",
    );
    expect(classifyTool({ ...base, kind: "file", name: "Edit draft.md", input: null })).toBe(
      "files_write",
    );
    expect(classifyTool({ ...base, kind: "browser", name: "Open page", input: null })).toBe(
      "browser",
    );
  });
});

describe("rotation", () => {
  const thinking = deriveActivity(
    input({ queue: queue(delivery("running")), activeTurnId: "t", messages: [request] }),
  );

  it("never shows the same secondary line twice in a row", () => {
    const pool = secondaryPool(thinking, 0);
    for (let slot = 0; slot < 20; slot += 1) {
      expect(secondaryLine(pool, slot, 3)).not.toBe(secondaryLine(pool, slot + 1, 3));
    }
  });

  it("switches to honest long-wait lines after a while without new events", () => {
    expect(secondaryPool(thinking, LONG_WAIT_MS - 1)).not.toBe(LONG_RUNNING);
    expect(secondaryPool(thinking, LONG_WAIT_MS)).toBe(LONG_RUNNING);
    expect(LONG_RUNNING.join(" ")).not.toMatch(/bas|almost|final|poora ho gaya/i);
    expect(ROTATE_MS).toBeGreaterThanOrEqual(3_000);
  });

  it("only says the task is done when it is", () => {
    const active = Object.entries(PRIMARY).filter(
      ([phase]) => !["completed", "cancelled", "failed", "idle"].includes(phase),
    );
    for (const [, text] of active) expect(text).not.toMatch(/poora ho gaya|complete ho gaya/i);
    expect(primaryLine({ ...thinking, phase: "completed" })).toBe("Kaam poora ho gaya!");
  });

  it("formats elapsed time compactly", () => {
    expect(formatElapsed(4_000)).toBe("4s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_725_000)).toBe("1h 02m");
  });
});

describe("Hinglish vocabulary", () => {
  const all: string[] = [];
  for (const value of Object.values(vocabulary)) {
    if (typeof value === "string") all.push(value);
    else if (Array.isArray(value)) all.push(...value.filter((item) => typeof item === "string"));
    else if (value && typeof value === "object") {
      for (const entry of Object.values(value)) {
        if (typeof entry === "string") all.push(entry);
        if (Array.isArray(entry)) all.push(...entry);
      }
    }
  }

  it("is written only in Roman script (no Devanagari, no Bengali)", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const text of all) expect(text).not.toMatch(/[\u0900-\u097F\u0980-\u09FF]/);
  });

  it("contains no English-only status lines", () => {
    const englishOnly =
      /^(thinking|working|searching|analyzing|loading|processing|executing|retrying|finalizing|completed|please wait|something went wrong)\b/i;
    for (const text of all) expect(text).not.toMatch(englishOnly);
    // Every full sentence carries Hindi grammar.
    const hindi =
      /\b(hai|hain|ho|raha|rahi|rahe|gaya|gayi|gaye|ka|ki|ke|mein|se|kar|karein|nahi|abhi|aap|kaam|dijiye|lekar|line|ruka|ruki|poore|chal)\b/i;
    for (const text of all.filter((line) => line.includes(" ") && !line.includes("{"))) {
      expect(text, text).toMatch(hindi);
    }
  });
});
