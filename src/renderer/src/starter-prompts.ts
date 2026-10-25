import { findAgentTemplate } from "../../shared/agent-catalog";
import type { BotProfile } from "./data";

/** First tasks for the built-in team, keyed by role. Plain business tasks, never jargon. */
const BY_ROLE: Record<string, string[]> = {
  orchestrator: [
    "Plan my week and share the work across the team",
    "Ask Asha for this month's GST position",
    "What should I focus on today?",
  ],
  accounts: [
    "Reconcile my purchase register with GSTR-2B",
    "List the customers whose payment is overdue",
    "Prepare this month's GST summary",
  ],
  sales: [
    "Draft WhatsApp follow-ups for my open leads",
    "Which leads should I call first today?",
    "Write a quotation for a bulk order",
  ],
  support: [
    "Draft a calm reply to an upset customer",
    "Sort today's customer messages by priority",
    "Write a simple return and refund policy",
  ],
  research: [
    "Compare three suppliers for cotton fabric",
    "What GST rate applies to readymade garments?",
    "Find competitors selling kurtis online",
  ],
  content: [
    "Write an Instagram post for our festive sale",
    "Give me 5 WhatsApp broadcast ideas",
    "Write a product description for a cotton kurti",
  ],
  code: [
    "Review a file for bugs and explain them simply",
    "Explain what this script does",
    "Write tests for a function",
  ],
  ops: [
    "Check which items need reordering",
    "Turn my meeting notes into action items",
    "Plan tomorrow's deliveries",
  ],
  security: [
    "Check my Shared folder for exposed passwords",
    "Make a password safety checklist for my staff",
    "Review which apps can access my accounts",
  ],
};

const GENERAL = ["What can you help me with?", "Summarise a document for me", "Plan my day"];

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Three things the owner can ask this coworker straight away. */
export function starterPrompts(bot: BotProfile | undefined): string[] {
  if (!bot) return GENERAL;
  const template = bot.template ? findAgentTemplate(bot.template.id) : undefined;
  if (template?.outputs.length) {
    return template.outputs
      .slice(0, 3)
      .map((output) => `Make ${output} for me`)
      .map(capitalise);
  }
  return BY_ROLE[bot.role.trim().toLowerCase()] ?? GENERAL;
}
