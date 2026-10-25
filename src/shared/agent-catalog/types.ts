import type { BotAvatarColor, BotAvatarShape } from "../ipc";

/**
 * One versioned definition per Marketplace coworker. The coworker's standing brief (its
 * description) is generated from these fields, so every agent follows the same lifecycle:
 * understand → collect inputs → plan → execute → validate → deliver.
 */

export const AGENT_CATEGORIES = [
  "finance",
  "sales",
  "marketing",
  "writing",
  "research",
  "hr",
  "operations",
  "ecommerce",
  "engineering",
  "design",
  "web",
  "legal",
  "education",
  "productivity",
  "industry",
] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

/** What the coworker actually uses. Every capability maps to a tool the runtime provides. */
export const AGENT_CAPABILITIES = [
  "files", // read and write files in Shared and its own folder
  "documents", // Word/PDF/Markdown documents (via local commands and libraries)
  "spreadsheets", // CSV/Excel/Sheets exports, formulas, pivots
  "web-research", // search and read the web, with sources
  "browser", // operate websites in Sahkarmi's browser, owner signs in via takeover
  "code", // write and run code and commands on this computer
  "delegation", // message or create other coworkers for sub-tasks
  "schedule", // repeat on a schedule (Run on schedule)
  "images", // prepare image briefs or generate images where a model allows
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

/**
 * ready: works with Sahkarmi's built-in tools (files, commands, web, browser with the owner's
 * own sign-in). needs-setup: a named outside service must be connected first.
 */
export type AgentAvailability = "ready" | "needs-setup";

export interface AgentIntegration {
  name: string;
  /** browser: used through the owner's own sign-in in Sahkarmi's browser. setup: needs a key. */
  via: "browser" | "files" | "setup";
  note?: string;
}

export interface AgentTemplate {
  id: string;
  /** Bump when the brief changes; coworkers made from an older version can be updated. */
  version: number;
  name: string;
  role: string;
  category: AgentCategory;
  summary: string;
  /** Job titles and tasks this agent covers; used by search. */
  jobFunctions: string[];
  requiredInputs: string[];
  optionalInputs: string[];
  capabilities: AgentCapability[];
  integrations: AgentIntegration[];
  /** The execute steps of the lifecycle, in order. */
  workflow: string[];
  outputs: string[];
  /** Checks run on the output before it is reported as done. */
  validation: string[];
  /** Actions that need sahkarmi.request_approval first. */
  approvals: string[];
  completion: string;
  /** Professional limits, for example "not a licensed lawyer". */
  limits?: string;
  /** Shared sub-folder for deliverables. */
  folder: string;
  availability: AgentAvailability;
  featured?: boolean;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
}

export type AgentTemplateInput = Omit<
  AgentTemplate,
  "version" | "optionalInputs" | "integrations" | "approvals" | "availability"
> &
  Partial<
    Pick<
      AgentTemplate,
      "version" | "optionalInputs" | "integrations" | "approvals" | "availability"
    >
  >;

export function defineAgent(input: AgentTemplateInput): AgentTemplate {
  return {
    version: 1,
    optionalInputs: [],
    integrations: [],
    approvals: [],
    availability: "ready",
    ...input,
  };
}

const CAPABILITY_TOOLS: Record<AgentCapability, string> = {
  files: "files in Shared",
  documents: "documents",
  spreadsheets: "spreadsheets",
  "web-research": "web research with sources",
  browser: "Sahkarmi's browser",
  code: "code and commands",
  delegation: "other coworkers (sahkarmi.list_agents, send_message, create_coworker)",
  schedule: "scheduled runs",
  images: "image briefs",
};

/** The coworker's standing brief, written into its description when it is added. */
export function agentBrief(agent: AgentTemplate): string {
  const list = (items: string[]) => items.join("; ");
  const lines = [
    agent.summary,
    "Work in this order and report progress at each step:",
    "1. UNDERSTAND: restate the outcome in one line. Ask only questions whose answer changes the result; otherwise state your assumption and continue.",
    `2. COLLECT: needs ${list(agent.requiredInputs)}.${
      agent.optionalInputs.length > 0 ? ` Helpful: ${list(agent.optionalInputs)}.` : ""
    } Check the conversation, Shared and earlier records before asking.`,
    "3. PLAN: list the steps (and which coworker helps, if any) before starting longer work.",
    `4. EXECUTE: ${agent.workflow.map((step, index) => `(${index + 1}) ${step}`).join(" ")}`,
    `5. VALIDATE: ${list(agent.validation)}. Fix what fails; never report unchecked work as done.`,
    `6. DELIVER: ${list(agent.outputs)}, saved in Shared/${agent.folder}. Report what was done, the evidence, and what is still open.`,
    `Tools: ${agent.capabilities.map((capability) => CAPABILITY_TOOLS[capability]).join(", ")}.`,
  ];
  if (agent.integrations.length > 0) {
    lines.push(
      `Services: ${agent.integrations
        .map(
          (service) =>
            `${service.name} (${
              service.via === "browser"
                ? "in Sahkarmi's browser; the owner signs in via takeover"
                : service.via === "files"
                  ? "from exports the owner puts in Shared"
                  : "needs a connection set up by the owner"
            }${service.note ? `; ${service.note}` : ""})`,
        )
        .join(
          ", ",
        )}. If a service is not available, say exactly what is missing and finish the rest.`,
    );
  }
  if (agent.approvals.length > 0) {
    lines.push(`Ask for approval (sahkarmi.request_approval) before: ${list(agent.approvals)}.`);
  }
  lines.push(`Done when: ${agent.completion}`);
  if (agent.limits) lines.push(`Limits: ${agent.limits}`);
  return lines.join("\n");
}

/** Everything search looks at, lower-cased. */
export function agentSearchText(agent: AgentTemplate): string {
  return [
    agent.name,
    agent.role,
    agent.category,
    agent.summary,
    ...agent.jobFunctions,
    ...agent.capabilities,
    ...agent.outputs,
  ]
    .join(" ")
    .toLowerCase();
}
