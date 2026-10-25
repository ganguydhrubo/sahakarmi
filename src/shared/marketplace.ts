import { AGENT_CATALOG, type AgentTemplate } from "./agent-catalog";

/**
 * Sahkarmi's own curated catalog: ready-made coworkers and skills for Indian small businesses.
 * Written for Sahkarmi; no install counts or ratings are shown because none are collected.
 */

/** Marketplace coworkers are versioned templates; see agent-catalog. */
export type MarketplaceAgent = AgentTemplate;

export type SkillIcon = "plan" | "search" | "check" | "chart" | "chat" | "bolt" | "code";

export interface MarketplaceSkill {
  id: string;
  name: string;
  summary: string;
  icon: SkillIcon;
  /** Markdown playbook written to Shared/Skills/<id>.md on install. */
  instructions: string;
}

export const MARKETPLACE_AGENTS: MarketplaceAgent[] = AGENT_CATALOG;

function skill(
  id: string,
  name: string,
  summary: string,
  icon: SkillIcon,
  steps: string[],
): MarketplaceSkill {
  return {
    id,
    name,
    summary,
    icon,
    instructions: [
      `# ${name}`,
      "",
      summary,
      "",
      "## How to do it",
      "",
      ...steps.map((step, index) => `${index + 1}. ${step}`),
      "",
    ].join("\n"),
  };
}

export const MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  skill(
    "project-plan",
    "Project Plan",
    "Turn a goal into deliverables, milestones and acceptance checks.",
    "plan",
    [
      "Restate the goal in one sentence and confirm what done looks like.",
      "Break it into 3-7 deliverables, each with an owner and a due date.",
      "List dependencies and risks for each deliverable.",
      "Add an acceptance check for each deliverable that can be verified.",
      "Save the plan as a table in Shared and tell the owner where it is.",
    ],
  ),
  skill(
    "evidence-brief",
    "Evidence Brief",
    "Summarise sources into a cited brief that separates facts from interpretation.",
    "search",
    [
      "Collect the sources given or found, and note the date of each.",
      "Write the key facts, each with its source.",
      "Write your interpretation in a separate section.",
      "List what is still unknown or conflicting.",
    ],
  ),
  skill(
    "gst-invoice-check",
    "GST Invoice Check",
    "Check invoices for GSTIN, HSN/SAC, tax rate and place of supply.",
    "check",
    [
      "Check the GSTIN format (15 characters, state code matches) for buyer and seller.",
      "Check HSN/SAC codes are present and the GST rate fits the item.",
      "Check CGST+SGST is used within a state and IGST across states.",
      "Check invoice totals and tax amounts add up.",
      "Report each problem with the invoice number; never edit the original file.",
    ],
  ),
  skill(
    "meeting-actions",
    "Meeting Actions",
    "Extract decisions, owners, deadlines and open questions from notes.",
    "check",
    [
      "List each decision made.",
      "List action items as: owner, task, due date (mark missing ones as TBD).",
      "List open questions and who should answer them.",
      "Keep it under one page.",
    ],
  ),
  skill(
    "competitor-comparison",
    "Competitor Comparison",
    "Compare competitors on price, features and service for a specific buyer need.",
    "search",
    [
      "Confirm the buyer need being compared against.",
      "Make a table of competitors with price, key features, delivery and support.",
      "Cite where each figure came from and its date.",
      "Say which option fits the need best and why, separately from the facts.",
    ],
  ),
  skill(
    "data-quality-review",
    "Data Quality Review",
    "Check a dataset for missing values, duplicates and inconsistent units.",
    "chart",
    [
      "Count rows and columns, and describe what each column holds.",
      "Find missing values, duplicates and obvious typos.",
      "Check units and formats are consistent (dates as DD/MM/YYYY, INR amounts).",
      "Report problems with row references; do not change the original file.",
    ],
  ),
  skill(
    "campaign-analysis",
    "Campaign Analysis",
    "Analyse campaign exports against the business goal.",
    "chart",
    [
      "Confirm the goal (sales, leads, reach) and the period.",
      "Check units, dates and attribution windows in the export.",
      "Summarise spend, results and cost per result for each campaign.",
      "Recommend what to continue, change or stop, with the numbers behind it.",
    ],
  ),
  skill(
    "workflow-playbook",
    "Workflow Playbook",
    "Turn a repeating process into a step-by-step playbook.",
    "bolt",
    [
      "Write the trigger: when this process starts.",
      "List each step with who does it and what tool or file is used.",
      "Add a check after each step that can go wrong.",
      "Mark which steps a coworker can do and which need the owner.",
    ],
  ),
  skill(
    "customer-reply",
    "Customer Reply Draft",
    "Draft a polite, accurate reply grounded in your own policies.",
    "chat",
    [
      "Read the customer's message and identify the actual question.",
      "Find the answer in Shared/Policies or Shared/FAQ; never invent a policy or price.",
      "Reply in the customer's language, short and polite.",
      "If the answer is not in the documents, say so and ask the owner.",
    ],
  ),
  skill(
    "price-comparison",
    "Price Comparison",
    "Compare supplier or product prices on the same basis.",
    "chart",
    [
      "Normalise each price to the same unit, quantity and GST treatment.",
      "Include delivery charges and payment terms.",
      "Show the comparison as a table with sources and dates.",
    ],
  ),
  skill(
    "bug-triage",
    "Bug Triage",
    "Turn a bug report into a diagnosis and a focused fix plan.",
    "code",
    [
      "Restate the expected and the actual behaviour.",
      "Reproduce it, or list what is needed to reproduce it.",
      "Name the most likely cause with evidence.",
      "Propose the smallest fix and how to verify it. Never change production data.",
    ],
  ),
  skill(
    "decision-check",
    "Decision Check",
    "Self-check a recommendation before it reaches the owner.",
    "check",
    [
      "State the recommendation in one line.",
      "List the assumptions it depends on.",
      "Name what would make it wrong, and how likely that is.",
      "Say how confident you are and what would raise confidence.",
    ],
  ),
];

export function findMarketplaceSkill(id: string): MarketplaceSkill | undefined {
  return MARKETPLACE_SKILLS.find((candidate) => candidate.id === id);
}
