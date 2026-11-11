#!/usr/bin/env bun
// Writes website/coworkers/*.html and the coworker block of website/sitemap.xml from the
// Marketplace catalogue. Run after changing src/shared/agent-catalog: bun scripts/build-coworker-pages.ts
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCoworkerPages, withCoworkerSitemap } from "./coworker-pages-lib";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const pages = renderCoworkerPages();
const folder = join(site, "coworkers");
mkdirSync(folder, { recursive: true });
// Remove pages of coworkers that left the catalogue.
for (const name of readdirSync(folder))
  if (!pages.has(`coworkers/${name}`)) rmSync(join(folder, name));
for (const [path, html] of pages) writeFileSync(join(site, path), html);

const sitemapFile = join(site, "sitemap.xml");
writeFileSync(sitemapFile, withCoworkerSitemap(readFileSync(sitemapFile, "utf8")));
console.log(`Wrote ${pages.size} coworker pages and updated sitemap.xml.`);
