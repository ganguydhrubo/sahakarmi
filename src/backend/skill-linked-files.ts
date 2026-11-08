import { posix } from "node:path";
import type { McpRecommendation, SkillPluginInfo } from "../shared/ipc";

/**
 * Plugin-aware skill import: a skill from a multi-skill plugin repo often points at files outside
 * its own folder (e.g. `../../shared/connector-neutrality.md`). These helpers find those
 * references, bring the files along inside the skill's folder and rewrite the links so none
 * break. Everything downloaded is data: nothing here runs it.
 */

/** Program and script files: never brought along as linked files, never copied from a pack. */
export const EXECUTABLE_FILE =
  /\.(py|pyw|sh|bash|zsh|ps1|psm1|psd1|bat|cmd|vbs|js|mjs|cjs|ts|tsx|jsx|rb|go|rs|java|kt|c|h|cpp|php|pl|exe|dll|jar|msi|scr|com|so|dylib)$/i;

/** Files whose text is scanned for links to other files. */
const LINKING_FILE = /\.(md|markdown|mdx|txt)$/i;

/** Folder inside an installed skill for files from the rest of its plugin / repo. */
export const PLUGIN_FOLDER = "_plugin";
export const REPO_FOLDER = "_repo";

export interface FileReference {
  /** Where the target text starts and ends in the file. */
  start: number;
  end: number;
  /** The path part (no #anchor or ?query). */
  path: string;
  /** Inline code (`path`) only counts when it names a real file; links always count. */
  kind: "link" | "code";
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function pathPart(target: string): string {
  return target.replace(/[#?].*$/, "");
}

function looksLikePath(target: string, kind: FileReference["kind"], bracketed: boolean): boolean {
  if (!target || SCHEME.test(target) || /^[#~$<{]/.test(target)) return false;
  // Only <angle-bracketed> link targets may contain spaces.
  if (bracketed ? /[\n\t]/.test(target) : /\s/.test(target)) return false;
  if (target.startsWith("//")) return false;
  const path = pathPart(target);
  if (!path) return false;
  if (kind === "code") return path.includes("/") || /\.[a-z0-9]{1,8}$/i.test(path);
  return true;
}

/** Markdown links/images, reference definitions and `inline/code/paths` in a text. */
export function fileReferences(text: string): FileReference[] {
  const refs: FileReference[] = [];
  const add = (start: number, raw: string, kind: FileReference["kind"]) => {
    let target = raw;
    let offset = 0;
    const bracketed = target.startsWith("<") && target.endsWith(">");
    if (bracketed) {
      target = target.slice(1, -1);
      offset = 1;
    }
    if (!looksLikePath(target, kind, bracketed)) return;
    const path = pathPart(target);
    refs.push({ start: start + offset, end: start + offset + path.length, path, kind });
  };
  for (const match of text.matchAll(
    /\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g,
  )) {
    const raw = match[1] ?? "";
    add((match.index ?? 0) + match[0].indexOf(raw, 1), raw, "link");
  }
  for (const match of text.matchAll(/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(\S+)/gm)) {
    const raw = match[1] ?? "";
    add((match.index ?? 0) + match[0].lastIndexOf(raw), raw, "link");
  }
  for (const match of text.matchAll(/`([^`\s]{2,240})`/g)) {
    const raw = match[1] ?? "";
    add((match.index ?? 0) + 1, raw, "code");
  }
  return refs.sort((a, b) => a.start - b.start);
}

/**
 * The repo path a reference in `fromFile` points at, or null when it leaves the repo (path
 * traversal), is absolute on a drive, or is otherwise unsafe. "/x" means x at the repo root.
 */
export function resolveRepoPath(fromFile: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (!decoded || /[\\:\0]/.test(decoded) || decoded.startsWith("//")) return null;
  const joined = decoded.startsWith("/")
    ? decoded.slice(1)
    : posix.join(posix.dirname(fromFile), decoded);
  const normal = posix.normalize(joined).replace(/\/+$/, "");
  if (!normal || normal === "." || normal === ".." || normal.startsWith("../")) return null;
  if (posix.isAbsolute(normal)) return null;
  return normal;
}

/** The nearest folder (the skill's own or above) that holds a plugin manifest or .mcp.json. */
export function pluginRootOf(paths: ReadonlySet<string>, skillDir: string): string | null {
  let dir = skillDir;
  for (;;) {
    const prefix = dir ? `${dir}/` : "";
    if (paths.has(`${prefix}.claude-plugin/plugin.json`) || paths.has(`${prefix}.mcp.json`)) {
      return dir;
    }
    if (!dir) return null;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
}

const SECRET_WORD = /(token|secret|password|passwd|api[-_]?key|apikey|auth|bearer|credential)/i;

function cleanUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Query strings and user-info can carry keys: never kept.
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The servers a plugin's .mcp.json lists, as recommendations only: names, addresses and the
 * names of settings they need. Values of env vars and headers (where keys live) are dropped,
 * as are arguments that look like they carry a secret.
 */
export function parseMcpRecommendations(text: string): McpRecommendation[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const servers =
    record.mcpServers && typeof record.mcpServers === "object" && !Array.isArray(record.mcpServers)
      ? (record.mcpServers as Record<string, unknown>)
      : record;
  const found: McpRecommendation[] = [];
  for (const [name, raw] of Object.entries(servers).slice(0, 40)) {
    if (!/^[\w.@-]{1,64}$/.test(name) || !raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const keys = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value)
            .filter((key) => /^[\w.-]{1,80}$/.test(key))
            .slice(0, 20)
        : [];
    const envKeys = keys(entry.env);
    const headerKeys = keys(entry.headers);
    if (typeof entry.url === "string") {
      const url = cleanUrl(entry.url);
      if (!url) continue;
      found.push({ name, transport: "http", url, envKeys, headerKeys });
    } else if (typeof entry.command === "string" && /^[\w.@/-]{1,80}$/.test(entry.command)) {
      const args = (Array.isArray(entry.args) ? entry.args : [])
        .filter((arg): arg is string => typeof arg === "string" && arg.length <= 200)
        .filter(
          (arg, index, all) => !SECRET_WORD.test(arg) && !SECRET_WORD.test(all[index - 1] ?? ""),
        )
        .slice(0, 20);
      found.push({ name, transport: "stdio", command: entry.command, args, envKeys, headerKeys });
    }
  }
  return found;
}

/** Name, display name, version and description from .claude-plugin/plugin.json. */
export function parsePluginInfo(text: string): SkillPluginInfo | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const str = (value: unknown, max: number) =>
      typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
    const name = str(data.name, 80);
    if (!name) return null;
    const info: SkillPluginInfo = { name };
    const displayName = str(data.displayName, 80);
    const version = str(data.version, 40);
    const description = str(data.description, 400);
    if (displayName) info.displayName = displayName;
    if (version) info.version = version;
    if (description) info.description = description;
    return info;
  } catch {
    return null;
  }
}

/**
 * Third-party product names in a skill's shown name or description, in neutral words. Only the
 * text Sahkarmi displays is changed; the skill's own files stay as written.
 */
export function neutralBrandText(text: string): string {
  return text
    .replace(/\bClaude\s+Code\b/g, "the AI")
    .replace(/\bClaude\s+(Desktop|Cowork|\.ai)\b/gi, "the AI")
    .replace(/\bClaude['’]s\b/g, "the AI's")
    .replace(/\bClaude\b/g, "the AI")
    .replace(/\bAnthropic['’]s\s+/g, "")
    .replace(/\bby\s+Anthropic\b/g, "")
    .replace(/\bAnthropic\b/g, "")
    .replace(/\bCowork\b/g, "the app")
    .replace(/\bthe AI the AI\b/g, "the AI")
    .replace(/\b([Aa])sk the AI\b/g, "$1sk your coworker")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

export interface LinkedFilesInput {
  /** Every file in the repo with its size. */
  sizes: ReadonlyMap<string, number>;
  skillDir: string;
  pluginRoot: string | null;
  /** The skill's own files, already downloaded, by repo path. */
  own: ReadonlyMap<string, string>;
  read: (repoPath: string) => Promise<string>;
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  isText: (repoPath: string) => boolean;
}

export interface LinkedFilesResult {
  /** Everything to write, by path inside the installed skill folder. */
  contents: Map<string, string>;
  /** Repo paths brought along from outside the skill folder. */
  linked: string[];
  /** References to real files that could not be brought along (binary, too big, a script). */
  unresolved: string[];
  /** Links rewritten to their new place. */
  rewritten: number;
}

/** Where a repo file lives inside the installed skill folder. */
export function installedLocation(
  repoPath: string,
  skillDir: string,
  pluginRoot: string | null,
): string {
  const skillPrefix = skillDir ? `${skillDir}/` : "";
  if (!skillDir || repoPath.startsWith(skillPrefix)) {
    const inside = repoPath.slice(skillPrefix.length);
    return /^skill\.md$/i.test(inside) ? "SKILL.md" : inside;
  }
  if (pluginRoot !== null) {
    const pluginPrefix = pluginRoot ? `${pluginRoot}/` : "";
    if (!pluginRoot || repoPath.startsWith(pluginPrefix)) {
      return `${PLUGIN_FOLDER}/${repoPath.slice(pluginPrefix.length)}`;
    }
  }
  return `${REPO_FOLDER}/${repoPath}`;
}

/**
 * Follows references from the skill's text files to other files in the same repo (also from
 * the files it brings along), downloads those, and rewrites each link to the file's new place
 * inside the skill folder. Path traversal out of the repo is never followed.
 */
export async function bringLinkedFiles(input: LinkedFilesInput): Promise<LinkedFilesResult> {
  const { sizes, skillDir, pluginRoot } = input;
  const skillPrefix = skillDir ? `${skillDir}/` : "";
  const insideSkill = (path: string) => !skillDir || path.startsWith(skillPrefix);
  const texts = new Map(input.own);
  const linked: string[] = [];
  const unresolved = new Set<string>();
  let bytes = [...texts.values()].reduce((total, text) => total + Buffer.byteLength(text), 0);

  /** The file a reference points at, if it exists in the repo. */
  const targetOf = (from: string, ref: FileReference): string | null => {
    const direct = resolveRepoPath(from, ref.path);
    if (direct && sizes.has(direct)) return direct;
    // Skills often name their files relative to the skill folder, wherever the mention is.
    if (ref.kind === "code" && !ref.path.startsWith("/") && !ref.path.startsWith(".")) {
      const fromSkill = resolveRepoPath(`${skillPrefix}SKILL.md`, ref.path);
      if (fromSkill && sizes.has(fromSkill)) return fromSkill;
    }
    return null;
  };

  const queue = [...texts.keys()];
  while (queue.length > 0) {
    const from = queue.shift() as string;
    if (!LINKING_FILE.test(from)) continue;
    for (const ref of fileReferences(texts.get(from) ?? "")) {
      const target = targetOf(from, ref);
      if (!target || texts.has(target)) continue;
      const size = sizes.get(target) ?? 0;
      if (
        !input.isText(target) ||
        EXECUTABLE_FILE.test(target) ||
        size > input.maxFileBytes ||
        linked.length >= input.maxFiles ||
        bytes + size > input.maxBytes
      ) {
        unresolved.add(target);
        continue;
      }
      try {
        const text = await input.read(target);
        texts.set(target, text);
        bytes += Buffer.byteLength(text);
        if (!insideSkill(target)) linked.push(target);
        queue.push(target);
      } catch {
        unresolved.add(target);
      }
    }
  }

  let rewritten = 0;
  const contents = new Map<string, string>();
  for (const [from, text] of texts) {
    const here = installedLocation(from, skillDir, pluginRoot);
    let next = text;
    if (LINKING_FILE.test(from)) {
      // Right to left, so earlier offsets stay valid.
      for (const ref of fileReferences(text).reverse()) {
        const target = targetOf(from, ref);
        if (!target || !texts.has(target)) continue;
        if (insideSkill(from) && insideSkill(target)) continue;
        const there = installedLocation(target, skillDir, pluginRoot);
        const relative = posix.relative(posix.dirname(here), there) || posix.basename(there);
        if (relative === ref.path) continue;
        next = `${next.slice(0, ref.start)}${relative}${next.slice(ref.end)}`;
        rewritten += 1;
      }
    }
    contents.set(here, next);
  }
  return { contents, linked, unresolved: [...unresolved].sort(), rewritten };
}

/**
 * Relative markdown links in installed files that point at nothing inside the folder: the
 * broken-link count (inline code is not counted; it is often not meant as a link).
 */
export function brokenLinks(contents: ReadonlyMap<string, string>): string[] {
  const broken: string[] = [];
  for (const [file, text] of contents) {
    if (!LINKING_FILE.test(file)) continue;
    for (const ref of fileReferences(text)) {
      if (ref.kind !== "link" || ref.path.startsWith("/")) continue;
      const target = resolveRepoPath(file, ref.path);
      if (target === null) {
        broken.push(`${file} -> ${ref.path}`);
        continue;
      }
      const isFolder = [...contents.keys()].some((path) => path.startsWith(`${target}/`));
      if (!contents.has(target) && !isFolder) broken.push(`${file} -> ${ref.path}`);
    }
  }
  return broken;
}
