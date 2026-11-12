// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clock,
  isoDuration,
  loadLibrary,
  renderVideoPages,
  slugFor,
  videoUrls,
  withHomeTeaser,
  withVideoSitemap,
} from "./video-library-lib";

const site = join(__dirname, "..", "website");
const videos = loadLibrary();
const pages = renderVideoPages(videos);

describe("website video library", () => {
  it("has a film file and poster for every entry, and no strays", () => {
    const ids = new Set<string>();
    for (const video of videos) {
      expect(ids.has(video.id), `${video.id} duplicate`).toBe(false);
      ids.add(video.id);
      expect(video.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(existsSync(join(site, "assets", "videos", `${video.id}.mp4`)), video.id).toBe(true);
      expect(existsSync(join(site, "assets", "videos", `${video.id}.jpg`)), video.id).toBe(true);
      expect(video.seconds).toBeGreaterThan(0);
      expect(video.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const name of readdirSync(join(site, "assets", "videos"))) {
      expect(ids.has(name.replace(/\.(mp4|jpg)$/, "")), `${name} is not in library.json`).toBe(
        true,
      );
    }
  });

  it("are up to date (run: bun scripts/build-video-library.ts)", () => {
    for (const [path, html] of pages) {
      expect(readFileSync(join(site, path), "utf8"), path).toBe(html);
    }
    const onDisk = readdirSync(join(site, "videos")).filter((name) => name.endsWith(".html"));
    expect(onDisk.length).toBe(pages.size);
    const sitemap = readFileSync(join(site, "sitemap.xml"), "utf8");
    expect(withVideoSitemap(sitemap, videos)).toBe(sitemap);
    for (const url of videoUrls(videos)) expect(sitemap).toContain(`<loc>${url}</loc>`);
    const home = readFileSync(join(site, "index.html"), "utf8");
    expect(withHomeTeaser(home, videos)).toBe(home);
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
      expect(html).toContain(
        `<link rel="canonical" href="https://sahkarmi.site/${path.replace("index.html", "")}" />`,
      );
      expect(html).toContain('<meta name="robots" content="index, follow');
      const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
      const graph = JSON.parse(json ?? "")["@graph"] as { "@type": string }[];
      expect(
        graph.some((node) => node["@type"] === "BreadcrumbList"),
        path,
      ).toBe(true);
      // The player data is plain JSON for the script, never markup.
      const data = html.match(
        /<script type="application\/json" id="video-data">([^<]*)<\/script>/,
      )?.[1];
      expect(JSON.parse(data ?? "").length).toBeGreaterThan(0);
    }
  });

  it("gives every watch page a complete VideoObject with the film as its main content", () => {
    for (const video of videos) {
      const html = pages.get(`videos/${video.id}.html`) ?? "";
      const graph = JSON.parse(
        html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "",
      )["@graph"] as Record<string, unknown>[];
      const object = graph.find((node) => node["@type"] === "VideoObject");
      expect(object, video.id).toMatchObject({
        name: video.title,
        duration: isoDuration(video.seconds),
        contentUrl: `https://sahkarmi.site/assets/videos/${video.id}.mp4`,
        thumbnailUrl: [`https://sahkarmi.site/assets/videos/${video.id}.jpg`],
      });
      expect(String(object?.uploadDate)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(html).toContain(`<video id="vmain" controls playsinline`);
    }
  });

  it("formats lengths and makes ids", () => {
    expect(clock(81.4)).toBe("1:21");
    expect(isoDuration(125.1)).toBe("PT2M5S");
    expect(slugFor("Clinic front desk: how to!", new Set())).toBe("clinic-front-desk-how-to");
    expect(slugFor("HR", new Set(["hr"]))).toBe("hr-2");
  });
});
