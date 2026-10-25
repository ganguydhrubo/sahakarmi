import { DESIGN_AGENTS } from "./design";
import { ECOMMERCE_AGENTS } from "./ecommerce";
import { EDUCATION_AGENTS } from "./education";
import { ENGINEERING_AGENTS } from "./engineering";
import { EXISTING_AGENTS } from "./existing";
import { FINANCE_AGENTS } from "./finance";
import { HR_AGENTS } from "./hr";
import { INDUSTRY_AGENTS } from "./industry";
import { LEGAL_AGENTS } from "./legal";
import { MARKETING_AGENTS } from "./marketing";
import { OPERATIONS_AGENTS } from "./operations";
import { PRODUCTIVITY_AGENTS } from "./productivity";
import { RESEARCH_AGENTS } from "./research";
import { SALES_AGENTS } from "./sales";
import { type AgentTemplate, agentBrief } from "./types";
import { WEB_AGENTS } from "./web";
import { WRITING_AGENTS } from "./writing";

export * from "./types";

/** Every Marketplace coworker: the original twelve first, then each category. */
export const AGENT_CATALOG: AgentTemplate[] = [
  ...EXISTING_AGENTS,
  ...FINANCE_AGENTS,
  ...SALES_AGENTS,
  ...MARKETING_AGENTS,
  ...WRITING_AGENTS,
  ...RESEARCH_AGENTS,
  ...HR_AGENTS,
  ...OPERATIONS_AGENTS,
  ...ECOMMERCE_AGENTS,
  ...ENGINEERING_AGENTS,
  ...DESIGN_AGENTS,
  ...WEB_AGENTS,
  ...LEGAL_AGENTS,
  ...EDUCATION_AGENTS,
  ...PRODUCTIVITY_AGENTS,
  ...INDUSTRY_AGENTS,
];

export function findAgentTemplate(id: string): AgentTemplate | undefined {
  return AGENT_CATALOG.find((agent) => agent.id === id);
}

/** FNV-1a: a short, stable fingerprint of a brief, to tell whether the owner edited it. */
export function briefHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The fields a coworker gets when it is added from (or updated to) a template. */
export function coworkerFromTemplate(agent: AgentTemplate) {
  const description = agentBrief(agent);
  return {
    name: agent.name,
    role: agent.role,
    description,
    avatarShape: agent.avatarShape,
    avatarColor: agent.avatarColor,
    template: { id: agent.id, version: agent.version, briefHash: briefHash(description) },
  };
}
