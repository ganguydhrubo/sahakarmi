import { randomUUID } from "node:crypto";
import type { AgentExecutionInstance, BotSummary, OrchestratorSpecialistRole } from "../shared/ipc";

interface RoleMapping {
  botId: string;
  defaultName: string;
  defaultPermissions: string[];
}

const ROLE_MAPPINGS: Record<OrchestratorSpecialistRole, RoleMapping> = {
  orchestrator: {
    botId: "mitra-lead",
    defaultName: "Mitra",
    defaultPermissions: ["read_file", "list_files"],
  },
  architect: {
    botId: "dev-code",
    defaultName: "Dev",
    defaultPermissions: ["read_file", "list_files", "execute_command"],
  },
  code: {
    botId: "dev-code",
    defaultName: "Dev",
    defaultPermissions: [
      "read_file",
      "write_file",
      "list_files",
      "execute_command",
      "run_tests",
      "check_types",
      "run_lint",
    ],
  },
  backend: {
    botId: "dev-code",
    defaultName: "Dev",
    defaultPermissions: [
      "read_file",
      "write_file",
      "list_files",
      "execute_command",
      "run_tests",
      "check_types",
    ],
  },
  frontend: {
    botId: "kavya-content",
    defaultName: "Kavya",
    defaultPermissions: ["read_file", "write_file", "list_files", "check_types", "run_lint"],
  },
  qa: {
    botId: "tara-ops",
    defaultName: "Tara",
    defaultPermissions: [
      "read_file",
      "list_files",
      "run_tests",
      "check_types",
      "run_lint",
      "execute_command",
    ],
  },
  security: {
    botId: "kabir-security",
    defaultName: "Kabir",
    defaultPermissions: ["read_file", "list_files", "check_types", "run_lint"],
  },
  research: {
    botId: "arjun-research",
    defaultName: "Arjun",
    defaultPermissions: ["read_file", "list_files"],
  },
  finance: {
    botId: "asha-accounts",
    defaultName: "Asha",
    defaultPermissions: ["read_file", "list_files", "write_file"],
  },
  ops: {
    botId: "tara-ops",
    defaultName: "Tara",
    defaultPermissions: ["read_file", "list_files", "execute_command"],
  },
};

export class AgentExecutionFactory {
  createInstance(
    role: OrchestratorSpecialistRole,
    workspacePath: string,
    existingBots: BotSummary[] = [],
    customPermissions?: string[],
  ): AgentExecutionInstance {
    const mapping = ROLE_MAPPINGS[role] ?? ROLE_MAPPINGS.orchestrator;
    const persistentBot = existingBots.find((b) => b.id === mapping.botId);

    const instanceId = `exec-${mapping.botId}-${randomUUID().slice(0, 8)}`;
    const botName = persistentBot?.name ?? mapping.defaultName;
    const permissions = customPermissions ?? mapping.defaultPermissions;

    return {
      instanceId,
      botId: persistentBot?.id ?? mapping.botId,
      botName,
      role,
      assignedTaskId: null,
      status: "idle",
      workspacePath,
      toolPermissions: [...permissions],
      turnCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  getRoleForBot(botId: string): OrchestratorSpecialistRole {
    for (const [role, mapping] of Object.entries(ROLE_MAPPINGS)) {
      if (mapping.botId === botId) {
        return role as OrchestratorSpecialistRole;
      }
    }
    return "code";
  }
}
