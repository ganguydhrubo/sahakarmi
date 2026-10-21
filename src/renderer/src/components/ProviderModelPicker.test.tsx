import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelOption, AgentStatus } from "../../../shared/ipc";
import { ProviderModelPicker } from "./ProviderModelPicker";

const status: AgentStatus = {
  phase: "ready",
  cliVersion: "1.19.3",
  auth: { kind: "opencode", email: null },
  capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
  fullAccess: true,
  message: null,
  providers: [{ id: "opencode", state: "available", version: "1.19.3", message: null }],
};
const model = (id: AgentModelOption["id"], name: string): AgentModelOption => ({
  id,
  name,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
});
const models = [
  model("opencode:opencode/beam-free", "OpenCode/Beam Free"),
  model("opencode:opencode/qwen-plus", "OpenCode/Qwen Plus"),
];

describe("model picker", () => {
  it("keeps the menu in the viewport near the bottom right and repositions on resize", async () => {
    const { container } = render(() => (
      <ProviderModelPicker
        value={models[0].id}
        modelOptions={models}
        agentStatus={status}
        onChange={() => undefined}
      />
    ));
    const root = container.querySelector(".provider-model-picker") as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: 690,
      bottom: 720,
      left: 850,
      right: 1010,
    } as DOMRect);
    await fireEvent.click(screen.getByRole("button", { name: /Agent model/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).not.toBe(root);
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(12);
    expect(
      Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width),
    ).toBeLessThanOrEqual(window.innerWidth - 12);
    expect(
      Number.parseFloat(dialog.style.top) + Number.parseFloat(dialog.style.maxHeight),
    ).toBeLessThanOrEqual(690);
    await fireEvent.resize(window);
    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("separates account models, searches and sends the exact selected model ID", async () => {
    const change = vi.fn();
    render(() => (
      <ProviderModelPicker
        value={models[0].id}
        modelOptions={models}
        agentStatus={status}
        onChange={change}
      />
    ));
    await fireEvent.click(screen.getByRole("button", { name: /Agent model/ }));
    expect(screen.queryByRole("option", { name: "Qwen Plus" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("option", { name: "Qwen Plus" })).toHaveTextContent(
      "Account / credits",
    );
    await fireEvent.input(screen.getByRole("searchbox"), { target: { value: "Qwen" } });
    expect(screen.queryByRole("option", { name: "Beam Free" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: "Qwen Plus" }));
    expect(change).toHaveBeenCalledWith("opencode:opencode/qwen-plus");
  });
});
