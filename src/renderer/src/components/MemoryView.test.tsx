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
          list: vi.fn().mockResolvedValue({
            memories: [
              memory({}),
              memory({ id: "m2", category: "decision", key: "Social schedule", content: LONG }),
            ],
            total: 2,
            offset: 0,
          }),
        },
      },
    });
    render(() => <MemoryView workspaceId="shop" />);

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

  it("lists, searches, edits and deletes only the active workspace's memories", async () => {
    const list = vi.fn().mockResolvedValue({
      memories: [memory({ id: "m1", key: "Supplier", content: "Ravi", authorBotId: "asha" })],
      total: 1,
      offset: 0,
    });
    const save = vi.fn().mockResolvedValue(memory({}));
    const remove = vi.fn().mockResolvedValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    Object.defineProperty(window, "sahkarmi", {
      configurable: true,
      value: { memory: { list, save, delete: remove } },
    });
    render(() => (
      <MemoryView workspaceId="shop-a" bots={[{ id: "asha", name: "Asha" } as never]} />
    ));
    expect(await screen.findByRole("heading", { name: "Supplier" })).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "shop-a" }));
    expect(screen.getByText("Saved by Asha")).toBeInTheDocument();

    await fireEvent.input(screen.getByRole("searchbox"), { target: { value: "ravi" } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: "shop-a", query: "ravi" }),
    );

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit memory" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m1",
        workspaceId: "shop-a",
        key: "Supplier",
        content: "Ravi",
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith("m1", "shop-a");
  });
});
