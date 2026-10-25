import type { AgentProviderId } from "./ipc";

/**
 * How each AI provider is presented on the Connect screen: its brand mark, a plain-English line
 * about who it suits, and whether it costs anything to start.
 */
export interface ProviderCatalogEntry {
  id: AgentProviderId;
  name: string;
  /** Key into the renderer's BRAND_MARKS. */
  mark: string;
  /** One line under the name while not connected. */
  tagline: string;
  /** Shown as a "Free" badge: usable without paying anything. */
  free: boolean;
  /** "Built in" providers ship with Sahkarmi; "agent" ones are a separate program it starts. */
  kind: "built-in" | "account" | "agent";
  /** Can the owner paste an API key instead of signing in? */
  apiKey: boolean;
  /** Where to get a key or learn more. */
  website: string;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "codex",
    name: "ChatGPT",
    mark: "openai",
    tagline: "Use your ChatGPT Plus, Pro or Business plan",
    free: false,
    kind: "account",
    apiKey: true,
    website: "https://chatgpt.com",
  },
  {
    id: "claude",
    name: "Claude",
    mark: "claude",
    tagline: "Use your Claude Pro or Max plan",
    free: false,
    kind: "account",
    apiKey: true,
    website: "https://claude.ai",
  },
  {
    id: "antigravity",
    name: "Gemini (Antigravity)",
    mark: "googlegemini",
    tagline: "Free with your Google account",
    free: true,
    kind: "account",
    apiKey: true,
    website: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "opencode",
    name: "OpenCode",
    mark: "opencode",
    tagline: "Built in. Free models, no sign-in (daily free limit)",
    free: true,
    kind: "built-in",
    apiKey: false,
    website: "https://opencode.ai",
  },
  agent("cursor", "Cursor", "cursor", "Use your Cursor account", false, "https://cursor.com"),
  agent(
    "copilot",
    "GitHub Copilot",
    "githubcopilot",
    "Free with Copilot Free on your GitHub account",
    true,
    "https://github.com/features/copilot",
  ),
  agent("kimi", "Kimi Code", "kimi", "Use your Kimi account", false, "https://www.kimi.com"),
  agent("cline", "Cline", "cline", "Use your Cline account or ChatGPT", false, "https://cline.bot"),
  agent(
    "qwen",
    "Qwen Code",
    "qwen",
    "Bring a key from DashScope, OpenRouter or any OpenAI-style service",
    false,
    "https://github.com/QwenLM/qwen-code",
  ),
  agent("grok", "Grok", "x", "Use your xAI account", false, "https://x.ai"),
  agent("droid", "Factory Droid", "", "Use your Factory account", false, "https://factory.ai"),
  agent("qoder", "Qoder", "", "Use your Qoder account", false, "https://qoder.com"),
  agent(
    "goose",
    "Goose",
    "",
    "Open-source agent with your own model key",
    false,
    "https://goose-docs.ai",
  ),
  agent(
    "vibe",
    "Mistral Vibe",
    "mistralai",
    "Use your Mistral account",
    false,
    "https://mistral.ai",
  ),
  agent(
    "kiro",
    "Kiro",
    "",
    "Free 50 credits a month with a Kiro account",
    true,
    "https://kiro.dev",
  ),
];

function agent(
  id: AgentProviderId,
  name: string,
  mark: string,
  tagline: string,
  free: boolean,
  website: string,
): ProviderCatalogEntry {
  return { id, name, mark, tagline, free, kind: "agent", apiKey: false, website };
}

export function providerCatalogEntry(id: AgentProviderId): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === id);
}
