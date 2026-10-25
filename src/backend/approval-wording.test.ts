import { describe, expect, it } from "vitest";
import { describePermissionRequest } from "./approval-wording";
import { classifyAcpTool } from "./permission-policy";

const ROOTS = {
  shared: "C:\\Users\\me\\Sahkarmi\\Shared",
  own: "C:\\Users\\me\\Sahkarmi\\Coworkers\\asha",
};

describe("describePermissionRequest", () => {
  it("explains a command in plain words and folds the raw command away", () => {
    const action = `python -c "open(r'C:\\Users\\me\\Sahkarmi\\Shared\\gst\\working.md').read()"`;
    const card = describePermissionRequest(
      { botId: "asha", provider: "antigravity", category: "shell", action, paths: [] },
      "Asha",
      ROOTS,
    );
    expect(card.title).toBe("Asha wants to run a command on your computer");
    expect(card.details).toContain("Files: working.md");
    expect(card.details).toContain("Where: your Shared folder");
    expect(card.details).not.toContain("python");
    expect(card.technical).toBe(action);
  });

  it("warns about money for payments", () => {
    const card = describePermissionRequest(
      {
        botId: "asha",
        provider: "claude",
        category: "payments",
        action: "click Pay now",
        paths: [],
      },
      "Asha",
      ROOTS,
    );
    expect(card.title).toBe("Asha wants to make a payment");
    expect(card.details).toContain("Money may leave your account.");
  });
});

describe("classifyAcpTool", () => {
  it("does not treat Sahkarmi's own tools as shell commands", () => {
    expect(classifyAcpTool(null, "sahkarmi_save_memory", [], {})).toBe("research");
    expect(classifyAcpTool(null, "sahkarmi_request_approval", [], {})).toBe("research");
    expect(classifyAcpTool(null, "something_else", [], {})).toBe("shell");
  });
});
