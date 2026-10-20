import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { Routine, RoutineRun, ScheduledTask } from "../../../shared/ipc";
import { calendarEntries, calendarRange, upcomingRuns } from "../calendar";
import { SchedulesView } from "./SchedulesView";

// Wednesday 21 Oct 2026, 08:00 local time.
const NOW = new Date(2026, 9, 21, 8, 0);

function task(id: string, time: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return {
    id,
    botId: "chief",
    text: `Task ${id}`,
    cadence: { kind: "daily", time },
    enabled: true,
    createdAt: new Date(2026, 9, 1).toISOString(),
    lastRunAt: null,
    nextRunAt: new Date(2026, 9, 21, hours, minutes).toISOString(),
    ...overrides,
  };
}

const ROUTINE: Routine = {
  id: "r1",
  name: "Evening growth run",
  steps: [{ id: "s1", botId: "chief", instruction: "Check sales" }],
  cadence: { kind: "daily", time: "18:00" },
  enabled: true,
  createdAt: new Date(2026, 9, 1).toISOString(),
  lastRunAt: new Date(2026, 9, 20, 18, 0).toISOString(),
  nextRunAt: new Date(2026, 9, 21, 18, 0).toISOString(),
};

const FAILED_RUN: RoutineRun = {
  id: "run1",
  routineId: "r1",
  routineName: "Evening growth run",
  trigger: "schedule",
  status: "failed",
  startedAt: new Date(2026, 9, 20, 18, 0).toISOString(),
  finishedAt: new Date(2026, 9, 20, 18, 5).toISOString(),
  steps: [],
};

describe("schedule calendar", () => {
  it("lists real upcoming runs in time order and never invents past ones", () => {
    const schedules = [
      task("a", "09:00"),
      task("b", "07:00", { nextRunAt: new Date(2026, 9, 22, 7, 0).toISOString() }),
    ];
    const next = upcomingRuns(schedules, [ROUTINE], NOW, 4);
    expect(
      next.map((entry) => `${entry.title}@${entry.at.getDate()}/${entry.at.getHours()}`),
    ).toEqual(["Task a@21/9", "Evening growth run@21/18", "Task b@22/7", "Task a@22/9"]);
    const { start, end } = calendarRange("week", NOW);
    const entries = calendarEntries(schedules, [ROUTINE], [FAILED_RUN], start, end, NOW);
    // Monday and Tuesday are past: only the real failed run appears there.
    const past = entries.filter((entry) => entry.at < NOW);
    expect(past.map((entry) => entry.state)).toEqual(["failed"]);
  });

  it("shows the week with run status and collapses busy days into +N more", async () => {
    const busy = ["09:00", "10:00", "11:00", "12:00", "13:00"].map((time, index) =>
      task(`t${index}`, time),
    );
    render(() => (
      <SchedulesView
        schedules={busy}
        routines={[ROUTINE]}
        runs={[FAILED_RUN]}
        bots={[]}
        now={NOW}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onRunNow={vi.fn()}
        onOpenCoworker={vi.fn()}
      />
    ));
    expect(screen.getByRole("heading", { name: "Upcoming runs" })).toBeInTheDocument();
    expect(document.querySelector(".calendar-entry-failed")).toHaveTextContent("Failed");
    const today = document.querySelector(".calendar-day-today") as HTMLElement;
    // 5 tasks + the routine on Wednesday: 3 shown, 3 hidden.
    const more = within(today).getByRole("button", { name: "+3 more" });
    await fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".calendar-day-today .calendar-entry")).toHaveLength(6);
  });
});
