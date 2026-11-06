import { describe, expect, it } from "vitest";
import { MAX_PLANNED_TASKS, parseCeoPlan, planningPrompt } from "./team-run-planner";

describe("parseCeoPlan", () => {
  it("reads a fenced JSON plan and fills defaults", () => {
    const parsed = parseCeoPlan(
      'Plan:\n```json\n{"tasks":[{"title":"A","description":"Do A","role":"wizard"}]}\n```',
    );
    expect(parsed.ok && parsed.plan.tasks[0]).toMatchObject({
      title: "A",
      role: "code",
      dependsOn: [],
      acceptanceCriteria: [],
    });
  });

  it.each([
    ["no JSON at all", "I will get the team started.", "not valid JSON"],
    ["no tasks", '{"tasks":[]}', "did not match"],
    ["a task without a title", '{"tasks":[{"description":"x"}]}', "tasks.0.title"],
    [
      "a forward dependency",
      '{"tasks":[{"title":"A","description":"a","dependsOn":[2]},{"title":"B","description":"b"}]}',
      "only depend on earlier",
    ],
    [
      "too many tasks",
      JSON.stringify({
        tasks: Array.from({ length: MAX_PLANNED_TASKS + 1 }, (_, i) => ({
          title: `T${i}`,
          description: "d",
        })),
      }),
      "did not match",
    ],
  ])("refuses %s", (_name, reply, reason) => {
    const parsed = parseCeoPlan(reply);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(reason);
  });

  it("tells the CEO why the last plan was sent back", () => {
    expect(planningPrompt("Goal", [{ id: "dev", name: "Dev", description: "" }], "Bad.")).toContain(
      "Your last plan could not be used: Bad.",
    );
  });
});
