import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMemory } from "../../../shared/ipc";
import { MemoryView, readableText } from "./MemoryView";

const LONG = `Daily cycles at 10:00 AM and 6:00 PM IST. ${"Check the ledger before posting. ".repeat(14)}`;

function memory(overrides: Partial<AgentMemory>): AgentMemory {
  return {
    id: "m1",
    category: "fact",
    key: "Dhrubo LinkedIn Day 19 Completion &amp; Status",
    content: "Posted &amp; checked.",
    tags: ["linkedin"],
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "sahkarmi");
});

describe("MemoryView", () => {
  it("shows saved entities as the characters they stand for", () => {
    expect(readableText("Q&amp;A &lt;b&gt; &quot;x&quot; it&#39;s &amp;amp;")).toBe(
      `Q&A <b> "x" it's &amp;`,
    );
  });

  it("decodes titles, folds long notes and counts each kind", async () => {
    Object.defineProperty(window, "sahkarmi", {
      configurable: true,
      value: {
        memory: {
          list: vi
            .fn()
            .mockResolvedValue([
              memory({}),
              memory({ id: "m2", category: "decision", key: "Social schedule", content: LONG }),
            ]),
        },
      },
    });
    render(() => <MemoryView />);

    expect(
      await screen.findByRole("heading", { name: "Dhrubo LinkedIn Day 19 Completion & Status" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Posted & checked.")).toBeInTheDocument();
    expect(screen.queryByText(/&amp;/)).not.toBeInTheDocument();

    // Only the long note can fold, and it opens and closes in place.
    const more = screen.getByRole("button", { name: "Show all" });
    const note = document.getElementById(more.getAttribute("aria-controls") ?? "");
    expect(note).toHaveClass("memory-content-folded");
    await fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(note).not.toHaveClass("memory-content-folded");
    expect(screen.getByRole("button", { name: "Show less" })).toBe(more);
    expect(screen.getAllByRole("button", { name: /Show/ })).toHaveLength(1);

    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^Decision/ })).toHaveTextContent("1");
  });
});
