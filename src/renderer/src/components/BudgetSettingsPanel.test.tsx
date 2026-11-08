import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BudgetSettings } from "../../../shared/ipc";
import { BudgetSettingsPanel } from "./BudgetSettingsPanel";

const original = window.sahkarmi;

afterEach(() => {
  (window as unknown as { sahkarmi: unknown }).sahkarmi = original;
});

describe("Work limits", () => {
  it("shows no limit by default and saves a coworker's daily limit", async () => {
    let state: BudgetSettings = { coworkers: {}, teamRunSteps: null, usedToday: {} };
    const setBudgets = vi.fn(async (patch: { coworkers?: Record<string, number | null> }) => {
      state = {
        ...state,
        coworkers: { ...state.coworkers, ...(patch.coworkers as Record<string, number>) },
      };
      return state;
    });
    (window as unknown as { sahkarmi: unknown }).sahkarmi = {
      orchestrator: { getBudgets: async () => state, setBudgets },
      agent: { listBots: async () => [{ id: "asha", name: "Asha" }] },
    };
    render(() => <BudgetSettingsPanel />);
    const input = (await screen.findByLabelText(/Asha · Replies a day/)) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.input(input, { target: { value: "10" } });
    fireEvent.change(input);
    await vi.waitFor(() => expect(setBudgets).toHaveBeenCalledWith({ coworkers: { asha: 10 } }));
    expect(await screen.findByText("0 today")).toBeInTheDocument();
  });
});
