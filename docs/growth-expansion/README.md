# Growth expansion — discovery and downloads (2026-11-05)

Scope: the website (`website/`), the GitHub listing and software distribution. The desktop app was
not changed. Research with sources: [research-2026-11-05.md](research-2026-11-05.md). Listings
ready to paste: [distribution-kit.md](distribution-kit.md).

## Baseline (measured 2026-11-05)

| Metric | Value | Source |
| --- | --- | --- |
| Installer downloads, all releases | 314 (57 releases) | `node scripts/download-stats.mjs` (GitHub `download_count` of `*-x64.exe`) |
| GitHub stars / forks | 1 / 0 | GitHub API |
| Web search for "Sahkarmi" | no Sahkarmi result in the research tool's search | research §0 |
| Search Console / Bing data | not available to this session | — |

Counting rules: a **button click** (website beacon) is not a **download** (GitHub count), a download
is not an **install**, and an install is not an **active user**. They are reported separately; the
app itself sends no analytics, so installs and active users are not measured.

## What changed

**Positioning and download (homepage)**
- Meta description and hero lead now say what the product is: free, open-source AI that uses your
  Windows PC (websites, desktop apps, files) and asks before it posts or pays (English and Hindi).
- New hero announcement linking to the computer-use page.
- Download section: a release facts panel (version, release date, download size, system, licence,
  installer SHA-256 with Copy, install guide). Values are filled from the newest GitHub release at
  deploy time by `scripts/inject-downloads.mjs`, which now also writes the date and SHA-256 (from
  the asset's `digest`) and processes every page; if GitHub is unreachable the committed values stay.
- Footer links to the new pages.

**New pages (one search intent each)**

| Page | Intent / query cluster |
| --- | --- |
| `/computer-use.html` | "ai that can use / control my computer", computer-use AI explained, safety and limits |
| `/ai-agent-for-windows.html` | "ai agent for windows 11", "ai agent download for pc", install options |
| `/use-cases.html` | profession workflows (finance, marketing, sales, research, development, writing, design, operations), each with the app's real ready-made coworkers |
| `/alternatives.html` | "ChatGPT agent / Claude computer use / Manus / Browser Use alternative", factual table with sources |
| `/open-source-ai-agent.html` | "open-source / free AI agent", licence, verifying builds, kinds of agents |

They share `/assets/guide.css`, carry WebPage + BreadcrumbList + FAQPage JSON-LD (plus HowTo and
ItemList where they fit), a canonical URL, a download CTA and the download-click beacon.

**Corrections to existing pages**
- `install.html`: Claude now connects with Sahkarmi's own sign-in (0.22.0); the uninstaller asks
  about data; removed an obsolete 0.7.1 note.
- `savings.html`: description shortened to fit search snippets.
- `llms.txt`: facts updated to 0.22.0 (computer use, approvals, Claude sign-in) and the new pages.
- `sitemap.xml`: five new URLs.

**Measurement**
- `download-notify.js` now labels clicks from page CTAs and footers; `scripts/inject-notify.mjs`
  turns the beacon on for every page that carries the meta tag (it was home and install only).
- `scripts/download-stats.mjs`: completed installer downloads per release (`--json` for snapshots).

**Checks**: `scripts/check-website.mjs` now also checks every secondary page for a description of
50–170 characters, a sitemap entry and parseable JSON-LD (231 checks pass).

**GitHub listing** (applied): new description that says "use your Windows PC"; topics now include
computer-use, computer-use-agent, desktop-agent, browser-automation, desktop-automation, windows,
ai-agent, open-source, claude, llm-agent (18 of 20). README: computer-use positioning, desktop
control, Store link, Claude sign-in facts, links to the new pages.

**winget**: manifests for 0.22.0 in `winget/manifests/s/Sahkarmi/Sahkarmi/0.22.0/` (Apache-2.0; the
old 0.5.6 copy said MIT and was removed). `winget validate` passes. The community PR
microsoft/winget-pkgs#458967 (0.12.3) passed validation and waits for a moderator.

## 30 / 60 / 90 days

**Days 1–30**
1. Merge and deploy; confirm the Pages verify job passes.
2. Google Search Console + Bing Webmaster Tools (DNS verification), submit the sitemap, request
   indexing of the six key URLs. Record the baseline queries and impressions.
3. Free listings, cheapest first (distribution-kit.md): AlternativeTo, slavakurilyak and e2b-dev
   awesome-ai-agents, ranpox/awesome-computer-use, SourceForge import.
4. Record two real screen captures of computer use (a browser post with approval; a desktop app
   task) for the computer-use and use-cases pages and YouTube.

**Days 31–60**
1. Product Hunt launch and one Show HN with a real demo; Dev.to / Hashnode write-up of how the
   desktop control works (UI Automation, approvals).
2. winget acceptance; Chocolatey package if the moderation effort is acceptable.
3. Add pages only where Search Console shows impressions without a matching page (candidates from
   research §5: social-media posting, lead research, letting AI control your PC safely).

**Days 61–90**
1. Rewrite titles and descriptions of pages with impressions but low CTR.
2. Grow the clusters that get clicks; prune or merge pages that get none.
3. Compare download sources (beacon `page`/`button`/`utm`, GitHub counts, Store dashboard) and move
   the CTA effort to what converts.

## Owner actions (need your accounts)

- Search Console and Bing Webmaster Tools verification (DNS TXT on sahkarmi.site).
- AlternativeTo, Product Hunt, SourceForge and Hacker News accounts and posts.
- Optional: rename confusion. Two unrelated GitHub repositories use the name Sahkarmi
  (research §0); confirm whether `SahkarmiAI/sahkarmi-website` is yours.
