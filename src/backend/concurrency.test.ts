// @vitest-environment node

import { describe, expect, it } from "vitest";
import { autoTurnCost, autoTurnLimit, fairOrder } from "./concurrency";

describe("auto concurrency", () => {
  it("fits 3 heavy or 10 shared coworkers on a 16 GB PC with 3 GB free", () => {
    expect(autoTurnLimit({ freeMb: 3_072, kind: "heavy", awakePages: 0 })).toBe(3);
    expect(autoTurnLimit({ freeMb: 3_072, kind: "shared", awakePages: 0 })).toBe(10);
  });

  it("counts 150 MB for each awake page the coworker holds", () => {
    expect(autoTurnCost({ kind: "heavy", awakePages: 2 })).toBe(750);
    expect(autoTurnCost({ kind: "shared", awakePages: 1 })).toBe(300);
    // (3072 - 1536) / 750 = 2.04
    expect(autoTurnLimit({ freeMb: 3_072, kind: "heavy", awakePages: 2 })).toBe(2);
  });

  it("always lets one turn run, and never more than 64", () => {
    expect(autoTurnLimit({ freeMb: 500, kind: "heavy", awakePages: 0 })).toBe(1);
    expect(autoTurnLimit({ freeMb: 0, kind: "shared", awakePages: 0 })).toBe(1);
    expect(autoTurnLimit({ freeMb: Number.NaN, kind: "shared", awakePages: 0 })).toBe(1);
    expect(autoTurnLimit({ freeMb: 200_000, kind: "shared", awakePages: 0 })).toBe(64);
    expect(autoTurnLimit({ freeMb: 3_072, kind: "shared", awakePages: -4 })).toBe(10);
  });
});

describe("fair order", () => {
  it("keeps arrival order when nobody was served yet", () => {
    expect(
      fairOrder([
        { botId: "a", fromOwner: false, lastServedAt: undefined },
        { botId: "b", fromOwner: false, lastServedAt: undefined },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("serves the coworker served least recently first; never served goes first", () => {
    expect(
      fairOrder([
        { botId: "busy", fromOwner: false, lastServedAt: 300 },
        { botId: "older", fromOwner: false, lastServedAt: 100 },
        { botId: "new", fromOwner: false, lastServedAt: undefined },
      ]),
    ).toEqual(["new", "older", "busy"]);
  });

  it("puts owner-typed messages first whatever the history", () => {
    expect(
      fairOrder([
        { botId: "routine", fromOwner: false, lastServedAt: undefined },
        { botId: "owner", fromOwner: true, lastServedAt: 999 },
      ]),
    ).toEqual(["owner", "routine"]);
  });

  it("rotates: a coworker that just finished goes behind those already waiting", () => {
    const served = new Map<string, number>([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const order: string[] = [];
    let clock = 10;
    // One slot; every coworker always has more queued work.
    for (let turn = 0; turn < 6; turn += 1) {
      const next = fairOrder(
        ["a", "b", "c"].map((botId) => ({
          botId,
          fromOwner: false,
          lastServedAt: served.get(botId),
        })),
      )[0];
      if (!next) throw new Error("no one waiting");
      order.push(next);
      served.set(next, clock++);
    }
    expect(order).toEqual(["a", "b", "c", "a", "b", "c"]);
  });
});
