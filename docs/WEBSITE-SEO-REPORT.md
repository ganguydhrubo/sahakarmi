# sahkarmi.site — social links, SEO, GEO/AEO and deployment report

Branch: `website/seo-social` (commit `034b294`), based on `main` `fe2c89c`.
Statuses: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**.

## 1. Changes

| Area | Change |
| --- | --- |
| Social | "Follow Sahkarmi" block before the footer. Two buttons: **Follow Sahkarmi on LinkedIn** → `https://www.linkedin.com/company/sahkarmi/` and **Follow Sahkarmi on Facebook** → `https://www.facebook.com/sahakarmi`. Official-shape icons from Bootstrap Icons (MIT) with platform colours on a small badge; buttons in brand style. Visible labels, `target="_blank" rel="noopener noreferrer"`, 48 px tall, saffron focus ring, hover and active states, full-width on phones. No follower counts. There were no existing social links to merge. |
| Metadata | New title (64 chars) and description (≤160). Added canonical `https://sahkarmi.site/`, `robots: index, follow, max-image-preview:large`, Open Graph (site name, `en_IN` + `hi_IN`, absolute image URL with 1200×630 size and alt, video), Twitter `summary_large_image` with title, description, image and alt, theme colour, favicon set (`/favicon.ico` 16/32/48, SVG, 96 px PNG), web manifest. |
| Structured data | One JSON-LD `@graph`: `Organization` (name, सहकर्मी, logo 512 px, email, contact point, `sameAs` LinkedIn, Facebook, GitHub), `WebSite`, `SoftwareApplication` (BusinessApplication, OS, free INR offer, Apache-2.0, download URL, feature list from the README), `VideoObject` (real duration PT1M57S) and `FAQPage`. The FAQ matches the visible questions and answers word for word. **No ratings, reviews, awards, addresses or invented prices.** `BreadcrumbList` and `Article` were not added: this is a one-page site with no articles. |
| Content | New factual sections, rendered in the static HTML for crawlers and translated to Hindi: What is Sahkarmi, the team, how it works, features, AI providers (with free-tier and paid-plan limits), privacy and safety (honest: development preview; text goes to the chosen AI provider), get started (including the SmartScreen note), 7-question FAQ. The FAQ says approvals in the current release rely on the AI following instructions. |
| Fix | The video label said "90 seconds"; the file is 1:57, so it now says "2 minutes". |
| Crawl files | `robots.txt`, `sitemap.xml` (one canonical URL), `llms.txt`, `404.html` (`noindex`), IndexNow key file. |
| Performance | Google Fonts replaced by self-hosted Mukta and Baloo 2 WOFF2 (Latin and Devanagari subsets, `font-display: swap`, two preloads); no third-party font request. Screenshots served as responsive WebP (480/720/1440 w) with width and height. Poster 116 KB JPG → 47 KB WebP. Images below the fold load lazily. |
| Accessibility | Skip link; real `/` home link; play button named by its visible text; landmarks and one `h1`; `h2`/`h3` hierarchy; table headers with `scope`; reduced-motion respected as before. |
| Automation | `scripts/check-website.mjs` (no dependencies) runs 74 checks. `pages.yml` now: (1) runs the checks before deploying, (2) stamps `build.txt` with the commit, (3) a `verify` job waits until https://sahkarmi.site serves that commit and re-runs the checks live (status codes, robots, sitemap, 404, JSON-LD URLs), (4) pings IndexNow. |

## 2. Crawler policy (evidence and recommendation)

Before this change the site had **no robots.txt**, so every crawler was allowed. That policy is
**kept**: `User-agent: * / Allow: /`. Nothing was silently blocked.

- Search and answer crawlers (allowed): Googlebot, Bingbot, OAI-SearchBot (ChatGPT search; opting
  out removes the site from ChatGPT search answers), Claude-SearchBot, PerplexityBot, Applebot,
  DuckDuckBot.
- User-triggered fetchers: ChatGPT-User, Claude-User and Perplexity-User. These are not used for
  training; Perplexity documents that Perplexity-User may not follow robots.txt.
- Training crawlers or tokens (allowed today): GPTBot, ClaudeBot, Google-Extended (a control
  token, not a crawler; it does not affect Google Search ranking), Applebot-Extended,
  meta-externalagent, CCBot. Commented-out opt-out lines are in `robots.txt`.
- Recommendation: for a product that wants to be described by AI assistants, keep the search
  crawlers allowed. Whether to allow *training* crawlers is your data-use choice: allowing them
  costs nothing for a public marketing page. To opt out, uncomment those lines; search visibility is
  unaffected. Grok/xAI and Meta AI search crawlers have no robots.txt documentation that I could
  confirm, so they fall under `*`.
- `llms.txt` is an optional guide and **not a ranking factor**.
- Sources: [OpenAI crawlers](https://developers.openai.com/api/docs/bots),
  [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-the-web-and-how-can-site-owners-block-the-crawler),
  [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers.md),
  [Google-Extended (summary)](https://www.mariehaynes.com/should-you-use-google-extended-in-robots-txt/).

## 3. Tests run

| Check | Result |
| --- | --- |
| `node scripts/check-website.mjs` (local files, 74 checks) | **PASS** 74/74 |
| Mutation test (wrong Facebook URL, edited FAQ question) | **PASS**: the checker failed as expected |
| Playwright render at 375 / 820 / 1440 px | **PASS**: no horizontal overflow, fonts load, no page errors (GitHub API call blocked in sandbox only) |
| axe-core (WCAG 2 A/AA, 2.1 AA, best practice), English and Hindi | **PASS**: 0 violations |
| Keyboard: Tab reaches the skip link first; LinkedIn button shows a 3 px saffron outline | **PASS** |
| Hindi toggle: title, headings and social labels switch | **PASS** |
| Lighthouse (mobile, local Python server without compression) | Accessibility 100, Best practices 100, SEO 100, Performance 86 (LCP 3.6 s under simulated slow 4G, CLS 0, TBT 0). **NOT TESTED** on production. |
| Biome on the new script | **PASS** |

## 4. Deployment and live verification

| Item | Status |
| --- | --- |
| Branch pushed (`website/seo-social`, `034b294`) | **PASS** |
| Production deploy (push to `main` → Pages workflow) | **BLOCKED**: this session's permission policy refused the push to `main` as a production deploy. Needs your approval. |
| Live checks (status, canonical, social buttons, robots, sitemap, llms.txt, 404, structured data, deployed commit) | **BLOCKED** until deployed. The sandbox cannot reach sahkarmi.site (proxy 403), so the new `verify` job in GitHub Actions performs these checks after deploy. |
| Google Search Console / Bing Webmaster Tools | **BLOCKED**: no access. Not claimed. |
| Sitemap submission | **BLOCKED** (Search Console/Bing). IndexNow ping runs automatically after deploy (`continue-on-error`). |

### Exact remaining actions

1. Deploy: on github.com open
   `https://github.com/ganguydhrubo/sahakarmi/compare/main...website/seo-social`, create the pull
   request and merge it. Merging to `main` triggers **Website** → `deploy` → `verify`.
2. Check the **Verify live site** job log: every line must be `PASS`.
3. Google Search Console: add the property `https://sahkarmi.site/` with the DNS TXT method, then
   Sitemaps → submit `https://sahkarmi.site/sitemap.xml`, and URL Inspection → Request indexing.
4. Bing Webmaster Tools: Import from Google Search Console (or verify by DNS), then submit the same
   sitemap.
5. Optional: validate at https://search.google.com/test/rich-results and
   https://validator.schema.org with the live URL. Share-preview check: LinkedIn Post Inspector and
   Facebook Sharing Debugger (both need your login).
6. Measurement: record a baseline in Search Console (impressions, clicks, queries containing
   "sahkarmi") a week after indexing. AI referrals can be counted later from referrers such as
   chatgpt.com, perplexity.ai and gemini.google.com if you add privacy-friendly analytics. None is
   installed today.

No ranking, indexing or AI-citation result is claimed.
