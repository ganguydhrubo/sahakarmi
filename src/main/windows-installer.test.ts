// @vitest-environment node

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  INSTALL_RESULT_FILE,
  INSTALL_SCRIPT,
  installedByInstaller,
  installFailureReason,
  launchWindowsInstaller,
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
   * Starts the real helper through launchWindowsInstaller, so it runs exactly as Sahkarmi runs
   * it: detached, hidden, with no console and no standard input. (Started from a console, as
   * an earlier test did, a pipe in the script worked; started from the app it hung forever.)
   * A copy of Node stands in for both the installer and Sahkarmi: NODE_OPTIONS loads a script
   * that records each run and exits with the next code from FAKE_CODES, whatever the
   * arguments. A folder name with a space, "&" and Hindi letters checks that paths survive cmd.
   */
  async function runHelper(
    codes: number[],
    options: { pid?: number; mode?: "restart" | "quit" } = {},
  ) {
    const root = mkdtempSync(join(tmpdir(), "sahkarmi-helper-"));
    const dir = join(root, "सहकर्मी & co");
    mkdirSync(dir);
    const runs = join(dir, "runs.txt");
    const fake = join(dir, "fake.js");
    writeFileSync(
      fake,
      `const fs = require("fs");
const runs = ${JSON.stringify(runs)};
const done = fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").split("\\n").filter(Boolean).length : 0;
// Node reads the first argument as its script path: "/S" arrives as "C:\\S".
const args = process.argv.slice(1).map((arg, i) => (i === 0 && /^[A-Za-z]:[\\\\/]S$/.test(arg) ? "/S" : arg));
fs.appendFileSync(runs, JSON.stringify({ at: Date.now(), args }) + "\\n");
process.exit(Number(process.env.FAKE_CODES.split(",")[done] ?? 0));`,
    );
    const installer = join(dir, "Fake Setup.exe");
    copyFileSync(process.execPath, installer);
    await launchWindowsInstaller({
      installer,
      mode: options.mode ?? "quit",
      version: "9.9.9",
      appExe: installer,
      pid: options.pid ?? 999_999_999,
      resultDir: dir,
      scriptDir: dir,
      env: {
        ...process.env,
        FAKE_CODES: codes.join(","),
        NODE_OPTIONS: `--require "${fake.replaceAll("\\", "/")}"`,
      },
    });
    const resultFile = join(dir, INSTALL_RESULT_FILE);
    const end = Date.now() + 90_000;
    while (!existsSync(resultFile) && Date.now() < end) await sleep(200);
    // In restart mode a failed install opens the old app again: give it a moment to record.
    await sleep(options.mode === "restart" ? 1500 : 200);
    const lines = existsSync(runs)
      ? readFileSync(runs, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { at: number; args: string[] })
      : [];
    return { dir, lines, outcome: takeInstallResult(dir) };
  }

  it.runIf(process.platform === "win32")(
    "installs silently once and records success",
    async () => {
      const run = await runHelper([0]);
      expect(run.lines.map((line) => line.args)).toEqual([["/S", "--updated"]]);
      expect(run.outcome).toEqual({ version: "9.9.9", code: 0, attempts: 1 });
      expect(existsSync(join(run.dir, INSTALL_RESULT_FILE))).toBe(false);
    },
    60_000,
  );

  it.runIf(process.platform === "win32")(
    "retries silently while a file is still in use, then records the outcome",
    async () => {
      const recovered = await runHelper([2, 2, 0]);
      expect(recovered.lines).toHaveLength(3);
      expect(recovered.outcome).toEqual({ version: "9.9.9", code: 0, attempts: 3 });

      const stuck = await runHelper([2, 2, 2, 0]);
      expect(stuck.lines).toHaveLength(3);
      expect(stuck.outcome).toEqual({ version: "9.9.9", code: 2, attempts: 3 });
    },
    240_000,
  );

  it.runIf(process.platform === "win32")(
    "after Restart, opens the new version itself, or the old one again when it failed",
    async () => {
      const ok = await runHelper([0], { mode: "restart" });
      expect(ok.lines.map((line) => line.args)).toEqual([["/S", "--updated", "--force-run"]]);

      const failed = await runHelper([2, 2, 2, 0], { mode: "restart" });
      expect(failed.outcome?.code).toBe(2);
      // Three silent attempts, then the old app reopened with no arguments.
      expect(failed.lines.map((line) => line.args)).toEqual([
        ["/S", "--updated", "--force-run"],
        ["/S", "--updated", "--force-run"],
        ["/S", "--updated", "--force-run"],
        [],
      ]);
    },
    240_000,
  );

  it.runIf(process.platform === "win32")(
    "waits until Sahkarmi has exited before the installer runs",
    async () => {
      const app = spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], {
        stdio: "ignore",
      });
      const exited = new Promise<number>((resolve) => app.once("exit", () => resolve(Date.now())));
      const run = await runHelper([0], { pid: app.pid });
      const exitAt = await exited;
      expect(run.lines).toHaveLength(1);
      expect(run.lines[0].at).toBeGreaterThanOrEqual(exitAt - 50);
    },
    60_000,
  );

  it.runIf(process.platform === "win32")("refuses a missing installer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-helper-"));
    await expect(
      launchWindowsInstaller({
        installer: join(dir, "gone.exe"),
        mode: "restart",
        version: "9.9.9",
        appExe: "x",
        pid: 1,
        resultDir: dir,
        scriptDir: dir,
      }),
    ).rejects.toThrow(/missing/);
  });
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
