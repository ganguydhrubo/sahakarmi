// @vitest-environment node

import { describe, expect, it } from "vitest";
import { codexMcpToolApproval } from "./agent-service";

describe("Codex MCP tool approval", () => {
  it("reads Codex's 'Allow <server> to run tool' request", () => {
    expect(
      codexMcpToolApproval({
        threadId: "t1",
        turnId: "u1",
        serverName: "sim-tools",
        mode: "form",
        message: 'Allow the sim-tools MCP server to run tool "add"?',
        requestedSchema: { type: "object", properties: {} },
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          tool_name: "add",
          tool_params: { a: 1, b: 2 },
        },
      }),
    ).toEqual({ server: "sim-tools", tool: "add", input: { a: 1, b: 2 } });
  });

  it("reads the tool name from the question when Codex leaves tool_name out", () => {
    expect(
      codexMcpToolApproval({
        threadId: "t1",
        serverName: "sim-tools",
        mode: "form",
        message: 'Allow the sim-tools MCP server to run tool "secret_word"?',
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          persist: ["session", "always"],
          tool_description: "Returns the word",
          tool_params: {},
          tool_params_display: [],
        },
      }),
    ).toEqual({ server: "sim-tools", tool: "secret_word", input: {} });
  });

  it("leaves a real form from a server alone", () => {
    expect(
      codexMcpToolApproval({ serverName: "x", mode: "form", message: "Your name?", _meta: null }),
    ).toBeNull();
    expect(codexMcpToolApproval(null)).toBeNull();
    expect(
      codexMcpToolApproval({ serverName: "", _meta: { codex_approval_kind: "mcp_tool_call" } }),
    ).toBeNull();
  });
});
