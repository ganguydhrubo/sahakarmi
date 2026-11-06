// @vitest-environment node

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppLog } from "./app-log";

describe("AppLog", () => {
  it("has every line on disk once flush resolves, as a quit right after needs", async () => {
    const log = new AppLog(mkdtempSync(join(tmpdir(), "sahkarmi-log-")));
    for (let i = 0; i < 20; i++) log.write("info", `line ${i}`);
    log.write("info", "updater", "install helper started (restart) for 9.9.9");
    await log.flush();
    const lines = readFileSync(log.path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toMatch(/\[info\] updater "install helper started/);
  });
});
