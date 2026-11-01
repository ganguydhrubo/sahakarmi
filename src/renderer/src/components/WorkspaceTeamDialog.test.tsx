import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { WorkspaceTeamDialog } from "./WorkspaceTeamDialog";

const workspaces: WorkspaceState = {
  activeWorkspaceId: "w1",
  workspaces: [
    { id: "w1", name: "First", createdAt: "", ceoBotId: "b2" },
    { id: "w2", name: "Second", createdAt: "" },
  ],
};
const bots = [
  { id: "b1", name: "Asha", workspaceId: "w1" },
  { id: "b2", name: "Mitra", workspaceId: "w1" },
] as BotProfile[];

function dialog(state = workspaces) {
  const onDelete = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(() => (
    <WorkspaceTeamDialog
      workspaces={state}
      bots={bots}
      onClose={onClose}
      onSetCeo={async () => undefined}
      onDelete={onDelete}
    />
  ));
  return { onDelete, onClose };
}

const shown = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe("WorkspaceTeamDialog", () => {
  beforeEach(() => {
    window.sahkarmi = {
      approvals: { listAuthority: async () => [] },
    } as unknown as typeof window.sahkarmi;
  });

  it("shows the choices that are really in force", () => {
    dialog();
    expect(shown("CEO of this workspace").selectedOptions[0]?.textContent).toBe("Mitra");
    expect(shown("Its coworkers").selectedOptions[0]?.textContent).toContain("Second");
  });

  it("moves coworkers by default, after a second click", async () => {
    const { onDelete } = dialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("move its coworkers");
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await vi.waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith({ workspaceId: "w1", moveCoworkersTo: "w2" }),
    );
  });

  it("warns plainly before deleting the coworkers too, and Cancel backs out", () => {
    const { onDelete } = dialog();
    fireEvent.change(shown("Its coworkers"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    expect(screen.getByRole("alert").textContent).toContain("removed for good");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("offers no delete for the only workspace", () => {
    dialog({ activeWorkspaceId: "w1", workspaces: [workspaces.workspaces[0] as never] });
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
    expect(screen.getByText(/only workspace/)).toBeTruthy();
  });
});
