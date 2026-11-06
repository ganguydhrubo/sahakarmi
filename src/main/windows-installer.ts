import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Runs a downloaded Windows update without electron-updater's own launcher.
 *
 * That launcher starts the installer while Sahkarmi is still closing and, when Windows refuses
 * (antivirus still scanning the new file, a locked file), retries through elevate.exe: a UAC
 * prompt for an installer that never needs admin rights. Choosing No there, or Yes on a PC
 * where another account's password is typed in (the update then installs into that account),
 * left the old version running and asked for the same restart again, forever. The NSIS
 * installer also stops with exit code 2 and no message in silent mode whenever a file of the
 * old version is still in use, and nothing reopened Sahkarmi or recorded why.
 *
 * Here a small cmd script (cmd.exe is on every Windows PC; PowerShell is used only to wait,
 * with a fixed pause where it is missing or blocked) waits until this Sahkarmi has fully exited, runs the installer as the signed-in user, retries
 * silently when a file was still busy, writes the installer's exit code to a result file, and
 * opens the old Sahkarmi again if the install failed, which then says exactly what happened.
 * Paths reach the script through environment variables, so names with spaces, "&" or
 * non-English letters need no quoting in the script itself (cmd reads it in the OEM code page).
 */

export const INSTALL_RESULT_FILE = "update-install-result.json";

export interface InstallResult {
  version: string;
  /** The installer's exit code: 0 installed, 1 closed by the owner, 2 a file was in use. */
  code: number;
  attempts: number;
}

/** The helper script. ASCII only: everything variable comes from SK_* environment variables. */
export const INSTALL_SCRIPT = [
  "@echo off",
  "rem Sahkarmi update helper: waits for Sahkarmi to close, installs, records the result.",
  "rem Windows' own tools by full path: Git or Cygwin on PATH bring their own versions.",
  'set "SYS=%SystemRoot%\\System32"',
  'set "PS=%SYS%\\WindowsPowerShell\\v1.0\\powershell.exe"',
  "rem Started with no console (as Sahkarmi starts it, so it outlives the app), tasklist prints",
  "rem nothing: a tasklist | find check hung forever, a file-based one never waited. PowerShell's",
  "rem Wait-Process works without a console; without PowerShell, a fixed pause instead.",
  'if not exist "%PS%" goto pause',
  '"%PS%" -NoProfile -NonInteractive -Command "Wait-Process -Id %SK_PID% -Timeout 120 -ErrorAction SilentlyContinue" >nul 2>nul <nul',
  "if not errorlevel 1 goto install",
  ":pause",
  '"%SYS%\\ping.exe" -n 16 127.0.0.1 >nul',
  ":install",
  "set /a attempt=1",
  '"%SK_INSTALLER%" %SK_ARGS% <nul',
  "set code=%errorlevel%",
  ":check",
  'if "%code%"=="0" goto done',
  "if %attempt% geq 3 goto done",
  "rem A file still in use (antivirus checking new files, a helper closing) clears in seconds.",
  '"%SYS%\\ping.exe" -n 4 127.0.0.1 >nul',
  "set /a attempt+=1",
  '"%SK_INSTALLER%" %SK_RETRY_ARGS% <nul',
  "set code=%errorlevel%",
  "goto check",
  ":done",
  '>"%SK_RESULT%" echo {"version":"%SK_VERSION%","code":%code%,"attempts":%attempt%}',
  'if not "%code%"=="0" if "%SK_REOPEN%"=="1" start "" "%SK_APP%"',
  "",
].join("\r\n");

export interface LaunchInstallerOptions {
  installer: string;
  /**
   * "restart": the owner clicked Restart; it installs silently, then opens the new version
   * (or the old one again, if it failed). "quit": the owner closed Sahkarmi with an
   * update ready; it installs silently and nothing opens.
   */
  mode: "restart" | "quit";
  version: string;
  /** Sahkarmi.exe, reopened when the install fails. */
  appExe: string;
  /** This process: the script waits until it has exited. */
  pid: number;
  /** Folder for the result file (the app's user data folder). */
  resultDir: string;
  /** Folder for the script (next to the downloaded installer). */
  scriptDir: string;
  /** Environment the helper starts from (tests); this process's by default. */
  env?: NodeJS.ProcessEnv;
}

/** Starts the helper and resolves once it runs; the caller then quits the app. */
export function launchWindowsInstaller(options: LaunchInstallerOptions): Promise<void> {
  if (!existsSync(options.installer)) {
    return Promise.reject(new Error(`The downloaded update is missing (${options.installer}).`));
  }
  mkdirSync(options.scriptDir, { recursive: true });
  mkdirSync(options.resultDir, { recursive: true });
  const script = join(options.scriptDir, "install-update.cmd");
  writeFileSync(script, INSTALL_SCRIPT, "ascii");
  const resultFile = join(options.resultDir, INSTALL_RESULT_FILE);
  rmSync(resultFile, { force: true });
  const comspec =
    process.env.ComSpec || join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  return new Promise((resolve, reject) => {
    // /s with the whole command in one more pair of quotes: cmd then keeps a path with "&",
    // spaces or non-English letters (it can be in the Windows user name) as one path.
    const child = spawn(comspec, ["/d", "/s", "/c", `""${script}""`], {
      windowsVerbatimArguments: true,
      cwd: dirname(options.installer),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...(options.env ?? process.env),
        SK_PID: String(options.pid),
        SK_INSTALLER: options.installer,
        SK_VERSION: options.version,
        SK_APP: options.appExe,
        SK_RESULT: resultFile,
        // Silent every time: the visible installer stops on Windows dialogs ("cannot be closed",
        // Retry/Cancel) when a file is busy, which blocked the retries and confused owners.
        SK_ARGS: options.mode === "restart" ? "/S --updated --force-run" : "/S --updated",
        SK_RETRY_ARGS: options.mode === "restart" ? "/S --updated --force-run" : "/S --updated",
        SK_REOPEN: options.mode === "restart" ? "1" : "0",
      },
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** The result the helper left for this app, read once (the file is removed). */
export function takeInstallResult(resultDir: string): InstallResult | null {
  const file = join(resultDir, INSTALL_RESULT_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, code, attempts } = parsed as Record<string, unknown>;
  if (typeof version !== "string" || typeof code !== "number") return null;
  return { version, code, attempts: typeof attempts === "number" ? attempts : 1 };
}

/** Plain words for an installer exit code that left the old version running. */
export function installFailureReason(code: number): string {
  if (code === 1) return "The installer was closed before it finished.";
  if (code === 2)
    return "Windows reported that a Sahkarmi file was still in use (often antivirus checking the new files), so nothing was changed.";
  if (code === 5 || code === 1260 || code === 225)
    return "Windows or your antivirus blocked the installer from running.";
  return `The installer stopped with code ${code}.`;
}

/**
 * True when this copy was set up by Sahkarmi's own installer, which leaves its uninstaller next
 * to Sahkarmi.exe. A copy unpacked by Scoop (or by hand) has none: running the installer from it
 * would install a second copy elsewhere while the owner keeps opening this one, and the same
 * update would then be offered at every start.
 */
export function installedByInstaller(appExe: string, productName = "Sahkarmi"): boolean {
  return existsSync(join(dirname(appExe), `Uninstall ${productName}.exe`));
}

/** Overwrites the result file; used by tests and to simulate the helper. */
export function writeInstallResult(resultDir: string, result: InstallResult): void {
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(join(resultDir, INSTALL_RESULT_FILE), JSON.stringify(result));
}
