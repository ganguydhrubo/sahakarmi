import { describe, expect, it } from "vitest";
import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES, isBotTemplateRef } from "../ipc";
import {
  AGENT_CAPABILITIES,
  AGENT_CATALOG,
  AGENT_CATEGORIES,
  agentBrief,
  agentSearchText,
  briefHash,
  coworkerFromTemplate,
  findAgentTemplate,
} from "./index";

const ORIGINAL_IDS = [
  "gst-accountant",
  "sales-follow-up",
  "customer-support",
  "social-media-writer",
  "inventory-planner",
  "hiring-partner",
  "research-analyst",
  "meeting-notes",
  "payment-reminders",
  "marketplace-seller",
  "translator",
  "operations-planner",
];

describe("agent catalogue", () => {
  it("keeps the twelve original agents with their ids", () => {
    for (const id of ORIGINAL_IDS) expect(findAgentTemplate(id)?.version).toBeGreaterThan(1);
  });

  it("has unique, well-formed ids and covers every category", () => {
    const ids = AGENT_CATALOG.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
    for (const category of AGENT_CATEGORIES) {
      expect(AGENT_CATALOG.some((agent) => agent.category === category)).toBe(true);
    }
  });

  it("gives every agent a complete, valid definition", () => {
    for (const agent of AGENT_CATALOG) {
      const where = agent.id;
      expect(agent.name.length, where).toBeGreaterThan(0);
      expect(agent.requiredInputs.length, where).toBeGreaterThan(0);
      expect(agent.workflow.length, where).toBeGreaterThanOrEqual(3);
      expect(agent.validation.length, where).toBeGreaterThanOrEqual(2);
      expect(agent.outputs.length, where).toBeGreaterThanOrEqual(1);
      expect(agent.completion.length, where).toBeGreaterThan(0);
      expect(
        agent.capabilities.every((item) => AGENT_CAPABILITIES.includes(item)),
        where,
      ).toBe(true);
      expect(BOT_AVATAR_SHAPES).toContain(agent.avatarShape);
      expect(BOT_AVATAR_COLORS).toContain(agent.avatarColor);
      if (agent.availability === "needs-setup") {
        expect(
          agent.integrations.some((service) => service.via === "setup"),
          where,
        ).toBe(true);
      }
    }
  });

  it("writes briefs that fit a coworker description and follow the lifecycle", () => {
    for (const agent of AGENT_CATALOG) {
      const brief = agentBrief(agent);
      expect(brief.length, agent.id).toBeLessThanOrEqual(4_000);
      for (const step of ["UNDERSTAND", "COLLECT", "PLAN", "EXECUTE", "VALIDATE", "DELIVER"]) {
        expect(brief, agent.id).toContain(step);
      }
    }
  });

  it("never ends a text with the word import", () => {
    // electron-vite's ESM shim scans the main bundle for `import "…"` and would inject code
    // inside a string such as "data import", breaking the production build.
    const texts = JSON.stringify(AGENT_CATALOG).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    expect(texts.filter((text) => /(^|[\s;"])import\s*"$/.test(text))).toEqual([]);
  });

  it("marks legal agents as assistants, not lawyers", () => {
    for (const agent of AGENT_CATALOG.filter((item) => item.category === "legal")) {
      expect(agent.limits, agent.id).toBeTruthy();
    }
  });

  it("finds agents by job function as well as by name", () => {
    const text = agentSearchText(findAgentTemplate("gst-accountant")!);
    expect(text).toContain("gstr-3b");
    expect(
      AGENT_CATALOG.filter((agent) => agentSearchText(agent).includes("seo")).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("stamps a coworker with its template and a brief fingerprint", () => {
    const agent = findAgentTemplate("software-engineering-team")!;
    const coworker = coworkerFromTemplate(agent);
    expect(isBotTemplateRef(coworker.template)).toBe(true);
    expect(coworker.template.briefHash).toBe(briefHash(coworker.description));
    expect(briefHash(`${coworker.description} edited`)).not.toBe(coworker.template.briefHash);
    expect(agent.capabilities).toContain("delegation");
  });
});
