export type ComposioAppCategory =
  | "developer"
  | "productivity"
  | "communication"
  | "project-management"
  | "crm"
  | "other";

export interface ComposioActionSummary {
  name: string;
  displayName: string;
  description: string;
  isSensitive: boolean;
  requiredParams: string[];
}

export interface ComposioAppMeta {
  id: string;
  name: string;
  description: string;
  category: ComposioAppCategory;
  icon: string;
  authScheme: "OAUTH2" | "API_KEY";
  isConnected: boolean;
  connectedAccountId?: string;
  popularActions: ComposioActionSummary[];
}

export interface ComposioStatus {
  configured: boolean;
  apiKeyMasked: string | null;
  connectedCount: number;
  freeTierActive: boolean;
  monthlyQuota: number;
}

export interface ComposioConnectionInitiateResult {
  connectionId: string;
  redirectUrl: string;
}

export interface ComposioExecuteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalId?: string;
}
