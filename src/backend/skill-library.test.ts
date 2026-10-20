// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARKETPLACE_AGENTS, MARKETPLACE_SKILLS } from "../shared/marketplace";
import { installedSkillNames, SkillLibrary } from "./skill-library";

let shared: string;

beforeEach(async () => {
  shared = await mkdtemp(join(tmpdir(), "sahkarmi-skills-"));
});

afterEach(async () => {
  await rm(shared, { recursive: true, force: true });
});

describe("Marketplace catalog", () => {
  it("has unique ids and no invented numbers", () => {
    const agentIds = MARKETPLACE_AGENTS.map((agent) => agent.id);
    const skillIds = MARKETPLACE_SKILLS.map((skill) => skill.id);
    expect(new Set(agentIds).size).toBe(agentIds.length);
    expect(new Set(skillIds).size).toBe(skillIds.length);
    expect(MARKETPLACE_AGENTS.length).toBeGreaterThanOrEqual(12);
    expect(MARKETPLACE_SKILLS.length).toBeGreaterThanOrEqual(12);
    for (const entry of [...MARKETPLACE_AGENTS, ...MARKETPLACE_SKILLS]) {
      expect(JSON.stringify(entry)).not.toMatch(
        /\d[\d,.]*\s*(installs|ratings?|downloads|users)|★/i,
      );
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("SkillLibrary", () => {
  it("installs a skill as a playbook coworkers can read, and removes it again", async () => {
    const library = new SkillLibrary(shared);
    expect(await library.installed()).toEqual([]);
    expect(await library.install("gst-invoice-check")).toEqual(["gst-invoice-check"]);
    const text = await readFile(join(shared, "Skills", "gst-invoice-check.md"), "utf8");
    expect(text).toContain("# GST Invoice Check");
    expect(text).toContain("1. Check the GSTIN format");
    expect(installedSkillNames(shared)).toEqual(["GST Invoice Check (gst-invoice-check.md)"]);
    expect(await library.uninstall("gst-invoice-check")).toEqual([]);
    expect(installedSkillNames(shared)).toEqual([]);
  });

  it("never deletes an owner's own file with the same name", async () => {
    await mkdir(join(shared, "Skills"), { recursive: true });
    const own = join(shared, "Skills", "project-plan.md");
    await writeFile(own, "# My own plan\n");
    const library = new SkillLibrary(shared);
    expect(await library.installed()).toEqual([]);
    await library.uninstall("project-plan");
    expect(await readFile(own, "utf8")).toBe("# My own plan\n");
  });

  it("rejects ids that are not in the catalog", async () => {
    const library = new SkillLibrary(shared);
    await expect(library.install("../../etc/passwd")).rejects.toThrow("Unknown skill.");
  });
});
