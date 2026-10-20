import { describe, expect, it } from "vitest";
import { profileForRole, suggestModels } from "./model-profiles";

describe("model suggestions", () => {
  it("maps roles to task profiles in English and Hindi", () => {
    expect(profileForRole("Accounts")).toBe("analysis");
    expect(profileForRole("Research")).toBe("analysis");
    expect(profileForRole("Content")).toBe("writing");
    expect(profileForRole("सपोर्ट")).toBe("quick");
    expect(profileForRole("Office manager")).toBe("general");
  });

  it("keeps a free coworker on free models and marks any paid alternative", () => {
    const result = suggestModels("analysis", "opencode-free", ["opencode", "gemini", "claude"]);
    expect(result.sameCost).toEqual({ model: "gemini-pro", movesToPaid: false });
    expect(result.paidAlternative).toEqual({ model: "claude-opus-5", movesToPaid: true });
  });

  it("suggests nothing when the coworker already uses the best connected option", () => {
    expect(suggestModels("quick", "opencode-free", ["opencode"])).toEqual({
      sameCost: null,
      paidAlternative: null,
    });
  });

  it("never suggests a provider that is not connected", () => {
    const result = suggestModels("writing", "gpt-5.6-luna", ["codex"]);
    expect(result.sameCost?.model).toBe("gpt-5.6-terra");
    expect(result.paidAlternative).toBeNull();
  });
});
