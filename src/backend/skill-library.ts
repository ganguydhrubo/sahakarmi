import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findMarketplaceSkill, MARKETPLACE_SKILLS } from "../shared/marketplace";

/** First line of every installed skill file, so only Sahkarmi's own files are ever removed. */
const MARKER = "<!-- sahkarmi-skill:";

function marker(id: string): string {
  return `${MARKER} ${id} -->`;
}

/**
 * Installs catalog skills as markdown playbooks in Shared/Skills, where every coworker (and the
 * owner) can read them. Coworker instructions point at this folder.
 */
export class SkillLibrary {
  readonly #root: string;

  constructor(sharedRoot: string) {
    this.#root = join(sharedRoot, "Skills");
  }

  get folder(): string {
    return this.#root;
  }

  /** Ids of catalog skills currently installed. */
  async installed(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const skill of MARKETPLACE_SKILLS) {
      if (!names.includes(`${skill.id}.md`)) continue;
      try {
        const text = await readFile(join(this.#root, `${skill.id}.md`), "utf8");
        if (text.startsWith(marker(skill.id))) ids.push(skill.id);
      } catch {
        // Unreadable files are treated as not installed.
      }
    }
    return ids;
  }

  async install(id: string): Promise<string[]> {
    const skill = findMarketplaceSkill(id);
    if (!skill) throw new Error("Unknown skill.");
    await mkdir(this.#root, { recursive: true });
    await writeFile(
      join(this.#root, `${skill.id}.md`),
      `${marker(skill.id)}\n${skill.instructions}`,
      "utf8",
    );
    return this.installed();
  }

  async uninstall(id: string): Promise<string[]> {
    const skill = findMarketplaceSkill(id);
    if (!skill) throw new Error("Unknown skill.");
    const path = join(this.#root, `${skill.id}.md`);
    try {
      const text = await readFile(path, "utf8");
      // Never delete a file the owner wrote with the same name.
      if (text.startsWith(marker(skill.id))) await rm(path, { force: true });
    } catch {
      // Already gone.
    }
    return this.installed();
  }
}

/** First line of every skill a coworker wrote, so only those files are ever changed or removed. */
const LEARNED_MARKER = "<!-- sahkarmi-learned-skill:";
const LEARNED_FOLDER = "Learned";
export const MAX_LEARNED_SKILLS = 200;

export interface LearnedSkill {
  id: string;
  name: string;
  whenToUse: string;
  version: number;
  updatedAt: string;
  author: string;
  /** Path inside the Shared folder, e.g. "Skills/Learned/gst-invoice.md". */
  sharedPath: string;
}

export interface SaveLearnedSkillInput {
  name: string;
  whenToUse: string;
  steps: string;
  changeNote?: string;
  author: string;
}

/** A stable file name from a skill name: "GST invoice (B2B)" -> "gst-invoice-b2b". */
export function learnedSkillId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) throw new Error("Give the skill a name.");
  return slug;
}

function learnedRoot(sharedRoot: string): string {
  return join(sharedRoot, "Skills", LEARNED_FOLDER);
}

function parseLearned(id: string, text: string): LearnedSkill | null {
  if (!text.startsWith(`${LEARNED_MARKER} ${id} -->`)) return null;
  const field = (label: string) =>
    text.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1]?.trim() ?? "";
  return {
    id,
    name: text.match(/^# (.+)$/m)?.[1]?.trim() ?? id,
    whenToUse: field("When to use"),
    version: Number.parseInt(field("Version"), 10) || 1,
    updatedAt: field("Updated"),
    author: field("By"),
    sharedPath: `Skills/${LEARNED_FOLDER}/${id}.md`,
  };
}

/**
 * Skills coworkers write for themselves after a hard task, kept as playbooks beside the
 * Marketplace skills (Shared/Skills/Learned). Saving under the same name improves the skill:
 * the version goes up and the change note is kept, so the owner can see how it grew.
 */
export class LearnedSkills {
  readonly #root: string;

  constructor(sharedRoot: string) {
    this.#root = learnedRoot(sharedRoot);
  }

  async list(): Promise<LearnedSkill[]> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch {
      return [];
    }
    const skills: LearnedSkill[] = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const id = name.slice(0, -3);
      try {
        const skill = parseLearned(id, await readFile(join(this.#root, name), "utf8"));
        if (skill) skills.push(skill);
      } catch {
        // Unreadable files are skipped.
      }
    }
    return skills.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** The whole playbook, or null when there is no learned skill with that id. */
  async read(id: string): Promise<string | null> {
    const safe = learnedSkillId(id);
    try {
      const text = await readFile(join(this.#root, `${safe}.md`), "utf8");
      return parseLearned(safe, text) ? text : null;
    } catch {
      return null;
    }
  }

  async save(input: SaveLearnedSkillInput): Promise<LearnedSkill> {
    const name = input.name.trim().slice(0, 120);
    const id = learnedSkillId(name);
    const steps = input.steps.trim();
    if (!steps) throw new Error("steps is required: the playbook itself.");
    if (looksSecret(steps)) {
      throw new Error("A skill must not contain passwords, OTPs, keys or card numbers.");
    }
    const path = join(this.#root, `${id}.md`);
    let previous: string | null = null;
    try {
      previous = await readFile(path, "utf8");
    } catch {
      // A new skill.
    }
    if (previous !== null && !parseLearned(id, previous)) {
      throw new Error(`A file named ${id}.md that a coworker did not write is already there.`);
    }
    if (previous === null && (await this.list()).length >= MAX_LEARNED_SKILLS) {
      throw new Error(
        `There are already ${MAX_LEARNED_SKILLS} learned skills. Improve one instead.`,
      );
    }
    const old = previous ? parseLearned(id, previous) : null;
    const version = (old?.version ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    const notes = previous?.split(/^## Change notes\s*$/m)[1]?.trim() ?? "";
    const note = `- v${version} (${updatedAt.slice(0, 10)}, ${input.author}): ${
      input.changeNote?.trim() || (version === 1 ? "First version." : "Improved.")
    }`;
    const text = [
      `${LEARNED_MARKER} ${id} -->`,
      `# ${name}`,
      "",
      `When to use: ${input.whenToUse.trim().replace(/\s+/g, " ").slice(0, 300)}`,
      `Version: ${version}`,
      `Updated: ${updatedAt}`,
      `By: ${input.author}`,
      "",
      "## Steps",
      "",
      steps,
      "",
      "## Change notes",
      "",
      [note, notes].filter(Boolean).join("\n"),
      "",
    ].join("\n");
    await mkdir(this.#root, { recursive: true });
    await writeFile(path, text, "utf8");
    return parseLearned(id, text) as LearnedSkill;
  }

  async remove(id: string): Promise<LearnedSkill[]> {
    const safe = learnedSkillId(id);
    const path = join(this.#root, `${safe}.md`);
    try {
      // Never delete a file the owner wrote with the same name.
      if (parseLearned(safe, await readFile(path, "utf8"))) await rm(path, { force: true });
    } catch {
      // Already gone.
    }
    return this.list();
  }
}

/** Card numbers, OTP or password lines and API keys never go into a shared playbook. */
function looksSecret(text: string): boolean {
  return (
    /\b(?:\d[ -]?){13,19}\b/.test(text) ||
    /\b(?:password|passcode|otp|pin)\s*[:=]\s*\S+/i.test(text) ||
    /\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{16,}/.test(text)
  );
}

/** Learned skill names for a coworker's instructions, read synchronously at thread start. */
export function learnedSkillNames(sharedRoot: string, limit = 30): string[] {
  const root = learnedRoot(sharedRoot);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const id = name.slice(0, -3);
      try {
        const skill = parseLearned(id, readFileSync(join(root, name), "utf8"));
        return skill ? [`${skill.name} (${LEARNED_FOLDER}/${name})`] : [];
      } catch {
        return [];
      }
    })
    .slice(0, limit);
}

/** Names of installed skills, read synchronously when a coworker thread starts. */
export function installedSkillNames(sharedRoot: string): string[] {
  const root = join(sharedRoot, "Skills");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return MARKETPLACE_SKILLS.filter((skill) => {
    if (!names.includes(`${skill.id}.md`)) return false;
    try {
      return readFileSync(join(root, `${skill.id}.md`), "utf8").startsWith(marker(skill.id));
    } catch {
      return false;
    }
  }).map((skill) => `${skill.name} (${skill.id}.md)`);
}
