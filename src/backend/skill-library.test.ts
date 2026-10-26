// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARKETPLACE_AGENTS, MARKETPLACE_SKILLS } from "../shared/marketplace";
import {
  installedSkillNames,
  LearnedSkills,
  learnedSkillId,
  learnedSkillNames,
  SkillLibrary,
} from "./skill-library";

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

describe("LearnedSkills", () => {
  it("saves a coworker's playbook and improves it under the same name", async () => {
    const skills = new LearnedSkills(shared);
    const first = await skills.save({
      name: "GST invoice (B2B)",
      whenToUse: "Making a B2B tax invoice",
      steps: "1. Check the buyer GSTIN.\n2. Add HSN codes.",
      author: "Asha",
    });
    expect(first).toMatchObject({ id: "gst-invoice-b2b", version: 1, author: "Asha" });
    expect(first.sharedPath).toBe("Skills/Learned/gst-invoice-b2b.md");
    const second = await skills.save({
      name: "GST invoice (B2B)",
      whenToUse: "Making a B2B tax invoice",
      steps: "1. Check the buyer GSTIN.\n2. Add HSN codes.\n3. Round to the rupee.",
      changeNote: "Owner asked for rounding.",
      author: "Ravi",
    });
    expect(second.version).toBe(2);
    const text = (await skills.read("gst-invoice-b2b")) ?? "";
    expect(text).toContain("3. Round to the rupee.");
    expect(text).toMatch(/v2 \(.+, Ravi\): Owner asked for rounding\.\n- v1 \(.+, Asha\): First/);
    expect((await skills.list()).map((skill) => skill.id)).toEqual(["gst-invoice-b2b"]);
    expect(learnedSkillNames(shared)).toEqual(["GST invoice (B2B) (Learned/gst-invoice-b2b.md)"]);
    expect(await skills.remove("gst-invoice-b2b")).toEqual([]);
  });

  it("keeps secrets out and never touches files a coworker did not write", async () => {
    const skills = new LearnedSkills(shared);
    await expect(
      skills.save({ name: "Bank", whenToUse: "x", steps: "password: hunter2", author: "A" }),
    ).rejects.toThrow(/passwords/);
    await expect(
      skills.save({
        name: "Card",
        whenToUse: "x",
        steps: "Pay with 4111 1111 1111 1111",
        author: "A",
      }),
    ).rejects.toThrow(/card numbers/);
    await mkdir(join(shared, "Skills", "Learned"), { recursive: true });
    const own = join(shared, "Skills", "Learned", "my-notes.md");
    await writeFile(own, "# Mine\n");
    await expect(
      skills.save({ name: "My notes", whenToUse: "x", steps: "1. a", author: "A" }),
    ).rejects.toThrow(/did not write/);
    await skills.remove("my-notes");
    expect(await readFile(own, "utf8")).toBe("# Mine\n");
    expect(await skills.read("../../etc/passwd")).toBeNull();
  });

  it("makes safe file names", () => {
    expect(learnedSkillId("../../Secret Plan!")).toBe("secret-plan");
    expect(() => learnedSkillId("!!!")).toThrow(/name/);
  });
});
