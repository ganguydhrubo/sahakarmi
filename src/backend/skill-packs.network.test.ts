// @vitest-environment node

/**
 * Downloads every pinned skill pack from GitHub and counts skills and broken links.
 * Skipped by default; run by hand with SAHKARMI_NETWORK_TESTS=1 (uses ~20 GitHub API calls).
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_PACKS } from "../shared/skill-packs";
import { CustomSkills } from "./custom-skills";
import { brokenLinks, EXECUTABLE_FILE } from "./skill-linked-files";

const enabled = process.env.SAHKARMI_NETWORK_TESTS === "1";

async function folderFiles(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.name !== ".sahkarmi-skill.json") {
        files.set(rel, await readFile(join(dir, entry.name), "utf8"));
      }
    }
  };
  await walk(folder, "");
  return files;
}

describe.skipIf(!enabled)("pinned skill packs (network)", () => {
  it("installs every pack and reports skills and broken links", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-packs-"));
    const report: string[] = [];
    let skills = 0;
    let broken = 0;
    let linked = 0;
    let scripts = 0;
    try {
      const store = new CustomSkills(root, undefined, () => true);
      for (const pack of SKILL_PACKS) {
        const before = (await store.list()).length;
        const list = await store.installPack(pack.id);
        const mine = list.filter((skill) => skill.pack === pack.id);
        let packBroken = 0;
        for (const skill of mine) {
          const folder = join(root, "Skills", "Custom", skill.id);
          const files = await folderFiles(folder);
          scripts += [...files.keys()].filter((path) => EXECUTABLE_FILE.test(path)).length;
          // Broken = a mention of a file that exists upstream but not in the installed folder.
          const record = JSON.parse(await readFile(join(folder, ".sahkarmi-skill.json"), "utf8"));
          const left: string[] = record.notBrought ?? [];
          packBroken += left.length;
          linked += skill.linkedFiles ?? 0;
          for (const line of left) report.push(`  left ${pack.id}/${skill.id}: ${line}`);
          // Markdown links to nothing at all (often broken upstream too, or not paths).
          for (const line of brokenLinks(files)) {
            report.push(`  dangling ${pack.id}/${skill.id}: ${line}`);
          }
          if (skill.reviewNeeded) {
            report.push(`  flagged ${pack.id}/${skill.id}: ${skill.risks?.join("; ")}`);
          }
        }
        skills += list.length - before;
        broken += packBroken;
        report.push(
          `${pack.id}: ${mine.length}/${pack.skills.length} skills, ${packBroken} broken links, mcp=${mine[0]?.mcpRecommendations?.length ?? 0}`,
        );
      }
      report.push(
        `TOTAL skills=${skills} brokenLinks=${broken} linkedFiles=${linked} scripts=${scripts}`,
      );
      console.log(report.join("\n"));
      // Optional copy of the report, for runs whose console output is not kept.
      const out = process.env.SAHKARMI_NETWORK_REPORT;
      if (out) await writeFile(out, `${report.join("\n")}\n`, "utf8");
      expect(scripts).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 1_800_000);
});
