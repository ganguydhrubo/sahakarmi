import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { CustomSkill, GithubSkillCandidate, GithubSkillPreview } from "../shared/ipc";
import { type FetchLike, fetchRepoText, fetchRepoTree, parseGithubUrl } from "./github-repo";
import { learnedSkillId } from "./skill-library";

const CUSTOM_FOLDER = "Custom";
/** Written beside SKILL.md; only folders that carry it are ever listed or removed. */
const SOURCE_FILE = ".sahkarmi-skill.json";
export const MAX_CUSTOM_SKILLS = 100;
const MAX_FILE_BYTES = 200_000;
const MAX_SKILL_BYTES = 2_000_000;
const MAX_FILES_PER_SKILL = 150;
/** Skill folders hold playbooks, references and small scripts; binaries are never copied. */
const TEXT_FILE =
  /\.(md|markdown|txt|json|jsonc|ya?ml|toml|csv|tsv|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|ps1|rb|go|rs|java|kt|c|h|cpp|xml|svg|sql|ini|cfg)$/i;

interface SourceRecord {
  name: string;
  description: string;
  source: string;
  installedAt: string;
}

/** Name and description from a SKILL.md: YAML front matter first, then the first heading. */
export function parseSkillMarkdown(text: string): { name: string; description: string } {
  const front = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const field = (key: string) => {
    const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front);
    if (!match) return "";
    let value = (match[1] ?? "").trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      // Folded or literal block: the indented lines that follow.
      const after = front.slice((match.index ?? 0) + match[0].length).split(/\r?\n/);
      const lines: string[] = [];
      for (const line of after.slice(1)) {
        if (!/^\s+\S/.test(line)) break;
        lines.push(line.trim());
      }
      value = lines.join(" ");
    }
    return value.replace(/^["']|["']$/g, "").trim();
  };
  const body = text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const name = field("name") || (/^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? "");
  const description =
    field("description") ||
    (body
      .split(/\r?\n\s*\r?\n/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith("#")) ??
      "");
  return { name: name.slice(0, 80), description: description.replace(/\s+/g, " ").slice(0, 400) };
}

function customRoot(sharedRoot: string): string {
  return join(sharedRoot, "Skills", CUSTOM_FOLDER);
}

/** A repo-relative file path made safe to write under a skill folder, or null. */
function safeRelative(path: string): string | null {
  const normal = posix.normalize(path);
  if (!normal || normal.startsWith("..") || posix.isAbsolute(normal) || /[:\\]/.test(normal)) {
    return null;
  }
  return normal;
}

/**
 * Skills the owner adds themselves (pasted SKILL.md, or folders from an open-source GitHub repo,
 * in the same format Claude Code uses). Kept in Shared/Skills/Custom/<id>/ so coworkers on every
 * AI (Claude, Codex, Gemini, Antigravity) can read and follow them.
 */
export class CustomSkills {
  readonly #root: string;
  readonly #fetch: FetchLike;

  constructor(sharedRoot: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.#root = customRoot(sharedRoot);
    this.#fetch = fetchImpl;
  }

  async list(): Promise<CustomSkill[]> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch {
      return [];
    }
    const skills: CustomSkill[] = [];
    for (const id of names.sort()) {
      const record = await this.#record(id);
      if (record) skills.push(record);
    }
    return skills;
  }

  async read(id: string): Promise<string | null> {
    if (!(await this.#record(id))) return null;
    try {
      return await readFile(join(this.#root, id, "SKILL.md"), "utf8");
    } catch {
      return null;
    }
  }

  /** Adds a skill from pasted SKILL.md text. */
  async addFromText(text: string): Promise<CustomSkill[]> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Paste the skill's SKILL.md text.");
    if (Buffer.byteLength(trimmed, "utf8") > MAX_FILE_BYTES)
      throw new Error("That skill is too large.");
    const { name, description } = parseSkillMarkdown(trimmed);
    if (!name) throw new Error('Give the skill a name: a "name:" line at the top or a "# Title".');
    await this.#write(name, description, "pasted", new Map([["SKILL.md", `${trimmed}\n`]]));
    return this.list();
  }

  /** Lists the skills (folders with a SKILL.md) a GitHub repo offers, without installing. */
  async previewGithub(url: string): Promise<GithubSkillPreview> {
    const tree = await fetchRepoTree(parseGithubUrl(url), this.#fetch);
    const dirs = tree.files
      .filter((file) => /(^|\/)SKILL\.md$/i.test(file.path))
      .map((file) => file.path.split("/").slice(0, -1).join("/"));
    const installed = new Set((await this.list()).map((skill) => skill.source));
    const skills: GithubSkillCandidate[] = [];
    for (const dir of dirs.slice(0, 200)) {
      const files = this.#skillFiles(tree.files, dir);
      const bytes = files.reduce((total, file) => total + file.size, 0);
      let name = dir.split("/").pop() || tree.repo;
      let description = "";
      const skillFile = tree.files.find((file) => file.path === `${dir ? `${dir}/` : ""}SKILL.md`);
      // Read each SKILL.md for its name and description (only for a reasonable count).
      if (skillFile && dirs.length <= 60) {
        try {
          const parsed = parseSkillMarkdown(
            await fetchRepoText(tree, skillFile.path, this.#fetch, MAX_FILE_BYTES),
          );
          name = parsed.name || name;
          description = parsed.description;
        } catch {
          // Shown by folder name only.
        }
      }
      skills.push({
        path: dir,
        name,
        description,
        files: files.length,
        bytes,
        tooBig: bytes > MAX_SKILL_BYTES,
        installed: installed.has(sourceOf(tree, dir)),
      });
    }
    return {
      repo: `${tree.owner}/${tree.repo}`,
      ref: tree.ref,
      url,
      truncated: tree.truncated,
      skills,
    };
  }

  /** Installs the chosen skill folders from a GitHub repo (text files only, size-capped). */
  async installGithub(url: string, paths: string[]): Promise<CustomSkill[]> {
    if (paths.length === 0) throw new Error("Pick at least one skill.");
    const tree = await fetchRepoTree(parseGithubUrl(url), this.#fetch);
    for (const dir of paths) {
      const skillPath = `${dir ? `${dir}/` : ""}SKILL.md`;
      const files = this.#skillFiles(tree.files, dir);
      if (!files.some((file) => file.path === skillPath)) {
        throw new Error(`No SKILL.md in ${dir || "the repo root"}.`);
      }
      if (files.reduce((total, file) => total + file.size, 0) > MAX_SKILL_BYTES) {
        throw new Error(`The skill in ${dir || "the repo root"} is too large to install.`);
      }
      const contents = new Map<string, string>();
      for (const file of files) {
        const relative = safeRelative(dir ? file.path.slice(dir.length + 1) : file.path);
        if (!relative) continue;
        contents.set(relative, await fetchRepoText(tree, file.path, this.#fetch, MAX_FILE_BYTES));
      }
      const parsed = parseSkillMarkdown(contents.get("SKILL.md") ?? "");
      await this.#write(
        parsed.name || dir.split("/").pop() || tree.repo,
        parsed.description,
        sourceOf(tree, dir),
        contents,
      );
    }
    return this.list();
  }

  async remove(id: string): Promise<CustomSkill[]> {
    if (await this.#record(id)) await rm(join(this.#root, id), { recursive: true, force: true });
    return this.list();
  }

  /** The text files that belong to the skill in `dir` (not those of a nested skill). */
  #skillFiles(files: Array<{ path: string; size: number }>, dir: string) {
    const prefix = dir ? `${dir}/` : "";
    const nested = files
      .filter((file) => /(^|\/)SKILL\.md$/i.test(file.path) && file.path !== `${prefix}SKILL.md`)
      .map((file) => `${file.path.split("/").slice(0, -1).join("/")}/`)
      .filter((folder) => folder.startsWith(prefix));
    return files
      .filter(
        (file) =>
          file.path.startsWith(prefix) &&
          TEXT_FILE.test(file.path) &&
          file.size <= MAX_FILE_BYTES &&
          !nested.some((folder) => file.path.startsWith(folder)),
      )
      .slice(0, MAX_FILES_PER_SKILL);
  }

  async #write(
    name: string,
    description: string,
    source: string,
    contents: Map<string, string>,
  ): Promise<void> {
    const existing = await this.list();
    const same = existing.find((skill) => skill.source === source && source !== "pasted");
    let id = same?.id ?? learnedSkillId(name);
    if (!same) {
      if (existing.length >= MAX_CUSTOM_SKILLS) {
        throw new Error(`You can add up to ${MAX_CUSTOM_SKILLS} skills. Remove one first.`);
      }
      const taken = new Set(existing.map((skill) => skill.id));
      for (let n = 2; taken.has(id); n++) id = `${learnedSkillId(name)}-${n}`;
    }
    const folder = join(this.#root, id);
    await rm(folder, { recursive: true, force: true });
    for (const [relative, text] of contents) {
      const target = join(folder, ...relative.split("/"));
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, text, "utf8");
    }
    const record: SourceRecord = {
      name,
      description,
      source,
      installedAt: new Date().toISOString(),
    };
    await writeFile(join(folder, SOURCE_FILE), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async #record(id: string): Promise<CustomSkill | null> {
    if (!/^[\p{L}\p{N}-]{1,64}$/u.test(id)) return null;
    try {
      const record = JSON.parse(
        await readFile(join(this.#root, id, SOURCE_FILE), "utf8"),
      ) as SourceRecord;
      return {
        id,
        name: String(record.name || id),
        description: String(record.description || ""),
        source: String(record.source || ""),
        installedAt: String(record.installedAt || ""),
        sharedPath: `Skills/${CUSTOM_FOLDER}/${id}/SKILL.md`,
      };
    } catch {
      return null;
    }
  }
}

function sourceOf(tree: { owner: string; repo: string }, dir: string): string {
  return `github.com/${tree.owner}/${tree.repo}${dir ? `/${dir}` : ""}`;
}

/** "Name: when to use (Custom/<id>/SKILL.md)" lines for coworker instructions, read at thread start. */
export function customSkillLines(sharedRoot: string, limit = 40): string[] {
  const root = customRoot(sharedRoot);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .sort()
    .flatMap((id) => {
      try {
        const record = JSON.parse(
          readFileSync(join(root, id, SOURCE_FILE), "utf8"),
        ) as SourceRecord;
        const when = String(record.description || "").slice(0, 200);
        return [`${record.name || id}${when ? `: ${when}` : ""} (${CUSTOM_FOLDER}/${id}/SKILL.md)`];
      } catch {
        return [];
      }
    })
    .slice(0, limit);
}
