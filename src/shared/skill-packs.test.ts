// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ALLOWED_LICENCES, creditForRepo, OPEN_SOURCE_CREDITS } from "./open-source-credits";
import {
  PACK_NOTICE_TEXT,
  packSkillPath,
  packSource,
  parsePackSource,
  SKILL_PACKS,
} from "./skill-packs";

/** Upstream names must never reach pack titles, summaries or ids (owner rule). */
const UPSTREAM =
  /anthropic|claude|cowork|corey|haines|mohit|nextlevel|evolsb|sheehan|mukul|mahipal|tuan|knowledge-work|github/i;

describe("skill pack catalog", () => {
  it("parses: every pack is pinned to a full commit with an allowed licence and a credit", () => {
    expect(SKILL_PACKS.length).toBeGreaterThanOrEqual(15);
    const ids = new Set<string>();
    for (const pack of SKILL_PACKS) {
      expect(pack.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(pack.id)).toBe(false);
      ids.add(pack.id);
      expect(pack.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(ALLOWED_LICENCES).toContain(pack.licence);
      expect(pack.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      const credit = creditForRepo(pack.repo);
      expect(credit, pack.id).toBeDefined();
      expect(credit?.licence).toBe(pack.licence);
      expect(pack.skills.length).toBeGreaterThan(0);
      expect(new Set(pack.skills).size).toBe(pack.skills.length);
      for (const skill of pack.skills) {
        const path = packSkillPath(pack, skill);
        expect(path.split("/").includes("..")).toBe(false);
        expect(parsePackSource(packSource(pack.id, skill))).toEqual({ packId: pack.id, skill });
      }
      expect(`${pack.id} ${pack.title} ${pack.summary}`).not.toMatch(UPSTREAM);
    }
  });

  it("marks legal and privacy packs as not legal advice", () => {
    for (const id of ["legal", "contract-review", "privacy-dpdp"]) {
      const pack = SKILL_PACKS.find((entry) => entry.id === id);
      expect(pack?.notice).toBe("legal");
      expect(pack?.title).toMatch(/not legal advice/);
    }
    expect(PACK_NOTICE_TEXT.legal).toMatch(/^Not legal advice/);
  });

  it("keeps the privacy pack to the India DPDP Act and GDPR", () => {
    const pack = SKILL_PACKS.find((entry) => entry.id === "privacy-dpdp");
    expect(
      pack?.skills.every((skill) => /^(india-dpdp-act|conducting-gdpr-dpia|gdpr-)/.test(skill)),
    ).toBe(true);
  });

  it("never offers a skill it lists as skipped", () => {
    for (const pack of SKILL_PACKS) {
      for (const skipped of pack.skipped) expect(pack.skills).not.toContain(skipped.skill);
    }
  });
});

describe("open-source credits", () => {
  it("has a project URL, allowed licence and copyright line for every entry", () => {
    const urls = new Set<string>();
    for (const credit of OPEN_SOURCE_CREDITS) {
      expect(urls.has(credit.url)).toBe(false);
      urls.add(credit.url);
      expect(credit.name.length).toBeGreaterThan(0);
      expect(credit.url).toMatch(/^https:\/\//);
      expect(ALLOWED_LICENCES as readonly string[]).toContain(credit.licence);
      expect(credit.copyright).toMatch(/copyright/i);
      expect(credit.notice === undefined || typeof credit.notice === "string").toBe(true);
    }
  });
});
