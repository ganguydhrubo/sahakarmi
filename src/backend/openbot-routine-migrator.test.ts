import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SaveRoutineInput } from "../shared/ipc";
import {
  cadenceFromOpenBot,
  importOpenBotRoutinesOnce,
  matchCoworker,
  planOpenBotImport,
} from "./openbot-routine-migrator";

const sqlite = await import("node:sqlite").catch(() => null);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const COWORKERS = [
  { id: "bot-li", name: "my linkdin" },
  { id: "bot-ceo", name: "CEO" },
  { id: "bot-smm-s", name: "SMM - Outreach - Sahkarmi" },
  { id: "bot-smm-g", name: "SMM - Outreach - Goliv" },
];

describe("OpenBot routine import", () => {
  it("turns OpenBot schedules into Sahkarmi cadences", () => {
    expect(cadenceFromOpenBot({ kind: "daily", time: "18:00" })).toEqual({
      kind: "daily",
      time: "18:00",
    });
    expect(cadenceFromOpenBot({ kind: "interval", amount: 2, unit: "hours" })).toEqual({
      kind: "interval",
      minutes: 120,
    });
    expect(cadenceFromOpenBot({ kind: "once", date: "2026-10-18", time: "23:45" })).toBeNull();
    expect(cadenceFromOpenBot("garbage")).toBeNull();
  });

  it("finds the coworker an OpenBot agent became, and refuses to guess between two", () => {
    expect(matchCoworker("Dhrubo Linkdin Content", COWORKERS)?.id).toBe("bot-li");
    expect(matchCoworker("ceo", COWORKERS)?.id).toBe("bot-ceo");
    expect(matchCoworker("sahkarmi sm outreach", COWORKERS)?.id).toBe("bot-smm-s");
    expect(matchCoworker("SMM Outreach", COWORKERS)).toBeNull();
    expect(matchCoworker("WA Agent", COWORKERS)).toBeNull();
  });

  it("imports matched routines paused and reports the rest", () => {
    const { inputs, report } = planOpenBotImport(
      [
        {
          name: "Dhrubo personal LinkedIn daily publishing",
          agentName: "Dhrubo Linkdin Content",
          instruction: "Publish one post at 18:00.",
          schedule: { kind: "daily", time: "18:00" },
        },
        { name: "WA run", agentName: "WA Agent", instruction: "Send.", schedule: null },
      ],
      COWORKERS,
      new Date("2026-10-25T12:00:00Z"),
    );
    expect(inputs).toEqual([
      {
        name: "Dhrubo personal LinkedIn daily publishing",
        steps: [{ botId: "bot-li", instruction: "Publish one post at 18:00." }],
        cadence: { kind: "daily", time: "18:00" },
        enabled: false,
        confirmFrequent: true,
      },
    ]);
    expect(report.imported).toEqual([
      { name: "Dhrubo personal LinkedIn daily publishing", coworker: "my linkdin" },
    ]);
    expect(report.skipped[0]?.name).toBe("WA run");
  });

  it.skipIf(!sqlite)("reads OpenBot's database read-only and imports only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-openbot-"));
    roots.push(root);
    const database = join(root, "openbot.db");
    const db = new sqlite!.DatabaseSync(database);
    db.exec(`CREATE TABLE projection_agents (agent_id TEXT, agent_json TEXT);
      CREATE TABLE projection_agent_routines (routine_id TEXT, agent_id TEXT, name TEXT,
        instruction TEXT, active INTEGER);
      CREATE TABLE projection_routine_triggers (routine_id TEXT, schedule_json TEXT);
      INSERT INTO projection_agents VALUES ('a1', '{"name":"Dhrubo Linkdin Content"}');
      INSERT INTO projection_agent_routines VALUES ('r1', 'a1', 'LinkedIn daily', 'Post.', 1);
      INSERT INTO projection_agent_routines VALUES ('r2', 'a1', 'Old one', 'Post.', 0);
      INSERT INTO projection_routine_triggers VALUES ('r1', '{"kind":"daily","time":"18:00"}');`);
    db.close();

    const saved: SaveRoutineInput[] = [];
    const run = (routineCount: number) =>
      importOpenBotRoutinesOnce({
        userDataPath: root,
        openBotDatabase: database,
        routineCount,
        coworkers: COWORKERS,
        save: async (input) => saved.push(input),
      });

    await expect(run(1)).resolves.toBeNull();
    const report = await run(0);
    expect(report?.imported).toEqual([{ name: "LinkedIn daily", coworker: "my linkdin" }]);
    expect(saved.map((input) => [input.name, input.enabled, input.cadence])).toEqual([
      ["LinkedIn daily", false, { kind: "daily", time: "18:00" }],
    ]);
    expect(
      JSON.parse(await readFile(join(root, "openbot-import.json"), "utf8")).imported,
    ).toHaveLength(1);
    await expect(run(0)).resolves.toBeNull();
    expect(saved).toHaveLength(1);
  });
});
