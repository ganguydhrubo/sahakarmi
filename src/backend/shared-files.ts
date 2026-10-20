import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SharedFileEntry, SharedFolderListing } from "../shared/ipc";

const MAX_ENTRIES = 500;

/** Browses the folder every coworker can read and write (~/Sahkarmi/Shared). */
export class SharedFiles {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  get root(): string {
    return this.#root;
  }

  /** Resolves a "/"-separated path relative to the shared root, refusing anything outside it. */
  resolve(relativePath = ""): string {
    const cleaned = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
    const target = resolve(this.#root, ...cleaned.split("/").filter(Boolean));
    const candidate = relative(this.#root, target);
    if (candidate.startsWith("..") || isAbsolute(candidate)) {
      throw new Error("That path is outside the Shared folder.");
    }
    return target;
  }

  async list(directory = ""): Promise<SharedFolderListing> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const absolute = this.resolve(directory);
    const dirents = await readdir(absolute, { withFileTypes: true });
    const entries: SharedFileEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".") || entries.length >= MAX_ENTRIES) continue;
      if (!dirent.isFile() && !dirent.isDirectory()) continue;
      const stats = await lstat(join(absolute, dirent.name)).catch(() => null);
      if (!stats) continue;
      entries.push({
        name: dirent.name,
        path: toPosix(relative(this.#root, join(absolute, dirent.name))),
        kind: dirent.isDirectory() ? "directory" : "file",
        size: dirent.isDirectory() ? 0 : stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
    entries.sort((left, right) =>
      left.kind === right.kind
        ? right.modifiedAt.localeCompare(left.modifiedAt)
        : left.kind === "directory"
          ? -1
          : 1,
    );
    return { root: this.#root, directory: toPosix(relative(this.#root, absolute)), entries };
  }

  /** Copies files into the shared folder without overwriting existing ones. */
  async add(sourcePaths: string[], directory = ""): Promise<SharedFolderListing> {
    const target = this.resolve(directory);
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const source of sourcePaths) {
      const stats = await lstat(source);
      if (!stats.isFile()) continue;
      await copyFile(
        source,
        await availableName(target, basename(source)),
        constants.COPYFILE_EXCL,
      );
    }
    return this.list(directory);
  }
}

async function availableName(directory: string, name: string): Promise<string> {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = join(directory, index === 0 ? name : `${stem} (${index})${extension}`);
    const exists = await lstat(candidate).then(
      () => true,
      () => false,
    );
    if (!exists) return candidate;
  }
  throw new Error(`Too many files named ${name}.`);
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
