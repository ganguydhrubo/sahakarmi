/** The shapes the renderer sees live in shared/ipc.ts; the backend re-exports them here. */
export type {
  ComposioAppMeta,
  ComposioConnectionInitiateResult,
  ComposioConnectionState,
  ComposioConnectionStatus,
  ComposioStatus,
} from "../../shared/ipc";

export interface ComposioExecuteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalId?: string;
}

/** A tool as handed to the agent runtimes (same shape as the browser and Sahkarmi tools). */
export interface ComposioDynamicTool {
  type: "function";
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** One toolkit from Composio's catalogue, trimmed to what the app needs. */
export interface ComposioToolkitRecord {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  toolsCount: number | null;
  authSchemes: string[];
  managedAuthSchemes: string[];
  noAuth: boolean;
}

/** One tool of a toolkit, with the real input schema Composio publishes for it. */
export interface ComposioToolRecord {
  slug: string;
  name: string;
  description: string;
  toolkitSlug: string;
  toolkitName: string;
  inputParameters: Record<string, unknown>;
}

export interface ComposioConnection {
  id: string;
  toolkitSlug: string;
  status: string;
  userId: string | null;
}
