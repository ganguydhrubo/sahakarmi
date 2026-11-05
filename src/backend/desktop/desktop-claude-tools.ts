import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ZodTypeAny, z } from "zod";
import {
  DESKTOP_TOOL_DEFINITIONS,
  desktopControlSupported,
  SAHKARMI_DESKTOP_NAMESPACE,
} from "./desktop-tools";

interface PropertySchema {
  type?: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
}

/** The few JSON Schema shapes the desktop tools use, as zod (the Claude SDK takes zod). */
export function zodShape(
  properties: Record<string, PropertySchema>,
  required: readonly string[],
): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(properties)) {
    let field: ZodTypeAny;
    if (schema.enum) {
      field = z.enum(schema.enum as [string, ...string[]]);
    } else if (schema.type === "integer" || schema.type === "number") {
      let number = schema.type === "integer" ? z.number().int() : z.number();
      if (schema.minimum !== undefined) number = number.min(schema.minimum);
      if (schema.maximum !== undefined) number = number.max(schema.maximum);
      field = number;
    } else if (schema.type === "boolean") {
      field = z.boolean();
    } else {
      let text = z.string();
      if (schema.minLength !== undefined) text = text.min(schema.minLength);
      if (schema.maxLength !== undefined) text = text.max(schema.maxLength);
      field = text;
    }
    if (schema.description) field = field.describe(schema.description);
    shape[key] = required.includes(key) ? field : field.optional();
  }
  return shape;
}

/**
 * The sahkarmi_desktop tools as a Claude SDK MCP server (mcp__sahkarmi_desktop__click, …).
 * `call` is the Claude client's dynamic-tool bridge, so the calls reach AgentService exactly
 * like the browser tools do. Empty off Windows.
 */
export function desktopSdkServers(
  call: (namespace: string, name: string, args: unknown) => Promise<CallToolResult>,
  platform: NodeJS.Platform = process.platform,
): Record<string, ReturnType<typeof createSdkMcpServer>> {
  if (!desktopControlSupported(platform)) return {};
  return {
    [SAHKARMI_DESKTOP_NAMESPACE]: createSdkMcpServer({
      name: SAHKARMI_DESKTOP_NAMESPACE,
      version: "0.1.0",
      tools: DESKTOP_TOOL_DEFINITIONS.map((definition) =>
        tool(
          definition.name,
          definition.description,
          zodShape(
            definition.inputSchema.properties as Record<string, PropertySchema>,
            definition.inputSchema.required,
          ),
          (args) => call(SAHKARMI_DESKTOP_NAMESPACE, definition.name, args),
        ),
      ),
    }),
  };
}
