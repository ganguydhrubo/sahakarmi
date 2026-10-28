# Upstream watch

Sahkarmi was originally derived from a project released under the Apache License 2.0 (the
required attribution is in `NOTICE`). Later versions of that project use a noncommercial licence,
so **no upstream source is synchronised, merged or copied** into Sahkarmi, and there must never be
an automatic merge. Sahkarmi has its own history and code.

What is automated is awareness:

| Step | Where |
| --- | --- |
| Every hour, look for new desktop releases of the watched project | `.github/workflows/upstream-watch.yml` |
| Read that release's own licence and classify it (`apache-2.0` / `polyform-nc` / `unknown`) | `scripts/check-upstream.mjs` |
| Summarise the release notes: all lines, feature candidates, Windows-relevant lines, shared-dependency signals, critical flags | `scripts/upstream-radar-lib.mjs` |
| Mail the owner the full report | Apps Script relay (`deploy/apps-script/upstream-mail/Code.gs`) |
| Remember what was processed | `docs/upstream/state.json` (tags only) |

Reports are not committed and no issues are opened by default, because this repository is public.
Set `UPSTREAM_OPEN_ISSUES=true` in the workflow if tracking issues are wanted.

Porting an idea is always manual: implement it independently in Sahkarmi from the description,
with tests, then release as usual (`docs/RELEASING.md`).

## Configuration

Repository secrets:

- `UPSTREAM_REPO` — `owner/repo` of the watched project
- `UPSTREAM_NAME` — display name used in mail subjects
- `UPSTREAM_MAIL_URL`, `UPSTREAM_MAIL_TOKEN` — the Apps Script relay

Relay set-up: create an Apps Script project in the sender's Google account, paste
`deploy/apps-script/upstream-mail/Code.gs`, set script properties `MAIL_TOKEN` (random string,
same as `UPSTREAM_MAIL_TOKEN`) and `MAIL_TO` (recipient), deploy as a web app (execute as me,
access: anyone) and store its `/exec` URL as `UPSTREAM_MAIL_URL`.

## What counts as critical

Security, licence changes, provider CLIs, the updater/installer/signing, Electron/Bun/Chromium/Node
bumps, data loss or migrations, breaking changes, and anything Windows-specific. The flags appear in
the mail subject.

## Running it by hand

```bash
node scripts/check-upstream.mjs --self-test   # no network
UPSTREAM_REPO=owner/repo node scripts/check-upstream.mjs --dry-run
```

State advances only after a release is processed; a mail that fails is retried on the next run;
GitHub 403/429/5xx are retried with backoff; at most 5 releases per run.

## Not getting the mails?

1. Check where they go. Mails go only to the relay's `MAIL_TO` script property (Apps Script →
   Project Settings → Script properties). To get them in more than one inbox, list the addresses
   with commas, for example `owner@gmail.com, teammate@company.com`.
2. Send a test mail: Actions → Upstream Radar → Run workflow → tick "Only send one test mail".
   The log line `test mail sent to g•••@gmail.com` shows which inbox got it (only the first letter
   and the domain, because the logs are public). A relay deployed before 28 Oct 2026 says
   "to the relay's MAIL_TO" until it is redeployed with the current `Code.gs` (Deploy → Manage
   deployments → edit → New version keeps the same URL).
3. Look in Spam and in Gmail's Updates tab for "Sahkarmi Upstream Radar". Marking one as
   "Not spam" (or adding a filter "Never send it to Spam") keeps the next ones in the inbox.
4. A mail goes out only for a new upstream desktop release, never on quiet days. GitHub runs the
   hourly schedule late when it is busy (often every 4 to 6 hours), so a mail can arrive a few
   hours after the release.
