import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type {
  McpEnvRequirement,
  McpRepoAnalysis,
  McpServerInput,
  McpServerStatus,
  McpServerSummary,
} from "../shared/ipc";
import { type FetchLike, fetchRepoText, fetchRepoTree, parseGithubUrl } from "./github-repo";
import { JsonFile } from "./json-file";
import { argumentPaths, serverProblems } from "./mcp/checks";
import { testServer } from "./mcp/handshake";
import { placeholderHits } from "./mcp/placeholders";
import { RepoAnalyzer } from "./mcp/resolve";
import { freshPath, lookupCommand, refreshFreshPath, serverEnvironment } from "./mcp/windows-env";
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
  /** Folder the server starts in (MCP-4). */
  cwd?: string;
  /** Coworkers that get the server; missing or null = all (how every older server works). */
  coworkerIds?: string[] | null;
  /** Saved under the "test first" rule: it can be turned on only after a passing test (MCP-11). */
  needsTest?: boolean;
  /** The last "Test server" result (MCP-18). */
  status?: McpServerStatus | null;
  /** Keys the server says it needs (from server.json, MCP-13). */
  requiredEnv?: McpEnvRequirement[];
}

/** What a runtime needs to start the server; passed to clients as `customMcpServers`. */
export type McpServerWire = Pick<
  McpServerConfig,
  "name" | "transport" | "command" | "args" | "env" | "url" | "headers"
> & {
  cwd?: string;
  /** Never passed a test yet: the first start may download a package (MCP-15). */
  firstRun?: boolean;
};

/** Feature switches this store follows; all on when nothing is set (tests, first start). */
export type McpFeatureId = "mcp-fresh-path" | "mcp-test-first" | "mcp-smart-import";
export type McpFeatureCheck = (id: McpFeatureId) => boolean;

/** How long a test may take: a first run can download the whole package (npx -y, uvx). */
export const FIRST_RUN_TEST_MS = 60_000;
export const TEST_MS = 15_000;

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
 * the owner only, and handed to the coworkers the owner chose when their chat starts.
 */
export class McpServerStore {
  readonly #file: JsonFile<StoredFile>;
  readonly #fetch: FetchLike;
  #servers: McpServerConfig[] = [];
  #feature: McpFeatureCheck = () => true;
  readonly #analyzer: RepoAnalyzer;

  constructor(userDataPath: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.#file = new JsonFile(join(userDataPath, FILE));
    this.#fetch = fetchImpl;
    this.#analyzer = new RepoAnalyzer(join(userDataPath, "mcp-cache"), fetchImpl);
  }

  /** The analysis made earlier in this session (install plans refer to it by id). */
  analysis(id: string): McpRepoAnalysis | undefined {
    return this.#analyzer.get(id);
  }

  /**
   * "Connect from GitHub" (audit §11.4 steps 1-3). With smart import switched off it returns the
   * repo's .mcp.json files as before, for the paste box.
   */
  async analyzeGithub(url: string): Promise<McpRepoAnalysis> {
    if (!this.#feature("mcp-smart-import")) {
      const location = parseGithubUrl(url);
      return {
        id: "",
        repo: `${location.owner}/${location.repo}`,
        url,
        commit: "",
        subPath: location.subPath,
        kind: "unknown",
        notMcp: [],
        evidence: [],
        candidates: [],
        cli: null,
        heavy: false,
        warnings: [],
        truncated: false,
        legacyJson: await this.githubJson(url),
      };
    }
    return this.#analyzer.analyze(url);
  }

  /** Saves a ready-made candidate from an analysis, with the key values the owner typed. */
  async addCandidate(
    analysisId: string,
    candidateId: string,
    name: string,
    values: Record<string, string>,
  ): Promise<McpServerSummary[]> {
    const analysis = this.#analyzer.get(analysisId);
    const candidate = analysis?.candidates.find((entry) => entry.id === candidateId);
    if (!analysis || !candidate?.server) {
      throw new Error("That suggestion is no longer available. Load the repo again.");
    }
    const allowed = new Set([
      ...candidate.requiredEnv.map((entry) => entry.name),
      ...Object.keys(candidate.server.env ?? {}),
    ]);
    const filled = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => allowed.has(key) && value.trim() !== ""),
    );
    const server = candidate.server;
    return this.save(
      {
        ...server,
        name,
        ...(server.transport === "http"
          ? { headers: { ...(server.headers ?? {}), ...filled } }
          : { env: { ...(server.env ?? {}), ...filled } }),
        requiredEnv: candidate.requiredEnv,
        enabled: this.#feature("mcp-test-first") ? false : undefined,
      },
      `GitHub ${analysis.repo}${analysis.commit ? `@${analysis.commit.slice(0, 7)}` : ""}`,
    );
  }

  /** Follows Settings › Features (fresh PATH, test before use). */
  setFeatureCheck(check: McpFeatureCheck): void {
    this.#feature = check;
  }

  async load(): Promise<McpServerSummary[]> {
    const stored = await this.#file.read(() => ({ version: 1, servers: [] }), isStored);
    this.#servers = stored.servers.filter((server) => isRecord(server) && NAME.test(server.name));
    return this.list();
  }

  /** The environment checks look commands up in: the fresh PATH when that is on. */
  #checkEnv(): NodeJS.ProcessEnv {
    return this.#feature("mcp-fresh-path") ? { ...process.env, PATH: freshPath() } : process.env;
  }

  list(): McpServerSummary[] {
    const env = this.#checkEnv();
    return this.#servers.map((server) => summary(server, env));
  }

  /** Re-reads Windows' PATH from the registry (Settings opened, or Re-check pressed). */
  async recheck(): Promise<McpServerSummary[]> {
    if (this.#feature("mcp-fresh-path")) await refreshFreshPath();
    return this.list();
  }

  /**
   * Enabled servers for a runtime, read when a coworker's chat starts. With `botId`, only the
   * servers that coworker may use (MCP-12). A server still holding a template value is left out.
   */
  enabled(botId?: string): McpServerWire[] {
    return this.#servers
      .filter((server) => server.enabled)
      .filter(
        (server) =>
          botId === undefined ||
          !Array.isArray(server.coworkerIds) ||
          server.coworkerIds.includes(botId),
      )
      .filter((server) => placeholderHits(server).length === 0)
      .map((server) => this.#wire(server));
  }

  #wire(server: McpServerConfig): McpServerWire {
    const { name, transport, command, args, url, headers } = server;
    const env =
      transport === "stdio" && this.#feature("mcp-fresh-path")
        ? serverEnvironment(server.env)
        : server.env;
    return {
      name,
      transport,
      command,
      args,
      env,
      url,
      headers,
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.status?.ok ? {} : { firstRun: true }),
    };
  }

  /** Adds a server, or updates the one with `input.id`. Blank env/header values keep the old ones. */
  async save(input: McpServerInput, source = "added by hand"): Promise<McpServerSummary[]> {
    const previous = input.id ? this.#servers.find((server) => server.id === input.id) : undefined;
    const next = normalizeServer(input, previous, source, this.#feature("mcp-test-first"));
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
   * repo's .mcp.json. A server whose name already exists is replaced only when its name is in
   * `replace` (the owner confirmed it); otherwise it is reported in `conflicts` (MCP-14).
   */
  async importJson(
    text: string,
    source = "pasted JSON",
    replace: string[] = [],
  ): Promise<{
    servers: McpServerSummary[];
    added: string[];
    skipped: string[];
    conflicts: string[];
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
    const conflicts: string[] = [];
    const confirmed = new Set(replace.map((name) => name.toLowerCase()));
    for (const input of servers) {
      const existing = this.#servers.find(
        (server) => server.name.toLowerCase() === input.name.toLowerCase(),
      );
      if (existing && !confirmed.has(existing.name.toLowerCase())) {
        conflicts.push(existing.name);
        continue;
      }
      const testFirst = this.#feature("mcp-test-first");
      try {
        await this.save(
          {
            ...input,
            id: existing?.id,
            enabled: testFirst ? false : (existing?.enabled ?? true),
          },
          source,
        );
        added.push(input.name);
      } catch (error) {
        skipped.push(`${input.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { servers: this.list(), added, skipped, conflicts };
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
    const server = this.#servers.find((entry) => entry.id === id);
    if (enabled && server) {
      const template = placeholderHits(server)[0];
      if (template) {
        throw new Error(
          `This is a template: replace "${template.token}" with the real value, then turn it on.`,
        );
      }
      if (server.needsTest && !server.status?.ok && this.#feature("mcp-test-first")) {
        throw new Error('Press "Test server" first. It can be turned on once the test passes.');
      }
    }
    this.#servers = this.#servers.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
    await this.#persist();
    return this.list();
  }

  /** Which coworkers get the server; null means all of them (MCP-12). */
  async setCoworkers(id: string, coworkerIds: string[] | null): Promise<McpServerSummary[]> {
    const ids = Array.isArray(coworkerIds)
      ? [...new Set(coworkerIds.filter((entry) => typeof entry === "string" && entry))].slice(
          0,
          200,
        )
      : null;
    this.#servers = this.#servers.map((entry) =>
      entry.id === id ? { ...entry, coworkerIds: ids } : entry,
    );
    await this.#persist();
    return this.list();
  }

  /** The saved record (main process only: it holds secret values). */
  get(id: string): McpServerConfig | undefined {
    return this.#servers.find((entry) => entry.id === id);
  }

  /** What a test or a coworker's runtime starts for this server, after cmd /c wrapping. */
  launchTargetFor(id: string): LaunchTarget | null {
    const server = this.get(id);
    return server ? launchTarget(this.#wire(server)) : null;
  }

  /**
   * "Test server" (MCP-2): starts it once exactly as coworkers would, lists its tools, ends the
   * process tree and stores the result (MCP-18). 60 s the first time (package download), 15 s after.
   */
  async test(id: string, timeoutMs?: number): Promise<McpServerSummary[]> {
    const server = this.get(id);
    if (!server) throw new Error("That server is no longer in the list.");
    const template = placeholderHits(server)[0];
    if (template) {
      throw new Error(`This is a template: replace "${template.token}" with the real value first.`);
    }
    if (this.#feature("mcp-fresh-path")) await refreshFreshPath();
    const firstRun = !server.status?.ok;
    const result = await testServer(
      { ...launchTarget(this.#wire(server)), displayCommand: server.command },
      { timeoutMs: timeoutMs ?? (firstRun ? FIRST_RUN_TEST_MS : TEST_MS), firstRun },
    );
    const { workingUrl, ...status } = result;
    this.#servers = this.#servers.map((entry) =>
      entry.id === id ? { ...entry, status, ...(workingUrl ? { url: workingUrl } : {}) } : entry,
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

function summary(server: McpServerConfig, env: NodeJS.ProcessEnv): McpServerSummary {
  const problems = serverProblems(server, env);
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
    ...(problems.some(
      (problem) => problem.kind === "missing-command" || problem.kind === "store-stub",
    )
      ? { missingCommand: true }
      : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
    problems,
    status: server.status ?? null,
    ...(server.needsTest ? { needsTest: true } : {}),
    coworkerIds: Array.isArray(server.coworkerIds) ? server.coworkerIds : null,
    ...(server.requiredEnv?.length ? { requiredEnv: server.requiredEnv } : {}),
  };
}

/**
 * Whether Windows can start `command`: a full path that exists, or a name found on PATH with one
 * of PATHEXT's endings (npx is npx.cmd). The Store's python.exe stub does not count (MCP-9).
 */
export function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return lookupCommand(command, env).path !== null;
}

function requirements(value: unknown): McpEnvRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((entry) =>
    typeof entry.name === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(entry.name)
      ? [
          {
            name: entry.name,
            description:
              typeof entry.description === "string" ? entry.description.slice(0, 300) : "",
            isRequired: entry.isRequired === true,
            isSecret: entry.isSecret === true,
          },
        ]
      : [],
  );
}

function sameLaunch(a: McpServerConfig, b: McpServerConfig): boolean {
  return (
    a.command === b.command &&
    a.url === b.url &&
    (a.cwd ?? "") === (b.cwd ?? "") &&
    JSON.stringify(a.args) === JSON.stringify(b.args) &&
    JSON.stringify(a.env) === JSON.stringify(b.env) &&
    JSON.stringify(a.headers) === JSON.stringify(b.headers)
  );
}

function normalizeServer(
  input: McpServerInput,
  previous: McpServerConfig | undefined,
  source: string,
  testFirst: boolean,
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
  const cwd = transport === "stdio" ? String(input.cwd ?? "").trim() : "";
  if (cwd && !isAbsolute(cwd) && placeholderHits({ cwd }).length === 0) {
    throw new Error("Folder: use the full path, like C:\\Users\\you\\my-server.");
  }
  const next: McpServerConfig = {
    id: previous?.id ?? randomUUID(),
    name,
    enabled: input.enabled ?? previous?.enabled ?? !testFirst,
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
    ...(cwd ? { cwd } : {}),
  };
  if (previous && "coworkerIds" in previous) next.coworkerIds = previous.coworkerIds ?? null;
  const required = input.requiredEnv
    ? requirements(input.requiredEnv)
    : (previous?.requiredEnv ?? []);
  if (required.length > 0) next.requiredEnv = required;
  // A new server (while "test first" is on) must pass a test before it can be turned on.
  if ((!previous && testFirst) || previous?.needsTest) next.needsTest = true;
  // When what starts changes, the old test result says nothing about the new one.
  const same = previous ? sameLaunch(previous, next) : false;
  if (same && previous?.status) next.status = previous.status;
  if (previous && !same && next.needsTest && testFirst) next.enabled = false;
  // A template value can never start; it stays off until the owner fills it in (MCP-1).
  if (placeholderHits(next).length > 0) next.enabled = false;
  return next;
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
        ...(typeof value.cwd === "string" && value.cwd ? { cwd: value.cwd } : {}),
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
        ...(typeof entry.cwd === "string" && isAbsolute(entry.cwd) ? { cwd: entry.cwd } : {}),
        ...(entry.firstRun === true ? { firstRun: true } : {}),
      },
    ];
  });
}

/**
 * On Windows, npx/npm/pnpm/yarn are .cmd scripts that cannot be started without a shell, so they
 * run through cmd /c (what Claude Code tells Windows users to do by hand).
 */
export function launchCommand(
  server: Pick<McpServerWire, "command" | "args">,
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

const UV = /(^|[\\/])uvx?(\.exe)?$/i;
const PYTHON = /(^|[\\/])(python[0-9.]*|py)(\.exe)?$/i;

/**
 * For runtimes that cannot start a server in a folder (Claude Code and ACP agents, MCP-4):
 * relative script paths become absolute, uv gets --directory, and `python -m` gets the folder on
 * PYTHONPATH. Codex takes `cwd` itself.
 */
export function withoutCwd(server: McpServerWire): McpServerWire {
  const cwd = server.cwd;
  if (!cwd || server.transport !== "stdio") return server;
  const args = server.args.map((arg) =>
    /\.(py|js|mjs|cjs|ts)$/i.test(arg) && !isAbsolute(arg) && !/^[-@]/.test(arg)
      ? join(cwd, arg)
      : arg,
  );
  const env = { ...server.env };
  if (server.command.match(UV) && argumentPaths(server.args).folders.length === 0) {
    args.unshift("--directory", cwd);
  }
  if (PYTHON.test(server.command) && server.args.includes("-m")) {
    env.PYTHONPATH = env.PYTHONPATH ? `${cwd};${env.PYTHONPATH}` : cwd;
  }
  return { ...server, args, env };
}

export interface LaunchTarget {
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url: string;
  headers: Record<string, string>;
}

/** Command, args, env and folder exactly as a runtime will start them. */
export function launchTarget(server: McpServerWire): LaunchTarget {
  return {
    transport: server.transport,
    ...launchCommand(server),
    env: server.env,
    ...(server.cwd ? { cwd: server.cwd } : {}),
    url: server.url,
    headers: server.headers,
  };
}

/** Claude Agent SDK `mcpServers` entries. Claude Code merges `env` over its own environment. */
export function claudeMcpServers(
  servers: McpServerWire[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const entry of servers) {
    const server = withoutCwd(entry);
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
  return servers.flatMap((entry): unknown[] => {
    const server = withoutCwd(entry);
    if (server.transport === "http") {
      return httpSupported
        ? [{ type: "http", name: server.name, url: server.url, headers: pairs(server.headers) }]
        : [];
    }
    return [{ name: server.name, ...launchCommand(server), env: pairs(server.env) }];
  });
}

/** An npx-based server on Windows can take longer than Codex's 10 s default to start. */
const MCP_STARTUP_SECONDS = 20;
/** Its very first start may download the whole package (npx -y, uvx) (MCP-15). */
export const MCP_FIRST_START_SECONDS = 60;

/** Codex thread `config` override: { mcp_servers: { name: {...} } }. */
export function codexMcpConfig(servers: McpServerWire[]): Record<string, unknown> | undefined {
  if (servers.length === 0) return undefined;
  const mcp: Record<string, unknown> = {};
  for (const server of servers) {
    mcp[server.name] =
      server.transport === "http"
        ? { url: server.url, http_headers: server.headers }
        : {
            ...launchCommand(server),
            env: server.env,
            ...(server.cwd ? { cwd: server.cwd } : {}),
            startup_timeout_sec: server.firstRun ? MCP_FIRST_START_SECONDS : MCP_STARTUP_SECONDS,
          };
  }
  return { mcp_servers: mcp };
}
