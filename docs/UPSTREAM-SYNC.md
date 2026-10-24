# Upstream sync: how OpenBot releases reach Sahkarmi

## The short version

Sahkarmi started from OpenBot **v0.1.11 (Apache-2.0)** — an imported snapshot, not a git fork
(there is no shared history). From **v0.1.12 onwards OpenBot is PolyForm Noncommercial 1.0.0**,
which does not allow its code to be copied, merged, rebranded or redistributed in Sahkarmi.

So there is **no automatic code synchronisation** and there must not be one. What is automated is
everything around it:

| Step | Automated? | Where |
| --- | --- | --- |
| Detect a new OpenBot desktop release | yes, every 6 h | `.github/workflows/upstream-watch.yml` |
| Read that release's licence and classify it | yes | `scripts/check-upstream.mjs` |
| Summarise release notes, list feature candidates, flag critical signals | yes | `scripts/upstream-radar-lib.mjs` |
| Write a report and a RADAR line | yes | `docs/upstream/reports/<tag>.md`, `docs/upstream/RADAR.md` |
| Open one tracking issue per release | yes | labels `upstream-parity`, `sync-blocked` / `sync-permitted`, `critical` |
| Mail the owner | yes | Apps Script relay, from the owner's Google account |
| Port a feature into Sahkarmi | **no — a person or agent re-implements it from the description** | normal PR → CI → `bun run release:patch` → tag |
| Build, test, publish, auto-update | yes, unchanged | `ci.yml`, `release.yml`, electron-updater |

The radar never touches `src/`. It commits only under `docs/upstream/`.

## Licence gate

For every release the script fetches that tag's `LICENSE` and `package.json` → `license`:

- `polyform-nc` → issue labelled `sync-blocked`; report says **SOURCE SYNC BLOCKED**.
- `apache-2.0` → issue labelled `sync-permitted` (a port with attribution may be reviewed by a
  person; still never merged automatically).
- anything else → `unknown`, treated as blocked.

If Sahkarmi ever obtains a commercial licence from OpenBot's licensor (Synthetify Labs), change
nothing here: the gate stays, and the human port path is the one that is then allowed.

## What "critical" means

A release is flagged critical when its notes mention any of: security / CVE / secrets; licence
changes; provider CLIs (Codex, Claude, Antigravity, Gemini, OpenCode, ACP); the updater,
installer or code signing; Electron / Bun / Chromium / Node version bumps; data loss, corruption or
migrations; breaking changes. The mail subject carries the flags.

## State and retries

`docs/upstream/state.json` holds the last processed tag, every processed tag, and tags whose mail
is still pending. A release advances the state only after its report and issue exist; a failed
run never advances it. GitHub API 403/429/5xx are retried with backoff. A mail that fails is
retried on the next run. Re-running on an already processed tag does nothing (the issue is found
by title, the RADAR line is not duplicated). At most 5 releases are processed per run
(`UPSTREAM_MAX_RELEASES`).

## Mail relay set-up (one time)

1. In the sender's Google account open script.google.com → New project, paste
   `deploy/apps-script/upstream-mail/Code.gs`.
2. Project Settings → Script properties: `MAIL_TOKEN` = a long random string,
   `MAIL_TO` = the recipient address.
3. Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone** → copy the
   `/exec` URL.
4. GitHub repo → Settings → Secrets and variables → Actions: `UPSTREAM_MAIL_URL` = that URL,
   `UPSTREAM_MAIL_TOKEN` = the same random string.
5. Test: `UPSTREAM_MAIL_URL=… UPSTREAM_MAIL_TOKEN=… node scripts/check-upstream.mjs --test-mail`.

Free Gmail accounts may send 100 mails a day through `MailApp`; the radar sends one per release.

## Running it by hand

```bash
node scripts/check-upstream.mjs --self-test   # no network
node scripts/check-upstream.mjs --dry-run     # analyse the newest releases, change nothing
node scripts/check-upstream.mjs --init        # mark the current latest tag as processed
node scripts/check-upstream.mjs               # real run (GITHUB_TOKEN for the issue)
```

Or Actions → Upstream Radar → Run workflow (tick *dry run* to only analyse).

## What this does not do, on purpose

- No merge, rebase, cherry-pick, patch or copy of upstream source.
- No automatic release: a Sahkarmi release always comes from a reviewed commit on `main` and a
  tag pushed by a maintainer (`docs/RELEASING.md`).
- No change to the updater, branding, providers or the website.
