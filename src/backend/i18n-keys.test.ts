// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "../renderer/src");

/** The top-level keys of the object literal that starts at `start`. */
function keysOf(text: string, start: number): string[] {
  const from = text.indexOf("{", start);
  let depth = 0;
  let end = from;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  return [...text.slice(from, end).matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] as string);
}

describe("English texts", () => {
  it("never define the same key in two packs, where the later one would silently win", () => {
    const main = readFileSync(join(DIR, "i18n.ts"), "utf8");
    const files = new Map<string, string>();
    for (const match of main.matchAll(/import \{ (\w+)En\b[^}]*\} from "\.\/(i18n-[\w-]+)"/g)) {
      files.set(match[1] as string, `${match[2]}.ts`);
    }
    const owner = new Map<string, string>();
    for (const key of keysOf(main, main.indexOf("const en"))) owner.set(key, "i18n.ts");
    const clashes: string[] = [];
    for (const match of main.matchAll(/\.\.\.(\w+)En,/g)) {
      const file = files.get(match[1] as string);
      if (!file) continue;
      const text = readFileSync(join(DIR, file), "utf8");
      const start = text.search(new RegExp(`export const ${match[1]}En\\b`));
      for (const key of keysOf(text, start)) {
        const earlier = owner.get(key);
        if (earlier) clashes.push(`${key}: ${earlier} and ${file}`);
        owner.set(key, file);
      }
    }
    expect(clashes).toEqual([]);
  });
});
