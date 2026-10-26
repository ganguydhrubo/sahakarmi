import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { BrowserTab } from "../../../shared/ipc";
import { BrowserPageList, type BrowserStartAction, BrowserStartMenu } from "./BrowserPages";

function tab(id: string, title: string): BrowserTab {
  return {
    id,
    title,
    url: `https://${id}.example.com/`,
    loading: false,
    ownerThreadId: "thread-1",
    ownerBotId: "bot-1",
  };
}

describe("BrowserStartMenu", () => {
  it("offers the five start actions in order and reports the chosen one", () => {
    const onAction = vi.fn<(action: BrowserStartAction) => void>();
    render(() => <BrowserStartMenu onAction={onAction} />);
    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    expect(labels).toEqual([
      "Open Browser",
      "Open Files",
      "Open Tasks",
      "Open Agent settings",
      "Open Voice",
    ]);
    for (const [label, action] of [
      ["Open Browser", "browser"],
      ["Open Files", "files"],
      ["Open Tasks", "tasks"],
      ["Open Agent settings", "settings"],
      ["Open Voice", "voice"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
  });
});

describe("BrowserPageList", () => {
  it("shows every page as a card that opens or closes that page only", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <BrowserPageList
        tabs={[tab("a", "Substack"), tab("b", "Facebook"), tab("c", "Home / X")]}
        activeTabId="b"
        previews={{ a: "data:image/jpeg;base64,AAAA" }}
        controlledTabIds={new Set(["c"])}
        onOpen={onOpen}
        onClose={onClose}
      />
    ));
    const cards = document.querySelectorAll(".browser-page-card");
    expect(cards).toHaveLength(3);
    expect(cards[1]?.classList.contains("browser-page-card-active")).toBe(true);
    expect(cards[2]?.classList.contains("browser-page-card-controlled")).toBe(true);
    expect(cards[0]?.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(cards[1]?.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open page: Facebook" }));
    expect(onOpen).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("button", { name: "Close page: Home / X" }));
    expect(onClose).toHaveBeenCalledWith("c");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
