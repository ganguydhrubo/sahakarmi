// @vitest-environment node

import { mkdtemp, readFileSync, rm } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "./classify";
import { RepoAnalyzer } from "./resolve";

const tempDir = promisify(mkdtemp);
const remove = promisify(rm);
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await remove(folder, { recursive: true, force: true });
});

const SHA = "0123456789abcdef0123456789abcdef01234567";

function fixture(name: string): RepoSnapshot {
  const path = fileURLToPath(new URL(`./__fixtures__/repos/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RepoSnapshot;
}

/** A fake internet serving one fixture repo, counting GitHub API calls. */
function fakeFetch(snapshot: RepoSnapshot) {
  const { owner, repo } = snapshot.location;
  const calls: string[] = [];
  const pypi = snapshot.packages.pypi ?? {};
  const fetchImpl = async (url: string) => {
    calls.push(url);
    let body: unknown = null;
    let text: string | null = null;
    if (url === `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`) body = { sha: SHA };
    else if (url === `https://api.github.com/repos/${owner}/${repo}/git/trees/${SHA}?recursive=1`) {
      body = { tree: snapshot.files.map((file) => ({ ...file, type: "blob" })), truncated: false };
    } else if (url.startsWith(`https://raw.githubusercontent.com/${owner}/${repo}/${SHA}/`)) {
      const path = decodeURIComponent(
        url.slice(`https://raw.githubusercontent.com/${owner}/${repo}/${SHA}/`.length),
      );
      text = snapshot.texts[path] ?? null;
    } else if (url.startsWith("https://registry.modelcontextprotocol.io/v0/servers?search=")) {
      body = { servers: snapshot.registry, metadata: { count: snapshot.registry.length } };
    } else if (url.startsWith("https://pypi.org/pypi/")) {
      const name = decodeURIComponent(url.split("/")[4] ?? "");
      const fact = pypi[name];
      body = fact
        ? { info: { version: fact.version, project_urls: { Homepage: fact.urls[0] ?? null } } }
        : null;
    }
    const ok = body !== null || text !== null;
    return {
      ok,
      status: ok ? 200 : 404,
      headers: { get: () => null },
      json: async () => body,
      text: async () => text ?? JSON.stringify(body),
    };
  };
  return { fetchImpl, calls };
}

describe("RepoAnalyzer", () => {
  it("pins the commit, reads a few files, and classifies MoneyPrinterTurbo as not MCP", async () => {
    const cache = await tempDir(join(tmpdir(), "sahkarmi-mcp-cache-"));
    folders.push(cache);
    const { fetchImpl, calls } = fakeFetch(fixture("not-mcp-moneyprinterturbo"));
    const analyzer = new RepoAnalyzer(cache, fetchImpl);
    const analysis = await analyzer.analyze("https://github.com/harry0703/MoneyPrinterTurbo");
    expect(analysis).toMatchObject({
      kind: "not-mcp",
      commit: SHA,
      repo: "harry0703/MoneyPrinterTurbo",
    });
    expect(analysis.cli).toMatchObject({ package: "mpt", version: "1.3.9", script: "mpt" });
    expect(calls.filter((url) => url.startsWith("https://api.github.com/"))).toHaveLength(2);
    expect(
      calls.filter((url) => url.startsWith("https://raw.githubusercontent.com/")).length,
    ).toBeLessThanOrEqual(14);
    expect(analyzer.get(analysis.id)?.commit).toBe(SHA);

    // Same repo@commit again: only the commit lookup hits the GitHub API.
    calls.length = 0;
    const again = await new RepoAnalyzer(cache, fetchImpl).analyze("harry0703/MoneyPrinterTurbo");
    expect(again.id).toBe(analysis.id);
    expect(calls).toEqual([
      `https://api.github.com/repos/harry0703/MoneyPrinterTurbo/commits/HEAD`,
    ]);
  });

  it("finds a published npm server through the MCP Registry", async () => {
    const cache = await tempDir(join(tmpdir(), "sahkarmi-mcp-cache-"));
    folders.push(cache);
    const { fetchImpl } = fakeFetch(fixture("npm-context7"));
    const analysis = await new RepoAnalyzer(cache, fetchImpl).analyze(
      "https://github.com/upstash/context7",
    );
    expect(analysis.kind).toBe("mcp-stdio");
    expect(analysis.candidates[0]?.server?.args).toEqual(["-y", "@upstash/context7-mcp@4.5.0"]);
  });
});
