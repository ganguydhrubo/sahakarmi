#!/usr/bin/env node
/**
 * Upstream Radar v2 for Sahkarmi.
 *
 * Watches the upstream project (repository secret UPSTREAM_REPO, display name UPSTREAM_NAME) for
 * new desktop releases, classifies each one's licence and mails the owner a full report through
 * the Apps Script relay. Nothing under src/ is ever touched and no upstream source is copied.
 * Reports are not stored in this public repository; only docs/upstream/state.json (tags already
 * processed) is committed. See docs/UPSTREAM-SYNC.md.
 *
 *   node scripts/check-upstream.mjs                 # normal run
 *   node scripts/check-upstream.mjs --dry-run       # analyse and print, change nothing
 *   node scripts/check-upstream.mjs --init          # record the current latest tag as processed
 *   node scripts/check-upstream.mjs --self-test     # exercise the pure helpers, no network
 *   node scripts/check-upstream.mjs --test-mail     # send one sample mail through the relay
 *
 * Env: UPSTREAM_REPO (required except --self-test), UPSTREAM_NAME, GITHUB_TOKEN,
 *      UPSTREAM_MAIL_URL, UPSTREAM_MAIL_TOKEN, UPSTREAM_MAX_RELEASES (default 5),
 *      UPSTREAM_OPEN_ISSUES ("true" to also open a tracking issue; off by default because
 *      issues in this repository are public).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeRelease,
  classifyLicence,
  compareTags,
  criticalFlags,
  featureCandidates,
  isCritical,
  isDesktopReleaseTag,
  LICENCE_VERDICTS,
  releaseBullets,
  renderMail,
  renderReport,
  UPSTREAM_NAME,
  UPSTREAM_REPO,
} from "./upstream-radar-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const UPSTREAM_DIR = resolve(ROOT, "docs/upstream");
const STATE_PATH = resolve(UPSTREAM_DIR, "state.json");
const SAHKARMI_REPO = process.env.GITHUB_REPOSITORY || "ganguydhrubo/sahakarmi";
const MAX_RELEASES = Number(process.env.UPSTREAM_MAX_RELEASES || 5);
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const log = (message) => console.log(`[radar] ${message}`);

// ---------------------------------------------------------------------------------------------
// GitHub API with retries (rate limits and transient failures must never advance the state).

async function githubJson(path, { method = "GET", body } = {}) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "User-Agent": "Sahkarmi-Upstream-Radar/2",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.ok) return response.json();
      const retryable =
        response.status === 403 || response.status === 429 || response.status >= 500;
      const text = await response.text().catch(() => "");
      lastError = new Error(`GitHub ${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
      if (!retryable || attempt === 3) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    }
    const wait = 2_000 * 2 ** attempt;
    log(`retrying in ${wait / 1000}s: ${lastError?.message ?? "network error"}`);
    await new Promise((done) => setTimeout(done, wait));
  }
  throw lastError ?? new Error("unreachable");
}

async function githubFileText(repo, path, ref) {
  try {
    const data = await githubJson(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return data?.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
  } catch (error) {
    if (/→ 404/.test(String(error.message))) return "";
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// State

function readState() {
  if (!existsSync(STATE_PATH)) {
    return {
      version: 1,
      lastProcessedTag: null,
      processed: {},
      pendingMail: [],
    };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  if (dryRun) return;
  mkdirSync(UPSTREAM_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function sahkarmiVersion() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version ?? "?";
  } catch {
    return "?";
  }
}

// ---------------------------------------------------------------------------------------------
// Mail relay (Google Apps Script web app in the owner's Google account)

async function sendMail(mail) {
  const url = process.env.UPSTREAM_MAIL_URL;
  const token = process.env.UPSTREAM_MAIL_TOKEN;
  if (!url || !token) throw new Error("UPSTREAM_MAIL_URL / UPSTREAM_MAIL_TOKEN are not set");
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, subject: mail.subject, text: mail.text, html: mail.html }),
  });
  const body = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Apps Script answers JSON; anything else is an error page.
  }
  if (!response.ok || !parsed?.ok) {
    throw new Error(`mail relay refused: ${response.status} ${body.slice(0, 200)}`);
  }
  return parsed;
}

/** Where the relay sent a mail. It names the inbox only partly, because these logs are public. */
function sentToNote(reply) {
  return typeof reply?.sentTo === "string" && reply.sentTo
    ? `to ${reply.sentTo}`
    : "to the relay's MAIL_TO";
}

// ---------------------------------------------------------------------------------------------
// Processing one release

async function licenceOf(tag) {
  const [licenseText, packageJson] = await Promise.all([
    githubFileText(UPSTREAM_REPO, "LICENSE", tag),
    githubFileText(UPSTREAM_REPO, "package.json", tag),
  ]);
  let packageLicense = "";
  try {
    packageLicense = JSON.parse(packageJson || "{}").license ?? "";
  } catch {
    packageLicense = "";
  }
  return classifyLicence(licenseText, packageLicense);
}

async function processRelease(release, state) {
  const analysis = analyzeRelease(release);
  const previousTag = state.lastProcessedTag;
  const licence = await licenceOf(analysis.tag);
  const reportUrl = null;

  log(
    `${analysis.tag}: licence ${licence.code}, ${analysis.bullets.length} notes, ${analysis.candidates.length} candidates, ${
      isCritical(analysis) ? `CRITICAL (${analysis.flags.join(", ")})` : "info"
    }`,
  );

  // 1. Tracking issue (once; a re-run finds the existing one by title).
  let issueUrl = null;
  if (!dryRun && process.env.GITHUB_TOKEN && process.env.UPSTREAM_OPEN_ISSUES === "true") {
    const title = `Upstream ${analysis.tag}: ${isCritical(analysis) ? "CRITICAL" : "review"} — licence ${licence.label}`;
    const existing = await githubJson(
      `/search/issues?q=${encodeURIComponent(`repo:${SAHKARMI_REPO} in:title "Upstream ${analysis.tag}:"`)}`,
    ).catch(() => null);
    const found = existing?.items?.find((item) =>
      item.title.startsWith(`Upstream ${analysis.tag}:`),
    );
    if (found) {
      issueUrl = found.html_url;
    } else {
      const labels = ["upstream-parity", licence.syncPermitted ? "sync-permitted" : "sync-blocked"];
      if (isCritical(analysis)) labels.push("critical");
      const created = await githubJson(`/repos/${SAHKARMI_REPO}/issues`, {
        method: "POST",
        body: {
          title,
          labels,
          body: renderReport({
            analysis,
            licence,
            previousTag,
            sahkarmiVersion: sahkarmiVersion(),
          }),
        },
      });
      issueUrl = created.html_url;
    }
  }

  // 2. The report itself travels only by mail (this repository is public).
  if (dryRun) {
    console.log(
      renderReport({
        analysis,
        licence,
        previousTag,
        sahkarmiVersion: sahkarmiVersion(),
        issueUrl,
      }),
    );
  }

  // 3. State advances now. Mail is best-effort with retry on the next run.
  state.processed[analysis.tag] = {
    at: new Date().toISOString(),
    licence: licence.code,
    critical: isCritical(analysis),
    issueUrl,
  };
  state.lastProcessedTag = analysis.tag;
  state.pendingMail = state.pendingMail.filter((tag) => tag !== analysis.tag);
  state.pendingMail.push(analysis.tag);
  writeState(state);

  const mail = renderMail({ analysis, licence, previousTag, issueUrl, reportUrl });
  if (dryRun) {
    log(`would mail: ${mail.subject}`);
    return;
  }
  try {
    const reply = await sendMail(mail);
    state.pendingMail = state.pendingMail.filter((tag) => tag !== analysis.tag);
    writeState(state);
    log(`mailed ${sentToNote(reply)}: ${mail.subject}`);
  } catch (error) {
    log(`MAIL NOT SENT (will retry next run): ${error.message}`);
  }
}

async function retryPendingMail(state, releasesByTag) {
  for (const tag of [...state.pendingMail]) {
    const release =
      releasesByTag.get(tag) ??
      (await githubJson(`/repos/${UPSTREAM_REPO}/releases/tags/${tag}`).catch(() => null));
    if (!release) continue;
    const analysis = analyzeRelease(release);
    const entry = state.processed[tag];
    const licence =
      Object.values(LICENCE_VERDICTS).find((verdict) => verdict.code === entry?.licence) ??
      LICENCE_VERDICTS.unknown;
    const mail = renderMail({
      analysis,
      licence,
      previousTag: null,
      issueUrl: entry?.issueUrl ?? null,
      reportUrl: null,
    });
    try {
      const reply = await sendMail(mail);
      state.pendingMail = state.pendingMail.filter((item) => item !== tag);
      writeState(state);
      log(`mailed (retry) ${sentToNote(reply)}: ${mail.subject}`);
    } catch (error) {
      log(`MAIL STILL NOT SENT for ${tag}: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Main

async function listNewReleases(state) {
  const releases = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubJson(`/repos/${UPSTREAM_REPO}/releases?per_page=50&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    releases.push(...batch);
    if (state.lastProcessedTag && batch.some((r) => r.tag_name === state.lastProcessedTag)) break;
  }
  return releases
    .filter((r) => isDesktopReleaseTag(r.tag_name) && !r.draft && !r.prerelease)
    .filter((r) => !state.processed[r.tag_name])
    .filter((r) => !state.lastProcessedTag || compareTags(r.tag_name, state.lastProcessedTag) > 0)
    .sort((a, b) => compareTags(a.tag_name, b.tag_name));
}

async function main() {
  if (args.has("--self-test")) return selfTest();
  if (!UPSTREAM_REPO) throw new Error("UPSTREAM_REPO is not set (repository secret).");
  if (args.has("--test-mail")) {
    const sample = {
      tag_name: "v0.0.0-test",
      name: "Radar test",
      html_url: `https://github.com/${UPSTREAM_REPO}/releases`,
      published_at: new Date().toISOString(),
      body: "- Test mail from the Sahkarmi Upstream Radar (relay check)\n- Nothing to act on",
    };
    const analysis = analyzeRelease(sample);
    const mail = renderMail({
      analysis,
      licence: LICENCE_VERDICTS["polyform-nc"],
      previousTag: "none",
      issueUrl: null,
      reportUrl: null,
    });
    const reply = await sendMail(mail);
    log(`test mail sent ${sentToNote(reply)}: ${mail.subject}`);
    return;
  }

  const state = readState();
  const latest = await githubJson(`/repos/${UPSTREAM_REPO}/releases/latest`);
  log(
    `upstream latest: ${latest.tag_name} (${latest.published_at?.slice(0, 10)}); last processed: ${state.lastProcessedTag ?? "none"}`,
  );

  if (args.has("--init")) {
    state.lastProcessedTag = latest.tag_name;
    state.processed[latest.tag_name] = {
      at: new Date().toISOString(),
      licence: "init",
      critical: false,
      issueUrl: null,
    };
    writeState(state);
    log(`state initialised at ${latest.tag_name}; the next release will be reported`);
    return;
  }

  const fresh = await listNewReleases(state);
  if (fresh.length === 0) log("no new desktop release");
  const releasesByTag = new Map(fresh.map((r) => [r.tag_name, r]));
  for (const release of fresh.slice(0, MAX_RELEASES)) {
    await processRelease(release, state);
  }
  if (fresh.length > MAX_RELEASES) {
    log(`${fresh.length - MAX_RELEASES} more releases wait for the next run`);
  }
  if (!dryRun && state.pendingMail.length) await retryPendingMail(state, releasesByTag);
  log("done");
}

function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`);
  };
  assert(
    classifyLicence("# PolyForm Noncommercial License 1.0.0", "").code === "polyform-nc",
    "polyform",
  );
  assert(
    classifyLicence("Apache License\nVersion 2.0, January 2004", "").code === "apache-2.0",
    "apache",
  );
  assert(
    classifyLicence("", "PolyForm-Noncommercial-1.0.0").code === "polyform-nc",
    "package licence",
  );
  assert(classifyLicence("", "").code === "unknown", "unknown");
  const body =
    "## What's Changed\n* Fail over to the next backup model on Codex errors by @x in https://github.com/a/b/pull/1\n* Update Electron to 44.7.0 for V8 fixes\n* Add a CLA check\n* Prepare v0.48.2\n## New Contributors\n* @y made their first contribution";
  const bullets = releaseBullets(body);
  assert(
    bullets.length === 3 && bullets[0] === "Fail over to the next backup model on Codex errors",
    `bullets ${JSON.stringify(bullets)}`,
  );
  assert(featureCandidates(bullets).length === 2, "candidates drop CI/CLA lines");
  assert(
    criticalFlags(body).includes("platform") && criticalFlags(body).includes("provider"),
    "flags",
  );
  assert(
    compareTags("v0.49.0", "v0.48.2") > 0 && compareTags("v0.9.9", "v0.10.0") < 0,
    "compareTags",
  );
  assert(
    isDesktopReleaseTag("v0.48.2") && !isDesktopReleaseTag("remote-desktop-runtime-abc"),
    "tags",
  );
  const analysis = analyzeRelease({
    tag_name: "v9.9.9",
    html_url: "u",
    published_at: "2026-10-24T00:00:00Z",
    body,
  });
  const licence = LICENCE_VERDICTS["polyform-nc"];
  const report = renderReport({
    analysis,
    licence,
    previousTag: "v9.9.8",
    sahkarmiVersion: "0.7.2",
  });
  assert(report.includes("SOURCE SYNC BLOCKED") && report.includes("CRITICAL"), "report");
  const mail = renderMail({
    analysis,
    licence,
    previousTag: "v9.9.8",
    issueUrl: "i",
    reportUrl: "r",
  });
  assert(
    mail.subject.startsWith(`[Sahkarmi upstream] ${UPSTREAM_NAME} v9.9.9 — CRITICAL`),
    mail.subject,
  );
  assert(mail.html.includes("<li>") && mail.text.includes("All release notes"), "mail body");
  assert(
    mail.text.includes("Windows-relevant changes") && report.includes("Windows-relevant"),
    "windows",
  );
  assert(
    criticalFlags("- Let the Windows installer choose the install disk").includes("windows"),
    "win flag",
  );
  assert(!mail.html.includes("<script"), "html safe");
  assert(sentToNote({ ok: true, sentTo: "g•••@gmail.com" }) === "to g•••@gmail.com", "sent to");
  assert(sentToNote({ ok: true }) === "to the relay's MAIL_TO", "sent to (old relay)");
  log("self-test passed");
}

main().catch((error) => {
  console.error(`[radar] FAILED: ${error.stack ?? error.message}`);
  process.exit(1);
});
