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
