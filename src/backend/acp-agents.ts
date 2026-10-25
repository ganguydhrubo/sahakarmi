import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import {
  ACP_AGENT_DEFAULT_MODEL,
  type AcpAgentProviderId,
  type AgentModelId,
  modelWireId,
  PROVIDER_LABELS,
} from "../shared/ipc";
import { AcpAgentClient, type AcpModelOption } from "./acp-client";
import { type AcpCliInfo, CodexCliError } from "./cli";

const execFileAsync = promisify(execFile);

/**
 * How Sahkarmi finds, installs and signs in to another vendor's agent. Every command here was
 * taken from the vendor's own documentation (October 2026); none of it is text from the owner.
 */
export interface AcpAgentSpec {
  id: AcpAgentProviderId;
  /** Program names to look for, in order. */
  commands: string[];
  /** Arguments that start the agent's ACP server on stdin/stdout. */
  args: string[];
  /** How Connect installs the tool when it is missing. */
  install?: { kind: "npm"; pkg: string } | { kind: "powershell"; url: string; site: string };
  /**
   * The agent's own sign-in: "command" runs it hidden (it opens the browser by itself);
   * "window" opens the tool in its own window for sign-ins that only work inside it.
   */
  signIn: { kind: "command"; args: string[] } | { kind: "window"; args: string[]; tip: string };
  /** Environment variables that hold an API key, the first one is the one Sahkarmi sets. */
  apiKeyEnv?: string[];
}

export const ACP_AGENT_SPECS: Record<AcpAgentProviderId, AcpAgentSpec> = {
  // https://cursor.com/docs/cli/acp, https://cursor.com/docs/cli/installation
  cursor: {
    id: "cursor",
    commands: ["cursor-agent", "agent"],
    args: ["acp"],
    install: {
      kind: "powershell",
      url: "https://cursor.com/install?win32=true",
      site: "cursor.com",
    },
    signIn: { kind: "command", args: ["login"] },
    apiKeyEnv: ["CURSOR_API_KEY"],
  },
  // https://docs.github.com/en/copilot/reference/acp-server
  copilot: {
    id: "copilot",
    commands: ["copilot"],
    args: ["--acp", "--stdio"],
    install: { kind: "npm", pkg: "@github/copilot" },
    signIn: {
      kind: "window",
      args: [],
      tip: "Type /login in the Copilot window, finish in the browser, then close the window.",
    },
    apiKeyEnv: ["COPILOT_GITHUB_TOKEN"],
  },
  // https://moonshotai.github.io/kimi-code/en/reference/kimi-command
  kimi: {
    id: "kimi",
    commands: ["kimi"],
    args: ["acp"],
    install: { kind: "npm", pkg: "@moonshot-ai/kimi-code" },
    signIn: { kind: "command", args: ["login"] },
  },
  // https://docs.cline.bot/usage/acp
  cline: {
    id: "cline",
    commands: ["cline"],
    args: ["--acp"],
    install: { kind: "npm", pkg: "cline" },
    signIn: { kind: "command", args: ["auth"] },
    apiKeyEnv: ["CLINE_API_KEY"],
  },
  // https://github.com/QwenLM/qwen-code (its free sign-in ended in April 2026; it needs a key)
  qwen: {
    id: "qwen",
    commands: ["qwen"],
    args: ["--acp"],
    install: { kind: "npm", pkg: "@qwen-code/qwen-code" },
    signIn: {
      kind: "window",
      args: [],
      tip: "Type /auth in the Qwen Code window, choose your provider and key, then close it.",
    },
  },
  // https://zed.dev/acp/agent/grok-build, https://github.com/xai-org/grok-build
  grok: {
    id: "grok",
    commands: ["grok"],
    args: ["agent", "stdio"],
    install: { kind: "powershell", url: "https://x.ai/cli/install.ps1", site: "x.ai" },
    signIn: {
      kind: "window",
      args: [],
      tip: "Grok asks you to sign in when it opens. Finish in the browser, then close the window.",
    },
    apiKeyEnv: ["XAI_API_KEY"],
  },
  // https://docs.factory.ai/integrations/zed
  droid: {
    id: "droid",
    commands: ["droid"],
    args: ["exec", "--output-format", "acp"],
    install: { kind: "npm", pkg: "droid" },
    signIn: {
      kind: "window",
      args: [],
      tip: "Droid asks you to sign in when it opens. Finish in the browser, then close the window.",
    },
    apiKeyEnv: ["FACTORY_API_KEY"],
  },
  // https://docs.qoder.com/cli/acp
  qoder: {
    id: "qoder",
    commands: ["qoder", "qodercli"],
    args: ["--acp"],
    install: { kind: "npm", pkg: "@qoder-ai/qodercli" },
    signIn: { kind: "command", args: ["login"] },
    apiKeyEnv: ["QODER_PERSONAL_ACCESS_TOKEN"],
  },
  // https://goose-docs.ai/docs/guides/acp-clients (install it yourself; Sahkarmi finds it)
  goose: {
    id: "goose",
    commands: ["goose"],
    args: ["acp"],
    signIn: {
      kind: "window",
      args: ["configure"],
      tip: "Choose a model provider in the Goose window, then close it.",
    },
  },
  // https://github.com/mistralai/mistral-vibe (installed with Python's uv; Sahkarmi finds it)
  vibe: {
    id: "vibe",
    commands: ["vibe-acp"],
    args: [],
    signIn: {
      kind: "window",
      args: ["--setup"],
      tip: "Finish the Mistral Vibe setup in its window, then close it.",
    },
    apiKeyEnv: ["MISTRAL_API_KEY"],
  },
  // https://kiro.dev/docs/cli/acp (install it yourself; Sahkarmi finds it)
  kiro: {
    id: "kiro",
    commands: ["kiro-cli"],
    args: ["acp"],
    signIn: {
      kind: "window",
      args: [],
      tip: "Sign in when Kiro asks, finish in the browser, then close the window.",
    },
  },
};

/** Mistral Vibe signs in through its main program, not the ACP one. */
export function signInCommandFor(spec: AcpAgentSpec, executable: string): string {
  return spec.id === "vibe" ? executable.replace(/vibe-acp(\.exe|\.cmd)?$/i, "vibe$1") : executable;
}

/** Folders npm, uv and the vendors' installers put programs in, besides PATH. */
function extraSearchFolders(home = homedir()): string[] {
  if (process.platform !== "win32") {
    return [join(home, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin"];
  }
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  return [
    join(appData, "npm"),
    join(home, ".local", "bin"),
    join(localAppData, "cursor-agent"),
    join(localAppData, "Programs", "goose"),
    join(home, ".grok", "bin"),
    join(home, ".kimi", "bin"),
  ];
}

const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat"];

/** Finds the agent's program, or null when it is not installed. */
export async function findAcpAgentExecutable(spec: AcpAgentSpec): Promise<string | null> {
  const override = process.env[`SAHKARMI_${spec.id.toUpperCase()}_PATH`]?.trim();
  if (override) {
    return (await access(override).then(
      () => true,
      () => false,
    ))
      ? override
      : null;
  }
  const folders = [...(process.env.PATH ?? "").split(delimiter), ...extraSearchFolders()].filter(
    Boolean,
  );
  const extensions = process.platform === "win32" ? WINDOWS_EXTENSIONS : [""];
  for (const command of spec.commands) {
    for (const folder of folders) {
      for (const extension of extensions) {
        const candidate = join(folder, `${command}${extension}`);
        if (
          await access(candidate).then(
            () => true,
            () => false,
          )
        )
          return candidate;
      }
    }
  }
  return null;
}

/** Runs a .cmd shim through cmd.exe, which Node cannot start directly on Windows. */
export function shellSafeLaunch(
  executable: string,
  args: string[],
): { command: string; args: string[]; verbatim: boolean } {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        `""${executable.replaceAll("%", "%%")}" ${args.map((arg) => `"${arg}"`).join(" ")}"`,
      ],
      verbatim: true,
    };
  }
  return { command: executable, args, verbatim: false };
}

export async function resolveAcpAgentCli(id: AcpAgentProviderId): Promise<AcpCliInfo> {
  const spec = ACP_AGENT_SPECS[id];
  const executable = await findAcpAgentExecutable(spec);
  if (!executable) {
    throw new CodexCliError(`${PROVIDER_LABELS[id]} is not installed on this computer.`, "missing");
  }
  let version = "installed";
  try {
    const launch = shellSafeLaunch(executable, ["--version"]);
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      timeout: 10_000,
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim,
    });
    version = /\d+\.\d+(?:\.\d+)?/.exec(stdout)?.[0] ?? version;
  } catch {
    // Some agents have no --version; being found is enough.
  }
  return { executable, version, bundled: false };
}

/** "<agent>:default" keeps the agent's own model; any other id must be one it reports. */
export function acpAgentModelValue(model: AgentModelId, options: AcpModelOption[]): string | null {
  const wire = modelWireId(model);
  if (wire === ACP_AGENT_DEFAULT_MODEL) return null;
  return options.some((option) => option.value === wire) ? wire : null;
}

export function createAcpAgentClient(
  id: AcpAgentProviderId,
  cli: AcpCliInfo,
  transcriptRoot: string,
): AcpAgentClient {
  const spec = ACP_AGENT_SPECS[id];
  const label = PROVIDER_LABELS[id];
  return new AcpAgentClient({
    provider: id,
    label,
    executable: cli.executable,
    args: spec.args,
    transcriptDir: join(transcriptRoot, id),
    models: [{ model: `${id}:${ACP_AGENT_DEFAULT_MODEL}`, displayName: `${label} default` }],
    // Signed in means the agent agrees to open a session; it says "authentication required"
    // otherwise. The session is metadata only: no prompt is sent.
    accountFromSession: true,
    modelValue: acpAgentModelValue,
    modelListTimeoutMs: 20_000,
  });
}
