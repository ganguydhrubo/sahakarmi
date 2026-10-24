# Sahkarmi — positioning, messaging and 30-day open-source growth plan (24 October 2026)

Built on `competitor-landscape-2026-10-24.md` and `icp-and-growth-channels-2026-10-24.md` in this folder and on the QA in `docs/qa/2026-10-24/`. Everything below is a recommendation unless marked verified.

## 1. Positioning statement

For developers and small-business owners who already use AI but want it to *do* work on their own computer under their control, Sahkarmi is a free, open-source desktop app that runs a team of AI coworkers, each with its own browser, memory and task queue, that stop and ask before anything that spends money or talks to a customer. Unlike chat apps and cloud agents, it is local-first, needs no account for its free models, reuses the Claude Code, Codex and Google Antigravity sign-ins you already have, and speaks Hindi and Bengali as well as English.

## 2. One-line value proposition

**A team of AI coworkers on your own computer: free, open source, and they ask before they act.**

## 3. Messaging pillars

1. **Yours, locally.** Runs on your PC; chats, files and settings stay there; no Sahkarmi account, no analytics (verified in code and QA).
2. **Free to start, your accounts when you want.** Free built-in models with no login; Claude, ChatGPT and Google Antigravity reuse existing sign-ins (verified). Say the free limits out loud.
3. **A team, not a chat box.** Nine named coworkers with roles, folders, memory, queues, schedules; a built-in browser each (verified).
4. **You decide the risky bits.** Approvals inbox and Take over browser; honest that approvals are instructions, not a hard block (verified in docs and code).
5. **Open and inspectable.** Apache-2.0, built in public, checksums, SBOM and provenance on every release (verified in CI config and release assets).

## 4. What Sahkarmi does and does not do (say both everywhere)

Does: run coworkers on your machine with files, commands and a browser; reuse CLI logins; free models; approvals and take-over; schedules; search; Hindi/Bengali UI.
Does not: run offline (models are remote), guarantee that a coworker never acts without approval, integrate with Tally, WhatsApp Business or the GST portal through APIs (coworkers use the browser), support Intel Macs or Windows ARM, sync between computers, or ship code-signed installers yet.

## 5. Onboarding and first-success strategy

The first-success moment is **a real reply within one minute of install with no account**. It was broken on 24 October (QA D1–D3) and is fixed in 0.7.2. Keep it protected:

- Measure it in CI with the fake providers (regression tests added) and once per release by hand on a clean Windows profile (procedure in `docs/qa/2026-10-24/QA-REPORT.md`).
- Default the first coworker to the free model; show the paid providers as optional.
- Replace the What's New dialog on a first install with a 3-step "Say namaste" card (U1 in the QA report).
- Pre-fill the composer with one example task per coworker so the first message is a click away.
- Put the free-model limit explanation in the product, not only on the site (done in 0.7.2 error text).

## 6. 30-day launch and community plan (starting the day 0.7.2 is live)

Week 1 — foundation (no promotion yet)
- Enable GitHub Discussions (currently disabled, verified via API) and pin a "Start here" thread.
- Create 10 `good first issue`s: Hindi locale gaps (U3), Bengali/Marathi strings, an Ollama/OpenAI-compatible provider via OpenCode config, docs typos, coworker templates, the log-email redaction (U5), the What's New first-install rule (U1).
- Apply to SignPath Foundation for free Windows code signing; until then keep the SmartScreen note on site and README.
- Fix the winget manifest (PR #458967 is for 0.5.6) to the current version or withdraw it; do not advertise winget until merged.
- Weekly release cadence; no more four-releases-in-a-morning days.

Week 2 — soft launches for feedback
- r/developersIndia Showcase Sunday; r/SideProject; Peerlist Launchpad (Monday); Indie Hackers build log; FOSS United forum thread asking for language contributors.
- One dev.to/Hashnode tutorial: "How a take-over browser and an approvals inbox make agents safer, and where they don't."
- Own Homebrew tap (`brew install ganguydhrubo/tap/sahkarmi`) and an AUR `sahkarmi-bin` package.

Week 3 — Show HN
- Tue–Thu, 7–10 am PT. Title: "Show HN: Sahkarmi – open-source AI coworkers for your desktop, reusing your Claude Code / Codex logins". First comment: architecture, CLI-login reuse, honest approval model, free-model limits, Windows-first rationale, roadmap. Be online six hours. Same day: X thread with a 30-s GIF; r/ClaudeAI post if its rules allow.

Week 4 — India push and compounding
- Hindi and Bengali demo videos (this branch ships a Hindi and an English explainer); pitch three Hindi GST/Tally YouTube creators for an honest review.
- LinkedIn personal post; Product Hunt (12:01 am PT, ask for comments not upvotes).
- awesome-electron PR after 18 November (30-day rule) and awesome-ai-agents PR.
- Retro: which channel produced issues and PRs, not just stars.

## 7. Sustainable content calendar (after the launch month)

| Cadence | Item |
| --- | --- |
| Weekly | Release notes post (GitHub Release + Discussions + X); one short clip of a real workflow (30–60 s, Hindi and English captions) |
| Fortnightly | A tutorial or "how it works" article on dev.to/Hashnode (approvals, browser take-over, schedules, provider setup, local data) |
| Monthly | Hindi/Bengali walkthrough video; a "what broke and what we fixed" transparency post; a contributor shout-out |
| Quarterly | Roadmap review in Discussions; refresh the comparison table on the site against the competitor research |

## 8. Feedback and bug-reporting workflow

- Issue templates: *Bug* (version from Settings → About, OS, provider, steps, log excerpt with the redaction reminder), *Feature*, *Language*.
- "Export diagnostics" from Settings → Data & privacy is the preferred attachment (no conversations, no paths); document that logs can contain a provider email (U5) until fixed.
- Triage weekly: label `needs-repro`, `confirmed`, `good first issue`, `provider:claude|codex|antigravity|opencode`, `platform:win|mac|linux`.
- Security: GitHub private vulnerability reporting only (SECURITY.md), 7-day acknowledgement.
- Website and README point to Issues for bugs and Discussions for questions (the site now links Issues; Discussions once enabled).

## 9. Contributor onboarding

- CONTRIBUTING already covers setup, tests and boundaries; add a "First hour" section: `bun install`, `bun run fetch:opencode`, `bun run dev`, where the strings live (`src/renderer/src/i18n*.ts`), how to run one test file.
- Keep the fake-provider test harness documented (it is the reason contributors can test without any AI account).
- Label and reply to first PRs within 48 hours; add a CODEOWNERS for `website/` and `src/renderer/src/i18n*.ts`.

## 10. Adoption metrics (privacy-respecting)

| Metric | Source | Target after 30 days (hypothesis) |
| --- | --- | --- |
| Release asset downloads per OS | GitHub Releases API (public) | 300+ Windows, 50+ mac/Linux |
| Stars, forks, watchers | GitHub | 100–300 without an HN hit |
| Issues opened by non-maintainers / with repro | GitHub | 10+ |
| External PRs merged | GitHub | 3+ |
| Discussions threads | GitHub | 10+ |
| Site sessions and download clicks | Not measured today (no analytics by design). If wanted later: a cookie-less, self-hosted counter or GitHub's referrer data; disclose on the site. | — |
| First-session success | Not measurable remotely by design; measure via the fresh-profile QA procedure each release and via "it worked / it didn't" Discussions polls | 100 % in QA |

## 11. Future monetisation (research only, not for now)

Keep the open-source app free and complete. If ever needed: paid support and setup for MSMEs through CA/Tally partners; hosted sync/backup across machines; signed enterprise builds with policy controls. Never paywall features that exist today.
