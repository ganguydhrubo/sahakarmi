// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "./approval-store";
import {
  type CorruptFileRecovery,
  clearCorruptFileRecoveries,
  JsonFile,
  onCorruptFileRecovered,
} from "./json-file";
import { PermissionService } from "./permission-service";

interface Doc {
  version: 1;
  items: string[];
}
const isDoc = (value: unknown): value is Doc =>
  typeof value === "object" &&
  value !== null &&
  (value as Doc).version === 1 &&
  Array.isArray((value as Doc).items);

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-json-file-"));
  clearCorruptFileRecoveries();
});
afterEach(async () => {
  clearCorruptFileRecoveries();
  await rm(root, { recursive: true, force: true });
});

describe("JsonFile corrupt-file recovery", () => {
  it("still throws on a corrupt file unless recovery is enabled", async () => {
    const path = join(root, "doc.json");
    await writeFile(path, "{ not json", "utf8");
    await expect(
      new JsonFile<Doc>(path).read(() => ({ version: 1, items: [] }), isDoc),
    ).rejects.toThrow();
  });

  it("moves a truncated file aside, keeps its bytes, and starts with defaults", async () => {
    const path = join(root, "doc.json");
    await writeFile(path, '{"version":1,"items":["a"', "utf8");
    const seen: CorruptFileRecovery[] = [];
    const stop = onCorruptFileRecovered((recovery) => seen.push(recovery));
    const value = await new JsonFile<Doc>(path, { recoverCorrupt: true }).read(
      () => ({ version: 1, items: [] }),
      isDoc,
    );
    stop();
    expect(value).toEqual({ version: 1, items: [] });
    const names = await readdir(root);
    expect(names).not.toContain("doc.json");
    const backup = names.find((name) => name.startsWith("doc.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(root, backup ?? ""), "utf8")).toBe('{"version":1,"items":["a"');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toMatch(/^doc\.json: not valid JSON/);
  });

  it("replays earlier recoveries to a listener added later (stores load before the window)", async () => {
    const path = join(root, "doc.json");
    await writeFile(path, '{"version":99}', "utf8");
    await new JsonFile<Doc>(path, { recoverCorrupt: true }).read(
      () => ({ version: 1, items: [] }),
      isDoc,
    );
    const seen: CorruptFileRecovery[] = [];
    onCorruptFileRecovered((recovery) => seen.push(recovery))();
    expect(seen.map((recovery) => recovery.path)).toEqual([path]);
  });

  it("a corrupt permissions.json or approvals.json no longer blocks startup", async () => {
    await writeFile(join(root, "permissions.json"), "\u0000\u0000garbage", "utf8");
    await writeFile(join(root, "approvals.json"), "[1,2", "utf8");
    const permissions = new PermissionService(root);
    await expect(permissions.initialize()).resolves.toBeUndefined();
    const approvals = new ApprovalStore(root);
    await expect(approvals.initialize()).resolves.toBeUndefined();
    expect(approvals.list()).toEqual([]);
    const names = await readdir(root);
    expect(names.some((name) => name.startsWith("permissions.json.corrupt-"))).toBe(true);
    expect(names.some((name) => name.startsWith("approvals.json.corrupt-"))).toBe(true);
  });
});
