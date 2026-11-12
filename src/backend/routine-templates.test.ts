// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceEn } from "../renderer/src/i18n-workspace";
import { workspaceBn } from "../renderer/src/i18n-workspace-bn";
import { workspaceHi } from "../renderer/src/i18n-workspace-hi";
import { coworkerForRole, ROUTINE_TEMPLATES } from "../shared/routine-templates";
import { parseRoutineSteps } from "./routine-store";

const TEAM = [
  { id: "mitra", role: "Orchestrator" },
  { id: "asha", role: "Accounts" },
  { id: "vikram", role: "Sales" },
  { id: "meera", role: "Support" },
  { id: "arjun", role: "Research" },
  { id: "kavya", role: "Content" },
  { id: "tara", role: "Ops" },
];

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "sahkarmi-templates-"));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("ready-made workflows", () => {
  it("are all valid routines once the owner picks a folder", async () => {
    for (const template of ROUTINE_TEMPLATES) {
      const steps = template.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        botId: !step.kind || step.kind === "condition" ? coworkerForRole(step.role, TEAM) : "",
        instruction: step.instruction,
        onNo: step.onNo,
        output: step.output?.kind === "file" ? { kind: "file" as const, folder } : step.output,
      }));
      await expect(parseRoutineSteps(steps), template.id).resolves.toHaveLength(steps.length);
    }
  });

  it("have unique ids and are named in English, Hindi and Bengali", () => {
    const ids = ROUTINE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of ROUTINE_TEMPLATES) {
      for (const pack of [workspaceEn, workspaceHi, workspaceBn] as Array<Record<string, string>>) {
        expect(pack[template.nameKey], template.nameKey).toBeTruthy();
        expect(pack[template.descriptionKey], template.descriptionKey).toBeTruthy();
      }
    }
  });

  it("match coworkers by role, falling back to the orchestrator", () => {
    expect(coworkerForRole("Accounts", TEAM)).toBe("asha");
    expect(coworkerForRole("sales", TEAM)).toBe("vikram");
    expect(coworkerForRole("Legal", TEAM)).toBe("mitra");
    expect(coworkerForRole("Legal", [{ id: "solo", role: "Helper" }])).toBe("solo");
  });
});
