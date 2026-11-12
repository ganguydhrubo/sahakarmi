import { type RoutineCadence, type RoutineDraft, WEEKDAYS } from "../shared/ipc";
import { type DeliveryWaitPort, waitForDelivery } from "./delivery-wait";
import { isRecord } from "./protocol";
import type { RoutineAgentPort } from "./routine-executor";

/** A plan is asked for again with the reason at most this many times. */
const MAX_RETRIES = 1;
const DESIGN_TIMEOUT_MS = 5 * 60_000;
const MAX_STEPS = 20;

type DesignPort = Pick<RoutineAgentPort, "sendMessage"> & DeliveryWaitPort;

export type DesignOutcome = { ok: true; draft: RoutineDraft } | { ok: false; error: string };

/**
 * "Describe it and Sahkarmi builds it": a coworker (usually the orchestrator) turns the owner's
 * words into a routine. The result is only a draft for the editor; nothing is saved or run.
 */
export async function designRoutine(
  port: DesignPort,
  designerBotId: string,
  description: string,
  coworkers: Array<{ id: string; name: string; role: string }>,
  options: { timeoutMs?: number } = {},
): Promise<DesignOutcome> {
  const wish = description.trim().slice(0, 4_000);
  if (!wish) return { ok: false, error: "Describe what the routine should do." };
  let problem: string | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const receipt = await port.sendMessage({
      botId: designerBotId,
      text: designPrompt(wish, coworkers, problem),
      origin: "routine",
    });
    const deliveryId = receipt.deliveries.find(
      (delivery) => delivery.recipientBotId === designerBotId,
    )?.id;
    if (!deliveryId) return { ok: false, error: "The coworker did not get the request." };
    const outcome = await waitForDelivery(port, designerBotId, deliveryId, {
      timeoutMs: options.timeoutMs ?? DESIGN_TIMEOUT_MS,
    });
    if (!outcome.ok || !outcome.reply) {
      return { ok: false, error: outcome.error ?? "The coworker did not send a routine." };
    }
    const parsed = parseRoutineDesign(outcome.reply, coworkers);
    if (parsed.ok) return parsed;
    problem = parsed.error;
  }
  return { ok: false, error: problem ?? "The routine could not be used." };
}

export function designPrompt(
  wish: string,
  coworkers: Array<{ id: string; name: string; role: string }>,
  problem: string | null,
): string {
  return [
    "[Routine design] The owner wants a routine (an automatic workflow). Design it; do not do any of the work now.",
    "",
    `What the owner wants: ${wish}`,
    "",
    "Coworkers you can use:",
    ...coworkers.map((bot) => `- ${bot.id}: ${bot.name} (${bot.role})`),
    "",
    "Step types:",
    '- "task": a coworker does something; its result goes to the next step.',
    '- "check": a coworker answers a yes/no question about the result so far. Yes goes on. No stops, or skips to the step number in "ifNoSkipTo" (a later step).',
    '- "approval": the owner is asked first (question in "do"). Put one before anything that sends, posts, pays or deletes.',
    '- "output": the result so far is saved to a file ("sendTo":"file") or sent to the owner\'s Telegram ("sendTo":"telegram").',
    "",
    `Reply with JSON only, in this shape (at most ${MAX_STEPS} steps):`,
    '{"name":"short name","schedule":{"kind":"manual|daily|weekdays|weekly","day":1,"time":"09:00"},"steps":[{"type":"task|check|approval|output","coworkerId":"an id from the list (task and check only)","do":"the instruction or question","ifNoSkipTo":3,"sendTo":"file|telegram"}]}',
    'Use "manual" when the owner gave no time. For weekly, "day" is 0 (Sunday) to 6 (Saturday).',
    ...(problem
      ? ["", `Your last design could not be used: ${problem} Send a corrected one.`]
      : []),
  ].join("\n");
}

/** Reads the coworker's JSON. Returns a reason the coworker can fix when it is unusable. */
export function parseRoutineDesign(reply: string, coworkers: Array<{ id: string }>): DesignOutcome {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  let value: unknown;
  try {
    value = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : null;
  } catch {
    value = null;
  }
  if (!isRecord(value)) return { ok: false, error: "The reply was not valid JSON." };
  const raw = Array.isArray(value.steps) ? value.steps.filter(isRecord) : [];
  if (raw.length === 0) return { ok: false, error: "It has no steps." };
  if (raw.length > MAX_STEPS) return { ok: false, error: `It has more than ${MAX_STEPS} steps.` };
  const known = new Set(coworkers.map((bot) => bot.id));
  const ids = raw.map((_, index) => `d${index + 1}`);
  const steps: RoutineDraft["steps"] = [];
  for (const [index, step] of raw.entries()) {
    const id = ids[index] as string;
    const text = typeof step.do === "string" ? step.do.trim().slice(0, 4_000) : "";
    const type = step.type;
    if (type === "approval" || type === "output") {
      if (type === "approval") {
        if (!text) return { ok: false, error: `Step ${index + 1} needs a question.` };
        steps.push({ id, kind: "approval", botId: "", instruction: text });
      } else {
        if (index === 0) return { ok: false, error: "An output cannot be the first step." };
        steps.push({
          id,
          kind: "output",
          botId: "",
          instruction: "",
          output: step.sendTo === "telegram" ? { kind: "telegram" } : { kind: "file", folder: "" },
        });
      }
      continue;
    }
    if (type !== "task" && type !== "check") {
      return { ok: false, error: `Step ${index + 1} has an unknown type.` };
    }
    const botId = typeof step.coworkerId === "string" ? step.coworkerId : "";
    if (!known.has(botId)) {
      return { ok: false, error: `Step ${index + 1} names a coworker that is not in the list.` };
    }
    if (!text) return { ok: false, error: `Step ${index + 1} has no instruction.` };
    if (type === "task") {
      steps.push({ id, botId, instruction: text });
      continue;
    }
    const to = step.ifNoSkipTo;
    if (to !== undefined && to !== null) {
      if (!Number.isInteger(to) || (to as number) <= index + 1 || (to as number) > raw.length) {
        return { ok: false, error: `Step ${index + 1} can only skip to a later step.` };
      }
    }
    steps.push({
      id,
      kind: "condition",
      botId,
      instruction: text,
      onNo:
        typeof to === "number"
          ? { action: "jump", stepId: ids[to - 1] as string }
          : { action: "stop" },
    });
  }
  if (!steps.some((step) => !step.kind || step.kind === "condition")) {
    return { ok: false, error: "It needs at least one task for a coworker." };
  }
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 80)
      : "New routine";
  return { ok: true, draft: { name, steps, cadence: parseSchedule(value.schedule) } };
}

/** An unclear schedule becomes "only with Run now"; the owner sets it in the editor. */
function parseSchedule(value: unknown): RoutineCadence | null {
  if (!isRecord(value)) return null;
  const time =
    typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
      ? value.time
      : null;
  if (!time) return null;
  if (value.kind === "daily") return { kind: "daily", time };
  if (value.kind === "weekdays") return { kind: "weekdays", time };
  if (value.kind === "weekly") {
    const day = WEEKDAYS.find((candidate) => candidate === value.day);
    return day === undefined ? null : { kind: "weekly", day, time };
  }
  return null;
}
