import type { OrchestratorSpecialistRole } from "../../shared/ipc";

/**
 * Sorts a task into one of a few kinds of work, from its words alone. Deterministic and
 * explainable: the result lists the words that decided it. No model, no network.
 *
 * The kinds are deliberately broad: learning needs several examples per kind, and a coworker's
 * track record on "code" says something useful about the next "code" task.
 */
export const TASK_CATEGORIES = [
  "code",
  "testing",
  "research",
  "writing",
  "data",
  "browser",
  "design",
  "ops",
  "security",
  "general",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface TaskClassification {
  category: TaskCategory;
  /** 0..1: share of the matched weight that went to the winning kind (0 for "general"). */
  confidence: number;
  /** The words that decided it, at most 6. */
  matched: string[];
  /** Score of every kind that matched anything, best first. */
  scores: Array<{ category: TaskCategory; score: number }>;
}

/** Word stems per kind, with a weight. A stem matches the start of a word ("deploy" ⊂ "deploying"). */
const LEXICON: Record<Exclude<TaskCategory, "general">, Array<[string, number]>> = {
  code: [
    ["code", 2],
    ["coding", 2],
    ["implement", 2],
    ["refactor", 3],
    ["function", 1.5],
    ["bug", 2],
    ["fix", 1],
    ["compile", 2],
    ["typescript", 3],
    ["javascript", 3],
    ["python", 3],
    ["react", 2],
    ["api", 1.5],
    ["endpoint", 2],
    ["backend", 2],
    ["frontend", 2],
    ["database", 1.5],
    ["schema", 1.5],
    ["migration", 1.5],
    ["repo", 2],
    ["commit", 2],
    ["branch", 1.5],
    ["merge", 1],
    ["build", 1],
    ["script", 1.5],
    ["class", 1],
    ["module", 1.5],
    ["component", 1.5],
    ["css", 2],
    ["html", 1.5],
    ["sql", 2],
    ["npm", 2],
    ["bun", 1.5],
    ["lint", 2],
    ["typecheck", 2],
    ["architecture", 1.5],
  ],
  testing: [
    ["test", 2.5],
    ["tests", 2.5],
    ["unit test", 3],
    ["regression", 3],
    ["qa", 3],
    ["verify", 1.5],
    ["validate", 1.5],
    ["coverage", 2.5],
    ["e2e", 3],
    ["end-to-end", 2],
    ["assert", 2],
    ["vitest", 3],
    ["jest", 3],
    ["pytest", 3],
    ["playwright", 2.5],
    ["smoke", 2],
  ],
  research: [
    ["research", 3],
    ["investigate", 2],
    ["compare", 2],
    ["comparison", 2],
    ["find out", 2],
    ["market", 1.5],
    ["competitor", 2.5],
    ["analyse", 1.5],
    ["analyze", 1.5],
    ["study", 1.5],
    ["sources", 2],
    ["survey", 1.5],
    ["benchmark", 1.5],
    ["feasibility", 2.5],
    ["trend", 1.5],
    ["look up", 1.5],
  ],
  writing: [
    ["write", 1.5],
    ["draft", 2],
    ["blog", 3],
    ["article", 3],
    ["post", 1],
    ["caption", 3],
    ["copy", 1.5],
    ["content", 2],
    ["email", 1.5],
    ["newsletter", 3],
    ["proofread", 3],
    ["translate", 2.5],
    ["summary", 1.5],
    ["summarise", 2],
    ["summarize", 2],
    ["script", 0.5],
    ["headline", 2.5],
    ["seo", 2],
    ["tone", 1.5],
    ["story", 1.5],
    ["press release", 3],
  ],
  data: [
    ["spreadsheet", 3],
    ["excel", 3],
    ["csv", 2.5],
    ["sheet", 2],
    ["invoice", 3],
    ["gst", 3],
    ["tax", 2],
    ["accounts", 2],
    ["accounting", 3],
    ["ledger", 3],
    ["budget", 2],
    ["revenue", 2],
    ["expense", 2.5],
    ["payroll", 3],
    ["report", 1],
    ["chart", 1.5],
    ["dashboard", 1.5],
    ["metrics", 1.5],
    ["forecast", 2],
    ["calculate", 2],
    ["reconcile", 3],
    ["finance", 2.5],
  ],
  browser: [
    ["browser", 3],
    ["website", 1.5],
    ["web page", 2],
    ["webpage", 2],
    ["login", 2],
    ["log in", 2],
    ["sign in", 2],
    ["form", 1.5],
    ["click", 2.5],
    ["scrape", 3],
    ["download", 1.5],
    ["upload", 1.5],
    ["publish", 2],
    ["facebook", 2],
    ["instagram", 2],
    ["linkedin", 2],
    ["navigate", 2],
    ["portal", 2],
    ["url", 1.5],
  ],
  design: [
    ["design", 2.5],
    ["logo", 3],
    ["banner", 3],
    ["poster", 3],
    ["image", 1.5],
    ["thumbnail", 3],
    ["mockup", 3],
    ["figma", 3],
    ["canva", 3],
    ["layout", 1.5],
    ["colour", 1.5],
    ["color", 1.5],
    ["font", 1.5],
    ["illustration", 3],
    ["video", 1.5],
    ["slide", 2],
    ["deck", 1.5],
  ],
  ops: [
    ["schedule", 2],
    ["meeting", 2],
    ["calendar", 2.5],
    ["remind", 2.5],
    ["follow up", 2],
    ["follow-up", 2],
    ["organise", 1.5],
    ["organize", 1.5],
    ["inbox", 2.5],
    ["reply", 1],
    ["customer", 1.5],
    ["order", 1],
    ["inventory", 3],
    ["stock", 1.5],
    ["delivery", 1.5],
    ["vendor", 2],
    ["hr", 2],
    ["leave", 1],
    ["attendance", 2.5],
    ["deploy", 1.5],
    ["backup", 2],
    ["monitor", 1.5],
  ],
  security: [
    ["security", 3],
    ["vulnerab", 3],
    ["audit", 1.5],
    ["password", 2],
    ["secret", 2],
    ["permission", 2],
    ["encrypt", 3],
    ["owasp", 3],
    ["xss", 3],
    ["csrf", 3],
    ["injection", 3],
    ["auth", 1.5],
    ["firewall", 3],
    ["malware", 3],
    ["phishing", 3],
    ["cve", 3],
  ],
};

/** A team-run role already says what kind of work a task is. */
export const ROLE_CATEGORY: Record<OrchestratorSpecialistRole, TaskCategory> = {
  orchestrator: "general",
  architect: "code",
  frontend: "code",
  backend: "code",
  code: "code",
  qa: "testing",
  security: "security",
  research: "research",
  finance: "data",
  ops: "ops",
};

interface CompiledStem {
  category: Exclude<TaskCategory, "general">;
  stem: string;
  weight: number;
  pattern: RegExp;
}

const COMPILED: CompiledStem[] = Object.entries(LEXICON).flatMap(([category, stems]) =>
  stems.map(([stem, weight]) => ({
    category: category as Exclude<TaskCategory, "general">,
    stem,
    weight,
    // Start of a word; the rest of the word may follow ("deploy" matches "deploying").
    pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(stem)}`, "iu"),
  })),
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest text classified; the opening of a long prompt says what it is about. */
const MAX_CHARS = 4_000;

export function classifyTask(
  text: string,
  role?: OrchestratorSpecialistRole | null,
): TaskClassification {
  const sample = (text ?? "").slice(0, MAX_CHARS).toLowerCase();
  const totals = new Map<TaskCategory, number>();
  const hits = new Map<TaskCategory, string[]>();
  for (const entry of COMPILED) {
    if (!entry.pattern.test(sample)) continue;
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.weight);
    const words = hits.get(entry.category) ?? [];
    words.push(entry.stem);
    hits.set(entry.category, words);
  }
  if (role && role !== "orchestrator") {
    const roleCategory = ROLE_CATEGORY[role];
    totals.set(roleCategory, (totals.get(roleCategory) ?? 0) + 4);
    hits.set(roleCategory, [`role:${role}`, ...(hits.get(roleCategory) ?? [])]);
  }
  const scores = [...totals.entries()]
    .map(([category, score]) => ({ category, score: round(score) }))
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
  const best = scores[0];
  // One weak word is not enough to call it.
  if (!best || best.score < 2) {
    return { category: "general", confidence: 0, matched: [], scores };
  }
  const sum = scores.reduce((total, item) => total + item.score, 0);
  return {
    category: best.category,
    confidence: round(best.score / sum),
    matched: (hits.get(best.category) ?? []).slice(0, 6),
    scores,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
