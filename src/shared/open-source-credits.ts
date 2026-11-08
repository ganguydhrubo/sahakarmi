/**
 * Open-source programs a Sahkarmi feature can work with, for Settings > About > Open-source
 * credits. This is the only place their names, addresses and licences are shown; everywhere
 * else the features use Sahkarmi's own names.
 */
export interface OpenSourceCredit {
  /** The Sahkarmi feature switch that uses it. */
  featureId: string;
  name: string;
  url: string;
  licence: string;
  /** How Sahkarmi uses it, in plain words. */
  use: string;
}

export const OPEN_SOURCE_CREDITS: OpenSourceCredit[] = [
  {
    featureId: "engine-open-model",
    name: "Open Interpreter",
    url: "https://github.com/openinterpreter/openinterpreter",
    licence: "Apache-2.0",
    use: "The Open-model engine starts it, if you installed it, over the Agent Client Protocol. It is not bundled.",
  },
  {
    featureId: "browser-hide-secrets",
    name: "Playwright MCP (idea only)",
    url: "https://github.com/microsoft/playwright-mcp",
    licence: "Apache-2.0",
    use: "Hiding secrets from the AI follows its --secrets idea. No code is included.",
  },
  {
    featureId: "browser-action-memory",
    name: "Stagehand (idea only)",
    url: "https://github.com/browserbase/stagehand",
    licence: "MIT",
    use: "Remembering clicked elements follows its action-cache idea. No code is included.",
  },
];
