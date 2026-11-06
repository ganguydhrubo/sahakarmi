// Pure helpers for refresh-windows-update-metadata.ts, kept separate so they can be unit tested.

export interface InstallerDigest {
  /** Installer file name as it appears in latest.yml (`url:` and `path:`). */
  fileName: string;
  /** Base64 SHA-512 of the installer bytes, the form electron-updater checks. */
  sha512: string;
  size: number;
}

/**
 * Rewrites electron-builder's latest.yml for a single-installer Windows release so it describes
 * the installer as it is now (for example after Authenticode signing changed its bytes).
 * electron-updater rejects a download whose sha512 doesn't match, so stale values would break
 * every update.
 */
export function rewriteLatestYml(text: string, digest: InstallerDigest): string {
  const urls = [...text.matchAll(/^\s*-\s*url:\s*(.+?)\s*$/gm)].map((match) => unquote(match[1]));
  if (urls.length !== 1) {
    throw new Error(`Expected exactly one file in latest.yml, found ${urls.length}.`);
  }
  if (urls[0] !== digest.fileName) {
    throw new Error(`latest.yml describes ${urls[0]}, not ${digest.fileName}.`);
  }
  const shaLines = text.match(/^(\s*)sha512:.*$/gm) ?? [];
  if (shaLines.length === 0) throw new Error("latest.yml has no sha512 entry.");
  if (!/^\s*size:\s*\d+\s*$/m.test(text)) throw new Error("latest.yml has no size entry.");
  return text
    .replace(/^(\s*)sha512:.*$/gm, (_line, indent: string) => `${indent}sha512: ${digest.sha512}`)
    .replace(/^(\s*)size:\s*\d+\s*$/gm, (_line, indent: string) => `${indent}size: ${digest.size}`);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
