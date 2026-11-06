import { randomUUID } from "node:crypto";
import type { AgentExecutionInstance, BotSummary, OrchestratorSpecialistRole } from "../shared/ipc";

interface RoleMapping {
  botId: string;
  defaultName: string;
}

/**
 * The starter coworker each specialist role goes to. What a coworker may do is decided by the
 * permission rules on every tool call, never here.
 */
const ROLE_MAPPINGS: Record<OrchestratorSpecialistRole, RoleMapping> = {
  orchestrator: { botId: "mitra-lead", defaultName: "Mitra" },
  architect: { botId: "dev-code", defaultName: "Dev" },
  code: { botId: "dev-code", defaultName: "Dev" },
  backend: { botId: "dev-code", defaultName: "Dev" },
  frontend: { botId: "kavya-content", defaultName: "Kavya" },
  qa: { botId: "tara-ops", defaultName: "Tara" },
  security: { botId: "kabir-security", defaultName: "Kabir" },
  research: { botId: "arjun-research", defaultName: "Arjun" },
  finance: { botId: "asha-accounts", defaultName: "Asha" },
  ops: { botId: "tara-ops", defaultName: "Tara" },
};

export class AgentExecutionFactory {
  createInstance(
    role: OrchestratorSpecialistRole,
    workspacePath: string,
    existingBots: BotSummary[] = [],
  ): AgentExecutionInstance {
    const mapping = ROLE_MAPPINGS[role] ?? ROLE_MAPPINGS.orchestrator;
    const persistentBot = existingBots.find((b) => b.id === mapping.botId);

    return {
      instanceId: `exec-${mapping.botId}-${randomUUID().slice(0, 8)}`,
      botId: persistentBot?.id ?? mapping.botId,
      botName: persistentBot?.name ?? mapping.defaultName,
      role,
      assignedTaskId: null,
      status: "idle",
      workspacePath,
      turnCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  /** An instance for a named coworker (a CEO plan picks coworkers by id, not by role). */
  instanceFor(
    bot: BotSummary,
    role: OrchestratorSpecialistRole,
    workspacePath: string,
  ): AgentExecutionInstance {
    return {
      instanceId: `exec-${bot.id}-${randomUUID().slice(0, 8)}`,
      botId: bot.id,
      botName: bot.name,
      role,
      assignedTaskId: null,
      status: "idle",
      workspacePath,
      turnCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  }
}
