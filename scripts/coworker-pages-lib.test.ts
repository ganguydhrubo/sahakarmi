// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "../src/shared/agent-catalog";
import { coworkerUrls, renderCoworkerPages, withCoworkerSitemap } from "./coworker-pages-lib";

const site = join(__dirname, "..", "website");
const pages = renderCoworkerPages();

describe("website coworker pages", () => {
  it("has one page per Marketplace coworker, plus categories and the hub", () => {
    expect(pages.size).toBe(AGENT_CATALOG.length + 16);
  });

  it("are up to date (run: bun scripts/build-coworker-pages.ts)", () => {
    for (const [path, html] of pages) {
      const file = join(site, path);
      expect(existsSync(file), path).toBe(true);
      expect(readFileSync(file, "utf8"), path).toBe(html);
    }
    expect(readdirSync(join(site, "coworkers")).length).toBe(pages.size);
    const sitemap = readFileSync(join(site, "sitemap.xml"), "utf8");
    expect(withCoworkerSitemap(sitemap)).toBe(sitemap);
  });

  it("meet the site's title, description, h1 and structured-data rules", () => {
    const titles = new Set<string>();
    for (const [path, html] of pages) {
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(title.length, `${path} title`).toBeGreaterThanOrEqual(30);
      expect(title.length, `${path} title`).toBeLessThanOrEqual(70);
      expect(titles.has(title), `${path} duplicate title`).toBe(false);
      titles.add(title);
      const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
      expect(description.length, `${path} description`).toBeGreaterThanOrEqual(50);
      expect(description.length, `${path} description`).toBeLessThanOrEqual(170);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path} h1`).toBe(1);
      const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
      const graph = JSON.parse(json ?? "")["@graph"];
      const faq = graph.find((node: { "@type": string }) => node["@type"] === "FAQPage");
      const visible = [...html.matchAll(/<summary>([^<]*)<\/summary>/g)].length;
      expect(faq.mainEntity.length, `${path} FAQ matches visible questions`).toBe(visible);
    }
  });

  it("only link to pages that exist", () => {
    const known = new Set(coworkerUrls().map((url) => new URL(url).pathname));
    for (const [path, html] of pages) {
      for (const [, href] of html.matchAll(/href="(\/coworkers\/[^"#]*)"/g)) {
        expect(known.has(href), `${path} links to ${href}`).toBe(true);
      }
    }
  });
});
