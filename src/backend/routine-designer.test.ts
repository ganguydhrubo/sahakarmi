// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const replies: Array<{ ok: boolean; reply: string | null; error?: string }> = [];
vi.mock("./delivery-wait", () => ({
  waitForDelivery: async () => replies.shift() ?? { ok: false, reply: null, error: "no reply" },
}));

const { designPrompt, designRoutine, parseRoutineDesign } = await import("./routine-designer");

const TEAM = [
  { id: "mitra", name: "Mitra", role: "Orchestrator" },
  { id: "asha", name: "Asha", role: "Accounts" },
];

function port() {
  const sent: string[] = [];
  return {
    sent,
    async sendMessage(input: { botId: string; text: string }) {
      sent.push(input.text);
      return {
        messageId: "m",
        deliveries: [
          { id: `d${sent.length}`, recipientBotId: input.botId, status: "queued", position: 0 },
        ],
      };
    },
    listQueue: () => ({ botId: "mitra", paused: false, deliveries: [] }),
    readConversation: async () => ({ botId: "mitra", threadId: null, messages: [] }),
    on: () => undefined,
    off: () => undefined,
  } as never as Parameters<typeof designRoutine>[0] & { sent: string[] };
}

const GOOD = JSON.stringify({
  name: "Weekly GST",
  schedule: { kind: "weekly", day: 1, time: "09:00" },
  steps: [
    { type: "task", coworkerId: "asha", do: "Total last week's GST." },
    { type: "check", coworkerId: "asha", do: "Is anything wrong?", ifNoSkipTo: 4 },
    { type: "approval", do: "Email the CA?" },
    { type: "output", sendTo: "file" },
    { type: "output", sendTo: "telegram" },
  ],
});

beforeEach(() => {
  replies.length = 0;
});

describe("routine designer", () => {
  it("turns the coworker's JSON into a draft with every step type", () => {
    const outcome = parseRoutineDesign(`Here you go:\n\`\`\`json\n${GOOD}\n\`\`\``, TEAM);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.draft.name).toBe("Weekly GST");
    expect(outcome.draft.cadence).toEqual({ kind: "weekly", day: 1, time: "09:00" });
    expect(outcome.draft.steps.map((step) => step.kind ?? "agent")).toEqual([
      "agent",
      "condition",
      "approval",
      "output",
      "output",
    ]);
    expect(outcome.draft.steps[1]?.onNo).toEqual({ action: "jump", stepId: "d4" });
    // The owner picks the folder in the editor.
    expect(outcome.draft.steps[3]?.output).toEqual({ kind: "file", folder: "" });
    expect(outcome.draft.steps[4]?.output).toEqual({ kind: "telegram" });
  });

  it("gives a reason the coworker can fix for an unusable design", () => {
    const bad = (steps: unknown[], extra: Record<string, unknown> = {}) =>
      parseRoutineDesign(JSON.stringify({ name: "x", steps, ...extra }), TEAM);
    expect(parseRoutineDesign("Sorry, I can't.", TEAM)).toEqual({
      ok: false,
      error: "The reply was not valid JSON.",
    });
    expect(bad([{ type: "task", coworkerId: "nobody", do: "x" }])).toMatchObject({
      error: expect.stringContaining("not in the list"),
    });
    expect(bad([{ type: "output", sendTo: "file" }])).toMatchObject({
      error: expect.stringContaining("first step"),
    });
    expect(
      bad([
        { type: "task", coworkerId: "asha", do: "a" },
        { type: "check", coworkerId: "asha", do: "b?", ifNoSkipTo: 1 },
      ]),
    ).toMatchObject({ error: expect.stringContaining("later step") });
    expect(bad([{ type: "approval", do: "Go?" }])).toMatchObject({
      error: expect.stringContaining("at least one task"),
    });
  });

  it("leaves an unclear schedule as Run now", () => {
    const outcome = parseRoutineDesign(
      JSON.stringify({
        name: "x",
        schedule: { kind: "weekly", day: 9, time: "25:00" },
        steps: [{ type: "task", coworkerId: "asha", do: "a" }],
      }),
      TEAM,
    );
    expect(outcome.ok && outcome.draft.cadence).toBeNull();
  });

  it("asks once more with the reason, then returns the draft", async () => {
    replies.push(
      { ok: true, reply: '{"steps":[{"type":"task","coworkerId":"ghost","do":"x"}]}' },
      { ok: true, reply: GOOD },
    );
    const fake = port();
    const outcome = await designRoutine(fake, "mitra", "GST every Monday", TEAM);
    expect(outcome.ok).toBe(true);
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]).toContain("could not be used");
    expect(fake.sent[0]).toContain("- asha: Asha (Accounts)");
  });

  it("does not ask for an empty description", async () => {
    const fake = port();
    await expect(designRoutine(fake, "mitra", "   ", TEAM)).resolves.toMatchObject({ ok: false });
    expect(fake.sent).toHaveLength(0);
    expect(designPrompt("x", TEAM, null)).toContain("Reply with JSON only");
  });
});
