import { describe, expect, it } from "vitest";
import { coworkerFromTemplate, findAgentTemplate } from "../../../shared/agent-catalog";
import type { BotProfile } from "../data";
import { coworkerForTemplate, templateUpdate } from "./MarketplaceView";

const agent = findAgentTemplate("gst-accountant")!;

function bot(overrides: Partial<BotProfile>): BotProfile {
  return {
    id: "b1",
    workspaceId: "w",
    name: "Someone",
    role: "",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: null,
    accent: "orange",
    avatarShape: "blob",
    avatarColor: "orange",
    time: "now",
    preview: "",
    ...overrides,
  } as BotProfile;
}

describe("Marketplace template updates", () => {
  it("matches coworkers by template, and older ones by name and role", () => {
    const stamped = bot({
      id: "a",
      name: "My GST person",
      template: { id: agent.id, version: 2, briefHash: "00000000" },
    });
    const legacy = bot({ id: "b", name: agent.name, role: agent.role });
    expect(coworkerForTemplate([stamped, legacy], agent)?.id).toBe("a");
    expect(coworkerForTemplate([legacy], agent)?.id).toBe("b");
    expect(coworkerForTemplate([bot({})], agent)).toBeUndefined();
  });

  it("offers an update only for an older version, and flags owner edits", () => {
    const fields = coworkerFromTemplate(agent);
    const current = bot({ ...fields });
    expect(templateUpdate(current, agent)).toEqual({ available: false, customized: false });
    const older = bot({ ...fields, template: { ...fields.template, version: 1 } });
    expect(templateUpdate(older, agent)).toEqual({ available: true, customized: false });
    const edited = bot({
      ...fields,
      description: `${fields.description}\nAlso check e-way bills.`,
      template: { ...fields.template, version: 1 },
    });
    expect(templateUpdate(edited, agent)).toEqual({ available: true, customized: true });
  });

  it("treats coworkers added before versioning as possibly edited", () => {
    const legacy = bot({ name: agent.name, role: agent.role, description: "old short remit" });
    expect(templateUpdate(legacy, agent)).toEqual({ available: true, customized: true });
  });
});
