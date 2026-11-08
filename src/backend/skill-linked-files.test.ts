// @vitest-environment node

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SKILL_PACKS } from "../shared/skill-packs";
import { CustomSkills } from "./custom-skills";
import {
  brokenLinks,
  fileReferences,
  neutralBrandText,
  parseMcpRecommendations,
  resolveRepoPath,
} from "./skill-linked-files";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

/** A fake GitHub serving one repo at one ref; records every URL asked for. */
function fakeGithub(files: Record<string, string>, owner = "acme", repo = "plugins", ref = "main") {
  const tree = Object.entries(files).map(([path, text]) => ({
    path,
    type: "blob",
    size: text.length,
  }));
  const responses: Record<string, unknown> = {
    [`https://api.github.com/repos/${owner}/${repo}`]: { default_branch: ref },
    [`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`]: { tree },
  };
  for (const [path, text] of Object.entries(files)) {
    responses[`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`] = text;
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

/** Mirrors the layout of a multi-skill business plugin repo. */
const PLUGIN_REPO: Record<string, string> = {
  "small-business/.claude-plugin/plugin.json": JSON.stringify({
    name: "small-business",
    displayName: "Small Business",
    version: "1.35.1",
    description: "Workflows. Ask Claude to help.",
  }),
  "small-business/.mcp.json": JSON.stringify({
    mcpServers: {
      "intuit-quickbooks": { type: "http", url: "https://ai-inc.quickbooks.example/v1/mcp" },
      keyed: {
        type: "http",
        url: "https://mcp.example.com/mcp?api_key=SECRET123",
        headers: { Authorization: "Bearer SECRET456" },
      },
      local: {
        command: "npx",
        args: ["-y", "some-server", "--token", "SECRET789"],
        env: { SOME_API_KEY: "SECRET000" },
      },
    },
  }),
  "small-business/shared/connector-neutrality.md":
    "# Connector neutrality\n\nSee also [tenant scope](tenant-scope.md) and [the repo](../../README.md).\n",
  "small-business/skills/lead-triage/SKILL.md": "---\nname: lead-triage\n---\n\nAnother skill.\n",
  "small-business/shared/tenant-scope.md": "# Tenant scope\n\nCheck the mailbox owner.\n",
  "small-business/shared/unused.md": "# Not linked from anywhere\n",
  "small-business/skills/invoice-chase/SKILL.md": [
    "---",
    "name: invoice-chase",
    "description: Drafts overdue-invoice reminders. Ask Claude to chase.",
    "---",
    "",
    "Use whichever ledger is connected (`../../shared/connector-neutrality.md`).",
    "Confirm the mailbox first ([scope](../../shared/tenant-scope.md#who)).",
    "Details in [gotchas](reference/gotchas.md) and `reference/gotchas.md`.",
    "Never read [this](../../../../../etc/passwd) or [that](..%2F..%2F..%2F..%2Fsecret.md).",
    "Website: [home](https://example.com/x.md).",
    "Then hand over to [lead triage](../lead-triage/SKILL.md).",
  ].join("\n"),
  "small-business/skills/invoice-chase/reference/gotchas.md":
    "# Gotchas\n\nSee [neutrality](../../../shared/connector-neutrality.md).\n",
  "small-business/skills/invoice-chase/helper.py": "print('never copied from a pack')\n",
  "README.md": "# Plugins\n",
  LICENSE: "Apache License\nVersion 2.0, January 2004\n",
};

async function installed(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else files.set(rel, await readFile(join(dir, entry.name), "utf8"));
    }
  };
  await walk(folder, "");
  return files;
}

describe("resolveRepoPath", () => {
  it("resolves relative links and refuses ones that leave the repo", () => {
    expect(resolveRepoPath("a/skills/x/SKILL.md", "../../shared/n.md")).toBe("a/shared/n.md");
    expect(resolveRepoPath("a/skills/x/SKILL.md", "/README.md")).toBe("README.md");
    expect(resolveRepoPath("a/skills/x/SKILL.md", "../../../../etc/passwd")).toBeNull();
    expect(resolveRepoPath("a/SKILL.md", "..%2F..%2Fsecret")).toBeNull();
    expect(resolveRepoPath("a/SKILL.md", "C:/Windows/win.ini")).toBeNull();
    expect(resolveRepoPath("a/SKILL.md", "..\\..\\x")).toBeNull();
    expect(resolveRepoPath("a/SKILL.md", "//evil.example/x")).toBeNull();
  });

  it("finds markdown links, reference links and inline-code paths, not web links", () => {
    const refs = fileReferences(
      "[a](../x.md) [b](<y z.md>) [c](https://e.com/q.md)\n[d]: ./d.md\n`ref/e.md` `npm install`",
    ).map((ref) => `${ref.kind}:${ref.path}`);
    expect(refs).toEqual(["link:../x.md", "link:y z.md", "link:./d.md", "code:ref/e.md"]);
  });
});

describe("plugin-aware import", () => {
  it("brings the plugin's shared/ files along and rewrites links so none break", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const { fetchImpl, requested } = fakeGithub(PLUGIN_REPO);
    const skills = new CustomSkills(root, fetchImpl, () => true);
    const [skill] = await skills.installGithub("https://github.com/acme/plugins", [
      "small-business/skills/invoice-chase",
    ]);
    expect(skill?.linkedFiles).toBe(2);
    const files = await installed(join(root, "Skills", "Custom", "invoice-chase"));
    expect([...files.keys()].sort()).toEqual([
      ".sahkarmi-skill.json",
      "LICENSE",
      "SKILL.md",
      "_plugin/shared/connector-neutrality.md",
      "_plugin/shared/tenant-scope.md",
      "helper.py",
      "reference/gotchas.md",
    ]);
    const main = files.get("SKILL.md") ?? "";
    expect(main).toContain("(`_plugin/shared/connector-neutrality.md`)");
    expect(main).toContain("[scope](_plugin/shared/tenant-scope.md#who)");
    // Links inside the skill's own folder are left exactly as written.
    expect(main).toContain("[gotchas](reference/gotchas.md) and `reference/gotchas.md`");
    expect(files.get("reference/gotchas.md")).toContain(
      "[neutrality](../_plugin/shared/connector-neutrality.md)",
    );
    // The linked file's own link keeps working from its new place.
    expect(files.get("_plugin/shared/connector-neutrality.md")).toContain("(tenant-scope.md)");
    // Licence text is kept, unchanged.
    expect(files.get("LICENSE")).toBe(PLUGIN_REPO.LICENSE);
    // Only the traversal links and the web link are not files in the folder.
    const contents = new Map([...files].filter(([path]) => path !== ".sahkarmi-skill.json"));
    // Another skill's folder, and repo files outside a brought-along doc's own folder, are by
    // design left as written (and recorded), so one shared doc never pulls in the whole repo.
    expect(brokenLinks(contents)).toEqual([
      "SKILL.md -> ../../../../../etc/passwd",
      "SKILL.md -> ..%2F..%2F..%2F..%2Fsecret.md",
      "SKILL.md -> ../lead-triage/SKILL.md",
      "_plugin/shared/connector-neutrality.md -> ../../README.md",
    ]);
    const record = JSON.parse(
      await readFile(
        join(root, "Skills", "Custom", "invoice-chase", ".sahkarmi-skill.json"),
        "utf8",
      ),
    );
    expect(record.notBrought).toEqual([
      "SKILL.md -> ../lead-triage/SKILL.md (another-skill, skill)",
      "_plugin/shared/connector-neutrality.md -> ../../README.md (outside-folder, linked)",
    ]);
    // Path traversal was never followed: nothing outside the repo was asked for.
    expect(requested.some((url) => /passwd|secret\.md/.test(url))).toBe(false);
    expect(requested.some((url) => url.endsWith("unused.md"))).toBe(false);
    expect(requested.some((url) => url.endsWith("lead-triage/SKILL.md"))).toBe(false);
  });

  it("lists a plugin's .mcp.json servers as recommendations only, with no secrets", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const { fetchImpl } = fakeGithub(PLUGIN_REPO);
    const skills = new CustomSkills(root, fetchImpl, () => true);
    const [skill] = await skills.installGithub("https://github.com/acme/plugins", [
      "small-business/skills/invoice-chase",
    ]);
    expect(skill?.plugin).toEqual({
      name: "small-business",
      displayName: "Small Business",
      version: "1.35.1",
      description: "Workflows. Ask Claude to help.",
    });
    expect(skill?.mcpRecommendations).toEqual([
      {
        name: "intuit-quickbooks",
        transport: "http",
        url: "https://ai-inc.quickbooks.example/v1/mcp",
        envKeys: [],
        headerKeys: [],
      },
      {
        name: "keyed",
        transport: "http",
        url: "https://mcp.example.com/mcp",
        envKeys: [],
        headerKeys: ["Authorization"],
      },
      {
        name: "local",
        transport: "stdio",
        command: "npx",
        args: ["-y", "some-server"],
        envKeys: ["SOME_API_KEY"],
        headerKeys: [],
      },
    ]);
    const stored = await readFile(
      join(root, "Skills", "Custom", "invoice-chase", ".sahkarmi-skill.json"),
      "utf8",
    );
    expect(stored).not.toMatch(/SECRET/);
    // No MCP server is ever added by an import: CustomSkills has no MCP store at all, and the
    // only MCP data written is the recommendation list in the skill's own record.
    expect(JSON.stringify(await skills.list())).not.toMatch(/SECRET/);
  });

  it("keeps the old behaviour when the switch is off", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const { fetchImpl } = fakeGithub(PLUGIN_REPO);
    const skills = new CustomSkills(root, fetchImpl);
    const [skill] = await skills.installGithub("https://github.com/acme/plugins", [
      "small-business/skills/invoice-chase",
    ]);
    expect(skill?.mcpRecommendations).toBeUndefined();
    const files = await installed(join(root, "Skills", "Custom", "invoice-chase"));
    expect([...files.keys()].sort()).toEqual([
      ".sahkarmi-skill.json",
      "SKILL.md",
      "helper.py",
      "reference/gotchas.md",
    ]);
  });

  it("parses .mcp.json shapes defensively", () => {
    expect(parseMcpRecommendations("not json")).toEqual([]);
    expect(parseMcpRecommendations('{"x":{"url":"file:///etc/passwd"}}')).toEqual([]);
    expect(parseMcpRecommendations('{"x":{"url":"https://a.example/mcp"}}')).toHaveLength(1);
  });
});

describe("skill packs", () => {
  it("installs a pack skill at its pinned commit: text only, neutral name, no scripts", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const pack = SKILL_PACKS.find((entry) => entry.id === "small-business");
    if (!pack) throw new Error("pack missing");
    const [owner = "", repo = ""] = pack.repo.split("/");
    const { fetchImpl, requested } = fakeGithub(PLUGIN_REPO, owner, repo, pack.commit);
    const skills = new CustomSkills(root, fetchImpl, () => true);
    const list = await skills.installPack("small-business", ["invoice-chase"]);
    expect(list).toHaveLength(1);
    const [skill] = list;
    expect(skill?.pack).toBe("small-business");
    expect(skill?.source).toBe("pack:small-business/invoice-chase");
    expect(skill?.description).toBe(
      "Drafts overdue-invoice reminders. Ask your coworker to chase.",
    );
    expect(skill?.plugin).toBeUndefined();
    const files = await installed(join(root, "Skills", "Custom", "invoice-chase"));
    expect(files.has("helper.py")).toBe(false);
    expect(requested.some((url) => url.endsWith("helper.py"))).toBe(false);
    expect(requested.every((url) => !url.includes("/main/"))).toBe(true);
    expect(files.has("_plugin/shared/tenant-scope.md")).toBe(true);
    await expect(skills.installPack("small-business", ["not-in-pack"])).rejects.toThrow(
      /not part of the pack/,
    );
    await expect(skills.installPack("no-such-pack")).rejects.toThrow(/not in this version/);
  });

  it("is refused while the switch is off", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const skills = new CustomSkills(root, fakeGithub({}).fetchImpl);
    await expect(skills.installPack("sales")).rejects.toThrow(/switched off/);
  });

  it("labels legal packs as not legal advice when a coworker reads the skill", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-linked-"));
    const pack = SKILL_PACKS.find((entry) => entry.id === "contract-review");
    if (!pack) throw new Error("pack missing");
    const [owner = "", repo = ""] = pack.repo.split("/");
    const { fetchImpl } = fakeGithub(
      {
        "skill.md": "---\nname: contract-review\ndescription: Review contracts.\n---\n\nSteps.\n",
        LICENSE: "MIT License\n",
        "examples/demo.png": "binary",
      },
      owner,
      repo,
      pack.commit,
    );
    const skills = new CustomSkills(root, fetchImpl, () => true);
    const [skill] = await skills.installPack("contract-review");
    expect(skill?.id).toBe("contract-review");
    expect(await skills.read("contract-review")).toMatch(/^\[Not legal advice/);
  });
});

describe("brand-neutral display text", () => {
  it("replaces vendor product names in shown names and descriptions", () => {
    expect(neutralBrandText("Use Claude Code to apply Anthropic's colours. Ask Claude.")).toBe(
      "Use the AI to apply colours. Ask your coworker.",
    );
  });
});
