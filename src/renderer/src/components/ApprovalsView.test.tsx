import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, For } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../../shared/ipc";
import { stableApprovals } from "../approval-list";
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

describe("where a request came from", () => {
  const card = (value: ApprovalRequest) =>
    render(() => (
      <ul>
        <ApprovalCard
          approval={value}
          bot={undefined}
          onDecide={async () => undefined}
          onOpenCoworker={() => undefined}
        />
      </ul>
    ));

  it("names the web page the coworker read, after the title", () => {
    card({ ...approval, provenance: { kind: "web", label: "example-shop.in" } });
    expect(screen.getByText("Where this request came from:")).toBeInTheDocument();
    expect(screen.getByText(/A web page it read \(example-shop\.in\)/)).toBeInTheDocument();
  });

  it("names another coworker and the owner's phone", () => {
    card({ ...approval, provenance: { kind: "coworker", label: "Asha" } });
    expect(screen.getByText(/Another coworker \(Asha\)/)).toBeInTheDocument();
    card({ ...approval, id: "approval-3", provenance: { kind: "remote" } });
    expect(screen.getByText(/You asked, from your phone/)).toBeInTheDocument();
  });

  it("shows nothing for older requests without it", () => {
    card(approval);
    expect(screen.queryByText("Where this request came from:")).toBeNull();
  });
});

describe("the approval list stays still", () => {
  const second = { ...approval, id: "approval-2", title: "Send invoice" };
  /** What the app receives on every event: the same requests, freshly copied. */
  const copies = (list: ApprovalRequest[]) => list.map((item) => ({ ...item }));

  function list(
    update: (current: ApprovalRequest[], next: ApprovalRequest[]) => ApprovalRequest[],
  ) {
    const [approvals, setApprovals] = createSignal<ApprovalRequest[]>(copies([approval, second]));
    const mounted = vi.fn();
    render(() => (
      <ul>
        <For each={approvals()}>
          {(item) => {
            mounted();
            return (
              <ApprovalCard
                approval={item}
                bot={undefined}
                onDecide={async () => undefined}
                onOpenCoworker={() => undefined}
                inline
              />
            );
          }}
        </For>
      </ul>
    ));
    return {
      mounted,
      emit: (next: ApprovalRequest[]) => setApprovals((current) => update(current, next)),
    };
  }

  it("reproduces the defect: fresh copies rebuild every card and lose what was typed", () => {
    const { mounted, emit } = list((_current, next) => next);
    const note = screen.getAllByPlaceholderText(/note/i)[0] as HTMLInputElement;
    fireEvent.input(note, { target: { value: "half typed" } });
    expect(mounted).toHaveBeenCalledTimes(2);
    emit(copies([approval, second]));
    expect(mounted).toHaveBeenCalledTimes(4);
    expect(note.isConnected).toBe(false);
    expect((screen.getAllByPlaceholderText(/note/i)[0] as HTMLInputElement).value).toBe("");
  });

  it("keeps cards, typed notes and focus through 50 repeated events", () => {
    const { mounted, emit } = list(stableApprovals);
    const note = screen.getAllByPlaceholderText(/note/i)[0] as HTMLInputElement;
    fireEvent.input(note, { target: { value: "half typed" } });
    note.focus();
    for (let event = 0; event < 50; event += 1) emit(copies([approval, second]));
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(note.isConnected).toBe(true);
    expect(note.value).toBe("half typed");
    expect(document.activeElement).toBe(note);
  });

  it("rebuilds only the card that changed, and removes only the one that left", () => {
    const { mounted, emit } = list(stableApprovals);
    const note = screen.getAllByPlaceholderText(/note/i)[0] as HTMLInputElement;
    emit(copies([approval, { ...second, routedToBotId: "ceo" }]));
    expect(mounted).toHaveBeenCalledTimes(3);
    emit(copies([approval]));
    expect(note.isConnected).toBe(true);
    expect(screen.getAllByPlaceholderText(/note/i)).toHaveLength(1);
  });

  it("returns the very same list when nothing changed, so nothing even re-renders", () => {
    const current = copies([approval, second]);
    expect(stableApprovals(current, copies(current))).toBe(current);
    expect(stableApprovals(current, [])).toEqual([]);
  });
});
