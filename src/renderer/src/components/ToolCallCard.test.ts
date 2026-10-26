import { describe, expect, it } from "vitest";
import type { ToolCallSummary } from "../../../shared/ipc";
import { formatToolDisplay, unwrapShell } from "./ToolCallCard";

function tool(overrides: Partial<ToolCallSummary>): ToolCallSummary {
  return {
    name: "Command",
    kind: "command",
    status: "completed",
    input: "",
    output: null,
    ...overrides,
  };
}

describe("unwrapShell", () => {
  it("shows the command the coworker meant, not the shell around it", () => {
    expect(
      unwrapShell(
        '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-ChildItem C:\\\\Users"',
      ),
    ).toBe("Get-ChildItem C:\\Users");
    expect(unwrapShell("pwsh -NoProfile -Command 'git status'")).toBe("git status");
    expect(unwrapShell("cmd.exe /c dir")).toBe("dir");
    expect(unwrapShell("/bin/bash -lc 'bun test'")).toBe("bun test");
    expect(unwrapShell("git log --oneline")).toBe("git log --oneline");
  });
});

describe("formatToolDisplay", () => {
  it("gives one plain line per tool, without emojis", () => {
    const command = formatToolDisplay(
      tool({ input: JSON.stringify({ command: '"powershell.exe" -Command "echo hi"' }) }),
    );
    expect(command).toMatchObject({ title: "echo hi", subtitle: "Command" });
    const message = formatToolDisplay(
      tool({
        name: "sahkarmi_send_message",
        kind: "coworker",
        input: JSON.stringify({ to: "Asha", message: "Check GST" }),
      }),
    );
    expect(message).toMatchObject({ title: "Message to Asha", subtitle: "Check GST" });
    const memory = formatToolDisplay(tool({ name: "search_memory", kind: "tool", input: "{}" }));
    expect(memory.title).toBe("Search memory");
    const file = formatToolDisplay(
      tool({
        name: "Read",
        kind: "file",
        input: JSON.stringify({ file_path: "C:/work/notes.md" }),
      }),
    );
    expect(file.title).toBe("Read notes.md");
  });
});
