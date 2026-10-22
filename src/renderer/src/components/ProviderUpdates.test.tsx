import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { AgentStatus, AiRuntimeStatus, AiToolId } from "../../../shared/ipc";
import { ProviderUpdates } from "./ProviderUpdates";

const status: AgentStatus = {
  phase: "ready",
  cliVersion: "1.19.3",
  auth: { kind: "opencode", email: null },
  capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
  fullAccess: true,
  message: null,
  providers: [{ id: "opencode", state: "available", version: "1.19.3", message: null }],
};

function runtime(overrides: Partial<AiRuntimeStatus> = {}): AiRuntimeStatus {
  return {
    phase: "available",
    currentVersion: "1.19.3",
    availableVersion: "1.20.0",
    progress: null,
    checkedAt: "2026-10-21T00:00:00.000Z",
    message: null,
    tools: [
      {
        id: "opencode",
        label: "OpenCode (bundled)",
        installed: "1.19.3",
        latest: "1.20.0",
        managed: true,
        command: null,
        note: null,
      },
      {
        id: "codex",
        label: "Codex CLI",
        installed: "0.162.0",
        latest: "0.163.0",
        managed: false,
        command: "npm install -g @openai/codex@latest",
        note: null,
      },
    ],
    ...overrides,
  };
}

async function openPanel(): Promise<void> {
  const details = document.querySelector("details") as HTMLDetailsElement | null;
  if (!details) return;
  details.open = true;
  await fireEvent(details, new Event("toggle"));
}

describe("AI tool updates", () => {
  it("shows the version gap and updates a tool on request", async () => {
    const onUpdateTool = vi.fn<(toolId: AiToolId) => Promise<void>>();
    render(() => (
      <ProviderUpdates
        status={status}
        models={[]}
        refreshes={{}}
        onRefresh={() => Promise.resolve()}
        runtime={runtime()}
        onUpdateTool={onUpdateTool}
      />
    ));
    await openPanel();
    expect(screen.getByText(/update available: v1\.20\.0/)).toBeTruthy();
    expect(screen.getByText(/update available: v0\.163\.0/)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Update now" });
    expect(buttons.length).toBe(2);
    await fireEvent.click(buttons[0]);
    expect(onUpdateTool).toHaveBeenCalledWith("opencode");
  });

  it("does not offer an update for a tool that is current", async () => {
    render(() => (
      <ProviderUpdates
        status={status}
        models={[]}
        refreshes={{}}
        onRefresh={() => Promise.resolve()}
        runtime={runtime({
          phase: "up-to-date",
          availableVersion: null,
          tools: [
            {
              id: "opencode",
              label: "OpenCode (bundled)",
              installed: "1.19.3",
              latest: "1.19.3",
              managed: true,
              command: null,
              note: null,
            },
          ],
        })}
        onUpdateTool={() => Promise.resolve()}
      />
    ));
    await openPanel();
    expect(screen.getByText(/up to date \(latest v1\.19\.3\)/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Update now" }).length).toBe(0);
  });
});
