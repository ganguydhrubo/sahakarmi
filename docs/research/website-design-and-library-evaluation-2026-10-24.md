# Website design direction and library evaluation (24 October 2026)

## Constraints that decided the approach

- The site is a static GitHub Pages deploy with no build step, checked by `scripts/check-website.mjs` and redeployed by the release workflow. Any build toolchain would break that flow.
- Audience research (see `icp-and-growth-channels-2026-10-24.md`) says a large share of Indian visitors arrive on phones over mobile data; the page must be light.
- The owner's rule: no fake content, real screenshots only; keep every existing SEO/structured-data asset.

## Design direction (implemented)

- Brand kept: saffron/indigo palette, Mukta + Baloo 2 self-hosted fonts, logo mark. Dark theme by default with a light theme through `prefers-color-scheme` (the app has both).
- Hierarchy: one claim per section, short lead text, the real app screenshot as the hero, a six-tab screenshot gallery, a category comparison table (not a scorecard against named products), honest download cards with build/test status.
- Motion: a single scroll-reveal (opacity + 18 px translate) driven by `IntersectionObserver`, a hover lift on cards and buttons, and the hero screenshot's 4° perspective tilt; everything disabled under `prefers-reduced-motion`, and content is visible without JavaScript (`.js` class gate plus a 2.5-s safety timer).
- Accessibility: skip link, one `h1`, landmark sections, `aria` tabs with arrow-key navigation, 3 px focus rings, 4.5:1 text contrast in both themes, labels on every control, lazy images with width/height.
- Weight: HTML 112 KB including inline CSS/JS and the JSON-LD; fonts subset by script; screenshots as WebP at 480/720/1440 (hero 52 KB at 1440).

## Libraries considered and why none were added

| Candidate | Licence / status (as of 24 Oct 2026) | Verdict |
| --- | --- | --- |
| GSAP + ScrollTrigger | Free since the Webflow acquisition (Standard "no charge" licence), actively maintained, ~70 KB min | Not needed: one reveal effect; IntersectionObserver does it in 12 lines. |
| Motion (Framer Motion for vanilla) | MIT, maintained, ~18 KB for the mini API | Same reason; would add a script request on a page that has none. |
| Lenis smooth scroll | MIT, maintained | Hijacking scroll hurts low-end phones and accessibility; `scroll-behavior: smooth` is enough. |
| Three.js / WebGL hero | MIT | No product reason for 3D; cost on mobile; the real screenshot carries more trust. |
| Lottie (lottie-web) | MIT | No motion asset exists; a scripted mock-up would contradict the "real app only" rule. |
| Tailwind CDN / UI kit | MIT | A build-less CDN Tailwind is 300 KB+ at runtime; hand-written CSS is smaller and already consistent with the app's tokens. |
| Swiper / Splide (gallery) | MIT | A six-item tab gallery with native `hidden` panels needs no carousel library. |
| Plausible / Umami analytics | AGPL / MIT self-hosted | Deliberately not added: the site states "no analytics". Revisit only with disclosure. |
| axe-core (testing) | MPL-2.0 | Not vendored; the render test checks overflow, images, fonts, console errors, keyboard order and language switching with Playwright. A one-off axe run is recommended before the next redesign. |

## Measured results (local static server, Playwright with Edge 155)

- No horizontal overflow at 375, 820 and 1440 px, both languages, both colour schemes; no console errors; fonts load; no failed requests.
- Keyboard: first Tab lands on the skip link; language toggle switches `<title>`, `lang` and every `data-i18n` element; gallery tabs respond to arrow keys.
- Lighthouse was **not** run in this session (no Chrome Lighthouse CLI available offline); the previous audit of the old page scored Performance 86 / A11y 100 / BP 100 / SEO 100 on simulated slow 4G. The new page has fewer bytes above the fold (no mascot animation, no fake chat), so a re-run after deploy is recommended and expected to be equal or better.
