/**
 * Small, forgiving readers for the files a repo uses to describe itself. Only what the classifier
 * needs is read; anything unexpected yields nothing rather than an error.
 */

export interface PyProject {
  name: string | null;
  version: string | null;
  requiresPython: string | null;
  dependencies: string[];
  scripts: Record<string, string>;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/** Lines of one TOML table ("project", "project.scripts"), without comments. */
function tomlTable(text: string, table: string): string[] {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^\\s*\\[${table.replace(/\./g, "\\.")}\\]\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    result.push(line.replace(/(^|\s)#.*$/, ""));
  }
  return result;
}

function tomlString(lines: string[], key: string): string | null {
  const pattern = new RegExp(`^\\s*${key.replace(/[-.]/g, "\\$&")}\\s*=\\s*("[^"]*"|'[^']*')`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return unquote(match[1]);
  }
  return null;
}

function tomlArray(lines: string[], key: string): string[] {
  const joined = lines.join("\n");
  const start = new RegExp(`(^|\\n)\\s*${key}\\s*=\\s*\\[`).exec(joined);
  if (!start) return [];
  // Strings may hold "]" (mcp[cli]), so walk to the bracket that closes the array.
  const values: string[] = [];
  let quote: string | null = null;
  let current = "";
  for (const char of joined.slice(start.index + start[0].length)) {
    if (quote) {
      if (char === quote) {
        values.push(current);
        current = "";
        quote = null;
      } else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "]") break;
  }
  return values;
}

export function parsePyProject(text: string): PyProject {
  const project = tomlTable(text, "project");
  const scripts: Record<string, string> = {};
  for (const line of tomlTable(text, "project.scripts")) {
    const match = /^\s*("?)([A-Za-z0-9_.-]+)\1\s*=\s*("[^"]*"|'[^']*')/.exec(line);
    if (match?.[2] && match[3]) scripts[match[2]] = unquote(match[3]);
  }
  return {
    name: tomlString(project, "name"),
    version: tomlString(project, "version"),
    requiresPython: tomlString(project, "requires-python"),
    dependencies: tomlArray(project, "dependencies"),
    scripts,
  };
}

/** The distribution name of a requirement line: "mcp[cli]>=1.2; python_version>'3'" → "mcp". */
export function requirementName(line: string): string {
  return /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)?.[1]?.toLowerCase().replace(/_/g, "-") ?? "";
}

export function parseRequirements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("-"))
    .map(requirementName)
    .filter(Boolean);
}

export interface PackageJson {
  name: string | null;
  version: string | null;
  private: boolean;
  dependencies: string[];
  bin: Record<string, string>;
  buildScript: boolean;
  main: string | null;
  engines: string | null;
  repository: string | null;
}

export function parsePackageJson(text: string): PackageJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : null;
  const deps = (field: unknown) =>
    field && typeof field === "object" ? Object.keys(field as Record<string, unknown>) : [];
  let bin: Record<string, string> = {};
  if (typeof value.bin === "string" && name) bin = { [name.replace(/^@[^/]+\//, "")]: value.bin };
  else if (value.bin && typeof value.bin === "object") {
    bin = Object.fromEntries(
      Object.entries(value.bin as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  const scripts = (value.scripts ?? {}) as Record<string, unknown>;
  const repository =
    typeof value.repository === "string"
      ? value.repository
      : value.repository && typeof (value.repository as { url?: unknown }).url === "string"
        ? ((value.repository as { url: string }).url as string)
        : null;
  const engines = (value.engines ?? {}) as Record<string, unknown>;
  return {
    name,
    version: typeof value.version === "string" ? value.version : null,
    private: value.private === true,
    dependencies: [...deps(value.dependencies), ...deps(value.peerDependencies)],
    bin,
    buildScript: typeof scripts.build === "string",
    main: typeof value.main === "string" ? value.main : null,
    engines: typeof engines.node === "string" ? engines.node : null,
    repository,
  };
}

/** Fenced code blocks in a README, with the line each starts on. */
export function fencedBlocks(text: string): { language: string; body: string; line: number }[] {
  const blocks: { language: string; body: string; line: number }[] = [];
  const pattern = /^([ \t]*)```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^\1```/gm;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split("\n").length;
    blocks.push({ language: (match[2] ?? "").toLowerCase(), body: match[3] ?? "", line });
  }
  return blocks;
}

/** JSON with // comments and trailing commas, as READMEs often show it. */
export function parseLooseJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
    .trim();
  return JSON.parse(cleaned);
}
