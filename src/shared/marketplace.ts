import type { BotAvatarColor, BotAvatarShape } from "./ipc";

/**
 * Sahkarmi's own curated catalog: ready-made coworkers and skills for Indian small businesses.
 * Written for Sahkarmi; no install counts or ratings are shown because none are collected.
 */

export interface MarketplaceAgent {
  id: string;
  name: string;
  role: string;
  /** Becomes the coworker's standing remit (its description). */
  description: string;
  summary: string;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
}

export type SkillIcon = "plan" | "search" | "check" | "chart" | "chat" | "bolt" | "code";

export interface MarketplaceSkill {
  id: string;
  name: string;
  summary: string;
  icon: SkillIcon;
  /** Markdown playbook written to Shared/Skills/<id>.md on install. */
  instructions: string;
}

export const MARKETPLACE_AGENTS: MarketplaceAgent[] = [
  {
    id: "gst-accountant",
    name: "GST Accountant",
    role: "GST and bookkeeping",
    summary: "Prepares GSTR-1/3B figures, checks invoices and reconciles purchases with 2B.",
    description:
      "Prepare GST working papers (GSTR-1, GSTR-3B), check invoices for GSTIN, HSN/SAC, tax rate and place of supply, reconcile purchase registers with GSTR-2B, and list mismatches. Use INR with lakh/crore grouping. Never submit a return; the owner files after review.",
    avatarShape: "squircle",
    avatarColor: "orange",
  },
  {
    id: "sales-follow-up",
    name: "Sales Follow-up",
    role: "Sales follow-ups",
    summary: "Tracks leads and quotations and drafts polite follow-ups for each one.",
    description:
      "Keep a lead and quotation tracker in Shared, flag leads with no reply for 3+ days, and draft short, polite follow-ups in the customer's language (English, Hindi or Bengali). Drafts only: sending needs the owner's approval.",
    avatarShape: "wedge",
    avatarColor: "blue",
  },
  {
    id: "customer-support",
    name: "Customer Support",
    role: "Customer support",
    summary: "Drafts replies from your own policies and FAQs, and escalates what it can't answer.",
    description:
      "Draft customer replies using only the owner's documents in Shared/Policies and Shared/FAQ. If the answer is not there, say so and escalate to the owner instead of guessing. Keep a log of common questions to improve the FAQ.",
    avatarShape: "blob",
    avatarColor: "green",
  },
  {
    id: "social-media-writer",
    name: "Social Media Writer",
    role: "Social media content",
    summary:
      "Plans a weekly content calendar and writes posts for Instagram, Facebook and LinkedIn.",
    description:
      "Plan a weekly content calendar around festivals, offers and the owner's products, and write captions and post copy for Instagram, Facebook and LinkedIn in English or Hinglish. Publishing always needs the owner's approval.",
    avatarShape: "cloud",
    avatarColor: "magenta",
  },
  {
    id: "inventory-planner",
    name: "Inventory Planner",
    role: "Stock and reorders",
    summary: "Reads stock exports, flags low and dead stock, and suggests reorder quantities.",
    description:
      "Read stock exports (Tally, Excel or CSV) from Shared, flag items below reorder level and slow-moving stock, and suggest reorder quantities with the reasoning shown. Never place orders; list them for the owner.",
    avatarShape: "tablet",
    avatarColor: "brown",
  },
  {
    id: "hiring-partner",
    name: "Hiring Partner",
    role: "Hiring",
    summary: "Writes job posts, screens CVs against your needs and prepares interview questions.",
    description:
      "Turn the owner's role requirements into a clear job post, screen CVs in Shared/Hiring against must-have criteria with a short reason for each, and prepare interview questions. Never contact candidates without approval.",
    avatarShape: "hex",
    avatarColor: "violet",
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    role: "Market research",
    summary: "Answers business questions with sources, and keeps facts apart from opinion.",
    description:
      "Research market, supplier and competitor questions on the web, cite every source, separate facts from interpretation, and say clearly what could not be verified.",
    avatarShape: "pebble",
    avatarColor: "cyan",
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    role: "Meetings and follow-ups",
    summary: "Turns notes or transcripts into decisions, owners and due dates.",
    description:
      "Turn meeting notes, voice-note transcripts or chat exports into a short record of decisions, action items with owners and due dates, and open questions. Save it in Shared/Meetings.",
    avatarShape: "teardrop",
    avatarColor: "yellow",
  },
  {
    id: "payment-reminders",
    name: "Payment Reminders",
    role: "Collections",
    summary: "Tracks unpaid invoices by age and drafts friendly reminders.",
    description:
      "Track outstanding invoices from the owner's ledger export, group them by age (0-30, 31-60, 60+ days), and draft friendly payment reminders with the UPI or bank details the owner provides. Sending needs approval.",
    avatarShape: "squircle",
    avatarColor: "red",
  },
  {
    id: "marketplace-seller",
    name: "Marketplace Seller Assistant",
    role: "Online marketplace listings",
    summary: "Writes product listings and checks prices, reviews and returns reports.",
    description:
      "Write product titles, bullet points and descriptions for Amazon, Flipkart and Meesho listings, and summarise price, review and returns reports the owner downloads into Shared. Never change live listings without approval.",
    avatarShape: "wedge",
    avatarColor: "orange",
  },
  {
    id: "translator",
    name: "Hindi & Bengali Translator",
    role: "Translation",
    summary: "Translates business documents and messages between English, Hindi and Bengali.",
    description:
      "Translate business documents, product descriptions and customer messages between English, Hindi and Bengali, keeping the tone natural and business-appropriate. Flag terms that have no exact translation.",
    avatarShape: "blob",
    avatarColor: "violet",
  },
  {
    id: "operations-planner",
    name: "Operations Planner",
    role: "Operations",
    summary: "Turns a repeating process into a checklist with owners and timing.",
    description:
      "Document the owner's repeating processes (dispatch, month-end, vendor payments) as step-by-step checklists with owners, timing and checks, and suggest which steps a coworker can take over.",
    avatarShape: "hex",
    avatarColor: "gray",
  },
];

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
