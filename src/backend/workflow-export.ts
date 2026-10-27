import type {
  BotSummary,
  ConversationMessage,
  OrchestratorRun,
  Routine,
  RoutinesState,
  SaveRoutineInput,
  WorkflowDoc,
  WorkflowFormat,
  WorkflowTimelineEntry,
} from "../shared/ipc";
import { isRecord } from "./protocol";

export const WORKFLOW_FORMAT = "sahkarmi.workflow/v1";
const MAX_TEXT = 4_000;
const MAX_DETAIL = 400;
const MAX_STEPS = 50;

/** Passwords, OTPs, card numbers and API keys never leave the app in an export. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|AIza)[-_][A-Za-z0-9_-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b(password|passcode|passwd|pwd|otp|pin|api[_ -]?key|token|secret)(\s*[:=]\s*)[^\s,;]+/gi,
  /\b(bearer)\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
];

export function hideSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (_match, label?: string, separator?: string) =>
      typeof label === "string" && typeof separator === "string"
        ? `${label}${separator}[hidden]`
        : typeof label === "string" && /^bearer$/i.test(label)
          ? `${label} [hidden]`
          : "[hidden]",
    );
  }
  return result;
}

function clean(text: string | null | undefined, max = MAX_TEXT): string {
  const value = hideSecrets(String(text ?? "").trim());
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function oneLine(text: string | null | undefined, max = MAX_DETAIL): string {
  return clean(String(text ?? "").replace(/\s+/g, " "), max);
}

/** "mcp__sahkarmi_browser__act" → "browser act". */
function toolLabel(name: string): string {
  return name
    .replace(/^mcp__/, "")
    .replace(/^sahkarmi_?/, "")
    .replace(/__/g, " ")
    .replace(/_/g, " ")
    .trim();
}

function durationMs(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** One coworker's chat (the last task, or all of it) as a workflow. */
export function chatWorkflow(
  bot: BotSummary,
  messages: ConversationMessage[],
  scope: "last" | "all",
  bots: BotSummary[],
): WorkflowDoc {
  let slice = messages;
  if (scope === "last") {
    const lastAsk = messages.map((message) => message.author).lastIndexOf("user");
    slice = lastAsk >= 0 ? messages.slice(lastAsk) : messages;
  }
  const nameOf = (botId?: string) => bots.find((candidate) => candidate.id === botId)?.name;
  const timeline: WorkflowTimelineEntry[] = [];
  const steps: WorkflowDoc["steps"] = [];
  const others = new Set<string>();
  let toolCalls = 0;
  let lastAnswer = "";
  for (const message of slice) {
    if (message.tool) {
      toolCalls += 1;
      timeline.push({
        at: message.createdAt,
        by: bot.name,
        kind: "step",
        text: toolLabel(message.tool.name),
        detail: oneLine(message.tool.input) || undefined,
        status: message.tool.status === "failed" ? "failed" : undefined,
      });
      continue;
    }
    const text = clean(message.text);
    if (!text) continue;
    if (message.exchange || message.senderBotId) {
      const sender = nameOf(message.senderBotId ?? message.exchange?.senderBotId) ?? "Coworker";
      if (sender !== bot.name) others.add(sender);
      timeline.push({ at: message.createdAt, by: sender, kind: "message", text });
      continue;
    }
    if (message.author === "user") {
      timeline.push({ at: message.createdAt, by: "Owner", kind: "asked", text });
      if (steps.length < MAX_STEPS) steps.push({ by: bot.name, do: text });
      continue;
    }
    if (message.author === "assistant") {
      const thinking = message.itemType === "commentary" || message.itemType === "reasoning";
      timeline.push({
        at: message.createdAt,
        by: bot.name,
        kind: thinking ? "note" : "said",
        text,
      });
      if (!thinking) lastAnswer = text;
    }
  }
  const first = slice[0]?.createdAt ?? null;
  const last = slice.at(-1)?.createdAt ?? null;
  const lastStatus = slice.at(-1)?.status;
  return {
    format: WORKFLOW_FORMAT,
    name: `${bot.name}: ${steps[0] ? oneLine(steps[0].do, 60) : "chat"}`,
    exportedAt: new Date().toISOString(),
    source: "chat",
    goal: steps[0]?.do,
    coworkers: [
      { name: bot.name, role: bot.role || undefined, model: bot.model },
      ...[...others].map((name) => ({ name })),
    ],
    steps,
    timeline,
    result: {
      status:
        lastStatus === "failed" ? "failed" : lastStatus === "streaming" ? "running" : "completed",
      summary: lastAnswer || undefined,
      files: [],
    },
    run: { startedAt: first, finishedAt: last, durationMs: durationMs(first, last), toolCalls },
  };
}

/** A team (orchestrator) run: the plan, who did what, their messages and the result. */
export function teamRunWorkflow(run: OrchestratorRun, bots: BotSummary[]): WorkflowDoc {
  const nameOf = (botId: string) =>
    bots.find((bot) => bot.id === botId)?.name ??
    run.instances.find((instance) => instance.botId === botId)?.botName ??
    "Coworker";
  const coworkers = new Map<string, WorkflowDoc["coworkers"][number]>();
  for (const task of run.tasks) {
    const name = nameOf(task.assignedBotId);
    if (!coworkers.has(name)) coworkers.set(name, { name, role: task.role });
  }
  const timeline: WorkflowTimelineEntry[] = [
    { at: run.startedAt, by: "Owner", kind: "asked", text: clean(run.objective) },
  ];
  for (const task of run.tasks) {
    timeline.push({
      at: task.createdAt,
      by: nameOf(task.assignedBotId),
      kind: "task",
      text: clean(task.title, 200),
      detail: oneLine(task.description) || undefined,
      status: task.status,
    });
  }
  for (const message of run.messages) {
    timeline.push({
      at: message.createdAt,
      by: nameOf(message.senderBotId),
      kind: "message",
      text: `→ ${nameOf(message.recipientBotId)}: ${clean(message.summary, 1_000)}`,
    });
  }
  timeline.sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
  const files = run.deliverables.map((file) => file.path ?? file.name);
  return {
    format: WORKFLOW_FORMAT,
    name: oneLine(run.objective, 80) || "Team run",
    exportedAt: new Date().toISOString(),
    source: "team-run",
    goal: clean(run.objective),
    coworkers: [...coworkers.values()],
    steps: run.tasks.slice(0, MAX_STEPS).map((task) => ({
      by: nameOf(task.assignedBotId),
      do: clean(
        [task.title, task.description].filter(Boolean).join(": ") +
          (task.acceptanceCriteria.length
            ? `\nDone when: ${task.acceptanceCriteria.join("; ")}`
            : ""),
        2_000,
      ),
    })),
    timeline,
    result: {
      status: run.status,
      summary: run.error ? clean(run.error) : undefined,
      files: files.map((file) => clean(file, 300)),
    },
    run: {
      startedAt: run.startedAt,
      finishedAt: run.completedAt,
      durationMs: durationMs(run.startedAt, run.completedAt),
      toolCalls: null,
    },
  };
}

/** A routine (steps handed to coworkers in order) with its latest run. */
export function routineWorkflow(
  routine: Routine,
  state: RoutinesState,
  bots: BotSummary[],
): WorkflowDoc {
  const nameOf = (botId: string) => bots.find((bot) => bot.id === botId)?.name ?? "Coworker";
  const lastRun = state.runs.find((run) => run.routineId === routine.id);
  const coworkers = new Map<string, WorkflowDoc["coworkers"][number]>();
  for (const step of routine.steps) {
    const bot = bots.find((candidate) => candidate.id === step.botId);
    const name = nameOf(step.botId);
    if (!coworkers.has(name)) coworkers.set(name, { name, role: bot?.role || undefined });
  }
  const timeline: WorkflowTimelineEntry[] = (lastRun?.steps ?? []).flatMap((step) => [
    {
      at: step.startedAt ?? undefined,
      by: nameOf(step.botId),
      kind: "task" as const,
      text: clean(step.instruction, 300),
      status: step.status,
    },
    ...(step.result
      ? [
          {
            at: step.finishedAt ?? undefined,
            by: nameOf(step.botId),
            kind: "said" as const,
            text: clean(step.result),
          },
        ]
      : []),
  ]);
  return {
    format: WORKFLOW_FORMAT,
    name: routine.name,
    exportedAt: new Date().toISOString(),
    source: "routine",
    coworkers: [...coworkers.values()],
    steps: routine.steps.map((step) => ({
      by: nameOf(step.botId),
      do: clean(step.instruction, 2_000),
    })),
    schedule: routine.cadence ?? undefined,
    timeline,
    result: lastRun ? { status: lastRun.status, files: [] } : undefined,
    run: lastRun
      ? {
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          durationMs: durationMs(lastRun.startedAt, lastRun.finishedAt),
          toolCalls: null,
        }
      : undefined,
  };
}

const KIND_ICON: Record<WorkflowTimelineEntry["kind"], string> = {
  asked: "🙋",
  said: "💬",
  note: "💭",
  step: "🔧",
  message: "✉️",
  task: "📌",
};

const STATUS_ICON: Record<string, string> = {
  completed: "✅",
  done: "✅",
  failed: "❌",
  running: "⏳",
  paused: "⏸️",
  planning: "🗺️",
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatTime(at: string | undefined | null): string {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const SOURCE_LABEL: Record<WorkflowDoc["source"], string> = {
  chat: "Coworker chat",
  "team-run": "Team run",
  routine: "Routine",
};

/** A Markdown report that reads well on GitHub, in VS Code or in Notion. */
export function workflowMarkdown(doc: WorkflowDoc): string {
  const quote = (text: string) =>
    text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  const lines: string[] = [`# ${doc.name}`, ""];
  const facts = [
    `**Type:** ${SOURCE_LABEL[doc.source]}`,
    `**Coworkers:** ${doc.coworkers.map((coworker) => coworker.name).join(", ") || "—"}`,
    doc.result
      ? `**Status:** ${STATUS_ICON[doc.result.status] ?? ""} ${doc.result.status}`.trim()
      : "",
    doc.run?.durationMs != null ? `**Took:** ${formatDuration(doc.run.durationMs)}` : "",
    doc.run?.toolCalls ? `**Steps run:** ${doc.run.toolCalls}` : "",
  ].filter(Boolean);
  lines.push(facts.join(" · "), "");
  if (doc.goal) lines.push("## Goal", "", quote(doc.goal), "");
  if (doc.coworkers.length > 0) {
    lines.push("## Coworkers", "", "| Name | Role | Model |", "| --- | --- | --- |");
    for (const coworker of doc.coworkers) {
      lines.push(`| ${coworker.name} | ${coworker.role ?? ""} | ${coworker.model ?? ""} |`);
    }
    lines.push("");
  }
  if (doc.steps.length > 0) {
    lines.push("## Workflow (to run again)", "");
    doc.steps.forEach((step, index) => {
      const [firstLine, ...rest] = step.do.split("\n");
      lines.push(`${index + 1}. **${step.by}:** ${firstLine}`);
      for (const line of rest) lines.push(`   ${line}`);
    });
    lines.push("");
  }
  if (doc.timeline.length > 0) {
    lines.push("## What happened", "");
    for (const entry of doc.timeline) {
      const time = formatTime(entry.at);
      const status = entry.status ? ` ${STATUS_ICON[entry.status] ?? `(${entry.status})`}` : "";
      const head = `- ${KIND_ICON[entry.kind]} ${time ? `\`${time}\` ` : ""}**${entry.by}**`;
      if (entry.kind === "step" || entry.kind === "task") {
        lines.push(`${head}: ${entry.text}${status}`);
        if (entry.detail) lines.push(`  <br><sub>${entry.detail.replace(/[<>]/g, "")}</sub>`);
      } else {
        const [firstLine, ...rest] = entry.text.split("\n");
        lines.push(`${head}: ${firstLine}${status}`);
        for (const line of rest) lines.push(line.trim() ? `  ${line}` : "");
      }
    }
    lines.push("");
  }
  if (doc.result?.summary || doc.result?.files.length) {
    lines.push("## Result", "");
    if (doc.result.summary) lines.push(doc.result.summary, "");
    if (doc.result.files.length) {
      lines.push("**Files:**", ...doc.result.files.map((file) => `- \`${file}\``), "");
    }
  }
  lines.push(
    "---",
    `<sub>Exported from Sahkarmi on ${formatTime(doc.exportedAt)}. Passwords, codes and keys are hidden. Import the .json version in Sahkarmi > Routines to run this workflow.</sub>`,
    "",
  );
  return lines.join("\n");
}

/** Plain text for WhatsApp or email. */
export function workflowText(doc: WorkflowDoc): string {
  const rule = "=".repeat(Math.min(60, Math.max(10, doc.name.length)));
  const lines: string[] = [doc.name, rule];
  lines.push(`Type: ${SOURCE_LABEL[doc.source]}`);
  lines.push(`Coworkers: ${doc.coworkers.map((coworker) => coworker.name).join(", ") || "-"}`);
  if (doc.result) lines.push(`Status: ${doc.result.status}`);
  if (doc.run?.durationMs != null) lines.push(`Took: ${formatDuration(doc.run.durationMs)}`);
  lines.push("");
  if (doc.goal) lines.push("GOAL", doc.goal, "");
  if (doc.steps.length > 0) {
    lines.push("WORKFLOW");
    doc.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.by}: ${step.do.replace(/\n/g, "\n   ")}`);
    });
    lines.push("");
  }
  if (doc.timeline.length > 0) {
    lines.push("WHAT HAPPENED");
    for (const entry of doc.timeline) {
      const time = formatTime(entry.at);
      const status = entry.status ? ` [${entry.status}]` : "";
      lines.push(
        `- ${time ? `${time} ` : ""}${entry.by} (${entry.kind}): ${entry.text.replace(/\n/g, "\n  ")}${status}`,
      );
      if (entry.detail) lines.push(`    ${entry.detail}`);
    }
    lines.push("");
  }
  if (doc.result?.summary) lines.push("RESULT", doc.result.summary, "");
  if (doc.result?.files.length)
    lines.push("FILES", ...doc.result.files.map((file) => `- ${file}`), "");
  lines.push(
    `Exported from Sahkarmi, ${formatTime(doc.exportedAt)}. Passwords, codes and keys are hidden.`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderWorkflow(doc: WorkflowDoc, format: WorkflowFormat): string {
  if (format === "md") return workflowMarkdown(doc);
  if (format === "txt") return workflowText(doc);
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** A safe file name: "Daily report: 27 Oct" → "daily-report-27-oct". */
export function workflowFileName(doc: WorkflowDoc, format: WorkflowFormat): string {
  const slug =
    doc.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workflow";
  return `${slug}-${doc.exportedAt.slice(0, 10)}.${format}`;
}

/** Reads an exported .json workflow; anything else is refused with a clear reason. */
export function parseWorkflowJson(text: string): WorkflowDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON. Choose a .json workflow exported from Sahkarmi.");
  }
  if (!isRecord(parsed) || parsed.format !== WORKFLOW_FORMAT) {
    throw new Error("That is not a Sahkarmi workflow (sahkarmi.workflow/v1).");
  }
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps
        .filter(isRecord)
        .map((step) => ({
          by: String(step.by ?? "").slice(0, 80),
          do: String(step.do ?? "")
            .trim()
            .slice(0, 4_000),
        }))
        .filter((step) => step.do)
        .slice(0, MAX_STEPS)
    : [];
  if (steps.length === 0) throw new Error("That workflow has no steps to run.");
  const coworkers = Array.isArray(parsed.coworkers)
    ? parsed.coworkers.filter(isRecord).map((coworker) => ({
        name: String(coworker.name ?? "").slice(0, 80),
        role: typeof coworker.role === "string" ? coworker.role.slice(0, 80) : undefined,
      }))
    : [];
  const source =
    parsed.source === "team-run" || parsed.source === "routine" ? parsed.source : "chat";
  return {
    format: WORKFLOW_FORMAT,
    name: String(parsed.name ?? "Imported workflow").slice(0, 120) || "Imported workflow",
    exportedAt:
      typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    source,
    goal: typeof parsed.goal === "string" ? parsed.goal.slice(0, 4_000) : undefined,
    coworkers,
    steps,
    timeline: [],
  };
}

/** The routine an imported workflow becomes; `assign` maps each step's coworker name to a bot. */
export function routineFromWorkflow(
  doc: WorkflowDoc,
  assign: Record<string, string>,
  bots: BotSummary[],
): SaveRoutineInput {
  const ids = new Set(bots.map((bot) => bot.id));
  return {
    name: doc.name,
    steps: doc.steps.map((step) => {
      const botId = assign[step.by];
      if (!botId || !ids.has(botId))
        throw new Error(`Choose a coworker for "${step.by || "step"}".`);
      return { botId, instruction: step.do };
    }),
    cadence: null,
    enabled: true,
  };
}

/** Best guess of which of the owner's coworkers should take each name in a workflow. */
export function suggestAssignments(doc: WorkflowDoc, bots: BotSummary[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of new Set(doc.steps.map((step) => step.by))) {
    const role = doc.coworkers.find((coworker) => coworker.name === name)?.role?.toLowerCase();
    const match =
      bots.find((bot) => bot.name.toLowerCase() === name.toLowerCase()) ??
      (role ? bots.find((bot) => bot.role.toLowerCase() === role) : undefined) ??
      bots[0];
    if (match) result[name] = match.id;
  }
  return result;
}
