import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { McpServerInput, McpServerSummary } from "../shared/ipc";
import { type FetchLike, fetchRepoText, fetchRepoTree, parseGithubUrl } from "./github-repo";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

const FILE = "mcp-servers.json";
export const MAX_MCP_SERVERS = 30;
const NAME = /^[A-Za-z0-9_-]{1,48}$/;

/** One MCP server as stored (env and header values may hold keys; never sent to the window). */
export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  source: string;
  addedAt: string;
}

/** What a runtime needs to start the server; passed to clients as `customMcpServers`. */
export type McpServerWire = Pick<
  McpServerConfig,
  "name" | "transport" | "command" | "args" | "env" | "url" | "headers"
>;

interface StoredFile {
  version: 1;
  servers: McpServerConfig[];
}

function isStored(value: unknown): value is StoredFile {
  return isRecord(value) && value.version === 1 && Array.isArray(value.servers);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^[A-Za-z0-9_.-]{1,128}$/.test(key) && typeof entry === "string") result[key] = entry;
  }
  return result;
}

/**
 * MCP servers the owner adds (like `claude mcp add`). Saved in the app's data folder, readable by
 * the owner only, and handed to every coworker's AI when its chat starts.
 */
export class McpServerStore {
  readonly #file: JsonFile<StoredFile>;
  readonly #fetch: FetchLike;
  #servers: McpServerConfig[] = [];

  constructor(userDataPath: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.#file = new JsonFile(join(userDataPath, FILE));
    this.#fetch = fetchImpl;
  }

  async load(): Promise<McpServerSummary[]> {
    const stored = await this.#file.read(() => ({ version: 1, servers: [] }), isStored);
    this.#servers = stored.servers.filter((server) => isRecord(server) && NAME.test(server.name));
    return this.list();
  }

  list(): McpServerSummary[] {
    return this.#servers.map(summary);
  }

  /** Enabled servers for a runtime, read when a coworker's chat starts. */
  enabled(): McpServerWire[] {
    return this.#servers
      .filter((server) => server.enabled)
      .map(({ name, transport, command, args, env, url, headers }) => ({
        name,
        transport,
        command,
        args,
        env,
        url,
        headers,
      }));
  }

  /** Adds a server, or updates the one with `input.id`. Blank env/header values keep the old ones. */
  async save(input: McpServerInput, source = "added by hand"): Promise<McpServerSummary[]> {
    const previous = input.id ? this.#servers.find((server) => server.id === input.id) : undefined;
    const next = normalizeServer(input, previous, source);
    const clash = this.#servers.find(
      (server) =>
        server.id !== previous?.id && server.name.toLowerCase() === next.name.toLowerCase(),
    );
    if (clash) throw new Error(`There is already a server called "${next.name}".`);
    if (!previous && this.#servers.length >= MAX_MCP_SERVERS) {
      throw new Error(`You can add up to ${MAX_MCP_SERVERS} MCP servers. Remove one first.`);
    }
    this.#servers = previous
      ? this.#servers.map((server) => (server.id === previous.id ? next : server))
      : [...this.#servers, next];
    await this.#persist();
    return this.list();
  }

  /**
   * Imports Claude-style JSON ({"mcpServers": {...}}) as pasted from a README, Claude Desktop or a
   * repo's .mcp.json. A server with a name that already exists is replaced.
   */
  async importJson(
    text: string,
    source = "pasted JSON",
  ): Promise<{
    servers: McpServerSummary[];
    added: string[];
    skipped: string[];
  }> {
    const { servers, skipped } = parseMcpJson(text);
    if (servers.length === 0) {
      throw new Error(
        skipped.length > 0
          ? `Nothing could be added: ${skipped.join("; ")}`
          : 'No servers found. Paste JSON like {"mcpServers": {"name": {"command": "npx", "args": [...]}}}.',
      );
    }
    const added: string[] = [];
    for (const input of servers) {
      const existing = this.#servers.find(
        (server) => server.name.toLowerCase() === input.name.toLowerCase(),
      );
      try {
        await this.save({ ...input, id: existing?.id, enabled: existing?.enabled ?? true }, source);
        added.push(input.name);
      } catch (error) {
        skipped.push(`${input.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { servers: this.list(), added, skipped };
  }

  /** Collects the .mcp.json files in a GitHub repo into one JSON text for the owner to review. */
  async githubJson(url: string): Promise<string> {
    const tree = await fetchRepoTree(parseGithubUrl(url), this.#fetch);
    const files = tree.files.filter((file) => /(^|\/)\.mcp\.json$/i.test(file.path)).slice(0, 20);
    if (files.length === 0) {
      throw new Error(
        "That repo has no .mcp.json. Copy the MCP JSON from its README and paste it instead.",
      );
    }
    const merged: Record<string, unknown> = {};
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(
          await fetchRepoText(tree, file.path, this.#fetch, 100_000),
        );
        const map = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
        if (isRecord(map)) Object.assign(merged, map);
      } catch {
        // A broken file is left out; the owner sees what was found.
      }
    }
    return JSON.stringify({ mcpServers: merged }, null, 2);
  }

  async setEnabled(id: string, enabled: boolean): Promise<McpServerSummary[]> {
    this.#servers = this.#servers.map((server) =>
      server.id === id ? { ...server, enabled } : server,
    );
    await this.#persist();
    return this.list();
  }

  async remove(id: string): Promise<McpServerSummary[]> {
    this.#servers = this.#servers.filter((server) => server.id !== id);
    await this.#persist();
    return this.list();
  }

  async #persist(): Promise<void> {
    await this.#file.write({ version: 1, servers: this.#servers });
  }
}

function summary(server: McpServerConfig): McpServerSummary {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    envKeys: Object.keys(server.env),
    headerKeys: Object.keys(server.headers),
    source: server.source,
  };
}

function normalizeServer(
  input: McpServerInput,
  previous: McpServerConfig | undefined,
  source: string,
): McpServerConfig {
  const name = String(input.name ?? "").trim();
  if (!NAME.test(name)) {
    throw new Error("Name: letters, numbers, - and _ only (up to 48), like github or my-files.");
  }
  if (/^sahkarmi/i.test(name)) throw new Error('Names starting with "sahkarmi" are reserved.');
  const keep = (next: Record<string, string> | undefined, old: Record<string, string>) => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(stringMap(next ?? old))) {
      // A blank value in an edit means "keep the saved one" (the window never sees secrets).
      result[key] = value === "" && key in old ? (old[key] ?? "") : value;
    }
    return result;
  };
  const transport = input.transport === "http" ? "http" : "stdio";
  const command = String(input.command ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (transport === "stdio" && !command)
    throw new Error("Enter the command that starts the server.");
  if (transport === "http" && !/^https?:\/\/\S+$/i.test(url)) {
    throw new Error("Enter the server's address, starting with https://.");
  }
  return {
    id: previous?.id ?? randomUUID(),
    name,
    enabled: input.enabled ?? previous?.enabled ?? true,
    transport,
    command: transport === "stdio" ? command : "",
    args:
      transport === "stdio" && Array.isArray(input.args)
        ? input.args.filter((arg): arg is string => typeof arg === "string").slice(0, 64)
        : [],
    env: transport === "stdio" ? keep(input.env, previous?.env ?? {}) : {},
    url: transport === "http" ? url : "",
    headers: transport === "http" ? keep(input.headers, previous?.headers ?? {}) : {},
    source: previous?.source ?? source,
    addedAt: previous?.addedAt ?? new Date().toISOString(),
  };
}

/** Claude Code / Claude Desktop / Cursor / VS Code style MCP JSON → servers to save. */
export function parseMcpJson(text: string): { servers: McpServerInput[]; skipped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error("That is not valid JSON. Copy the whole { ... } block.");
  }
  let map: unknown = parsed;
  if (isRecord(parsed)) {
    if (isRecord(parsed.mcpServers)) map = parsed.mcpServers;
    else if (isRecord(parsed.servers)) map = parsed.servers;
    else if (isRecord(parsed.mcp) && isRecord(parsed.mcp.servers)) map = parsed.mcp.servers;
  }
  if (!isRecord(map)) return { servers: [], skipped: [] };
  const servers: McpServerInput[] = [];
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (!isRecord(value)) continue;
    if (typeof value.command === "string") {
      servers.push({
        name,
        transport: "stdio",
        command: value.command,
        args: Array.isArray(value.args) ? value.args.map(String) : [],
        env: stringMap(value.env),
      });
      continue;
    }
    const url =
      typeof value.url === "string"
        ? value.url
        : typeof value.serverUrl === "string"
          ? value.serverUrl
          : "";
    if (url) {
      if (value.type === "sse") {
        skipped.push(`${name}: old "sse" servers are not supported; use its HTTP address`);
        continue;
      }
      servers.push({ name, transport: "http", url, headers: stringMap(value.headers) });
      continue;
    }
    skipped.push(`${name}: no "command" or "url"`);
  }
  return { servers, skipped };
}

/** Reads `customMcpServers` from thread/start or thread/resume params. */
export function readCustomMcpServers(params: unknown): McpServerWire[] {
  const list =
    isRecord(params) && Array.isArray(params.customMcpServers) ? params.customMcpServers : [];
  return list.filter(isRecord).flatMap((entry) => {
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!NAME.test(name)) return [];
    return [
      {
        name,
        transport: entry.transport === "http" ? ("http" as const) : ("stdio" as const),
        command: typeof entry.command === "string" ? entry.command : "",
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
        env: stringMap(entry.env),
        url: typeof entry.url === "string" ? entry.url : "",
        headers: stringMap(entry.headers),
      },
    ];
  });
}

/**
 * On Windows, npx/npm/pnpm/yarn are .cmd scripts that cannot be started without a shell, so they
 * run through cmd /c (what Claude Code tells Windows users to do by hand).
 */
export function launchCommand(
  server: McpServerWire,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (
    platform === "win32" &&
    /^(npx|npm|pnpm|pnpx|yarn|bunx)(\.cmd)?$|\.(cmd|bat)$/i.test(server.command)
  ) {
    return { command: "cmd", args: ["/c", server.command, ...server.args] };
  }
  return { command: server.command, args: server.args };
}

/** Claude Agent SDK `mcpServers` entries. */
export function claudeMcpServers(
  servers: McpServerWire[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    result[server.name] =
      server.transport === "http"
        ? { type: "http", url: server.url, headers: server.headers }
        : { type: "stdio", ...launchCommand(server), env: server.env };
  }
  return result;
}

/** ACP session `mcpServers` entries (Gemini, Antigravity, OpenCode). HTTP only when supported. */
export function acpMcpServers(servers: McpServerWire[], httpSupported: boolean): unknown[] {
  const pairs = (map: Record<string, string>) =>
    Object.entries(map).map(([name, value]) => ({ name, value }));
  return servers.flatMap((server): unknown[] => {
    if (server.transport === "http") {
      return httpSupported
        ? [{ type: "http", name: server.name, url: server.url, headers: pairs(server.headers) }]
        : [];
    }
    return [{ name: server.name, ...launchCommand(server), env: pairs(server.env) }];
  });
}

/** Codex thread `config` override: { mcp_servers: { name: {...} } }. */
export function codexMcpConfig(servers: McpServerWire[]): Record<string, unknown> | undefined {
  if (servers.length === 0) return undefined;
  const mcp: Record<string, unknown> = {};
  for (const server of servers) {
    mcp[server.name] =
      server.transport === "http"
        ? { url: server.url, http_headers: server.headers }
        : { ...launchCommand(server), env: server.env };
  }
  return { mcp_servers: mcp };
}
