#!/usr/bin/env node
/**
 * Upstream Radar Checker for Sahkarmi.
 * Queries GitHub APIs for nightly-labs/openbot and r2hu1/openbots,
 * comparing latest releases against docs/upstream/RADAR.md.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADAR_PATH = resolve(__dirname, "../docs/upstream/RADAR.md");

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Sahkarmi-Upstream-Watcher",
      Accept: "application/vnd.github.v3+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function checkUpstream() {
  console.log("🔍 Checking upstream OpenBot & OpenBots repositories...");

  let openbotRelease = null;
  let openbotsCommit = null;

  try {
    openbotRelease = await fetchJson(
      "https://api.github.com/repos/nightly-labs/openbot/releases/latest"
    );
    console.log(`✅ nightly-labs/openbot latest release: ${openbotRelease.tag_name} (${openbotRelease.published_at})`);
  } catch (err) {
    console.warn(`⚠️ Failed to fetch nightly-labs/openbot release: ${err.message}`);
  }

  try {
    const commits = await fetchJson(
      "https://api.github.com/repos/r2hu1/openbots/commits?per_page=1"
    );
    openbotsCommit = commits[0];
    console.log(
      `✅ r2hu1/openbots latest commit: ${openbotsCommit?.sha?.slice(0, 7)} - "${openbotsCommit?.commit?.message?.split("\n")[0]}"`
    );
  } catch (err) {
    console.warn(`⚠️ Failed to fetch r2hu1/openbots commits: ${err.message}`);
  }

  const timestamp = new Date().toISOString();
  let logEntry = `\n### Check on ${timestamp.slice(0, 10)}\n`;
  if (openbotRelease) {
    logEntry += `- **nightly-labs/openbot**: Latest release [${openbotRelease.tag_name}](${openbotRelease.html_url}) (published ${openbotRelease.published_at.slice(0, 10)}).\n`;
  }
  if (openbotsCommit) {
    logEntry += `- **r2hu1/openbots**: Latest commit \`${openbotsCommit.sha.slice(0, 7)}\` ("${openbotsCommit.commit.message.split("\n")[0]}").\n`;
  }

  try {
    let radarContent = readFileSync(RADAR_PATH, "utf-8");
    if (!radarContent.includes(`Check on ${timestamp.slice(0, 10)}`)) {
      radarContent += logEntry;
      writeFileSync(RADAR_PATH, radarContent, "utf-8");
      console.log("📝 Updated docs/upstream/RADAR.md with latest findings.");
    }
  } catch (err) {
    console.warn(`Could not update RADAR.md: ${err.message}`);
  }

  console.log("🎉 Upstream radar check completed.");
}

checkUpstream().catch((err) => {
  console.error("Upstream radar check failed:", err);
  process.exit(1);
});
