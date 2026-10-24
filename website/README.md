# Sahkarmi website

https://sahkarmi.site/ — a bilingual home page (English and हिन्दी: toggle top-right, or `?lang=hi`) plus
`install.html` (English). Pure HTML/CSS/JS, no build step, no third-party fonts, scripts or trackers.

Home page sections: hero with a real screenshot, see it working (video + screenshot gallery), what
Sahkarmi is, how it differs, how it works, features, the default team, AI providers, download,
privacy/security/permissions, FAQ, community and feedback, footer with contact.

## Editing rules

- **Text:** every translated element has `data-i18n="key"` and contains plain text only (no nested
  tags). Change the English text in the HTML *and* in `STRINGS.en`, and the Hindi in `STRINGS.hi`.
  `node scripts/check-website.mjs` fails if they drift or a key is missing.
- **Facts only:** describe what the released app does. No ratings, reviews, awards, user counts or
  invented numbers. Screenshots in `assets/shots/` are real captures from the app (see
  `docs/qa/2026-10-24/`), served as responsive WebP (480/720/1440 px).
- **Version and sizes:** never hard-code a version in translated strings. Elements with
  `data-release-version` and `data-release-size="win"` are filled in at deploy time by
  `scripts/inject-downloads.mjs` from the newest GitHub release, as are all download links
  (`data-download`, `data-platform`, `data-platform-tile`) on both pages and `softwareVersion` in
  the JSON-LD.
- **FAQ:** the `FAQPage` JSON-LD in `<head>` must match the visible questions and answers word for
  word (the check enforces it).
- **Structured data:** one JSON-LD `@graph` (Organization, WebSite, SoftwareApplication,
  VideoObject, FAQPage). Keep every existing tag; add, do not remove.
- **Social profiles and contact (do not change without the owner):** Instagram
  https://www.instagram.com/sahkarmiai, LinkedIn https://www.linkedin.com/company/sahkarmi/,
  Facebook https://www.facebook.com/sahakarmi, GitHub https://github.com/ganguydhrubo/sahakarmi,
  email hi@goliv.online, WhatsApp +91 82408 01921.

## Crawling

- `robots.txt` allows every crawler and documents how to opt out of AI training crawlers.
- `sitemap.xml` lists the home page and `install.html`. Update `<lastmod>` when content changes.
- `llms.txt` is a plain-text guide for AI tools and answer engines; keep it in sync with the FAQ.
- `404.html` is served by GitHub Pages for unknown URLs and is `noindex`.
- `<32 hex>.txt` is the public IndexNow key (Bing and other IndexNow engines).

## Deploying

`.github/workflows/pages.yml` runs on every push to `main` that touches `website/`:

1. `node scripts/inject-downloads.mjs` bakes the newest installer links, version and sizes into
   both pages.
2. `node scripts/check-website.mjs` checks the files (metadata, JSON-LD, links, social buttons,
   translations, robots, sitemap, install page).
3. The folder is published to GitHub Pages with `build.txt` set to the commit SHA.
4. A second job waits until https://sahkarmi.site serves that commit, runs the same checks against
   the live site, then pings IndexNow.

The release workflow re-runs the Pages workflow after publishing a release, so the links and version
on the site follow the newest release automatically.

## Local preview

Any static server works, for example `python -m http.server 8765 --directory website`, then open
http://127.0.0.1:8765/. Without the inject step the pages show the version and links committed in
the repository.
