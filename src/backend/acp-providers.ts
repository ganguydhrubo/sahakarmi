import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentModelId } from "../shared/ipc";
import { AcpAgentClient, type AcpModelOption } from "./acp-client";
import type { AcpCliInfo } from "./cli";
import { isRecord } from "./protocol";

/** Free model OpenCode uses by default; any "*-free" model is the fallback if it is renamed. */
const OPENCODE_FREE_MODEL = "opencode/big-pickle";

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
  });
}

export function openCodeModelValue(model: AgentModelId, options: AcpModelOption[]): string | null {
  if (model !== "opencode-free") return null; // "Your OpenCode model": keep the user's default.
  const values = options.map((option) => option.value);
  if (values.includes(OPENCODE_FREE_MODEL)) return OPENCODE_FREE_MODEL;
  return values.find((value) => value.startsWith("opencode/") && value.endsWith("-free")) ?? null;
}

export function createGeminiClient(cli: AcpCliInfo, transcriptRoot: string): AcpAgentClient {
  return new AcpAgentClient({
    provider: "gemini",
    label: "Gemini CLI",
    executable: cli.executable,
    args: ["--acp", "--model", "auto"],
    transcriptDir: join(transcriptRoot, "gemini"),
    models: [
      { model: "gemini-auto", displayName: "Gemini Auto" },
      { model: "gemini-pro", displayName: "Gemini Pro" },
      { model: "gemini-flash", displayName: "Gemini Flash" },
    ],
    readAccount: readGeminiAccount,
    modelValue: geminiModelValue,
  });
}

export function geminiModelValue(model: AgentModelId, options: AcpModelOption[]): string | null {
  const alias = model === "gemini-pro" ? "pro" : model === "gemini-flash" ? "flash" : "auto";
  const values = options.map((option) => option.value);
  if (values.includes(alias)) return alias;
  if (alias === "flash") {
    return values.find((value) => value.includes("flash") && !value.includes("lite")) ?? null;
  }
  return values.find((value) => value.includes(alias)) ?? null;
}

/** Uses the login Gemini CLI already has: Google sign-in (free tier), API key, or Vertex AI. */
export async function readGeminiAccount(
  home = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{
  account: { type: string; email: string | null } | null;
  requiresOpenaiAuth: boolean;
}> {
  const geminiHome = join(home, ".gemini");
  const hasKey = Boolean(
    environment.GEMINI_API_KEY?.trim() ||
      environment.GOOGLE_API_KEY?.trim() ||
      environment.GOOGLE_GENAI_USE_VERTEXAI?.trim(),
  );
  const hasOauth = await access(join(geminiHome, "oauth_creds.json")).then(
    () => true,
    () => false,
  );
  if (!hasKey && !hasOauth) return { account: null, requiresOpenaiAuth: false };
  let email: string | null = null;
  try {
    const accounts: unknown = JSON.parse(
      await readFile(join(geminiHome, "google_accounts.json"), "utf8"),
    );
    if (isRecord(accounts) && typeof accounts.active === "string") email = accounts.active;
  } catch {
    // Email is optional; API-key users have none.
  }
  return { account: { type: "gemini", email }, requiresOpenaiAuth: false };
}
