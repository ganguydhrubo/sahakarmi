#!/usr/bin/env node
// Bakes direct installer links into website/index.html at deploy time, so every download
// button starts the download immediately instead of opening the GitHub Releases page.
//
// For each platform it uses the newest release that actually has that installer attached,
// so links stay valid while a new release is still building. Runs in GitHub Actions with
// GITHUB_TOKEN (no visitor-side API calls or rate limits). If GitHub cannot be reached the
// page keeps its Releases-page fallback and the deploy continues.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.GITHUB_REPOSITORY || "ganguydhrubo/sahakarmi";
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "website", "index.html");
const PATTERNS = { win: /-x64\.exe$/i, mac: /-arm64\.dmg$/i, linux: /\.AppImage$/i };

async function releases() {
  const headers = { accept: "application/vnd.github+json", "user-agent": "sahkarmi-site" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, {
    headers,
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return (await response.json()).filter((release) => !release.draft && !release.prerelease);
}

function pick(list) {
  const found = {};
  for (const [platform, pattern] of Object.entries(PATTERNS)) {
    for (const release of list) {
      const asset = release.assets.find((candidate) => pattern.test(candidate.name));
      if (asset) {
        found[platform] = {
          url: asset.browser_download_url,
          tag: release.tag_name,
          size: asset.size,
        };
        break;
      }
    }
  }
  return found;
}

/** Replaces the href of every <a> carrying one of the given attributes. */
function setHref(html, attribute, url) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(<a\\b[^>]*\\s${escaped}(?=[\\s>])[^>]*\\shref=")[^"]*(")`, "g");
  const found = pattern.test(html);
  pattern.lastIndex = 0;
  return { html: html.replace(pattern, `$1${url}$2`), changed: found };
}

let list;
try {
  list = await releases();
} catch (error) {
  console.warn(
    `::warning::Download links not updated (${error.message}); keeping the Releases-page fallback.`,
  );
  process.exit(0);
}
const files = pick(list);
if (!files.win) {
  console.warn("::warning::No Windows installer found in recent releases; keeping the fallback.");
  process.exit(0);
}

let html = readFileSync(file, "utf8");
const apply = (attribute, url) => {
  const result = setHref(html, attribute, url);
  html = result.html;
  if (!result.changed) throw new Error(`No link with ${attribute} found in index.html`);
};
apply("data-download", files.win.url);
for (const [platform, asset] of Object.entries(files)) {
  apply(`data-platform="${platform}"`, asset.url);
  apply(`data-platform-tile="${platform}"`, asset.url);
}
writeFileSync(file, html);
for (const [platform, asset] of Object.entries(files)) {
  console.log(`${platform.padEnd(6)} ${asset.tag}  ${asset.url}`);
}
