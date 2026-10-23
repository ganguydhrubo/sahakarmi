import { createHash } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

export const ANTIGRAVITY_VERSION = "1.0.0";
export const ANTIGRAVITY_TERMS_URL = "https://antigravity.google/terms";

export interface AntigravityPlatformPin {
  url: string;
  sha256: string;
  executableName: string;
}

export const ANTIGRAVITY_PINS: Record<string, AntigravityPlatformPin> = {
  "win32-x64": {
    url: `https://storage.googleapis.com/antigravity-releases/v${ANTIGRAVITY_VERSION}/antigravity-win32-x64.zip`,
    sha256: "5f5b7d0328df17c128b2be338d4567b0d24e56ace8196e88794fec37d1372554",
    executableName: "agy_acp_server.exe",
  },
  "darwin-arm64": {
    url: `https://storage.googleapis.com/antigravity-releases/v${ANTIGRAVITY_VERSION}/antigravity-darwin-arm64.zip`,
    sha256: "c1869fbf7d86f7b1e4fa8e98da87c10b4c7be49635df0deeb016f6b21652f190",
    executableName: "agy_acp_server",
  },
  "linux-x64": {
    url: `https://storage.googleapis.com/antigravity-releases/v${ANTIGRAVITY_VERSION}/antigravity-linux-x64.zip`,
    sha256: "9c3c06eef148f3fb4ee7fc7ad8bb0e0ad3d1689369de1a882d9fe2cdb148c903",
    executableName: "agy_acp_server",
  },
};

/**
 * Extracts a ZIP archive buffer into target directory using node:zlib inflateRaw.
 */
export async function unzipBuffer(buffer: Buffer, targetDir: string): Promise<string[]> {
  const extractedFiles: string[] = [];
  let offset = 0;

  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // End of local files / start of central directory

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameStart + fileNameLength);

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    const filePath = join(targetDir, fileName);
    if (fileName.endsWith("/") || fileName.endsWith("\\")) {
      await mkdir(filePath, { recursive: true });
    } else {
      await mkdir(join(filePath, ".."), { recursive: true });
      let fileData: Buffer;
      if (compressionMethod === 0) {
        fileData = Buffer.from(compressedData);
      } else if (compressionMethod === 8) {
        fileData = inflateRawSync(compressedData);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }
      await writeFile(filePath, fileData);
      if (process.platform !== "win32") {
        chmodSync(filePath, 0o755);
      }
      extractedFiles.push(filePath);
    }

    offset = dataStart + compressedSize;
  }

  return extractedFiles;
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
 * Downloads and verifies Google Antigravity binary with pinned SHA-256 and Terms check.
 */
export async function downloadAntigravity(options: DownloadAntigravityOptions): Promise<string> {
  if (!options.termsAccepted) {
    throw new Error(
      `You must accept Google Antigravity Terms of Service (${ANTIGRAVITY_TERMS_URL}) before downloading.`,
    );
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const key = `${platform}-${arch}`;
  const pin = ANTIGRAVITY_PINS[key];

  if (!pin) {
    throw new Error(`Google Antigravity is not supported on ${key}.`);
  }

  const targetDir = join(options.runtimeDirectory, "antigravity", ANTIGRAVITY_VERSION);
  const executablePath = join(targetDir, pin.executableName);

  if (existsSync(executablePath)) {
    return executablePath;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(pin.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Google Antigravity (${response.status} ${response.statusText})`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const calculatedHash = createHash("sha256").update(buffer).digest("hex");
  if (calculatedHash !== pin.sha256) {
    throw new Error(
      `Google Antigravity download verification failed: SHA-256 mismatch (expected ${pin.sha256}, got ${calculatedHash}).`,
    );
  }

  await mkdir(targetDir, { recursive: true });
  try {
    await unzipBuffer(buffer, targetDir);
  } catch (err) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to unpack Google Antigravity archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return executablePath;
}
