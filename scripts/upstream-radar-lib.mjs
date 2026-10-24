/**
 * Pure helpers for the Upstream Radar (scripts/check-upstream.mjs): licence classification,
 * release-note analysis and report/mail rendering. No network, no filesystem, so they can be
 * exercised with `node scripts/check-upstream.mjs --self-test`.
 */

/** owner/repo of the watched project and its display name, both from repository secrets. */
export const UPSTREAM_REPO = process.env.UPSTREAM_REPO?.trim() || "";
export const UPSTREAM_NAME = process.env.UPSTREAM_NAME?.trim() || "Upstream";

/** What we may do with an upstream revision, decided from its own licence text. */
export const LICENCE_VERDICTS = {
  "apache-2.0": {
    code: "apache-2.0",
    label: "Apache-2.0",
    syncPermitted: true,
    note: "Source may be ported into Sahkarmi with attribution (NOTICE) — review each change first.",
  },
  "polyform-nc": {
    code: "polyform-nc",
    label: "PolyForm Noncommercial 1.0.0",
    syncPermitted: false,
    note: "Noncommercial only. Do NOT copy, merge, rebrand or redistribute this code in Sahkarmi. Facts from the release notes may guide an independent (clean-room) implementation.",
  },
  unknown: {
    code: "unknown",
    label: "Unknown / unclear",
    syncPermitted: false,
    note: "Licence could not be classified. Treat as restricted until a human has read it.",
  },
};

/** Classifies a LICENSE file and/or package.json "license" field. */
export function classifyLicence(licenseText, packageLicense) {
  const text = `${licenseText ?? ""}\n${packageLicense ?? ""}`.toLowerCase();
  if (/polyform[\s-]*noncommercial/.test(text)) return LICENCE_VERDICTS["polyform-nc"];
  if (/apache license\s*version 2\.0|apache-2\.0/.test(text)) return LICENCE_VERDICTS["apache-2.0"];
  return LICENCE_VERDICTS.unknown;
}

/** Lines that touch the Windows build Sahkarmi ships (installer, signing, Windows-only fixes). */
const WINDOWS_PATTERN =
  /\b(windows|win32|winget|nsis|msi|\.exe|defender|smart app control|powershell|cmd\.exe|%appdata%|registry|taskbar|wsl)\b/i;

export function windowsRelevant(bullets) {
  return bullets.filter((line) => WINDOWS_PATTERN.test(line));
}

/** Signals that make a release worth reading today rather than this week. */
const CRITICAL_RULES = [
  {
    flag: "security",
    pattern: /\b(security|vulnerab|cve-|secret|token leak|xss|rce|sandbox escape)/i,
  },
  { flag: "licence", pattern: /\b(licen[cs]e|polyform|apache|commercial)\b/i },
  {
    flag: "provider",
    pattern: /\b(codex|claude|antigravity|gemini|opencode|provider cli|acp)\b/i,
  },
  {
    flag: "updater",
    pattern: /\b(auto-?updat|electron-updater|latest\.yml|installer|code-?sign)/i,
  },
  { flag: "platform", pattern: /\b(electron \d|electron to|bun \d|bun to|chromium|node \d{2})/i },
  { flag: "data", pattern: /\b(data loss|corrupt|migration|wipe|delete.*(data|history))/i },
  { flag: "breaking", pattern: /\b(breaking|incompatib|removed support|no longer supports)\b/i },
  { flag: "windows", pattern: WINDOWS_PATTERN },
];

export function criticalFlags(body) {
  const text = body ?? "";
  return CRITICAL_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.flag);
}

/** Bullet lines of a GitHub release body, without PR links, hashes and contributor noise. */
export function releaseBullets(body) {
  return (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*] /.test(line))
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/\s+by @\S+/g, "")
        .replace(/\s+in https?:\/\/\S+/g, "")
        .replace(/\(\[?`?[0-9a-f]{7,40}`?\]?\([^)]*\)\)/g, "")
        .replace(/\(#\d+\)/g, "")
        .trim(),
    )
    .filter(
      (line) =>
        line &&
        !/made their first contribution|full changelog|^prepare |^release: prepare|^chore\(release\)/i.test(
          line,
        ),
    );
}

/** Bullets that read like user-facing features (not refactors, CI, docs, mobile-only, hosted). */
export function featureCandidates(bullets) {
  const skip =
    /\b(ci|storybook|refactor|lint|typecheck|knip|biome|test[s]?\b|docs?\b|readme|workflow|release|mobile app|ios|android|iphone|hosted server|boat|signal|stripe|billing|checkout|nix|docker|website|landing|hero|norbiai|cla\b|contributor)/i;
  return bullets.filter((line) => !skip.test(line)).slice(0, 40);
}

/** Version bumps of third-party tools Sahkarmi also ships or depends on. */
export function sharedDependencyBumps(bullets) {
  const shared =
    /\b(electron|bun|electron-updater|opencode|codex|claude code|antigravity|vite|solid)\b/i;
  return bullets.filter((line) => shared.test(line) && /\b\d+\.\d+(\.\d+)?\b/.test(line));
}

export function analyzeRelease(release) {
  const bullets = releaseBullets(release.body);
  return {
    tag: release.tag_name,
    name: release.name || release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
    bullets,
    candidates: featureCandidates(bullets),
    dependencyBumps: sharedDependencyBumps(bullets),
    windows: windowsRelevant(bullets),
    flags: criticalFlags(release.body),
  };
}

export function isCritical(analysis) {
  return analysis.flags.length > 0;
}

function list(items, empty = "_none_") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

/** Markdown report saved under docs/upstream/reports/<tag>.md and used as the issue body. */
export function renderReport({ analysis, licence, previousTag, sahkarmiVersion, issueUrl }) {
  const critical = isCritical(analysis);
  return `# Upstream ${UPSTREAM_NAME} ${analysis.tag}

| | |
| --- | --- |
| Previous processed revision | ${previousTag ?? "_none_"} |
| New revision | [${analysis.tag}](${analysis.url}) · published ${analysis.publishedAt?.slice(0, 10) ?? "?"} |
| Sahkarmi version at check | ${sahkarmiVersion} |
| Licence of this revision | **${licence.label}** — ${licence.syncPermitted ? "source port permitted (with attribution)" : "SOURCE SYNC BLOCKED"} |
| Priority | ${critical ? `**CRITICAL** (${analysis.flags.join(", ")})` : "info"} |
${issueUrl ? `| Tracking issue | ${issueUrl} |\n` : ""}
## Licence verdict

${licence.note}

## Changes excluded from automatic sync

All source changes of this revision (${licence.syncPermitted ? "pending human review" : "licence does not permit it"}).

## Feature candidates (names only — implement independently, from the description)

${list(analysis.candidates)}

## Windows-relevant changes (installer, signing, Windows-only fixes)

${list(analysis.windows, "_nothing Windows-specific in this release_")}

## Shared third-party dependency signals

${list(analysis.dependencyBumps, "_no shared dependency bumps mentioned_")}

## All release-note lines

${list(analysis.bullets, "_the release has no notes_")}

## Next step for a maintainer

1. Read the candidates above; pick what Sahkarmi's users need.
2. Implement from scratch in Sahkarmi (never from upstream source), with tests.
3. \`bun run release:patch\`, push main, push the tag → release.yml publishes; installed apps auto-update.
`;
}

/** Plain-text + HTML for the notification mail. */
export function renderMail({ analysis, licence, previousTag, issueUrl, reportUrl }) {
  const critical = isCritical(analysis);
  const subject = `[Sahkarmi upstream] ${UPSTREAM_NAME} ${analysis.tag} — ${critical ? `CRITICAL: ${analysis.flags.join(", ")}` : "info"}`;
  const lines = [
    `${UPSTREAM_NAME} published ${analysis.tag} (${analysis.publishedAt?.slice(0, 10) ?? "?"}).`,
    `Previous processed: ${previousTag ?? "none"}.`,
    `Licence: ${licence.label} — ${licence.syncPermitted ? "port permitted with attribution" : "source sync BLOCKED; clean-room only"}.`,
    critical ? `Why critical: ${analysis.flags.join(", ")}.` : "No critical signals.",
    "",
    "Feature candidates:",
    ...(analysis.candidates.length ? analysis.candidates.map((c) => `  • ${c}`) : ["  (none)"]),
    "",
    `Windows-relevant changes (${analysis.windows.length}):`,
    ...(analysis.windows.length
      ? analysis.windows.map((c) => `  • ${c}`)
      : ["  (nothing Windows-specific in this release)"]),
    "",
    analysis.dependencyBumps.length
      ? `Shared dependency signals:\n${analysis.dependencyBumps.map((c) => `  • ${c}`).join("\n")}\n`
      : "",
    `All release notes (${analysis.bullets.length} lines):`,
    ...(analysis.bullets.length
      ? analysis.bullets.map((c) => `  • ${c}`)
      : ["  (the release has no notes)"]),
    "",
    `Release: ${analysis.url}`,
    issueUrl ? `Tracking issue: ${issueUrl}` : "",
    reportUrl ? `Report: ${reportUrl}` : "",
  ].filter((line) => line !== "");
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">
<h2 style="margin:0 0 8px">${escapeHtml(UPSTREAM_NAME)} ${escapeHtml(analysis.tag)} ${critical ? '<span style="color:#b00020">CRITICAL</span>' : '<span style="color:#555">info</span>'}</h2>
<p>${escapeHtml(lines[0])}<br>${escapeHtml(lines[1])}<br><b>${escapeHtml(lines[2])}</b><br>${escapeHtml(lines[3])}</p>
<p><b>Feature candidates</b></p>
<ul>${analysis.candidates.length ? analysis.candidates.map((c) => `<li>${escapeHtml(c)}</li>`).join("") : "<li>(none)</li>"}</ul>
<p><b>Windows-relevant changes (${analysis.windows.length})</b></p>
<ul>${analysis.windows.length ? analysis.windows.map((c) => `<li>${escapeHtml(c)}</li>`).join("") : "<li>(nothing Windows-specific in this release)</li>"}</ul>
${analysis.dependencyBumps.length ? `<p><b>Shared dependency signals</b></p><ul>${analysis.dependencyBumps.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
<p><b>All release notes (${analysis.bullets.length} lines)</b></p>
<ul>${analysis.bullets.length ? analysis.bullets.map((c) => `<li>${escapeHtml(c)}</li>`).join("") : "<li>(the release has no notes)</li>"}</ul>
<p><a href="${escapeHtml(analysis.url)}">Release notes</a>${issueUrl ? ` · <a href="${escapeHtml(issueUrl)}">Tracking issue</a>` : ""}${reportUrl ? ` · <a href="${escapeHtml(reportUrl)}">Report</a>` : ""}</p>
<p style="color:#777;font-size:12px">Sent by the Sahkarmi Upstream Radar. No upstream code is copied: the project is ${escapeHtml(licence.label)}.</p>
</div>`;
  return { subject, text: lines.join("\n"), html };
}

/** Compares "v1.2.3" tags numerically; non-semver tags sort last. */
export function compareTags(left, right) {
  const parse = (tag) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag ?? "");
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/** Only real version tags of the desktop app; runtime blobs and prereleases are skipped. */
export function isDesktopReleaseTag(tag) {
  return /^v\d+\.\d+\.\d+$/.test(tag ?? "");
}
