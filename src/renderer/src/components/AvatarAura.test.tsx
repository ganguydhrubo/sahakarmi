import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoworkerStatus } from "../../../shared/ipc";
import { AURA_FLASH_MS, AvatarAura, phaseAura, statusAura } from "./AvatarAura";

afterEach(() => vi.useRealTimers());

describe("AvatarAura", () => {
  it("shows the working orbit, then a one-off done burst that clears itself", async () => {
    vi.useFakeTimers();
    const [status, setStatus] = createSignal<CoworkerStatus>("idle");
    const { container } = render(() => {
      const aura = statusAura(status);
      return (
        <AvatarAura state={aura()}>
          <span class="bot-avatar" />
        </AvatarAura>
      );
    });
    const aura = () => container.querySelector(".avatar-aura")?.getAttribute("data-aura");
    expect(aura()).toBe("idle");
    setStatus("working");
    expect(aura()).toBe("working");
    expect(container.querySelectorAll(".aura-spark")).toHaveLength(2);
    expect(container.querySelectorAll(".aura-dot")).toHaveLength(12);
    setStatus("idle");
    expect(aura()).toBe("done");
    expect(container.querySelectorAll(".aura-petal")).toHaveLength(8);
    vi.advanceTimersByTime(AURA_FLASH_MS + 10);
    expect(aura()).toBe("idle");
  });

  it("only claims what the real event phase says", () => {
    expect(phaseAura("thinking")).toBe("thinking");
    expect(phaseAura("executing_tool")).toBe("working");
    expect(phaseAura("waiting_approval")).toBe("waiting");
    expect(phaseAura("failed")).toBe("failed");
    expect(phaseAura("idle")).toBeNull();
  });
});
