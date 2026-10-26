#!/usr/bin/env node
// Puts the download-click mail relay URL (repository variable DOWNLOAD_NOTIFY_URL, a Google Apps
// Script /exec URL; see deploy/apps-script/download-notify/Code.gs) into the website's
// <meta name="sahkarmi-download-notify">. Without the variable the meta stays empty and
// website/assets/download-notify.js sends nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = (process.env.DOWNLOAD_NOTIFY_URL || "").trim();
if (!url) {
  console.log("DOWNLOAD_NOTIFY_URL not set; download click mail stays off.");
  process.exit(0);
}
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
  console.warn("::warning::DOWNLOAD_NOTIFY_URL is not an Apps Script /exec URL; leaving it off.");
  process.exit(0);
}
const site = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
for (const name of ["index.html", "install.html"]) {
  const target = join(site, name);
  const html = readFileSync(target, "utf8");
  const next = html.replace(
    /<meta name="sahkarmi-download-notify" content="[^"]*" \/>/,
    `<meta name="sahkarmi-download-notify" content="${url}" />`,
  );
  if (next === html && !html.includes(url)) throw new Error(`notify meta missing in ${name}`);
  writeFileSync(target, next);
}
console.log("Download click mail turned on.");
