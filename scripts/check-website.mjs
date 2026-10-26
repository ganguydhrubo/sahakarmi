#!/usr/bin/env node
// Checks the public website for SEO, structured-data, link and translation regressions.
//
//   node scripts/check-website.mjs                 # check the files in website/
//   node scripts/check-website.mjs --live URL      # check the deployed site (status codes too)
//          [--expect-build SHA] [--retries N]      # wait until the deployed build matches SHA
//
// No dependencies, so it runs the same locally and in GitHub Actions.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ORIGIN = "https://sahkarmi.site";
const SOCIAL = {
  linkedin: "https://www.linkedin.com/company/sahkarmi/",
  facebook: "https://www.facebook.com/sahakarmi",
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const args = process.argv.slice(2);
const live = args.includes("--live") ? args[args.indexOf("--live") + 1] : null;
const expectBuild = args.includes("--expect-build")
  ? args[args.indexOf("--expect-build") + 1]
  : null;
const retries = args.includes("--retries") ? Number(args[args.indexOf("--retries") + 1]) : 0;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

async function load(path) {
  if (!live) {
    const file = join(root, path === "/" ? "index.html" : path.replace(/^\//, ""));
    return {
      status: existsSync(file) ? 200 : 404,
      text: existsSync(file) ? readFileSync(file, "utf8") : "",
      type: "",
    };
  }
  const response = await fetch(new URL(path, live), {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  return {
    status: response.status,
    text: await response.text(),
    type: response.headers.get("content-type") ?? "",
    location: response.headers.get("location"),
    robotsHeader: response.headers.get("x-robots-tag"),
  };
}

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const metas = (html, key, value) =>
  [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]).filter((tag) => attr(tag, key) === value);
const decode = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

async function checkBuild() {
  if (!live || !expectBuild) return;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const build = await load(`/build.txt?ts=${Date.now()}`);
    if (build.text.trim() === expectBuild) {
      check("deployed build matches commit", true, expectBuild);
      return;
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 20_000));
    else
      check(
        "deployed build matches commit",
        false,
        `live=${build.text.trim() || build.status} expected=${expectBuild}`,
      );
  }
}

async function main() {
  await checkBuild();

  const page = await load("/");
  check("home page returns 200", page.status === 200, String(page.status));
  if (live) check("home page is HTML", page.type.includes("text/html"), page.type);
  if (live)
    check(
      "no X-Robots-Tag noindex on home page",
      !/noindex/i.test(page.robotsHeader ?? ""),
      page.robotsHeader ?? "none",
    );
  const html = page.text;

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  check(
    "title present and 30–70 chars",
    title.length >= 30 && title.length <= 70,
    `${title.length}: ${title}`,
  );
  const description = attr(metas(html, "name", "description")[0] ?? "", "content") ?? "";
  check(
    "meta description 70–170 chars",
    description.length >= 70 && description.length <= 170,
    String(description.length),
  );
  const canonicals = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g)].map((m) =>
    attr(m[0], "href"),
  );
  check(
    "exactly one canonical, pointing at the production home page",
    canonicals.length === 1 && canonicals[0] === `${ORIGIN}/`,
    canonicals.join(", "),
  );
  const robots = attr(metas(html, "name", "robots")[0] ?? "", "content") ?? "";
  check("home page is indexable", /index/.test(robots) && !/noindex|nofollow/.test(robots), robots);
  check("html lang set", /<html lang="[a-z]{2}/.test(html));
  check("viewport meta present", metas(html, "name", "viewport").length === 1);

  for (const property of [
    "og:title",
    "og:description",
    "og:url",
    "og:image",
    "og:type",
    "og:site_name",
  ]) {
    check(`${property} present`, metas(html, "property", property).length === 1);
  }
  const ogImage = attr(metas(html, "property", "og:image")[0] ?? "", "content") ?? "";
  check("og:image is an absolute https URL on the site", ogImage.startsWith(`${ORIGIN}/`), ogImage);
  check(
    "og:image size declared as 1200x630",
    /og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html),
  );
  for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    check(`${name} present`, metas(html, "name", name).length === 1);
  }

  // Structured data
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  check("one JSON-LD block (no duplicate injection)", blocks.length === 1, String(blocks.length));
  let graph = [];
  try {
    graph = JSON.parse(blocks[0] ?? "{}")["@graph"] ?? [];
    check("JSON-LD parses", true);
  } catch (error) {
    check("JSON-LD parses", false, String(error));
  }
  const byType = (type) => graph.filter((node) => node["@type"] === type);
  for (const type of ["Organization", "WebSite", "SoftwareApplication", "FAQPage"]) {
    check(`JSON-LD has one ${type}`, byType(type).length === 1);
  }
  const organization = byType("Organization")[0] ?? {};
  check(
    "Organization sameAs has the official LinkedIn and Facebook pages",
    organization.sameAs?.includes(SOCIAL.linkedin) &&
      organization.sameAs?.includes(SOCIAL.facebook),
  );
  check("Organization url is canonical", organization.url === `${ORIGIN}/`);
  const app = byType("SoftwareApplication")[0] ?? {};
  check("no invented ratings or reviews", !JSON.stringify(graph).match(/aggregateRating|"review"/));
  check("SoftwareApplication offer is free", app.offers?.price === "0");
  const urls = JSON.stringify(graph).match(/https:\/\/sahkarmi\.site\/[^"#]*/g) ?? [];
  for (const url of new Set(urls)) {
    if (url === `${ORIGIN}/`) continue;
    const asset = await load(url.replace(ORIGIN, ""));
    check(`JSON-LD URL resolves: ${url}`, asset.status === 200, String(asset.status));
  }
  const visibleQuestions = [...html.matchAll(/<summary data-i18n="q\d+">([^<]*)<\/summary>/g)].map(
    (m) => decode(m[1]),
  );
  const visibleAnswers = [...html.matchAll(/<p data-i18n="a\d+">([^<]*)<\/p>/g)].map((m) =>
    decode(m[1]),
  );
  const faq = byType("FAQPage")[0]?.mainEntity ?? [];
  check(
    "FAQPage matches the visible FAQ exactly",
    faq.length === visibleQuestions.length &&
      faq.every(
        (item, index) =>
          item.name === visibleQuestions[index] &&
          item.acceptedAnswer?.text === visibleAnswers[index],
      ),
    `${faq.length} vs ${visibleQuestions.length}`,
  );

  // Social buttons
  for (const [network, url] of Object.entries(SOCIAL)) {
    const links = [...html.matchAll(/<a\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => attr(tag, "href") === url);
    check(
      `${network} button present once with exact URL`,
      links.length === 1,
      String(links.length),
    );
    const tag = links[0] ?? "";
    check(
      `${network} opens safely in a new tab`,
      attr(tag, "target") === "_blank" && attr(tag, "rel") === "noopener noreferrer",
    );
  }
  check("LinkedIn button has its visible label", html.includes(">Follow Sahkarmi on LinkedIn<"));
  check("Facebook button has its visible label", html.includes(">Follow Sahkarmi on Facebook<"));
  for (const tag of [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0])) {
    check(
      `external link is noopener: ${attr(tag, "href")}`,
      /noopener/.test(attr(tag, "rel") ?? ""),
    );
  }

  // Download buttons must start the installer download, never open the GitHub Releases page.
  const EXPECTED = { win: /-x64\.exe$/ };
  const downloadLinks = [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\s(data-download|data-platform|data-platform-tile)[\s=>]/.test(tag));
  check("download links found", downloadLinks.length >= 4, String(downloadLinks.length));
  check(
    "no macOS or Linux download links while those builds are paused",
    !/\.(dmg|AppImage)"/.test(html),
  );
  for (const tag of downloadLinks) {
    const href = attr(tag, "href") ?? "";
    const platform = attr(tag, "data-platform") ?? attr(tag, "data-platform-tile") ?? "win";
    check(
      `direct ${platform} installer link: ${href.split("/").pop()}`,
      href.startsWith("https://github.com/ganguydhrubo/sahakarmi/releases/download/") &&
        EXPECTED[platform]?.test(href),
      href,
    );
  }
  if (live) {
    for (const href of new Set(downloadLinks.map((tag) => attr(tag, "href")))) {
      const response = await fetch(href, { method: "HEAD", redirect: "manual" });
      check(
        `installer downloads directly: ${href.split("/").pop()}`,
        response.status === 302 &&
          /githubusercontent\.com/.test(response.headers.get("location") ?? ""),
        String(response.status),
      );
    }
  }

  // Local references
  const refs = new Set(
    [...html.matchAll(/(?:src|href|srcset|poster)="(\/[^"]*|assets\/[^"]*)"/g)].flatMap((m) =>
      m[1].split(",").map((part) => part.trim().split(" ")[0]),
    ),
  );
  for (const ref of refs) {
    if (ref === "/" || ref.startsWith("//")) continue;
    const path = ref.split("#")[0];
    if (!path) continue;
    const asset = await load(path.startsWith("/") ? path : `/${path}`);
    check(`local reference exists: ${ref}`, asset.status === 200, String(asset.status));
  }
  // Secondary pages: indexable, canonical, titled.
  for (const page of [
    "/install.html",
    "/docs.html",
    "/changelog.html",
    "/privacy.html",
    "/terms.html",
  ]) {
    const secondary = await load(page);
    check(`${page} returns 200`, secondary.status === 200, String(secondary.status));
    const secondaryTitle = secondary.text.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    check(
      `${page} title present and 30–70 chars`,
      secondaryTitle.length >= 30 && secondaryTitle.length <= 70,
      String(secondaryTitle.length),
    );
    check(
      `${page} has its own canonical`,
      secondary.text.includes(`<link rel="canonical" href="${ORIGIN}${page}" />`),
    );
    check(`${page} has one h1`, (secondary.text.match(/<h1[\s>]/g) ?? []).length === 1);
  }
  check(
    "images declare width and height",
    [...html.matchAll(/<img\b[^>]*>/g)].every(
      (m) => /width="\d+"/.test(m[0]) && /height="\d+"/.test(m[0]),
    ),
  );
  check(
    "images have alt text",
    [...html.matchAll(/<img\b[^>]*>/g)].every((m) => /alt="[^"]+"/.test(m[0])),
  );
  check("one h1", (html.match(/<h1\b/g) ?? []).length === 1);
  check("no third-party font CDN", !html.includes("fonts.googleapis.com"));

  // Translations: every key exists in both languages and English matches the static HTML.
  const script = html.match(/const STRINGS = (\{[\s\S]*?\n {4}\});/)?.[1];
  const strings = script ? vm.runInNewContext(`(${script})`) : { en: {}, hi: {} };
  const keys = [...html.matchAll(/data-i18n="([^"]+)">([^<]*)</g)];
  const missing = keys
    .filter(([, key]) => !(key in strings.en) || !(key in strings.hi))
    .map(([, key]) => key);
  check("every data-i18n key has English and Hindi text", missing.length === 0, missing.join(", "));
  const drift = keys
    .filter(
      ([, key, text]) =>
        key in strings.en && decode(text) !== strings.en[key] && !["version"].includes(key),
    )
    .map(([, key]) => key);
  check("English strings match the static HTML", drift.length === 0, drift.join(", "));

  // Crawl files
  const robotsTxt = await load("/robots.txt");
  check("robots.txt returns 200", robotsTxt.status === 200, String(robotsTxt.status));
  check("robots.txt lists the sitemap", robotsTxt.text.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
  const activeRules = robotsTxt.text.split("\n").filter((line) => !line.trim().startsWith("#"));
  check(
    "robots.txt does not block the site",
    !activeRules.some((line) => /^Disallow:\s*\/\s*$/i.test(line.trim())),
  );
  const sitemap = await load("/sitemap.xml");
  check("sitemap.xml returns 200", sitemap.status === 200, String(sitemap.status));
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(
    "sitemap is a urlset with canonical URLs only",
    sitemap.text.includes("<urlset") &&
      locs.length > 0 &&
      locs.every((loc) => loc.startsWith(`${ORIGIN}/`)),
    locs.join(", "),
  );
  check("sitemap lists the canonical home page", locs.includes(`${ORIGIN}/`));
  const llms = await load("/llms.txt");
  check(
    "llms.txt returns 200 and starts with a title",
    llms.status === 200 && llms.text.startsWith("# Sahkarmi"),
    String(llms.status),
  );
  const missingPage = await load("/this-page-does-not-exist-sahkarmi");
  check("unknown URL returns 404", missingPage.status === 404, String(missingPage.status));
  check(
    "404 page is noindex",
    /<meta name="robots" content="noindex/.test(missingPage.text || (await load("/404.html")).text),
  );
  if (live) {
    const www = await fetch(live.replace("://", "://www."), { redirect: "manual" }).catch(
      () => null,
    );
    console.log(
      `INFO  www host: ${www ? `${www.status} ${www.headers.get("location") ?? ""}` : "not reachable"}`,
    );
  }

  let failed = 0;
  for (const result of results) {
    if (!result.ok) failed += 1;
    console.log(
      `${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`,
    );
  }
  console.log(
    `\n${results.length - failed} passed, ${failed} failed${live ? ` — live: ${live}` : " — local files"}`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
