// @vitest-environment node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INSTALL_RESULT_FILE,
  INSTALL_SCRIPT,
  installedByInstaller,
  installFailureReason,
  takeInstallResult,
  writeInstallResult,
} from "./windows-installer";

describe("install helper script", () => {
  it("is plain ASCII with Windows line ends, so cmd reads it on any code page", () => {
    expect(/^[\x20-\x7e\r\n]*$/.test(INSTALL_SCRIPT)).toBe(true);
    expect(INSTALL_SCRIPT.split("\r\n").length).toBeGreaterThan(10);
    expect(INSTALL_SCRIPT.replace(/\r\n/g, "")).not.toContain("\n");
  });

  /**
   * Runs the real script with Node standing in for the installer: it records each run and
   * exits with the next code from FAKE_CODES. A folder name with a space, "&" and Hindi letters
   * checks that paths survive cmd.
   */
  function runScript(codes: number[], waitForPid?: number) {
    const root = mkdtempSync(join(tmpdir(), "sahkarmi-helper-"));
    const dir = join(root, "सहकर्मी & co");
    spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(dir)})`]);
    const runs = join(dir, "runs.txt");
    const fake = join(dir, "fake-installer.js");
    writeFileSync(
      fake,
      `const fs = require("fs");
const runs = ${JSON.stringify(runs)};
const done = fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").split("\\n").filter(Boolean).length : 0;
fs.appendFileSync(runs, JSON.stringify({ at: Date.now(), args: process.argv.slice(2) }) + "\\n");
process.exit(Number(process.env.FAKE_CODES.split(",")[done] ?? 0));`,
    );
    const script = join(dir, "install-update.cmd");
    writeFileSync(script, INSTALL_SCRIPT, "ascii");
    // Started exactly as launchWindowsInstaller starts it.
    const result = spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `""${script}""`],
      {
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          FAKE_CODES: codes.join(","),
          SK_PID: String(waitForPid ?? 999_999_999),
          SK_INSTALLER: process.execPath,
          SK_ARGS: `"${fake}" first`,
          SK_RETRY_ARGS: `"${fake}" retry`,
          SK_VERSION: "9.9.9",
          SK_APP: process.execPath,
          SK_REOPEN: "0",
          SK_RESULT: join(dir, INSTALL_RESULT_FILE),
        },
        windowsHide: true,
        timeout: 60_000,
      },
    );
    const lines = existsSync(runs)
      ? readFileSync(runs, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { at: number; args: string[] })
      : [];
    return { status: result.status, dir, lines, outcome: takeInstallResult(dir) };
  }

  it.runIf(process.platform === "win32")(
    "installs once and records success",
    () => {
      const run = runScript([0]);
      expect(run.lines.map((line) => line.args.at(-1))).toEqual(["first"]);
      expect(run.outcome).toEqual({ version: "9.9.9", code: 0, attempts: 1 });
      expect(existsSync(join(run.dir, INSTALL_RESULT_FILE))).toBe(false);
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "retries silently while a file is still in use, then records the outcome",
    () => {
      const recovered = runScript([2, 2, 0]);
      expect(recovered.lines.map((line) => line.args.at(-1))).toEqual(["first", "retry", "retry"]);
      expect(recovered.outcome).toEqual({ version: "9.9.9", code: 0, attempts: 3 });

      const stuck = runScript([2, 2, 2, 0]);
      expect(stuck.lines).toHaveLength(3);
      expect(stuck.outcome).toEqual({ version: "9.9.9", code: 2, attempts: 3 });
    },
    60_000,
  );

  it.runIf(process.platform === "win32")(
    "waits until Sahkarmi has exited before the installer runs",
    async () => {
      const app = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], {
        stdio: "ignore",
      });
      const exited = new Promise<number>((resolve) => app.once("exit", () => resolve(Date.now())));
      const run = runScript([0], app.pid);
      const exitAt = await exited;
      expect(run.lines).toHaveLength(1);
      expect(run.lines[0].at).toBeGreaterThanOrEqual(exitAt - 50);
    },
    30_000,
  );
});

describe("install results", () => {
  it("is read once and explained in plain words", () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-result-"));
    expect(takeInstallResult(dir)).toBeNull();
    writeInstallResult(dir, { version: "0.25.0", code: 2, attempts: 3 });
    expect(takeInstallResult(dir)).toEqual({ version: "0.25.0", code: 2, attempts: 3 });
    expect(takeInstallResult(dir)).toBeNull();
    expect(installFailureReason(2)).toMatch(/still in use/);
    expect(installFailureReason(1)).toMatch(/closed/);
    expect(installFailureReason(77)).toMatch(/code 77/);
  });

  it("tells an installed copy from one Scoop unpacked", () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-copy-"));
    const exe = join(dir, "Sahkarmi.exe");
    writeFileSync(exe, "");
    expect(installedByInstaller(exe)).toBe(false);
    writeFileSync(join(dir, "Uninstall Sahkarmi.exe"), "");
    expect(installedByInstaller(exe)).toBe(true);
  });
});
