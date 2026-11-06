import { z } from "zod";
import type { BotSummary, OrchestratorSpecialistRole, SendMessageInput } from "../shared/ipc";
import { type DeliveryWaitPort, waitForDelivery } from "./delivery-wait";

/** Tasks a CEO may plan for one run; more is split into another run. */
export const MAX_PLANNED_TASKS = 8;
/** Times a CEO is asked again after an unusable plan, before the standard template is used. */
export const MAX_REPLANS = 2;
const PLAN_TIMEOUT_MS = 10 * 60_000;

const ROLES = [
  "architect",
  "frontend",
  "backend",
  "code",
  "qa",
  "security",
  "research",
  "finance",
  "ops",
] as const satisfies readonly OrchestratorSpecialistRole[];

const plannedTask = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000),
  role: z.enum(ROLES).catch("code"),
  /** A coworker id from the list the CEO was given; otherwise the role decides. */
  coworkerId: z.string().trim().max(80).optional().nullable(),
  /** 1-based numbers of earlier tasks this one needs. */
  dependsOn: z.array(z.number().int().min(1)).max(MAX_PLANNED_TASKS).default([]),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
});

export const ceoPlanSchema = z.object({
  tasks: z.array(plannedTask).min(1).max(MAX_PLANNED_TASKS),
});

export type CeoPlan = z.infer<typeof ceoPlanSchema>;
export type PlannedTask = CeoPlan["tasks"][number];

export interface PlannerPort extends DeliveryWaitPort {
  sendMessage(input: SendMessageInput): Promise<{ deliveries: Array<{ id: string }> }>;
}

/** The first JSON object in a reply (a ```json fence, or the outermost braces). */
function jsonIn(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)?.[1];
  const text = fenced ?? reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  if (!text.trim()) throw new Error("The reply had no JSON plan.");
  return JSON.parse(text);
}

/**
 * Reads a CEO's plan. Unusable plans are explained in one sentence, so the CEO can be asked
 * again with the reason: bad JSON, a missing field, a task that depends on itself or on a
 * later task (the order must be one a team can follow).
 */
export function parseCeoPlan(
  reply: string,
): { ok: true; plan: CeoPlan } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = jsonIn(reply);
  } catch (error) {
    return { ok: false, error: `The plan was not valid JSON (${String(error)}).` };
  }
  const parsed = ceoPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error:
        `The plan did not match the format: ${issue?.path.join(".") || "plan"} ${issue?.message ?? ""}`.trim(),
    };
  }
  for (const [index, task] of parsed.data.tasks.entries()) {
    const bad = task.dependsOn.find((number) => number >= index + 1);
    if (bad !== undefined) {
      return {
        ok: false,
        error: `Task ${index + 1} depends on task ${bad}; a task may only depend on earlier tasks.`,
      };
    }
  }
  return { ok: true, plan: parsed.data };
}

export function planningPrompt(
  objective: string,
  coworkers: Array<Pick<BotSummary, "id" | "name" | "description">>,
  problem: string | null,
): string {
  const team = coworkers
    .map((bot) => `- ${bot.id}: ${bot.name}${bot.description ? ` (${bot.description})` : ""}`)
    .join("\n");
  return [
    "[Team run planning] Plan this goal as a short list of tasks for your team. Do not start the work yourself.",
    "",
    `Goal: ${objective}`,
    "",
    "Coworkers you can give tasks to:",
    team,
    "",
    `Reply with JSON only, in this shape (at most ${MAX_PLANNED_TASKS} tasks):`,
    '{"tasks":[{"title":"...","description":"what to do and what to hand back","role":"architect|frontend|backend|code|qa|security|research|finance|ops","coworkerId":"an id from the list","dependsOn":[1],"acceptanceCriteria":["..."]}]}',
    "dependsOn lists the numbers of earlier tasks this one needs (the first task is 1).",
    ...(problem ? ["", `Your last plan could not be used: ${problem} Send a corrected plan.`] : []),
  ].join("\n");
}

export type PlanOutcome =
  | { ok: true; plan: CeoPlan; replans: number }
  | { ok: false; error: string; replans: number };

/**
 * Asks the CEO for a plan and checks it. An unusable plan is sent back with the reason, at most
 * MAX_REPLANS times; after that (or when the CEO's turn fails) the caller uses its template.
 */
export async function planWithCeo(
  port: PlannerPort,
  ceoBotId: string,
  objective: string,
  coworkers: Array<Pick<BotSummary, "id" | "name" | "description">>,
  options: { timeoutMs?: number; signal?: AbortSignal; retryGraceMs?: number } = {},
): Promise<PlanOutcome> {
  let problem: string | null = null;
  for (let attempt = 0; attempt <= MAX_REPLANS; attempt += 1) {
    const receipt = await port.sendMessage({
      botId: ceoBotId,
      text: planningPrompt(objective, coworkers, problem),
      origin: "team-run",
    });
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId)
      return { ok: false, error: "The CEO did not get the request.", replans: attempt };
    const outcome = await waitForDelivery(port, ceoBotId, deliveryId, {
      timeoutMs: options.timeoutMs ?? PLAN_TIMEOUT_MS,
      signal: options.signal,
      retryGraceMs: options.retryGraceMs,
    });
    if (!outcome.ok || !outcome.reply) {
      return {
        ok: false,
        error: outcome.error ?? "The CEO did not send a plan.",
        replans: attempt,
      };
    }
    const parsed = parseCeoPlan(outcome.reply);
    if (parsed.ok) return { ok: true, plan: parsed.plan, replans: attempt };
    problem = parsed.error;
  }
  return { ok: false, error: problem ?? "The plan could not be used.", replans: MAX_REPLANS };
}
