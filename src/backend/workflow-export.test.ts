// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  BotSummary,
  ConversationMessage,
  OrchestratorRun,
  RoutinesState,
} from "../shared/ipc";
import {
  chatWorkflow,
  hideSecrets,
  parseWorkflowJson,
  renderWorkflow,
  routineFromWorkflow,
  routineWorkflow,
  suggestAssignments,
  teamRunWorkflow,
  workflowFileName,
} from "./workflow-export";

const bot = (id: string, name: string, role = ""): BotSummary =>
  ({ id, name, role, model: "claude-opus-5" }) as unknown as BotSummary;

const reporter = bot("b1", "1xl reporting", "reporting");
const writer = bot("b2", "Writer", "writing");

const message = (patch: Partial<ConversationMessage>): ConversationMessage => ({
  id: Math.random().toString(36),
  author: "assistant",
  text: "",
  createdAt: "2026-10-27T10:00:00.000Z",
  status: "completed",
  ...patch,
});

const chat: ConversationMessage[] = [
  message({ author: "user", text: "Old task", createdAt: "2026-10-26T10:00:00.000Z" }),
  message({ text: "Old answer", createdAt: "2026-10-26T10:01:00.000Z" }),
  message({ author: "user", text: "Fill today's work log", createdAt: "2026-10-27T10:00:00.000Z" }),
  message({
    text: "",
    tool: {
      name: "mcp__sahkarmi_browser__open",
      kind: "browser",
      status: "completed",
      input: '{"url":"https://app.taskmagix.com"}',
      output: null,
    },
    createdAt: "2026-10-27T10:00:10.000Z",
  }),
  message({
    text: "The password: hunter22 was typed by the owner.",
    createdAt: "2026-10-27T10:01:00.000Z",
  }),
  message({
    text: "",
    tool: { name: "act", kind: "browser", status: "failed", input: null, output: null },
    createdAt: "2026-10-27T10:02:00.000Z",
  }),
  message({ text: "Report saved, 5 rows.", createdAt: "2026-10-27T10:03:16.000Z" }),
];

describe("hideSecrets", () => {
  it("hides keys, card numbers and labelled passwords", () => {
    expect(hideSecrets("key sk-ant-abcdefghijklmnop1234 card 4111 1111 1111 1111")).toBe(
      "key [hidden] card [hidden]",
    );
    expect(hideSecrets("otp: 482913, Authorization: Bearer abcdefghijklmnopqrstu")).toBe(
      "otp: [hidden], Authorization: Bearer [hidden]",
    );
  });
});

describe("chatWorkflow", () => {
  it("exports the last task with steps, timing and hidden secrets", () => {
    const doc = chatWorkflow(reporter, chat, "last", [reporter]);
    expect(doc.format).toBe("sahkarmi.workflow/v1");
    expect(doc.steps).toEqual([{ by: "1xl reporting", do: "Fill today's work log" }]);
    expect(doc.timeline.map((entry) => entry.kind)).toEqual([
      "asked",
      "step",
      "said",
      "step",
      "said",
    ]);
    expect(doc.timeline[1]).toMatchObject({ text: "browser open" });
    expect(doc.timeline[3]?.status).toBe("failed");
    expect(JSON.stringify(doc)).not.toContain("hunter22");
    expect(doc.run).toMatchObject({ toolCalls: 2, durationMs: 196_000 });
    expect(doc.result?.summary).toBe("Report saved, 5 rows.");
  });

  it("exports the whole chat when asked", () => {
    const doc = chatWorkflow(reporter, chat, "all", [reporter]);
    expect(doc.steps.map((step) => step.do)).toEqual(["Old task", "Fill today's work log"]);
  });
});

describe("rendering", () => {
  const doc = chatWorkflow(reporter, chat, "last", [reporter]);

  it("writes a readable Markdown report", () => {
    const md = renderWorkflow(doc, "md");
    expect(md).toMatch(/^# 1xl reporting: Fill today's work log/);
    expect(md).toContain("**Took:** 3 min 16 s");
    expect(md).toContain("## Workflow (to run again)");
    expect(md).toContain("1. **1xl reporting:** Fill today's work log");
    expect(md).toContain("🔧");
    expect(md).toContain("## Result");
    expect(md).not.toContain("hunter22");
  });

  it("writes plain text and JSON that round-trips", () => {
    const text = renderWorkflow(doc, "txt");
    expect(text).toContain("WORKFLOW\n1. 1xl reporting: Fill today's work log");
    expect(text).not.toContain("**");
    const back = parseWorkflowJson(renderWorkflow(doc, "json"));
    expect(back.steps).toEqual(doc.steps);
    expect(workflowFileName(doc, "md")).toMatch(
      /^1xl-reporting-fill-today-s-work-log-\d{4}-\d{2}-\d{2}\.md$/,
    );
  });
});

describe("team runs and routines", () => {
  it("exports a team run's plan, people, messages and files", () => {
    const run = {
      id: "r1",
      objective: "Launch the Diwali sale page",
      status: "completed",
      startedAt: "2026-10-27T09:00:00.000Z",
      completedAt: "2026-10-27T09:30:00.000Z",
      error: null,
      instances: [],
      tasks: [
        {
          id: "t1",
          title: "Write copy",
          description: "Hindi and English",
          role: "writer",
          assignedBotId: "b2",
          acceptanceCriteria: ["Both languages"],
          status: "completed",
          createdAt: "2026-10-27T09:01:00.000Z",
        },
      ],
      messages: [
        {
          senderBotId: "b2",
          recipientBotId: "b1",
          summary: "Copy ready",
          createdAt: "2026-10-27T09:10:00.000Z",
        },
      ],
      deliverables: [{ name: "copy.md", path: "Shared/copy.md" }],
    } as unknown as OrchestratorRun;
    const doc = teamRunWorkflow(run, [reporter, writer]);
    expect(doc.source).toBe("team-run");
    expect(doc.coworkers).toEqual([{ name: "Writer", role: "writer" }]);
    expect(doc.steps[0]?.do).toBe("Write copy: Hindi and English\nDone when: Both languages");
    expect(doc.timeline.map((entry) => entry.kind)).toEqual(["asked", "task", "message"]);
    expect(doc.result?.files).toEqual(["Shared/copy.md"]);
    expect(renderWorkflow(doc, "md")).toContain("`Shared/copy.md`");
  });

  it("exports a routine and turns an import back into a routine for chosen coworkers", () => {
    const state = {
      routines: [
        {
          id: "x",
          name: "Morning report",
          steps: [
            { id: "s1", botId: "b1", instruction: "Collect numbers" },
            { id: "s2", botId: "b2", instruction: "Write summary" },
          ],
          cadence: { kind: "daily", time: "09:00" },
          enabled: true,
          createdAt: "",
          lastRunAt: null,
          nextRunAt: null,
        },
      ],
      runs: [],
    } as unknown as RoutinesState;
    const doc = routineWorkflow(state.routines[0] as never, state, [reporter, writer]);
    expect(doc.schedule).toEqual({ kind: "daily", time: "09:00" });

    const imported = parseWorkflowJson(JSON.stringify(doc));
    const other = [bot("c1", "Data person", "reporting"), bot("c2", "Writer")];
    const assign = suggestAssignments(imported, other);
    expect(assign).toEqual({ "1xl reporting": "c1", Writer: "c2" });
    expect(routineFromWorkflow(imported, assign, other)).toEqual({
      name: "Morning report",
      steps: [
        { botId: "c1", instruction: "Collect numbers" },
        { botId: "c2", instruction: "Write summary" },
      ],
      cadence: null,
      enabled: true,
    });
  });

  it("refuses files that are not Sahkarmi workflows", () => {
    expect(() => parseWorkflowJson("nope")).toThrow(/not valid JSON/);
    expect(() => parseWorkflowJson('{"format":"other"}')).toThrow(/not a Sahkarmi workflow/);
    expect(() => parseWorkflowJson('{"format":"sahkarmi.workflow/v1","steps":[]}')).toThrow(
      /no steps/,
    );
  });
});
