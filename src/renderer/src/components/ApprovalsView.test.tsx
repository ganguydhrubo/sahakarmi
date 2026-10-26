import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../../shared/ipc";
import { ApprovalCard } from "./ApprovalsView";

const approval = {
  id: "approval-1",
  botId: "chief",
  title: "Run git push",
  status: "pending" as const,
  kind: "permission" as const,
  details: "",
  category: "other" as const,
  amount: null,
  createdAt: "2026-10-26T10:00:00.000Z",
  decidedAt: null,
  note: null,
} satisfies ApprovalRequest;

describe("ApprovalCard in the chat", () => {
  it("takes focus, rejects on Esc and approves on Enter in the note", async () => {
    const onDecide = vi.fn(async () => undefined);
    render(() => (
      <ul>
        <ApprovalCard
          approval={approval}
          bot={undefined}
          onDecide={onDecide}
          onOpenCoworker={() => undefined}
          inline
        />
      </ul>
    ));
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(document.activeElement).toBe(approve);
    expect(screen.getByText("Enter approves · Esc rejects")).toBeInTheDocument();

    fireEvent.keyDown(approve, { key: "Escape" });
    expect(onDecide).toHaveBeenLastCalledWith("approval-1", "rejected", "");
    await Promise.resolve();

    const note = screen.getByPlaceholderText("Add a note (optional)");
    fireEvent.input(note, { target: { value: "fine" } });
    fireEvent.keyDown(note, { key: "Enter" });
    await vi.waitFor(() =>
      expect(onDecide).toHaveBeenLastCalledWith("approval-1", "approved", "fine"),
    );
  });
});
