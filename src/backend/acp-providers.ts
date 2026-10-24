import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentModelId } from "../shared/ipc";
import { modelWireId } from "../shared/ipc";
import { AcpAgentClient, type AcpModelOption } from "./acp-client";
import type { AcpCliInfo } from "./cli";
import { isRecord } from "./protocol";

/** Free model OpenCode uses by default; the other "*-free" models are the fallbacks. */
const OPENCODE_FREE_MODEL = "opencode/big-pickle";

/**
 * OpenCode's free models, in the order Sahkarmi tries them: OpenCode's own default first, then
 * every other "-free" model it reports. Each has its own usage limit, so when one is used up
 * (big-pickle's "Free usage limit reached" is the usual one) the next still answers.
 */
export function openCodeFreeModels(options: AcpModelOption[]): string[] {
  const values = options.map((option) => option.value);
  const free = values.filter((value) => value.startsWith("opencode/") && value.endsWith("-free"));
  return values.includes(OPENCODE_FREE_MODEL) ? [OPENCODE_FREE_MODEL, ...free] : free;
}

export const OPENCODE_PERMISSION_CONFIG = JSON.stringify({
  edit: "ask",
  bash: "ask",
  webfetch: "ask",
  external_directory: "ask",
});

export function createOpenCodeClient(cli: AcpCliInfo, transcriptRoot: string): AcpAgentClient {
  return new AcpAgentClient({
    provider: "opencode",
    label: "OpenCode",
    executable: cli.executable,
    args: ["acp"],
    transcriptDir: join(transcriptRoot, "opencode"),
    models: [
      { model: "opencode-free", displayName: "Free model (no login)" },
      { model: "opencode-default", displayName: "Your OpenCode model" },
    ],
    // OpenCode works with no account: its free models need no login. Any provider the user
    // signed in to with `opencode auth login` (API keys, Copilot, …) is picked up automatically.
    readAccount: async () => ({
      account: { type: "opencode", email: null, planType: cli.bundled ? "bundled" : null },
      requiresOpenaiAuth: false,
    }),
    modelValue: openCodeModelValue,
    freeModels: openCodeFreeModels,
    // Make OpenCode ask before edits, commands, web fetches and work outside its folder, so
    // every such call reaches Sahkarmi's permission policy (session/request_permission).
    env: { OPENCODE_PERMISSION: OPENCODE_PERMISSION_CONFIG },
  });
}

export function openCodeModelValue(
  model: AgentModelId,
  options: AcpModelOption[],
  exhausted: ReadonlySet<string> = new Set(),
): string | null {
  if (model !== "opencode-free" && model !== "opencode-default") {
    const wire = modelWireId(model);
    return options.some((option) => option.value === wire) ? wire : null;
  }
  if (model !== "opencode-free") return null; // "Your OpenCode model": keep the user's default.
  const free = openCodeFreeModels(options);
  return free.find((value) => !exhausted.has(value)) ?? free[0] ?? null;
}

export function createAntigravityClient(cli: AcpCliInfo, transcriptRoot: string): AcpAgentClient {
  const harnessExecutable =
    process.platform === "win32" ? "localharness_external.exe" : "localharness_external";
  const harnessPath = join(cli.executable, "..", harnessExecutable);
  return new AcpAgentClient({
    provider: "antigravity",
    label: "Google Antigravity",
    executable: cli.executable,
    args: [],
    transcriptDir: join(transcriptRoot, "antigravity"),
    models: [{ model: "antigravity-default", displayName: "Antigravity Default" }],
    readAccount: readAntigravityAccount,
    modelValue: antigravityModelValue,
    env: {
      ANTIGRAVITY_HARNESS_PATH: harnessPath,
    },
    // Google's server takes 30-60 s to answer initialize and a few seconds per session.
    modelListTimeoutMs: 30_000,
  });
}

export function antigravityModelValue(
  model: AgentModelId,
  options: AcpModelOption[],
): string | null {
  if (model !== "antigravity-default") {
    const wire = modelWireId(model);
    return options.some((option) => option.value === wire) ? wire : null;
  }
  const values = options.map((option) => option.value);
  if (values.includes("default")) return "default";
  return values[0] ?? null;
}

/** Where Google's ACP server keeps its own sign-in, and where Sahkarmi notes the account it saw. */
export function antigravityAcpHome(home = homedir()): string {
  return join(home, ".gemini", "antigravity-acp");
}

export const ANTIGRAVITY_ACCOUNT_FILE = "sahkarmi-account.json";

/**
 * Uses the sign-in Google's Antigravity ACP server already has (Log in with Google, or an API key).
 * Only the server's own token counts: a Gemini CLI or Antigravity IDE login is a different thing.
 */
export async function readAntigravityAccount(
  home = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{
  account: { type: string; email: string | null; tier?: string | null } | null;
  requiresOpenaiAuth: boolean;
}> {
  const acpHome = antigravityAcpHome(home);
  const hasKey = Boolean(
    environment.ANTIGRAVITY_API_KEY?.trim() ||
      environment.GEMINI_API_KEY?.trim() ||
      environment.GOOGLE_API_KEY?.trim(),
  );
  const hasToken = await access(join(acpHome, "acp_token.json")).then(
    () => true,
    () => false,
  );
  if (!hasKey && !hasToken) return { account: null, requiresOpenaiAuth: false };
  let email: string | null = null;
  let tier: string | null = hasToken ? null : "API key";
  try {
    const noted: unknown = JSON.parse(
      await readFile(join(acpHome, ANTIGRAVITY_ACCOUNT_FILE), "utf8"),
    );
    if (isRecord(noted)) {
      if (typeof noted.email === "string") email = noted.email;
      if (typeof noted.tier === "string") tier = noted.tier;
    }
  } catch {
    // Sahkarmi has not noted the account yet (signed in before 0.6.0, or an API key).
  }
  return { account: { type: "antigravity", email, tier }, requiresOpenaiAuth: false };
}
