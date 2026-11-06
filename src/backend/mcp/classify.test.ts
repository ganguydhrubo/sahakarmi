// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRepo, filesToRead, type RepoSnapshot } from "./classify";

/** Real public files (small snippets) saved on 2026-11-06; see each fixture's "source". */
function fixture(name: string): RepoSnapshot {
  const path = fileURLToPath(new URL(`./__fixtures__/repos/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RepoSnapshot;
}

describe("classifyRepo (audit §11.5)", () => {
  it("npm server: registry entry gives a pinned npx config and the optional key", () => {
    const analysis = classifyRepo(fixture("npm-context7"));
    expect(analysis.kind).toBe("mcp-stdio");
    const [best] = analysis.candidates;
    expect(best?.server).toMatchObject({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@4.5.0"],
    });
    expect(best?.install).toEqual({
      type: "npm",
      package: "@upstash/context7-mcp",
      version: "4.5.0",
    });
    expect(best?.evidence[0]).toMatch(/MCP Registry/);
    expect(best?.requiredEnv).toEqual([
      expect.objectContaining({ name: "CONTEXT7_API_KEY", isRequired: false, isSecret: true }),
    ]);
    expect(analysis.candidates.some((candidate) => candidate.runtime === "remote")).toBe(true);
  });

  it("PyPI server: published package beats the README's uv --directory template", () => {
    const analysis = classifyRepo(fixture("pypi-obsidian"));
    expect(analysis.kind).toBe("mcp-stdio");
    const [best] = analysis.candidates;
    expect(best?.server).toMatchObject({ command: "uvx", args: ["mcp-obsidian@0.2.3"] });
    expect(best?.install).toMatchObject({
      type: "pypi",
      package: "mcp-obsidian",
      script: "mcp-obsidian",
    });
    // The README's env names are asked for, and its "<dir_to>" template is flagged and ranked last.
    expect(best?.requiredEnv.map((entry) => entry.name)).toContain("OBSIDIAN_API_KEY");
    const template = analysis.candidates.find((candidate) => candidate.server?.command === "uv");
    expect(template?.placeholders).toContain("<dir_to>");
    expect(analysis.candidates.at(-1)?.placeholders.length).toBeGreaterThan(0);
  });

  it("uv --directory server not on PyPI: needs a copy of the source at the commit", () => {
    const analysis = classifyRepo(fixture("uv-directory-weather"));
    expect(analysis.kind).toBe("mcp-needs-build");
    expect(analysis.candidates[0]?.install).toMatchObject({
      type: "clone-python",
      commit: "fixturecommit0003",
      subPath: "weather-server-python",
      script: "weather",
    });
    expect(analysis.warnings.join(" ")).toMatch(
      /PyPI package named "weather" exists but does not point/,
    );
  });

  it("Docker server: registry image with the token passed as -e NAME", () => {
    const analysis = classifyRepo(fixture("docker-github"));
    const docker = analysis.candidates.find((candidate) => candidate.runtime === "docker");
    expect(docker?.server?.args).toEqual([
      "run",
      "-i",
      "--rm",
      "-p",
      "127.0.0.1:8085:8085",
      "-e",
      "GITHUB_OAUTH_CALLBACK_PORT=8085",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server:2.1.0",
    ]);
    expect(docker?.needs).toEqual(["docker"]);
    expect(docker?.requiredEnv.map((entry) => entry.name)).toContain(
      "GITHUB_PERSONAL_ACCESS_TOKEN",
    );
    expect(
      analysis.candidates.some(
        (candidate) => candidate.server?.url === "https://api.githubcopilot.com/mcp/",
      ),
    ).toBe(true);
  });

  it("MoneyPrinterTurbo: not an MCP server; offers its pip CLI for the Skill route", () => {
    const analysis = classifyRepo(fixture("not-mcp-moneyprinterturbo"));
    expect(analysis.kind).toBe("not-mcp");
    expect(analysis.notMcp).toEqual(["cli", "http-api", "webapp"]);
    expect(analysis.cli).toEqual({
      package: "mpt",
      version: "1.3.9",
      script: "mpt",
      requiresPython: ">=3.11",
    });
    expect(analysis.candidates).toEqual([]);
    expect(analysis.heavy).toBe(true);
    expect(analysis.evidence.join(" ")).toMatch(/main\.py starts a web server/);
  });

  it("README template with placeholders: flagged, never ready to save as-is", () => {
    const analysis = classifyRepo(fixture("placeholder-template"));
    const [candidate] = analysis.candidates;
    expect(candidate?.placeholders).toEqual(["/ABSOLUTE/PATH/TO/PARENT/FOLDER/weather"]);
    expect(candidate?.evidence).toEqual(["README.md line 5"]);
    expect(analysis.kind).toBe("mcp-needs-build");
  });

  it("reads a dozen small files at most, inside the linked folder", () => {
    const snapshot = fixture("not-mcp-moneyprinterturbo");
    const files = filesToRead(snapshot.files, snapshot.location);
    expect(files).toEqual(
      expect.arrayContaining([
        "README-en.md",
        "pyproject.toml",
        "requirements.txt",
        "Dockerfile",
        "main.py",
      ]),
    );
    expect(files.length).toBeLessThanOrEqual(14);
    const weather = fixture("uv-directory-weather");
    expect(filesToRead(weather.files, weather.location)).toEqual(
      expect.arrayContaining([
        "weather-server-python/pyproject.toml",
        "weather-server-python/weather.py",
      ]),
    );
  });
});
