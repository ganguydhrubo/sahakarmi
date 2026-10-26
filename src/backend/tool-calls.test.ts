import { describe, expect, it } from "vitest";
import { toolCallFromItem } from "./tool-calls";

describe("toolCallFromItem", () => {
  it("ignores normal messages", () => {
    expect(toolCallFromItem({ type: "agentMessage", id: "a", text: "hi" }, true)).toBeNull();
    // Task-list tools are shown as the plan card instead of tool rows.
    for (const tool of ["update_plan", "mcp__sahkarmi__update_plan", "TodoWrite", "TaskUpdate"]) {
      expect(toolCallFromItem({ type: "toolUse", id: "p", tool, arguments: {} }, false)).toBeNull();
    }
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

  it("does not count Claude's ToolSearch as a web action", () => {
    expect(
      toolCallFromItem({ type: "toolUse", id: "s", tool: "ToolSearch", arguments: {} }, true),
    ).toMatchObject({ kind: "tool" });
    expect(
      toolCallFromItem({ type: "toolUse", id: "w", tool: "WebSearch", arguments: {} }, true),
    ).toMatchObject({ kind: "web" });
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
