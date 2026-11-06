import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipBuffer } from "../antigravity-runtime";
import { lookupCommand, setManagedToolDirectories } from "./windows-env";

/**
 * Programs MCP servers need (uv, Python, Node) found on this PC, or downloaded by Sahkarmi into
 * userData\tools\<tool>\<version> after the owner approves. Downloads come only from the tools'
 * official release pages and are checked against their published SHA-256 sums. Never `irm | iex`.
 */

export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string>; method?: string },
) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export const UV_ASSET = "uv-x86_64-pc-windows-msvc.zip";
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function run(command: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout, encoding: "utf8" },
      (error, stdout, stderr) => (error ? reject(error) : resolve(`${stdout}${stderr}`)),
    );
  });
}

export interface PythonInfo {
  path: string;
  version: [number, number];
}

/** "-V:3.13 *  C:\...\python.exe" lines from `py -0p`. */
export function parsePyLauncher(output: string): PythonInfo[] {
  const found: PythonInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /-V:(?:[^/\s]+\/)?(?:CPython)?(\d+)\.(\d+)[^\s]*\s+\*?\s*(\S.*\.exe)\s*$/i.exec(
      line.trim(),
    );
    if (match?.[3])
      found.push({ path: match[3].trim(), version: [Number(match[1]), Number(match[2])] });
  }
  return found;
}

/** ">=3.11" → [3, 11]; anything else → [3, 10]. */
export function minimumPython(requires: string | undefined): [number, number] {
  const match = /(?:>=|~=|==)\s*(\d+)\.(\d+)/.exec(requires ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [3, 10];
}

const atLeast = (version: [number, number], minimum: [number, number]) =>
  version[0] > minimum[0] || (version[0] === minimum[0] && version[1] >= minimum[1]);

export class ToolsManager {
  readonly root: string;
  readonly #fetch: HttpFetch;

  constructor(userDataPath: string, fetchImpl: HttpFetch = fetch as unknown as HttpFetch) {
    this.root = join(userDataPath, "tools");
    this.#fetch = fetchImpl;
  }

  /** Managed tool folders, added at the end of the fresh PATH so servers can use them by name. */
  async refreshManagedPath(): Promise<string[]> {
    const directories: string[] = [];
    const list = async (folder: string) => readdir(folder).catch(() => [] as string[]);
    for (const version of (await list(join(this.root, "uv"))).sort().reverse()) {
      directories.push(join(this.root, "uv", version));
      break;
    }
    for (const version of (await list(join(this.root, "node"))).sort().reverse()) {
      const inner = (await list(join(this.root, "node", version))).find((name) =>
        name.startsWith("node-v"),
      );
      if (inner) directories.push(join(this.root, "node", version, inner));
      break;
    }
    for (const name of (await list(join(this.root, "python"))).sort().reverse()) {
      if (/^cpython-3\.\d+/.test(name)) {
        directories.push(join(this.root, "python", name));
        break;
      }
    }
    setManagedToolDirectories(directories);
    return directories;
  }

  /** uv on PATH, in its usual folders, or Sahkarmi's own copy. */
  findUv(env: NodeJS.ProcessEnv): string | null {
    const onPath = lookupCommand("uv", env).path;
    if (onPath) return onPath;
    const home = env.USERPROFILE ?? "";
    for (const candidate of [
      join(home, ".local", "bin", "uv.exe"),
      join(home, ".cargo", "bin", "uv.exe"),
    ]) {
      if (home && existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** node.exe (with npm next to it), on PATH or Sahkarmi's own copy. */
  findNode(env: NodeJS.ProcessEnv): { node: string; npmCli: string } | null {
    const node = lookupCommand("node", env).path;
    if (!node) return null;
    const npmCli = join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js");
    return existsSync(npmCli) ? { node, npmCli } : null;
  }

  /** A real Python of at least `minimum` (the Store stub never counts, MCP-9); newest first. */
  async findPython(env: NodeJS.ProcessEnv, minimum: [number, number]): Promise<PythonInfo | null> {
    const found: PythonInfo[] = [];
    const launcher = lookupCommand("py", env).path;
    if (launcher) found.push(...parsePyLauncher(await run(launcher, ["-0p"]).catch(() => "")));
    const python = lookupCommand("python", env).path;
    if (python) {
      const text = await run(python, [
        "-c",
        "import sys;print(sys.version_info[0],sys.version_info[1])",
      ]).catch(() => "");
      const match = /(\d+)\s+(\d+)/.exec(text);
      if (match) found.push({ path: python, version: [Number(match[1]), Number(match[2])] });
    }
    const usable = found.filter(
      (entry) => atLeast(entry.version, minimum) && existsSync(entry.path),
    );
    // 3.11 first when allowed (what most AI projects test with), then the newest.
    usable.sort((a, b) => {
      const score = (entry: PythonInfo) => (entry.version[1] === 11 ? 1000 : 0) + entry.version[1];
      return score(b) - score(a);
    });
    return usable[0] ?? null;
  }

  /** Latest uv release version, read from GitHub's /releases/latest redirect (no API call). */
  async latestUvVersion(): Promise<string> {
    const response = await this.#fetch("https://github.com/astral-sh/uv/releases/latest", {
      headers: { "User-Agent": "Sahkarmi" },
    });
    const version = /\/tag\/v?([0-9]+\.[0-9]+\.[0-9]+)$/.exec(response.url)?.[1];
    if (!version) throw new Error("Could not find the latest uv version. Try again later.");
    return version;
  }

  uvDirectory(version: string): string {
    return join(this.root, "uv", version);
  }

  uvUrls(version: string): { zip: string; sha256: string } {
    const base = `https://github.com/astral-sh/uv/releases/download/${version}/${UV_ASSET}`;
    return { zip: base, sha256: `${base}.sha256` };
  }

  /** Downloads uv's Windows zip, checks it against the release's .sha256 file, unpacks it. */
  async installUv(version: string, log: (line: string) => void = () => {}): Promise<string> {
    if (!VERSION.test(version)) throw new Error("Unexpected uv version.");
    const target = this.uvDirectory(version);
    const exe = join(target, "uv.exe");
    if (existsSync(exe)) return exe;
    const urls = this.uvUrls(version);
    const expected = (await this.#text(urls.sha256)).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    log(`Downloading ${urls.zip}`);
    const zip = await this.#download(urls.zip);
    verifySha256(zip, expected, UV_ASSET);
    log(`SHA-256 matches (${expected.slice(0, 16)}…)`);
    await this.#unpack(zip, target);
    if (!existsSync(exe)) throw new Error("The uv download did not contain uv.exe.");
    await this.refreshManagedPath();
    return exe;
  }

  /** The newest Node.js LTS version and its Windows zip. */
  async latestNodeLts(): Promise<{ version: string; zip: string; shasums: string; file: string }> {
    const index = (await (await this.#fetch("https://nodejs.org/dist/index.json")).json()) as {
      version?: string;
      lts?: unknown;
      files?: string[];
    }[];
    const release = index.find((entry) => entry.lts && entry.files?.includes("win-x64-zip"));
    const version = release?.version?.replace(/^v/, "");
    if (!version || !VERSION.test(version))
      throw new Error("Could not find the current Node.js version.");
    const file = `node-v${version}-win-x64.zip`;
    return {
      version,
      file,
      zip: `https://nodejs.org/dist/v${version}/${file}`,
      shasums: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
    };
  }

  nodeExecutable(version: string): string {
    return join(this.root, "node", version, `node-v${version}-win-x64`, "node.exe");
  }

  /** Downloads portable Node.js, checks it against SHASUMS256.txt, unpacks it. */
  async installNode(version: string, log: (line: string) => void = () => {}): Promise<string> {
    if (!VERSION.test(version)) throw new Error("Unexpected Node.js version.");
    const exe = this.nodeExecutable(version);
    if (existsSync(exe)) return exe;
    const file = `node-v${version}-win-x64.zip`;
    const sums = await this.#text(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`);
    const expected = sums
      .split(/\r?\n/)
      .find((line) => line.trim().endsWith(` ${file}`))
      ?.trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    if (!expected) throw new Error("Node.js did not publish a checksum for that file.");
    log(`Downloading https://nodejs.org/dist/v${version}/${file}`);
    const zip = await this.#download(`https://nodejs.org/dist/v${version}/${file}`);
    verifySha256(zip, expected, file);
    log(`SHA-256 matches (${expected.slice(0, 16)}…)`);
    await this.#unpack(zip, join(this.root, "node", version));
    if (!existsSync(exe)) throw new Error("The Node.js download did not contain node.exe.");
    await this.refreshManagedPath();
    return exe;
  }

  /** Where `uv python install` puts Pythons, inside Sahkarmi's tools folder (no system change). */
  get pythonDirectory(): string {
    return join(this.root, "python");
  }

  async #text(url: string): Promise<string> {
    const response = await this.#fetch(url, { headers: { "User-Agent": "Sahkarmi" } });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return response.text();
  }

  async #download(url: string): Promise<Buffer> {
    const response = await this.#fetch(url, { headers: { "User-Agent": "Sahkarmi" } });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async #unpack(zip: Buffer, target: string): Promise<void> {
    const temporary = `${target}.partial`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    await unzipBuffer(zip, temporary);
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await rename(temporary, target);
  }
}

export function verifySha256(data: Buffer, expected: string, label: string): void {
  const actual = createHash("sha256").update(data).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(expected) || actual !== expected) {
    throw new Error(`${label} failed its SHA-256 check, so it was not used.`);
  }
}
