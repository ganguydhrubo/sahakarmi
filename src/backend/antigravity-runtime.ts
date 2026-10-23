import { createHash } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Google's official Antigravity ACP server (Agent Client Protocol over stdio), published at
 * https://dl.google.com/agy-extensions/releases/<os>/agy-acp-server-<version>-<os>-<arch>.zip.
 * Each archive holds agy_acp_server(.exe) and localharness_external(.exe). Sahkarmi downloads
 * the one for this computer when the owner clicks Connect, verifies it against the pinned
 * SHA-256 below, and unpacks it into <runtime>/antigravity/<version>/.
 */
export const ANTIGRAVITY_VERSION = "1.4.2";
export const ANTIGRAVITY_TERMS_URL = "https://antigravity.google/terms";

export interface AntigravityPlatformPin {
  url: string;
  sha256: string;
  executableName: string;
}

function releaseUrl(os: "windows" | "macos" | "linux", target: string): string {
  return `https://dl.google.com/agy-extensions/releases/${os}/agy-acp-server-${ANTIGRAVITY_VERSION}-${target}.zip`;
}

export const ANTIGRAVITY_PINS: Record<string, AntigravityPlatformPin> = {
  "win32-x64": {
    url: releaseUrl("windows", "windows-x86_64"),
    sha256: "03685e7bff689425b2916b5ece2d47a14f940263d27cfab2ec2bee544c041c38",
    executableName: "agy_acp_server.exe",
  },
  "darwin-arm64": {
    url: releaseUrl("macos", "darwin-arm64"),
    sha256: "4b6577fb0d84a6490c866efac8061d6c6ef01210b61ead9a1eecb30a2c8c15bc",
    executableName: "agy_acp_server",
  },
  "linux-x64": {
    url: releaseUrl("linux", "linux-x86_64"),
    sha256: "599e5c0fcd3d290d07c11350df8b1071225d03dedf0981a8840d9fd760584440",
    executableName: "agy_acp_server",
  },
};

/** The executable the pinned archive for this computer unpacks to, or null when unsupported. */
export function managedAntigravityExecutable(
  runtimeDirectory: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const pin = ANTIGRAVITY_PINS[`${platform}-${arch}`];
  return pin
    ? join(runtimeDirectory, "antigravity", ANTIGRAVITY_VERSION, pin.executableName)
    : null;
}

/**
 * Extracts a ZIP archive buffer into the target directory (stored and deflated entries). Sizes
 * come from the central directory, so archives written with data descriptors also unpack.
 */
export async function unzipBuffer(buffer: Buffer, targetDir: string): Promise<string[]> {
  const extractedFiles: string[] = [];
  for (const entry of readCentralDirectory(buffer)) {
    const header = entry.localHeaderOffset;
    if (buffer.readUInt32LE(header) !== 0x04034b50) {
      throw new Error("The archive is damaged (bad local file header).");
    }
    const fileNameLength = buffer.readUInt16LE(header + 26);
    const extraFieldLength = buffer.readUInt16LE(header + 28);
    const dataStart = header + 30 + fileNameLength + extraFieldLength;
    const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    const filePath = join(targetDir, ...safeEntryPath(entry.fileName));
    if (entry.fileName.endsWith("/")) {
      await mkdir(filePath, { recursive: true });
      continue;
    }
    await mkdir(join(filePath, ".."), { recursive: true });
    let fileData: Buffer;
    if (entry.compressionMethod === 0) {
      fileData = Buffer.from(compressedData);
    } else if (entry.compressionMethod === 8) {
      fileData = inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
    }
    await writeFile(filePath, fileData);
    if (process.platform !== "win32") chmodSync(filePath, 0o755);
    extractedFiles.push(filePath);
  }
  return extractedFiles;
}

interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  // End of central directory record (0x06054b50): within the last 64 KB plus its 22 fixed bytes.
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("The archive is damaged (no central directory).");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("The archive is damaged (bad central directory entry).");
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

/** Archive paths are untrusted: no absolute paths and no ".." escaping the target folder. */
function safeEntryPath(fileName: string): string[] {
  const parts = fileName.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..") || /^[a-zA-Z]:/.test(fileName)) {
    throw new Error(`The archive contains an unsafe path: ${fileName}`);
  }
  return parts;
}

export interface DownloadAntigravityOptions {
  runtimeDirectory: string;
  termsAccepted: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: number) => void;
}

/**
 * Downloads Google's Antigravity ACP server for this computer, verifies the pinned SHA-256 and
 * unpacks it. Returns the path of agy_acp_server. Does nothing when that version is already there.
 */
export async function downloadAntigravity(options: DownloadAntigravityOptions): Promise<string> {
  if (!options.termsAccepted) {
    throw new Error(
      `You must accept Google Antigravity's terms (${ANTIGRAVITY_TERMS_URL}) before downloading.`,
    );
  }
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const key = `${platform}-${arch}`;
  const pin = ANTIGRAVITY_PINS[key];
  if (!pin) throw new Error(`Google Antigravity is not available for ${key}.`);

  const targetDir = join(options.runtimeDirectory, "antigravity", ANTIGRAVITY_VERSION);
  const executablePath = join(targetDir, pin.executableName);
  if (existsSync(executablePath)) return executablePath;

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(pin.url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download Google Antigravity (${response.status}).`);
  }
  const total = Number(response.headers.get("content-length")) || 0;
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let received = 0;
  let lastProgress = -1;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    hash.update(chunk);
    received += chunk.length;
    const progress = total ? Math.min(99, Math.floor((received / total) * 100)) : null;
    if (progress !== null && progress !== lastProgress) {
      lastProgress = progress;
      options.onProgress?.(progress);
    }
  }
  const buffer = Buffer.concat(chunks);
  if (hash.digest("hex") !== pin.sha256) {
    throw new Error(
      "The Google Antigravity download did not match its checksum (SHA-256 mismatch). Check your connection and try again.",
    );
  }

  const work = `${targetDir}.download-${Date.now()}`;
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    await unzipBuffer(buffer, work);
    if (!existsSync(join(work, pin.executableName))) {
      throw new Error(`the archive does not contain ${pin.executableName}`);
    }
    await mkdir(join(targetDir, ".."), { recursive: true });
    await rm(targetDir, { recursive: true, force: true });
    await rename(work, targetDir);
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(
      `Could not unpack Google Antigravity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  options.onProgress?.(100);
  return executablePath;
}
