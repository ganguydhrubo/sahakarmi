import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpRepoAnalysis } from "../../shared/ipc";
import {
  type FetchLike,
  fetchCommitSha,
  fetchRepoText,
  fetchRepoTree,
  parseGithubUrl,
} from "../github-repo";
import { classifyRepo, filesToRead, type RepoSnapshot } from "./classify";
import { parsePackageJson, parsePyProject } from "./manifests";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const MAX_TEXT_BYTES = 200_000;
const CACHE_KEEP = 50;

function normalRepoUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

async function getJsonQuiet(fetchImpl: FetchLike, url: string): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "Sahkarmi" },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** MCP Registry entries (latest version) whose repository is this repo (rule 1). */
export async function registryEntries(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  subPath: string,
): Promise<unknown[]> {
  const body = await getJsonQuiet(
    fetchImpl,
    `${REGISTRY}?search=${encodeURIComponent(repo)}&version=latest&limit=100`,
  );
  const servers = (body as { servers?: unknown[] } | null)?.servers ?? [];
  const target = normalRepoUrl(`https://github.com/${owner}/${repo}`);
  return servers.filter((entry) => {
    const server = (entry as { server?: { repository?: { url?: unknown; subfolder?: unknown } } })
      .server;
    const url = server?.repository?.url;
    if (typeof url !== "string" || normalRepoUrl(url) !== target) return false;
    const folder =
      typeof server?.repository?.subfolder === "string" ? server.repository.subfolder : "";
    return !subPath || !folder || folder.replace(/\/+$/, "") === subPath.replace(/\/+$/, "");
  });
}

/** npm / PyPI facts for the package names in the manifests, to tell published from source-only. */
async function packageFacts(
  fetchImpl: FetchLike,
  texts: Record<string, string>,
): Promise<RepoSnapshot["packages"]> {
  const npm: NonNullable<RepoSnapshot["packages"]["npm"]> = {};
  const pypi: NonNullable<RepoSnapshot["packages"]["pypi"]> = {};
  for (const [path, text] of Object.entries(texts)) {
    if (/(^|\/)package\.json$/.test(path)) {
      const pkg = parsePackageJson(text);
      if (!pkg?.name || pkg.private || npm[pkg.name] !== undefined) continue;
      const body = (await getJsonQuiet(
        fetchImpl,
        `https://registry.npmjs.org/${pkg.name.replace("/", "%2f")}`,
      )) as { "dist-tags"?: { latest?: unknown }; repository?: { url?: unknown } | string } | null;
      const latest = body?.["dist-tags"]?.latest;
      npm[pkg.name] =
        typeof latest === "string"
          ? {
              version: latest,
              repository:
                typeof body?.repository === "string"
                  ? body.repository
                  : typeof body?.repository?.url === "string"
                    ? body.repository.url
                    : null,
            }
          : null;
    } else if (/(^|\/)pyproject\.toml$/.test(path)) {
      const name = parsePyProject(text).name;
      if (!name || pypi[name] !== undefined) continue;
      const body = (await getJsonQuiet(
        fetchImpl,
        `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
      )) as {
        info?: {
          version?: unknown;
          project_urls?: Record<string, unknown> | null;
          home_page?: unknown;
        };
      } | null;
      const version = body?.info?.version;
      pypi[name] =
        typeof version === "string"
          ? {
              version,
              urls: [
                ...Object.values(body?.info?.project_urls ?? {}),
                body?.info?.home_page,
              ].filter((url): url is string => typeof url === "string"),
            }
          : null;
    }
  }
  return { npm, pypi };
}

/**
 * "Connect from GitHub", steps 1-3 (audit §11.4): pin the commit (1 GitHub API call), list the
 * files (1 call, skipped when this repo@commit is cached), read up to a dozen small files from
 * raw.githubusercontent.com (not counted by GitHub's 60/hour limit), ask the MCP Registry and the
 * package registries, then classify. Read-only: nothing is downloaded to run.
 */
export class RepoAnalyzer {
  readonly #fetch: FetchLike;
  readonly #cacheDir: string;
  readonly #recent = new Map<string, McpRepoAnalysis>();

  constructor(cacheDir: string, fetchImpl: FetchLike) {
    this.#cacheDir = cacheDir;
    this.#fetch = fetchImpl;
  }

  /** An analysis made in this session, by id (what install plans refer to). */
  get(id: string): McpRepoAnalysis | undefined {
    return this.#recent.get(id);
  }

  async analyze(url: string): Promise<McpRepoAnalysis> {
    const location = parseGithubUrl(url);
    const commit = await fetchCommitSha(location, this.#fetch);
    const key = `${location.owner}__${location.repo}__${commit}__${location.subPath.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
    const cachePath = join(this.#cacheDir, `${key}.json`);
    const cached = await readFile(cachePath, "utf8")
      .then((text) => JSON.parse(text) as McpRepoAnalysis)
      .catch(() => null);
    if (cached?.commit === commit) {
      this.#recent.set(cached.id, cached);
      return cached;
    }
    const pinned = { ...location, ref: commit };
    const tree = await fetchRepoTree(pinned, this.#fetch);
    const texts: Record<string, string> = {};
    let budget = MAX_TEXT_BYTES;
    for (const path of filesToRead(tree.files, pinned)) {
      if (budget <= 0) break;
      try {
        const text = await fetchRepoText(tree, path, this.#fetch, Math.min(budget, 120_000));
        texts[path] = text;
        budget -= Buffer.byteLength(text, "utf8");
      } catch {
        // A file that is too big or gone is left out.
      }
    }
    const [registry, packages] = await Promise.all([
      registryEntries(this.#fetch, location.owner, location.repo, location.subPath),
      packageFacts(this.#fetch, texts),
    ]);
    const analysis = classifyRepo({
      location: pinned,
      files: tree.files,
      texts,
      registry,
      packages,
      truncated: tree.truncated,
    });
    this.#recent.set(analysis.id, analysis);
    await this.#store(cachePath, analysis);
    return analysis;
  }

  async #store(path: string, analysis: McpRepoAnalysis): Promise<void> {
    try {
      await mkdir(this.#cacheDir, { recursive: true });
      await writeFile(path, `${JSON.stringify(analysis)}\n`, "utf8");
      const entries = (await readdir(this.#cacheDir)).filter((name) => name.endsWith(".json"));
      if (entries.length > CACHE_KEEP) {
        // Oldest names first is good enough: the cache only saves API calls.
        for (const name of entries.sort().slice(0, entries.length - CACHE_KEEP)) {
          await rm(join(this.#cacheDir, name), { force: true });
        }
      }
    } catch {
      // The cache is an optimisation only.
    }
  }
}
