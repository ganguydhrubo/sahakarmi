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
