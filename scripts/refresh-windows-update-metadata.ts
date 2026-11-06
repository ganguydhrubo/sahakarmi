// Run after the Windows installer in dist/ has been replaced by its signed copy.
// Signing changes the installer bytes, so the sha512/size in latest.yml and the differential
// update block map that electron-builder produced for the unsigned file no longer match.
// This recomputes both from the file as it is now.
//
// Usage: bun scripts/refresh-windows-update-metadata.ts [distDir]
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rewriteLatestYml } from "./update-metadata-lib";

const distDir = resolve(process.argv[2] ?? "dist");
const installers = (await readdir(distDir)).filter((name) => name.toLowerCase().endsWith(".exe"));
if (installers.length !== 1) {
  throw new Error(`Expected one installer in ${distDir}, found ${installers.length}.`);
}
const fileName = installers[0];
const installerPath = join(distDir, fileName);
const blockMapPath = `${installerPath}.blockmap`;
const latestPath = join(distDir, "latest.yml");

// electron-builder's own block map writer, so the format is exactly what electron-updater reads.
// It also returns the sha512 of the whole file. If it can't be loaded, the stale block map is
// removed: electron-updater then falls back to a full download instead of a differential one.
let digest: { sha512: string; size: number };
try {
  const { buildBlockMap } = await import("app-builder-lib/out/targets/blockmap/blockmap");
  digest = await buildBlockMap(installerPath, "gzip", blockMapPath);
  console.log(`Rebuilt ${blockMapPath}`);
} catch (error) {
  console.warn(`::warning::Could not rebuild the block map (${String(error)}); removing it.`);
  await rm(blockMapPath, { force: true });
  const { createHash } = await import("node:crypto");
  digest = {
    sha512: createHash("sha512")
      .update(await readFile(installerPath))
      .digest("base64"),
    size: (await stat(installerPath)).size,
  };
}

const before = await readFile(latestPath, "utf8");
const after = rewriteLatestYml(before, { fileName, sha512: digest.sha512, size: digest.size });
await writeFile(latestPath, after, "utf8");
console.log(`Updated ${latestPath}: ${fileName} sha512=${digest.sha512} size=${digest.size}`);
