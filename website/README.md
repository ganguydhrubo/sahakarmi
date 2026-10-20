# Sahkarmi website

https://sahkarmi.site/ — one bilingual page (English and हिन्दी: toggle top-right, or `?lang=hi`).
Pure HTML/CSS/JS in `index.html`, no build step, no third-party fonts or trackers.

Sections: hero + explainer video + Download, What is Sahkarmi, the team, how it works, features,
AI providers, privacy and safety, get started, FAQ, and Follow Sahkarmi (LinkedIn, Facebook).

## Editing rules

- **Text:** every translated element has `data-i18n="key"`. Change the English text in the HTML
  *and* in `STRINGS.en`, and the Hindi in `STRINGS.hi`. `node scripts/check-website.mjs` fails if
  they drift or a key is missing.
- **FAQ:** the `FAQPage` JSON-LD in `<head>` must match the visible questions and answers word for
  word (the check enforces it). Only state what the released app actually does.
- **Structured data:** one JSON-LD `@graph` (Organization, WebSite, SoftwareApplication,
  VideoObject, FAQPage). Never add ratings, reviews, awards or prices that are not real.
- **Social profiles:** LinkedIn https://www.linkedin.com/company/sahkarmi/ and Facebook
  https://www.facebook.com/sahakarmi, used in the Follow section and in `sameAs`.

## Crawling

- `robots.txt` allows every crawler (the policy the site always had). It documents how to opt out
  of AI *training* crawlers (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
  meta-externalagent, CCBot) without affecting search; those lines are commented out.
- `sitemap.xml` lists the one canonical URL. Update `<lastmod>` when the content changes.
- `llms.txt` is an optional plain-text guide for AI tools. It is not a ranking factor.
- `404.html` is served by GitHub Pages for unknown URLs and is `noindex`.
- `<32 hex>.txt` is the public IndexNow key (Bing and other IndexNow engines).

## Deploying

`.github/workflows/pages.yml` runs on every push to `main` that touches `website/`:

1. `node scripts/check-website.mjs` checks the files (metadata, JSON-LD, links, social buttons,
   translations, robots, sitemap).
2. The folder is published to GitHub Pages with `build.txt` set to the commit SHA.
3. A second job waits until https://sahkarmi.site serves that commit, runs the same checks against
   the live site (plus status codes and the 404 page), then pings IndexNow.

Download button: points at the newest `*-x64.exe` on GitHub Releases (looked up live), falling back
to the Releases page. Contact: hi@goliv.online · WhatsApp +91 82408 01921.
