#!/usr/bin/env node
// Prints completed installer downloads from GitHub Releases (GitHub's own download_count), per
// release and in total. These count finished file downloads from github.com, which include the
// website's download buttons, the README, winget/Scoop installs and the in-app updater; they are
// not installs and not active users. Button clicks on the website are counted separately by
// website/assets/download-notify.js.
//
//   node scripts/download-stats.mjs            table for people
//   node scripts/download-stats.mjs --json     one JSON object (for a dashboard or a saved snapshot)

const REPO = process.env.GITHUB_REPOSITORY || "ganguydhrubo/sahakarmi";
const headers = { accept: "application/vnd.github+json", "user-agent": "sahkarmi-stats" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releases = [];
for (let page = 1; page < 20; page += 1) {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`,
    { headers },
  );
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const batch = await response.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}

// The updater downloads the .blockmap and latest.yml on every check and the installer on update;
// the installer count is the closest thing to "people who got this version".
const rows = releases
  .filter((release) => !release.draft)
  .map((release) => {
    const count = (pattern) =>
      release.assets
        .filter((asset) => pattern.test(asset.name))
        .reduce((sum, asset) => sum + asset.download_count, 0);
    return {
      tag: release.tag_name,
      published: (release.published_at ?? "").slice(0, 10),
      installer: count(/-x64\.exe$/i),
      updateChecks: count(/^latest\.yml$/i),
    };
  });

const summary = {
  repo: REPO,
  takenAt: new Date().toISOString(),
  releases: rows.length,
  installerDownloads: rows.reduce((sum, row) => sum + row.installer, 0),
  rows,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `${REPO} — ${summary.installerDownloads} installer downloads over ${rows.length} releases`,
  );
  console.log("release     published   installer  latest.yml");
  for (const row of rows) {
    console.log(
      `${row.tag.padEnd(11)} ${row.published.padEnd(11)} ${String(row.installer).padStart(9)}  ${String(row.updateChecks).padStart(10)}`,
    );
  }
}
