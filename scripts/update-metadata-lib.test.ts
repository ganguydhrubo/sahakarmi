// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rewriteLatestYml } from "./update-metadata-lib";

const LATEST = `version: 0.23.0
files:
  - url: Sahkarmi-0.23.0-x64.exe
    sha512: OLDHASHunsigned==
    size: 100
path: Sahkarmi-0.23.0-x64.exe
sha512: OLDHASHunsigned==
releaseDate: '2026-11-06T10:00:00.000Z'
`;

describe("rewriteLatestYml", () => {
  it("replaces every sha512 and the size after signing, keeping the rest", () => {
    const next = rewriteLatestYml(LATEST, {
      fileName: "Sahkarmi-0.23.0-x64.exe",
      sha512: "NEWsigned+/==",
      size: 4242,
    });
    expect(next).toBe(`version: 0.23.0
files:
  - url: Sahkarmi-0.23.0-x64.exe
    sha512: NEWsigned+/==
    size: 4242
path: Sahkarmi-0.23.0-x64.exe
sha512: NEWsigned+/==
releaseDate: '2026-11-06T10:00:00.000Z'
`);
  });

  it("refuses a file name that latest.yml does not describe", () => {
    expect(() => rewriteLatestYml(LATEST, { fileName: "Other.exe", sha512: "x", size: 1 })).toThrow(
      /not Other.exe/,
    );
  });

  it("refuses metadata with more than one file", () => {
    const two = LATEST.replace("path:", "  - url: Second.exe\n    sha512: abc\n    size: 2\npath:");
    expect(() =>
      rewriteLatestYml(two, { fileName: "Sahkarmi-0.23.0-x64.exe", sha512: "x", size: 1 }),
    ).toThrow(/exactly one/);
  });
});
