/**
 * Reads public GitHub repositories without signing in: the file list from the GitHub API and
 * file contents from raw.githubusercontent.com. Used to import skills and MCP server settings
 * from open-source repos, the way people add them to Claude Code.
 */

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface RepoLocation {
  owner: string;
  repo: string;
  /** Branch, tag or commit; null means the repo's default branch. */
  ref: string | null;
  /** Folder inside the repo the link pointed at ("" for the whole repo). */
  subPath: string;
}

export interface RepoEntry {
  path: string;
  size: number;
}

export interface RepoTree {
  owner: string;
  repo: string;
  ref: string;
  files: RepoEntry[];
  /** GitHub stops listing very large repos; some files may be missing. */
  truncated: boolean;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "Sahkarmi" };

/** "owner/repo", github.com links, and /tree/<ref>/<folder> or /blob/<ref>/<file> links. */
export function parseGithubUrl(input: string): RepoLocation {
  let text = input.trim().replace(/[?#].*$/, "");
  text = text
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "");
  const parts = text.split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(repo)) {
    throw new Error("Paste a GitHub link like https://github.com/owner/repo.");
  }
  let ref: string | null = null;
  let subPath = "";
  if ((parts[2] === "tree" || parts[2] === "blob") && parts[3]) {
    ref = parts[3];
    subPath = parts.slice(4).join("/");
    // A link to SKILL.md or .mcp.json means the folder that holds it.
    if (parts[2] === "blob") subPath = subPath.split("/").slice(0, -1).join("/");
  }
  return { owner, repo, ref, subPath };
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { headers: HEADERS });
  if (response.status === 404) {
    throw new Error("GitHub could not find that repository. Check the link; it must be public.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub's limit for apps without sign-in is used up. Try again in an hour.");
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status}. Try again later.`);
  return response.json();
}

/** Every file in the repo (or the linked folder) with its size. */
export async function fetchRepoTree(
  location: RepoLocation,
  fetchImpl: FetchLike,
): Promise<RepoTree> {
  const base = `https://api.github.com/repos/${location.owner}/${location.repo}`;
  let ref = location.ref;
  if (!ref) {
    const info = (await getJson(fetchImpl, base)) as { default_branch?: unknown };
    ref = typeof info.default_branch === "string" ? info.default_branch : "main";
  }
  const tree = (await getJson(
    fetchImpl,
    `${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  )) as { tree?: unknown; truncated?: unknown };
  const prefix = location.subPath ? `${location.subPath.replace(/\/+$/, "")}/` : "";
  const files = (Array.isArray(tree.tree) ? tree.tree : []).flatMap((entry) => {
    const item = entry as { path?: unknown; type?: unknown; size?: unknown };
    if (item.type !== "blob" || typeof item.path !== "string") return [];
    if (prefix && !item.path.startsWith(prefix)) return [];
    return [{ path: item.path, size: typeof item.size === "number" ? item.size : 0 }];
  });
  return {
    owner: location.owner,
    repo: location.repo,
    ref,
    files,
    truncated: tree.truncated === true,
  };
}

/** One text file from the repo, refused when it is larger than `maxBytes`. */
export async function fetchRepoText(
  tree: Pick<RepoTree, "owner" | "repo" | "ref">,
  path: string,
  fetchImpl: FetchLike,
  maxBytes: number,
): Promise<string> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${tree.owner}/${tree.repo}/${encodeURIComponent(tree.ref)}/${encoded}`;
  const response = await fetchImpl(url, { headers: { "User-Agent": "Sahkarmi" } });
  if (!response.ok)
    throw new Error(`Could not download ${path} (GitHub answered ${response.status}).`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`${path} is too large.`);
  return text;
}
