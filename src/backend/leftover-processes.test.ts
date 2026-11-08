// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  closeLeftoverEngines,
  type EngineProcess,
  findLeftoverEngines,
  parseCimDate,
  parseEngineProcesses,
  SAHKARMI_LAUNCH_MARKERS,
} from "./leftover-processes";

const STARTED = 1_000_000;
const OWN = "C:\\Users\\me\\AppData\\Local\\Programs\\Sahkarmi\\resources";
const TOOLS = "C:\\Users\\me\\AppData\\Roaming\\Sahkarmi\\tools";
const RULES = {
  selfPid: 500,
  startedAt: STARTED,
  ownFolders: [OWN, TOOLS],
  markers: SAHKARMI_LAUNCH_MARKERS,
};

function proc(partial: Partial<EngineProcess> & { pid: number }): EngineProcess {
  return {
    ppid: 9_999,
    name: "claude.exe",
    executablePath: null,
    commandLine: null,
    createdAt: STARTED - 60_000,
    ...partial,
  };
}

// A fake PC: the running app (500), the shell (100), and every kind of process the rules see.
const ROWS: EngineProcess[] = [
  proc({ pid: 100, ppid: 4, name: "explorer.exe" }),
  proc({ pid: 500, ppid: 100, name: "Sahkarmi.exe", executablePath: `${OWN}\\..\\Sahkarmi.exe` }),
  // Leftovers: parent gone, older than this run, from Sahkarmi's folders or launches.
  proc({
    pid: 201,
    name: "claude.exe",
    executablePath: `${OWN}\\app.asar.unpacked\\node_modules\\x\\claude.exe`,
  }),
  proc({ pid: 202, name: "codex.exe", executablePath: `${TOOLS}\\codex\\bin\\codex.exe` }),
  proc({
    pid: 203,
    name: "claude.exe",
    executablePath: "C:\\Users\\me\\.local\\bin\\claude.exe",
    commandLine:
      'claude.exe --output-format stream-json --mcp-config {"mcpServers":{"sahkarmi_browser":{"type":"sdk"}}}',
  }),
  // Not leftovers:
  // the owner's own Claude Code in a terminal that is still open,
  proc({ pid: 301, ppid: 100, name: "claude.exe", executablePath: "C:\\me\\claude.exe" }),
  // the owner's own Claude Code whose terminal closed (no Sahkarmi sign at all),
  proc({
    pid: 302,
    name: "claude.exe",
    executablePath: "C:\\Users\\me\\.local\\bin\\claude.exe",
    commandLine: "claude.exe --resume",
  }),
  // the owner's own Codex session started from an editor that exited,
  proc({ pid: 303, name: "codex.exe", executablePath: "C:\\Users\\me\\npm\\codex.exe" }),
  // this run's own engine (parent alive),
  proc({ pid: 304, ppid: 500, name: "codex.exe", executablePath: `${TOOLS}\\codex\\bin\\codex.exe` }),
  // a Sahkarmi engine started after this run began (another window's, mid-start),
  proc({
    pid: 305,
    name: "codex.exe",
    executablePath: `${TOOLS}\\codex\\bin\\codex.exe`,
    createdAt: STARTED + 5_000,
  }),
  // no start time known,
  proc({ pid: 306, name: "codex.exe", executablePath: `${TOOLS}\\x.exe`, createdAt: null }),
  // not an engine program, even from Sahkarmi's folder,
  proc({ pid: 307, name: "powershell.exe", executablePath: `${OWN}\\powershell.exe` }),
  proc({ pid: 308, name: "node.exe", executablePath: `${TOOLS}\\node\\node.exe` }),
  // a same-named folder that only starts like Sahkarmi's,
  proc({ pid: 309, name: "codex.exe", executablePath: `${TOOLS}-backup\\codex.exe` }),
  // and this process itself.
  proc({ pid: 500, name: "claude.exe" }),
];

describe("leftover coworker programs", () => {
  it("finds only Sahkarmi's own engines whose parent is gone and that predate this run", () => {
    expect(
      findLeftoverEngines(ROWS, RULES)
        .map((row) => row.pid)
        .sort(),
    ).toEqual([201, 202, 203]);
  });

  it("finds nothing without Sahkarmi's folders or markers", () => {
    expect(findLeftoverEngines(ROWS, { ...RULES, ownFolders: [], markers: [] })).toEqual([]);
    // A blank or too-short folder never matches everything.
    expect(findLeftoverEngines(ROWS, { ...RULES, ownFolders: ["", "C:"], markers: [] })).toEqual(
      [],
    );
  });

  it("reads PowerShell's JSON (a list, or one object) and CIM dates", () => {
    expect(parseCimDate("/Date(1794160931794)/")).toBe(1794160931794);
    expect(parseCimDate("yesterday")).toBeNull();
    const one = parseEngineProcesses(
      '{"ProcessId":7,"ParentProcessId":3,"Name":"codex.exe","ExecutablePath":null,"CommandLine":null,"CreationDate":"/Date(5)/"}',
    );
    expect(one).toEqual([
      {
        pid: 7,
        ppid: 3,
        name: "codex.exe",
        executablePath: null,
        commandLine: null,
        createdAt: 5,
      },
    ]);
    expect(parseEngineProcesses("not json")).toEqual([]);
    expect(parseEngineProcesses('[{"ProcessId":"x"}]')).toEqual([]);
  });

  it("closes each leftover through the given killer and logs it; never kills for real here", async () => {
    const killed: number[] = [];
    const lines: string[] = [];
    const closed = await closeLeftoverEngines({
      ...RULES,
      list: async () => ROWS,
      kill: async (pid) => {
        killed.push(pid);
        return pid !== 203;
      },
      log: (line) => lines.push(line),
    });
    expect(killed.sort()).toEqual([201, 202, 203]);
    expect(closed).toBe(2);
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.startsWith("could not close") && line.includes("203"))).toBe(
      true,
    );
  });

  it("never throws when listing fails", async () => {
    const lines: string[] = [];
    const closed = await closeLeftoverEngines({
      ...RULES,
      list: async () => {
        throw new Error("no CIM");
      },
      kill: async () => true,
      log: (line) => lines.push(line),
    });
    expect(closed).toBe(0);
    expect(lines[0]).toMatch(/skipped/);
  });
});
