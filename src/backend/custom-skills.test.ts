// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CustomSkills, customSkillLines, parseSkillMarkdown } from "./custom-skills";
import { parseGithubUrl } from "./github-repo";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

const DESIGN = `---
name: frontend-design
description: >
  Make distinctive web pages,
  not generic ones.
---

# Frontend design

1. Pick a bold direction.
`;

function fakeGithub(files: Record<string, string>) {
  const tree = Object.entries(files).map(([path, text]) => ({
    path,
    type: "blob",
    size: text.length,
  }));
  const responses: Record<string, unknown> = {
    "https://api.github.com/repos/acme/skills": { default_branch: "main" },
    "https://api.github.com/repos/acme/skills/git/trees/main?recursive=1": { tree },
  };
  for (const [path, text] of Object.entries(files)) {
    responses[`https://raw.githubusercontent.com/acme/skills/main/${path}`] = text;
  }
  const requested: string[] = [];
  const fetchImpl = async (url: string) => {
    requested.push(url);
    return {
      ok: url in responses,
      status: url in responses ? 200 : 404,
      headers: { get: () => null },
      json: async () => responses[url],
      text: async () => String(responses[url]),
    };
  };
  return { fetchImpl, requested };
}

describe("parseSkillMarkdown", () => {
  it("reads front matter, folded descriptions and falls back to the heading", () => {
    expect(parseSkillMarkdown(DESIGN)).toEqual({
      name: "frontend-design",
      description: "Make distinctive web pages, not generic ones.",
    });
    expect(parseSkillMarkdown("# GST invoice\n\nMake a B2B invoice.")).toEqual({
      name: "GST invoice",
      description: "Make a B2B invoice.",
    });
  });
});

describe("parseGithubUrl", () => {
  it("understands repo, folder and file links", () => {
    expect(parseGithubUrl("acme/skills")).toEqual({
      owner: "acme",
      repo: "skills",
      ref: null,
      subPath: "",
    });
    expect(parseGithubUrl("https://github.com/acme/skills.git")).toMatchObject({ repo: "skills" });
    expect(parseGithubUrl("https://github.com/acme/skills/tree/dev/design")).toEqual({
      owner: "acme",
      repo: "skills",
      ref: "dev",
      subPath: "design",
    });
    expect(parseGithubUrl("https://github.com/acme/skills/blob/main/design/SKILL.md").subPath).toBe(
      "design",
    );
    expect(() => parseGithubUrl("https://example.com")).toThrow(/GitHub link/);
  });
});

describe("CustomSkills", () => {
  it("adds a pasted skill and lists it for coworkers", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-skills-"));
    const skills = new CustomSkills(root);
    const [skill] = await skills.addFromText(DESIGN);
    expect(skill).toMatchObject({ id: "frontend-design", source: "pasted" });
    expect(await skills.read("frontend-design")).toContain("Pick a bold direction");
    expect(customSkillLines(root)).toEqual([
      "frontend-design: Make distinctive web pages, not generic ones. (Custom/frontend-design/SKILL.md)",
    ]);
    // A second paste with the same name gets its own folder.
    expect((await skills.addFromText(DESIGN)).map((item) => item.id)).toEqual([
      "frontend-design",
      "frontend-design-2",
    ]);
  });

  it("previews and installs skill folders from a repo, text files only, nested skills apart", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-skills-"));
    const { fetchImpl } = fakeGithub({
      "README.md": "# repo",
      "design/SKILL.md": DESIGN,
      "design/reference/colors.md": "Use indigo.",
      "design/logo.png": "binary",
      "design/inner/SKILL.md": "---\nname: inner\n---\n",
      "re/SKILL.md": "---\nname: reverse-engineering\ndescription: Read binaries.\n---\n",
    });
    const skills = new CustomSkills(root, fetchImpl);
    const preview = await skills.previewGithub("https://github.com/acme/skills");
    expect(preview.skills.map((skill) => [skill.path, skill.name])).toEqual([
      ["design", "frontend-design"],
      ["design/inner", "inner"],
      ["re", "reverse-engineering"],
    ]);
    expect(preview.skills[0]?.files).toBe(2);

    const installed = await skills.installGithub("https://github.com/acme/skills", [
      "design",
      "re",
    ]);
    expect(installed.map((skill) => skill.source)).toEqual([
      "github.com/acme/skills/design",
      "github.com/acme/skills/re",
    ]);
    const folder = join(root, "Skills", "Custom", "frontend-design");
    expect(await readFile(join(folder, "reference", "colors.md"), "utf8")).toBe("Use indigo.");
    await expect(readFile(join(folder, "logo.png"), "utf8")).rejects.toThrow();
    await expect(readFile(join(folder, "inner", "SKILL.md"), "utf8")).rejects.toThrow();

    const again = await skills.previewGithub("https://github.com/acme/skills");
    expect(again.skills.find((skill) => skill.path === "design")?.installed).toBe(true);
    // Reinstalling the same folder updates it instead of making a copy.
    expect(await skills.installGithub("https://github.com/acme/skills", ["design"])).toHaveLength(
      2,
    );
  });

  it("never removes folders it did not create", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-skills-"));
    const own = join(root, "Skills", "Custom", "mine");
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "SKILL.md"), "# mine");
    const skills = new CustomSkills(root);
    expect(await skills.list()).toEqual([]);
    await skills.remove("mine");
    expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("# mine");
    await skills.remove("../../x");
  });
});
