import type { AgentModelId, AgentProviderId } from "../../shared/ipc";
import { providerForModel } from "../../shared/ipc";

export type TaskProfile = "quick" | "analysis" | "writing" | "general";

/** Preference order per task profile. Only a suggestion: nothing switches without a click. */
export const PROFILE_MODELS: Record<TaskProfile, AgentModelId[]> = {
  quick: ["opencode-free", "antigravity-default", "gpt-5.6-luna", "claude-fable-5"],
  analysis: [
    "claude-opus-5",
    "gpt-5.6-sol",
    "claude-sonnet-5",
    "gpt-5.6-terra",
    "antigravity-default",
    "opencode-free",
  ],
  writing: ["claude-sonnet-5", "gpt-5.6-terra", "antigravity-default", "opencode-free"],
  general: ["antigravity-default", "claude-sonnet-5", "gpt-5.6-terra", "opencode-free"],
};

/** Providers billed to the owner's own paid plan (as opposed to free models or free tiers). */
export const PAID_PROVIDERS: AgentProviderId[] = ["codex", "claude"];

export function profileForRole(role: string): TaskProfile {
  const text = role.toLowerCase();
  if (/account|financ|gst|tax|research|analy|हिसाब|लेखा|শোধ|হিসাব|গবেষণা|रिसर्च/.test(text))
    return "analysis";
  if (/content|market|writ|copy|social|कंटेंट|লেখা/.test(text)) return "writing";
  if (/support|sales|service|सपोर्ट|सेल्स|বিক্রি/.test(text)) return "quick";
  return "general";
}

export interface ModelSuggestion {
  model: AgentModelId;
  /** True when the suggestion moves the coworker from a free option onto a paid plan. */
  movesToPaid: boolean;
}

/**
 * Best model for the profile among connected providers. Stays within the coworker's current
 * cost class (free stays free); a paid alternative is returned separately and clearly marked.
 */
export function suggestModels(
  profile: TaskProfile,
  current: AgentModelId,
  available: AgentProviderId[],
): { sameCost: ModelSuggestion | null; paidAlternative: ModelSuggestion | null } {
  const currentPaid = PAID_PROVIDERS.includes(providerForModel(current));
  const candidates = PROFILE_MODELS[profile].filter((model) =>
    available.includes(providerForModel(model)),
  );
  const isPaid = (model: AgentModelId) => PAID_PROVIDERS.includes(providerForModel(model));
  const sameCost = candidates.find((model) => isPaid(model) === currentPaid) ?? null;
  const paid = currentPaid ? null : (candidates.find(isPaid) ?? null);
  return {
    sameCost: sameCost && sameCost !== current ? { model: sameCost, movesToPaid: false } : null,
    paidAlternative: paid && paid !== current ? { model: paid, movesToPaid: true } : null,
  };
}
