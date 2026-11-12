#!/usr/bin/env bun
// Adds a film to the website's video library, step by step, then rebuilds the pages.
//
//   bun scripts/add-video.ts "C:\path\to\film.mp4"      asks for the title and the rest
//   bun scripts/add-video.ts film.mp4 --title "..." --summary "..." --category "Office" --transcript script.txt --yes
//   bun scripts/add-video.ts --list                      shows what is in the library
//   bun scripts/add-video.ts --remove <id>               takes a film off the site
//   bun scripts/add-video.ts --poster <id> 4             new poster from second 4 of the film
//
// It copies the film to website/assets/videos/<id>.mp4 (made to start playing at once on phones),
// takes a poster picture, adds the film at the top of website/videos/library.json and runs
// scripts/build-video-library.ts. Needs ffmpeg and ffprobe (winget install Gyan.FFmpeg).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { LIBRARY_FILE, loadLibrary, slugFor, type Video } from "./video-library-lib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "website", "assets", "videos");
/** Above this the film is made smaller so it still plays smoothly on a phone connection. */
const MAX_MB = 40;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const yes = args.includes("--yes");
const say = (text = "") => console.log(text);
const fail = (text: string): never => {
  console.error(`\n  ✗ ${text}\n`);
  process.exit(1);
};

function run(command: string, list: string[]) {
  const result = spawnSync(command, list, { encoding: "utf8" });
  if (result.error)
    fail(`${command} is not installed. Install it with: winget install Gyan.FFmpeg`);
  return result;
}

function save(videos: Video[]) {
  writeFileSync(LIBRARY_FILE, `${JSON.stringify({ videos }, null, 2)}\n`);
}

function rebuild() {
  const result = spawnSync(process.execPath, [join(root, "scripts", "build-video-library.ts")], {
    stdio: "inherit",
  });
  if (result.status !== 0) fail("Building the video pages failed (see above).");
}

const videos = loadLibrary();

if (args.includes("--list")) {
  say(`\n  ${videos.length} films in the library (newest first):\n`);
  for (const video of videos)
    say(`  ${video.id.padEnd(28)} ${video.category.padEnd(16)} ${video.title}`);
  say();
  process.exit(0);
}

const removing = flag("remove");
if (removing) {
  const left = videos.filter((video) => video.id !== removing);
  if (left.length === videos.length) fail(`No film with the id "${removing}". See --list.`);
  for (const extension of [".mp4", ".jpg"])
    rmSync(join(assets, `${removing}${extension}`), { force: true });
  save(left);
  rebuild();
  say(`\n  ✓ Removed "${removing}". Publish to take it off the website.\n`);
  process.exit(0);
}

const reposter = flag("poster");
if (reposter) {
  const video =
    videos.find((candidate) => candidate.id === reposter) ??
    fail(`No film with the id "${reposter}". See --list.`);
  const at = Number(args[args.indexOf("--poster") + 2] ?? "");
  if (!Number.isFinite(at) || at < 0 || at >= video.seconds)
    fail(`Give a second between 0 and ${Math.floor(video.seconds)}.`);
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(at),
    "-i",
    join(assets, `${video.id}.mp4`),
    "-frames:v",
    "1",
    "-vf",
    "scale=540:-2",
    "-q:v",
    "3",
    join(assets, `${video.id}.jpg`),
  ]);
  save(
    videos.map((candidate) =>
      candidate.id === video.id ? { ...candidate, posterAt: at } : candidate,
    ),
  );
  rebuild();
  say(`
  ✓ New poster for "${video.id}" from second ${at}.
`);
  process.exit(0);
}

const ask = createInterface({ input: process.stdin, output: process.stdout });
async function question(text: string, fallback = "") {
  if (yes) return fallback;
  const answer = (await ask.question(`  ${text}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback;
}

say("\n  Add a film to the Sahkarmi video library\n  ----------------------------------------");

// 1. The film
let source = (
  args.find((arg) => !arg.startsWith("--") && !args[args.indexOf(arg) - 1]?.startsWith("--")) ?? ""
).replace(/^"|"$/g, "");
if (!source)
  source = (await question("1. Drag the .mp4 file here and press Enter")).replace(
    /^["']|["']$/g,
    "",
  );
if (!existsSync(source)) fail(`File not found: ${source}`);
if (extname(source).toLowerCase() !== ".mp4") fail("The film must be an .mp4 file.");

const probe = run("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration:stream=codec_type,codec_name,width,height",
  "-of",
  "json",
  source,
]);
const info = JSON.parse(probe.stdout || "{}") as {
  format?: { duration?: string };
  streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[];
};
const picture = info.streams?.find((stream) => stream.codec_type === "video");
if (!picture?.width || !picture.height) fail("This file has no video picture.");
const seconds = Math.round(Number(info.format?.duration ?? 0) * 10) / 10;
const megabytes = statSync(source).size / 1_000_000;
say(
  `     ${picture.width}×${picture.height}, ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")} long, ${megabytes.toFixed(1)} MB`,
);

// 2. Words people see
const suggested = basename(source, extname(source))
  .replace(/^Sahkarmi[_ -]*/i, "")
  .replace(/[_-]+(English|Hindi|EN|HI)$/i, "")
  .replace(/[_-]+/g, " ")
  .trim();
const title =
  flag("title") ?? (await question("2. Title (what the film shows, 30-60 letters)", suggested));
if (title.length < 8) fail("Please give the film a real title.");
const summary =
  flag("summary") ??
  (await question("3. One or two sentences about the film (shown under the title)"));
if (summary.length < 30)
  fail("The summary should be at least one full sentence (30 letters or more).");
const categories = [...new Set(videos.map((video) => video.category))];
if (!flag("category") && !yes)
  say(
    `     Groups so far: ${categories.map((name, index) => `${index + 1}. ${name}`).join("   ")}`,
  );
const picked =
  flag("category") ?? (await question("4. Group: type a number from the list, or a new name", "1"));
const category = /^\d+$/.test(picked)
  ? (categories[Number(picked) - 1] ?? fail("No group with that number."))
  : picked;
const transcriptFile =
  flag("transcript") ??
  (await question(
    "5. Words spoken in the film: drag a .txt, .srt or script.json here (or press Enter to skip)",
  ));

function readTranscript(file: string): string[] {
  if (!file) return [];
  const path = file.replace(/^["']|["']$/g, "");
  if (!existsSync(path)) fail(`Transcript file not found: ${path}`);
  const text = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text) as {
      en?: { lines?: { text?: string }[] };
      lines?: { text?: string }[];
    };
    return (data.en?.lines ?? data.lines ?? [])
      .map((line) => (line.text ?? "").trim())
      .filter(Boolean);
  }
  if (path.toLowerCase().endsWith(".srt") || path.toLowerCase().endsWith(".vtt")) {
    return text
      .split(/\r?\n\r?\n/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter(
            (line) => line && !/^\d+$/.test(line) && !line.includes("-->") && line !== "WEBVTT",
          )
          .join(" ")
          .trim(),
      )
      .filter(Boolean);
  }
  return text
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
const transcript = readTranscript(transcriptFile);
ask.close();

// 3. Copy the film, ready for phones
const id = flag("id") ?? slugFor(title, new Set(videos.map((video) => video.id)));
const target = join(assets, `${id}.mp4`);
say(`\n  Preparing "${id}" …`);
const tooBig = megabytes > MAX_MB || picture.codec_name !== "h264";
const prepared = tooBig
  ? run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "24",
      "-vf",
      "scale='min(1080,iw)':-2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      target,
    ])
  : // Same picture and sound, only reordered so playback starts before the whole file arrives.
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      target,
    ]);
if (prepared.status !== 0) {
  copyFileSync(source, target);
  say("     (could not optimise the file; it was copied as it is)");
} else if (tooBig) {
  say(`     made smaller for phones: ${(statSync(target).size / 1_000_000).toFixed(1)} MB`);
}
const posterAt = Number(flag("poster-at") ?? Math.min(1.5, seconds / 3));
run("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-ss",
  String(posterAt),
  "-i",
  target,
  "-frames:v",
  "1",
  "-vf",
  "scale=540:-2",
  "-q:v",
  "3",
  join(assets, `${id}.jpg`),
]);

const video: Video = {
  id,
  title,
  summary,
  category,
  seconds,
  date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  width: picture.width,
  height: picture.height,
  posterAt,
  transcript,
};
save([video, ...videos]);
rebuild();
say(`
  ✓ Added "${title}"
    Page:    https://sahkarmi.site/videos/${id}.html   (live after publishing)
    Poster:  website/assets/videos/${id}.jpg   (not happy? bun scripts/add-video.ts --poster ${id} 4)
`);
