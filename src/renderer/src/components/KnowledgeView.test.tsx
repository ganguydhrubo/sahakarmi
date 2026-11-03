import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBaseSummary, KnowledgeCitation } from "../../../shared/ipc";
import { citationParts, citationTitle } from "./Conversation";
import { formatBytes, KnowledgeView } from "./KnowledgeView";

function base(overrides: Partial<KnowledgeBaseSummary>): KnowledgeBaseSummary {
  return {
    id: "kb-1",
    name: "HR policies",
    workspaceId: "my-business",
    botIds: [],
    privacy: "coworkers",
    createdAt: "2026-11-03T09:00:00.000Z",
    updatedAt: "2026-11-03T09:00:00.000Z",
    folders: [],
    chunkCount: 3,
    indexing: false,
    sources: [
      {
        id: "doc-1",
        path: "C:/docs/leave-policy.pdf",
        name: "leave-policy.pdf",
        kind: "pdf",
        size: 2048,
        pages: 4,
        chunkCount: 3,
        status: "ready",
        error: null,
        enabled: true,
        folderId: null,
        indexedAt: "2026-11-03T09:05:00.000Z",
      },
    ],
    ...overrides,
  };
}

const citation: KnowledgeCitation = {
  id: "S1",
  kbId: "kb-1",
  kbName: "HR policies",
  documentId: "doc-1",
  fileName: "leave-policy.pdf",
  path: "C:/docs/leave-policy.pdf",
  page: 2,
  slide: null,
  sheet: null,
  heading: null,
  chunkIndex: 1,
  excerpt: "The notice period is sixty days.",
};

afterEach(() => {
  Reflect.deleteProperty(window, "sahkarmi");
});

describe("KnowledgeView", () => {
  it("lists the workspace's bases with their files and lets the owner add and search", async () => {
    const api = {
      list: vi.fn().mockResolvedValue([base({}), base({ id: "kb-2", workspaceId: "other" })]),
      create: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue([]),
      addFiles: vi.fn().mockResolvedValue([base({})]),
      pathsForFiles: vi.fn().mockReturnValue([]),
      addFolder: vi.fn().mockResolvedValue([base({})]),
      removeFolder: vi.fn(),
      removeSource: vi.fn(),
      setSourceEnabled: vi.fn().mockResolvedValue([base({})]),
      sync: vi.fn().mockResolvedValue([base({})]),
      search: vi.fn().mockResolvedValue({ hits: [{ citation, score: 3 }], kbIds: ["kb-1"] }),
      openSource: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(window, "sahkarmi", {
      configurable: true,
      value: { knowledge: api, agent: { onEvent: vi.fn(() => () => undefined) } },
    });
    render(() => <KnowledgeView workspaceId="my-business" bots={[]} />);

    await waitFor(() => expect(screen.getAllByText("HR policies").length).toBeGreaterThan(0));
    expect(screen.getByText("leave-policy.pdf")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    // Only this workspace's bases are shown.
    expect(screen.getByText("1")).toBeTruthy();

    fireEvent.click(screen.getByText("Add files"));
    await waitFor(() => expect(api.addFiles).toHaveBeenCalledWith("kb-1"));

    fireEvent.input(screen.getByLabelText("Try a search"), { target: { value: "notice period" } });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith({
        query: "notice period",
        kbIds: ["kb-1"],
        limit: 8,
      }),
    );
    await waitFor(() => expect(screen.getByText("leave-policy.pdf, p. 2")).toBeTruthy());
    expect(screen.getByText("The notice period is sixty days.")).toBeTruthy();
  });

  it("formats sizes and citation titles", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(citationTitle(citation)).toBe("leave-policy.pdf, p. 2");
    expect(citationTitle({ ...citation, page: null, sheet: "Prices" })).toBe(
      "leave-policy.pdf, sheet Prices",
    );
  });

  it("turns [S1] anchors into citation parts and leaves unknown anchors as text", () => {
    const parts = citationParts("Sixty days [S1] for managers [S1, S2] and [S9] elsewhere.", [
      citation,
      { ...citation, id: "S2", page: 3 },
    ]);
    expect(parts.map((part) => part.text)).toEqual([
      "Sixty days ",
      "S1",
      " for managers ",
      "S1",
      "S2",
      " and [S9] elsewhere.",
    ]);
    expect(parts[1]?.citation?.page).toBe(2);
    expect(parts[4]?.citation?.page).toBe(3);
  });
});
