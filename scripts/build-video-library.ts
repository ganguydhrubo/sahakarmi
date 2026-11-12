#!/usr/bin/env bun
// Writes website/videos/*.html and the video block of website/sitemap.xml from
// website/videos/library.json. Run after editing the library: bun scripts/build-video-library.ts
// (scripts/add-video.ts runs this for you).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderVideoPages, withHomeTeaser, withVideoSitemap } from "./video-library-lib";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const pages = renderVideoPages();
const folder = join(site, "videos");
mkdirSync(folder, { recursive: true });
// Remove pages of films that left the library (library.json itself stays).
for (const name of readdirSync(folder))
  if (name.endsWith(".html") && !pages.has(`videos/${name}`)) rmSync(join(folder, name));
for (const [path, html] of pages) writeFileSync(join(site, path), html);

const sitemapFile = join(site, "sitemap.xml");
writeFileSync(sitemapFile, withVideoSitemap(readFileSync(sitemapFile, "utf8")));
const homeFile = join(site, "index.html");
writeFileSync(homeFile, withHomeTeaser(readFileSync(homeFile, "utf8")));
console.log(`Wrote ${pages.size} video pages and updated sitemap.xml and the home page row.`);
