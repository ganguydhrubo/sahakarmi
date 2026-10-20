// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SharedFiles } from "./shared-files";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SharedFiles", () => {
  it("lists folders first, adds files without overwriting, and stays inside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-shared-"));
    roots.push(root);
    const shared = new SharedFiles(join(root, "Shared"));
    await mkdir(join(root, "Shared", "Invoices"), { recursive: true });
    const source = join(root, "price-list.csv");
    await writeFile(source, "item,price\nkurta,799\n");

    await shared.add([source]);
    const listing = await shared.add([source]);
    expect(listing.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      "directory:Invoices",
      expect.stringMatching(/^file:price-list( \(1\))?\.csv$/),
      expect.stringMatching(/^file:price-list( \(1\))?\.csv$/),
    ]);
    await expect(readFile(join(root, "Shared", "price-list (1).csv"), "utf8")).resolves.toContain(
      "kurta",
    );
    expect((await shared.list("Invoices")).directory).toBe("Invoices");
    expect(() => shared.resolve("../../etc/passwd")).toThrow("outside the Shared folder");
  });
});
