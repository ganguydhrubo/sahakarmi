/**
 * Downloads the pinned OpenCode binary for a platform into build/opencode/<os>-<arch>/ so
 * electron-builder can ship it in resources/bin. OpenCode (MIT) provides Sahkarmi's free,
 * no-login models. Usage: bun scripts/fetch-opencode.ts [platform] [arch]
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OPENCODE_VERSION = "1.19.3";
const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const npmPlatform = platform === "win32" ? "windows" : platform;
const binary = platform === "win32" ? "opencode.exe" : "opencode";
// Folder names match electron-builder's ${os}-${arch} macros (mac / win / linux).
const builderOs = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
const target = resolve("build", "opencode", `${builderOs}-${arch}`);
const destination = join(target, binary);

if (existsSync(destination)) {
  console.log(`OpenCode ${OPENCODE_VERSION} already present at ${destination}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "sahkarmi-opencode-"));
try {
  const packageSpec = `opencode-${npmPlatform}-${arch}@${OPENCODE_VERSION}`;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const tarball = execFileSync(npm, ["pack", packageSpec, "--silent"], {
    cwd: work,
    encoding: "utf8",
    shell: process.platform === "win32",
  })
    .trim()
    .split(/\r?\n/)
    .at(-1);
  if (!tarball) throw new Error(`npm pack ${packageSpec} produced no tarball.`);
  execFileSync("tar", ["-xzf", tarball], { cwd: work });
  mkdirSync(target, { recursive: true });
  copyFileSync(join(work, "package", "bin", binary), destination);
  if (platform !== "win32") chmodSync(destination, 0o755);
  console.log(`Bundled OpenCode ${OPENCODE_VERSION} for ${platform}-${arch} at ${destination}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
