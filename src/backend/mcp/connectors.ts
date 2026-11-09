import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  McpConnectorCheck,
  McpConnectorMissing,
  McpServerInput,
  PermissionCategory,
} from "../../shared/ipc";
import {
  CONNECTOR_PRESETS,
  type ConnectorPreset,
  type ConnectorRequirement,
} from "../../shared/mcp-presets";
import { lookupCommand } from "./windows-env";

/**
 * Ready-made connectors (feature "mcp-connector-gallery"): turns a gallery entry and the values the
 * owner typed into the same McpServerInput a manual add produces. Nothing here starts a server.
 */

export interface ConnectorContext {
  /** The Shared folder every coworker can reach. */
  sharedRoot: string;
  /** userData/mcp-connectors: one folder per connector for its config file and cache. */
  connectorRoot: string;
}

const SOURCE_PREFIX = "Sahkarmi connector: ";

/** The `source` a connector's server is saved with; it ties tool calls back to the preset. */
export function connectorSource(id: string): string {
  return `${SOURCE_PREFIX}${id}`;
}

export function connectorIdOf(source: string | undefined): string | null {
  if (!source?.startsWith(SOURCE_PREFIX)) return null;
  const id = source.slice(SOURCE_PREFIX.length);
  return CONNECTOR_PRESETS.some((preset) => preset.id === id) ? id : null;
}

export function connectorFolder(preset: ConnectorPreset, context: ConnectorContext): string {
  return join(context.connectorRoot, preset.id);
}

function fill(text: string, preset: ConnectorPreset, context: ConnectorContext): string {
  return text
    .replaceAll("@@SHARED@@", context.sharedRoot)
    .replaceAll("@@CONNECTOR_DIR@@", connectorFolder(preset, context));
}

/**
 * The server to save for `preset`, with the owner's values. Throws a plain message when a required
 * value is missing. The result is always switched off: it is tested before it can be turned on.
 */
export function connectorInput(
  preset: ConnectorPreset,
  values: Record<string, string>,
  context: ConnectorContext,
  name = preset.serverName,
): McpServerInput {
  const env = Object.fromEntries(
    Object.entries(preset.env).map(([key, value]) => [key, fill(value, preset, context)]),
  );
  const headers = { ...preset.headers };
  let command = preset.command;
  for (const field of preset.fields) {
    const raw = (values[field.key] ?? "").trim();
    const value = field.kind === "accept" ? (raw === "true" ? "true" : "") : raw;
    if (!value) {
      if (field.required) {
        throw new Error(
          field.kind === "accept" ? `Tick "${field.label}" first.` : `Fill in "${field.label}".`,
        );
      }
      continue;
    }
    if (field.target === "command") {
      if (!isAbsolute(value) || !/\.exe$/i.test(value)) {
        throw new Error(`"${field.label}": pick the full path of the .exe file.`);
      }
      command = value;
    } else if (field.target === "header") {
      headers[field.key] = `${field.prefix ?? ""}${value}`;
    } else {
      env[field.key] = value;
    }
  }
  const input: McpServerInput = {
    name,
    transport: preset.transport,
    enabled: false,
  };
  if (preset.transport === "http") {
    input.url = preset.url;
    input.headers = headers;
  } else {
    input.command = command;
    input.args = preset.args.map((arg) => fill(arg, preset, context));
    input.env = env;
  }
  if (preset.heavy) input.heavy = true;
  return input;
}

/** Writes the connector's own config file(s) into its folder (only when the owner presses Add). */
export async function writeConnectorFiles(
  preset: ConnectorPreset,
  context: ConnectorContext,
): Promise<void> {
  const folder = connectorFolder(preset, context);
  await mkdir(folder, { recursive: true });
  for (const [file, text] of Object.entries(preset.files ?? {})) {
    if (!/^[A-Za-z0-9_.-]+$/.test(file)) continue;
    await writeFile(join(folder, file), fill(text, preset, context), "utf8");
  }
}

const CHROME_PATHS = [
  ["ProgramFiles", "Google\\Chrome\\Application\\chrome.exe"],
  ["ProgramFiles(x86)", "Google\\Chrome\\Application\\chrome.exe"],
  ["LOCALAPPDATA", "Google\\Chrome\\Application\\chrome.exe"],
] as const;

export function chromeInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  return CHROME_PATHS.some(([variable, rest]) => {
    const base = env[variable];
    return Boolean(base) && existsSync(join(base as string, rest));
  });
}

/** What the requirement check reads from this PC; injectable for tests. */
export interface ConnectorProbe {
  has: (command: string) => boolean;
  nodeMajor: number | null;
  chrome: boolean;
}

const LINKS: Record<Exclude<ConnectorRequirement, "program">, string> = {
  node: "https://nodejs.org/en/download",
  uv: "https://docs.astral.sh/uv/getting-started/installation/",
  git: "https://git-scm.com/download/win",
  chrome: "https://www.google.com/chrome/",
};

/** What is missing for one connector. Never installs anything; the owner gets a link. */
export function connectorMissing(
  preset: ConnectorPreset,
  probe: ConnectorProbe,
): McpConnectorMissing[] {
  const missing: McpConnectorMissing[] = [];
  for (const requirement of preset.requirements) {
    if (requirement === "program") continue; // The owner picks the program in a field.
    if (requirement === "node") {
      const tooOld =
        preset.minNode !== undefined &&
        probe.nodeMajor !== null &&
        probe.nodeMajor < preset.minNode;
      if (!probe.has("npx") || tooOld) {
        missing.push({
          requirement,
          link: LINKS.node,
          ...(preset.minNode ? { minVersion: preset.minNode } : {}),
          ...(tooOld && probe.nodeMajor !== null ? { foundVersion: probe.nodeMajor } : {}),
        });
      }
    } else if (requirement === "uv") {
      if (!probe.has("uvx")) missing.push({ requirement, link: LINKS.uv });
    } else if (requirement === "git") {
      if (!probe.has("git")) missing.push({ requirement, link: LINKS.git });
    } else if (requirement === "chrome" && !probe.chrome) {
      missing.push({ requirement, link: LINKS.chrome });
    }
  }
  return missing;
}

export function connectorChecks(
  probe: ConnectorProbe,
  addedAs: (id: string) => string | null,
): McpConnectorCheck[] {
  return CONNECTOR_PRESETS.map((preset) => {
    const missing = connectorMissing(preset, probe);
    return { id: preset.id, ready: missing.length === 0, missing, addedAs: addedAs(preset.id) };
  });
}

let nodeVersionCache: { path: string; major: number | null } | null = null;

/** `node --version` of the Node.js on PATH (a short check, only when the gallery is opened). */
export function nodeMajor(env: NodeJS.ProcessEnv): Promise<number | null> {
  const path = lookupCommand("node", env).path;
  if (!path) return Promise.resolve(null);
  if (nodeVersionCache?.path === path) return Promise.resolve(nodeVersionCache.major);
  return new Promise((resolve) => {
    execFile(path, ["--version"], { timeout: 5_000, windowsHide: true, env }, (error, stdout) => {
      const major = error ? null : Number(/^v(\d+)/.exec(String(stdout).trim())?.[1] ?? Number.NaN);
      const value = major !== null && Number.isFinite(major) ? major : null;
      nodeVersionCache = { path, major: value };
      resolve(value);
    });
  });
}

/** `mcp__<server>__<tool>` → its parts; null for anything else. */
export function splitToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__([A-Za-z0-9_-]+?)__(.+)$/.exec(name);
  return match?.[1] && match[2] ? { server: match[1], tool: match[2] } : null;
}

function stringsAt(input: Record<string, unknown>, keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = input[key];
    if (typeof value === "string" && value) return [value];
    if (Array.isArray(value))
      return value.filter((entry): entry is string => typeof entry === "string");
    return [];
  });
}

/**
 * How one of a connector's tools is checked: the category from the first matching rule, with the
 * paths it touches. Null when no rule matches (the caller keeps its usual "ask").
 */
export function connectorToolCategory(
  preset: ConnectorPreset,
  tool: string,
  input: Record<string, unknown>,
): { category: PermissionCategory; paths: string[] } | null {
  for (const rule of preset.toolRules) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(rule.tool);
    } catch {
      continue;
    }
    if (!pattern.test(tool)) continue;
    if (rule.uriKey) {
      const uri = typeof input[rule.uriKey] === "string" ? (input[rule.uriKey] as string) : "";
      if (/^file:/i.test(uri)) {
        try {
          return { category: "file_read", paths: [fileURLToPath(uri)] };
        } catch {
          return null;
        }
      }
      // Web and data addresses read nothing on this PC; anything else is asked.
      return /^(https?|data):/i.test(uri) ? { category: rule.category, paths: [] } : null;
    }
    return { category: rule.category, paths: rule.pathKeys ? stringsAt(input, rule.pathKeys) : [] };
  }
  return null;
}
