import { statSync, writeFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

/** OpenCode's own server for its free models; it accepts the public key OpenCode itself sends. */
const OPENCODE_ZEN_CHAT_URL = "https://opencode.ai/zen/v1/chat/completions";

/**
 * True when OpenCode's server says the free allowance is used up. OpenCode retries that error
 * silently, so without this check the owner only learns it after a long wait per free model.
 * The server rejects a used-up allowance at once, so this costs nothing in that case.
 */
export async function probeOpenCodeFreeLimit(
  modelValue: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(OPENCODE_ZEN_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer public" },
      body: JSON.stringify({
        model: modelValue.replace(/^opencode\//, ""),
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status !== 429) return false;
    return /FreeUsageLimit|free usage limit/i.test(await response.text());
  } catch {
    return false;
  }
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
    probeFreeLimit: (modelValue) => probeOpenCodeFreeLimit(modelValue),
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

/**
 * Google's Antigravity server. `geminiHome` starts it on an extra Google account: Google keeps
 * the sign-in under $GEMINI_HOME, so each extra account has a folder of its own (see
 * gemini-accounts.ts). Null uses the first account in the real home folder.
 */
export function createAntigravityClient(
  cli: AcpCliInfo,
  transcriptRoot: string,
  geminiHome: string | null = null,
): AcpAgentClient {
  const harnessExecutable =
    process.platform === "win32" ? "localharness_external.exe" : "localharness_external";
  const harnessPath = join(cli.executable, "..", harnessExecutable);
  repairEmptyMcpConfig(geminiHome ?? join(homedir(), ".gemini"));
  return new AcpAgentClient({
    provider: "antigravity",
    label: "Google Antigravity",
    executable: cli.executable,
    args: [],
    transcriptDir: join(transcriptRoot, "antigravity"),
    models: [{ model: "antigravity-default", displayName: "Antigravity Default" }],
    // An extra account never counts an API key from the environment: that belongs to the first.
    readAccount: geminiHome
      ? () => readAntigravityAccount(dirname(geminiHome), {})
      : () => readAntigravityAccount(),
    modelValue: antigravityModelValue,
    env: {
      ANTIGRAVITY_HARNESS_PATH: harnessPath,
      ...(geminiHome ? { GEMINI_HOME: geminiHome } : {}),
    },
    // Google's server takes 30-60 s to answer initialize and a few seconds per session.
    modelListTimeoutMs: 30_000,
    // Every session keeps one of Google's helper processes (~40 MB) alive until the server
    // stops, so the model list is read once per server instead of on every refresh.
    reuseModelCatalog: true,
  });
}

/**
 * Antigravity also reads its own global MCP list at <GEMINI_HOME>/config/mcp_config.json. An
 * empty (0 byte) file there is not valid JSON, and every session logged an MCP parse error for
 * it. Only an empty file is touched: it becomes an empty list. Anything with content is the
 * owner's and stays exactly as it is.
 */
export function repairEmptyMcpConfig(geminiHome: string): boolean {
  const file = join(geminiHome, "config", "mcp_config.json");
  try {
    if (statSync(file).size !== 0) return false;
    writeFileSync(file, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
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
  if (!email && hasToken) {
    email = await lookupAntigravityEmail(acpHome);
    if (email) {
      await writeFile(
        join(acpHome, ANTIGRAVITY_ACCOUNT_FILE),
        JSON.stringify({ email, ...(tier ? { tier } : {}) }),
        "utf8",
      ).catch(() => undefined);
    }
  }
  return { account: { type: "antigravity", email, tier }, requiresOpenaiAuth: false };
}

type EmailFetch = (url: string, init: RequestInit) => Promise<Response>;
let emailFetch: EmailFetch = (url, init) => fetch(url, init);
/** Tests stand in for Google. */
export function setAntigravityEmailFetch(next: EmailFetch | null): void {
  emailFetch = next ?? ((url, init) => fetch(url, init));
}
const emailLookups = new Map<string, { at: number; email: Promise<string | null> }>();
const GOOGLE_TOKEN_URIS = new Set([
  "https://oauth2.googleapis.com/token",
  "https://accounts.google.com/o/oauth2/token",
  "https://www.googleapis.com/oauth2/v4/token",
]);
const EMAIL_RETRY_MS = 10 * 60_000;

/**
 * Google's sign-in for Antigravity has the userinfo.email scope but keeps no email on disk, so
 * every account read "Google account 1, 2, 3". Asks Google once with the account's own token
 * (a fresh access token, then userinfo) and Sahkarmi notes the answer. Only Google's own token
 * address is ever called; a failure is tried again after 10 minutes at most.
 */
function lookupAntigravityEmail(acpHome: string): Promise<string | null> {
  const known = emailLookups.get(acpHome);
  if (known && Date.now() - known.at < EMAIL_RETRY_MS) return known.email;
  const email = fetchAntigravityEmail(acpHome).catch(() => null);
  emailLookups.set(acpHome, { at: Date.now(), email });
  return email;
}

async function fetchAntigravityEmail(acpHome: string): Promise<string | null> {
  const token: unknown = JSON.parse(await readFile(join(acpHome, "acp_token.json"), "utf8"));
  if (!isRecord(token)) return null;
  const { refresh_token: refresh, client_id: clientId, client_secret: secret } = token;
  if (typeof refresh !== "string" || typeof clientId !== "string") return null;
  // Some sign-ins save no token address, or Google's older one: both mean Google's token
  // service. Any other address is never sent the token.
  const saved = typeof token.token_uri === "string" ? token.token_uri.trim() : "";
  if (saved && !GOOGLE_TOKEN_URIS.has(saved)) return null;
  const tokenUri = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId,
    ...(typeof secret === "string" ? { client_secret: secret } : {}),
  });
  const granted = await emailFetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!granted.ok) return null;
  const grant: unknown = await granted.json();
  const accessToken =
    isRecord(grant) && typeof grant.access_token === "string" ? grant.access_token : "";
  if (!accessToken) return null;
  const info = await emailFetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!info.ok) return null;
  const user: unknown = await info.json();
  return isRecord(user) && typeof user.email === "string" && user.email.includes("@")
    ? user.email
    : null;
}
