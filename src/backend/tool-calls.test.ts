import { describe, expect, it } from "vitest";
import { toolCallFromItem } from "./tool-calls";

describe("toolCallFromItem", () => {
  it("ignores normal messages", () => {
    expect(toolCallFromItem({ type: "agentMessage", id: "a", text: "hi" }, true)).toBeNull();
  });

  it("labels browser and approval tools for the cards", () => {
    expect(
      toolCallFromItem(
        {
          type: "dynamicToolCall",
          id: "b",
          namespace: "sahkarmi_browser",
          tool: "snapshot",
          arguments: { tabId: "t1" },
        },
        false,
      ),
    ).toMatchObject({ name: "Read page", kind: "browser", status: "running" });
    expect(
      toolCallFromItem(
        {
          type: "toolUse",
          id: "c",
          tool: "mcp__sahkarmi__request_approval",
          arguments: { title: "Pay" },
          output: "pending",
          status: "completed",
        },
        true,
      ),
    ).toMatchObject({
      name: "Ask for approval",
      kind: "approval",
      status: "completed",
      output: "pending",
    });
  });

  it("marks failures and clips long output", () => {
    const tool = toolCallFromItem(
      {
        type: "commandExecution",
        id: "d",
        command: ["npm", "test"],
        aggregatedOutput: "x".repeat(5_000),
        status: "failed",
      },
      true,
    );
    expect(tool?.status).toBe("failed");
    expect(tool?.input).toBe("npm test");
    expect(tool?.output?.length).toBeLessThan(4_100);
  });
});
