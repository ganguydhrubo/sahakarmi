// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneCrashDumps, redactErrorForLog } from "./crash-dumps";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-crash-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("pruneCrashDumps", () => {
  it("keeps the newest five dumps and leaves other files alone", async () => {
    const reports = join(root, "reports");
    await mkdir(reports, { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      const path = join(reports, `dump-${index}.dmp`);
      await writeFile(path, "x");
      const when = new Date(Date.UTC(2026, 10, 1 + index));
      await utimes(path, when, when);
    }
    await writeFile(join(root, "settings.dat"), "keep");
    expect(await pruneCrashDumps(root)).toBe(3);
    expect((await readdir(reports)).sort()).toEqual(
      ["dump-3.dmp", "dump-4.dmp", "dump-5.dmp", "dump-6.dmp", "dump-7.dmp"].sort(),
    );
    expect(await readdir(root)).toContain("settings.dat");
  });

  it("does nothing when the folder does not exist yet", async () => {
    expect(await pruneCrashDumps(join(root, "missing"))).toBe(0);
  });
});

describe("redactErrorForLog", () => {
  it("masks keys and tokens and shortens the home folder", () => {
    const error = new Error(
      "request failed for C:\\Users\\Asha\\x with sk-ant-abcdefghijklmnopqrstuv and token=abcdef123456",
    );
    const text = redactErrorForLog(error, "C:\\Users\\Asha");
    expect(text).not.toContain("sk-ant-abcdefghijklmnopqrstuv");
    expect(text).not.toContain("abcdef123456");
    expect(text).not.toContain("C:\\Users\\Asha");
    expect(text).toContain("~\\x");
  });
});
