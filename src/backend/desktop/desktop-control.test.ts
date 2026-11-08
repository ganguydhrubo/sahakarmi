import { describe, expect, it, vi } from "vitest";
import type { PermissionLevel } from "../../shared/ipc";
import type { DynamicToolCallParams } from "../protocol";
import {
  DESKTOP_APPROVAL_ACTION,
  DesktopControlService,
  formatUiTree,
  formatWindows,
} from "./desktop-control";
import type { DesktopHostLike } from "./desktop-host";

function fakeHost(replies: Record<string, Record<string, unknown>> = {}) {
  const requests: Record<string, unknown>[] = [];
  const host: DesktopHostLike = {
    request: vi.fn(async (body: Record<string, unknown>) => {
      requests.push(body);
      const reply = replies[String(body.op)];
      if (reply instanceof Error) throw reply;
      return { ok: true, ...(reply ?? {}) };
    }),
    dispose: vi.fn(async () => undefined),
  };
  return { host, requests };
}

function setup(options: {
  level?: PermissionLevel;
  allow?: boolean | (() => boolean);
  replies?: Record<string, Record<string, unknown>>;
  now?: () => number;
}) {
  const { host, requests } = fakeHost(options.replies);
  let level: PermissionLevel = options.level ?? "ask";
  const authorize = vi.fn(async (_input: { action: string; reason: string; category?: string }) => {
    const allow = typeof options.allow === "function" ? options.allow() : (options.allow ?? true);
    return { allowed: allow, reason: allow ? "Approved." : "The owner declined this action." };
  });
  const notify = vi.fn();
  const service = new DesktopControlService({
    host,
    level: () => level,
    authorize,
    notify,
    botName: (botId) => (botId === "asha" ? "Asha" : "Ravi"),
    now: options.now,
  });
  return {
    service,
    requests,
    authorize,
    notify,
    setLevel: (next: PermissionLevel) => {
      level = next;
    },
  };
}

function call(tool: string, args: unknown, botId = "asha"): DynamicToolCallParams {
  return {
    threadId: `thread-${botId}`,
    turnId: "turn",
    callId: "call",
    namespace: "sahkarmi_desktop",
    tool,
    arguments: args,
    botId,
  };
}

describe("DesktopControlService permission gate", () => {
  it("asks once per coworker per session, then acts without asking", async () => {
    const { service, authorize, requests } = setup({ level: "ask" });
    const first = await service.handleDynamicTool(call("click", { x: 10, y: 20 }), "claude");
    expect(first.success).toBe(true);
    await service.handleDynamicTool(call("key", { keys: "ctrl+s" }), "claude");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]?.[0]).toMatchObject({
      action: DESKTOP_APPROVAL_ACTION,
      reason: "First step: Click at (10, 20).",
    });
    expect(requests.map((request) => request.op)).toEqual(["click", "key"]);
    // Another coworker needs its own approval.
    await service.handleDynamicTool(call("list_windows", {}, "ravi"), "codex");
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("asks under Commands every time a step opens the Run box, even after a desktop approval", async () => {
    let shellAllowed = false;
    const { service, authorize, requests } = setup({ level: "ask" });
    authorize.mockImplementation(async (input: { action: string; category?: string }) => {
      const allowed = input.category === "shell" ? shellAllowed : true;
      return { allowed, reason: allowed ? "Approved." : "The owner declined this action." };
    });
    await service.handleDynamicTool(call("click", { x: 1, y: 1 }), "claude");
    const refused = await service.handleDynamicTool(call("key", { keys: "win+r" }), "claude");
    expect(refused.success).toBe(false);
    expect(authorize.mock.calls.at(-1)?.[0]).toMatchObject({ category: "shell" });
    expect(requests.map((request) => request.op)).toEqual(["click"]);
    shellAllowed = true;
    const allowed = await service.handleDynamicTool(call("key", { keys: "win+r" }), "claude");
    expect(allowed.success).toBe(true);
    expect(requests.map((request) => request.op)).toEqual(["click", "key"]);
    // Ordinary shortcuts still need nothing more.
    const before = authorize.mock.calls.length;
    await service.handleDynamicTool(call("key", { keys: "ctrl+s" }), "claude");
    expect(authorize.mock.calls.length).toBe(before);
  });

  it("does nothing when the owner declines, and asks again next time", async () => {
    const { service, authorize, requests } = setup({ allow: false });
    const result = await service.handleDynamicTool(call("type", { text: "hi" }), "codex");
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toMatchObject({ text: "The owner declined this action." });
    await service.handleDynamicTool(call("type", { text: "hi" }), "codex");
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(requests).toEqual([]);
  });

  it("refuses everything when desktop control is denied, even after an approval", async () => {
    const { service, authorize, requests, setLevel } = setup({ level: "ask" });
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    setLevel("deny");
    const result = await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toMatchObject({ text: expect.stringContaining("turned off") });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  it("forgets an approval when the owner changes the level", async () => {
    const { service, authorize, setLevel } = setup({ level: "ask" });
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    expect(service.isApproved("asha")).toBe(true);
    setLevel("auto");
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    setLevel("ask");
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    expect(authorize).toHaveBeenCalledTimes(3);
  });

  it("checks arguments before asking the owner", async () => {
    const { service, authorize } = setup({});
    const result = await service.handleDynamicTool(call("key", { keys: "ctrl+banana" }), "claude");
    expect(result.success).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("needs a coworker behind the chat", async () => {
    const { service, authorize } = setup({});
    const result = await service.handleDynamicTool(
      { ...call("move", { x: 1, y: 1 }), botId: undefined },
      "claude",
    );
    expect(result.success).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("DesktopControlService while acting", () => {
  it("tells the chat that the coworker is using the desktop, not on every step", async () => {
    let now = 1_000;
    const { service, notify } = setup({ now: () => now });
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    now += 10_000;
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toContain("Asha is using your desktop");
    now += 31 * 60_000;
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not repeat the line during one long task or its follow-up turns", async () => {
    let now = 1_000;
    const { service, notify } = setup({ now: () => now });
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }), "claude");
    // A slow upload, then the follow-up turns that check the screen after the reply.
    for (const gap of [4 * 60_000, 10 * 60_000, 25 * 60_000]) {
      now += gap;
      await service.handleDynamicTool(
        { ...call("move", { x: 1, y: 1 }), turnId: `turn-${gap}` },
        "claude",
      );
    }
    expect(notify).toHaveBeenCalledTimes(1);
    // A different chat of the same coworker gets its own line.
    now += 1_000;
    await service.handleDynamicTool(
      { ...call("move", { x: 1, y: 1 }), threadId: "thread-other" },
      "claude",
    );
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("lets one coworker drive at a time", async () => {
    let now = 0;
    const { service } = setup({ now: () => now });
    await service.handleDynamicTool(call("move", { x: 1, y: 1 }, "asha"), "claude");
    now += 5_000;
    const busy = await service.handleDynamicTool(call("move", { x: 1, y: 1 }, "ravi"), "codex");
    expect(busy.success).toBe(false);
    expect(busy.contentItems[0]).toMatchObject({ text: expect.stringContaining("Asha is using") });
    now += 30_000;
    const later = await service.handleDynamicTool(call("move", { x: 1, y: 1 }, "ravi"), "codex");
    expect(later.success).toBe(true);
  });

  it("returns the screenshot as an image and remembers how it maps to the screen", async () => {
    const { service, requests } = setup({
      replies: {
        screenshot: {
          data: "QUJD",
          mime: "image/jpeg",
          width: 1280,
          height: 720,
          captureWidth: 2560,
          captureHeight: 1440,
          left: 0,
          top: 0,
          scale: 0.5,
        },
      },
    });
    const shot = await service.handleDynamicTool(call("screenshot", {}), "claude");
    expect(shot.success).toBe(true);
    expect(shot.contentItems[1]).toEqual({
      type: "inputImage",
      imageUrl: "data:image/jpeg;base64,QUJD",
    });
    expect(shot.contentItems[0]).toMatchObject({ text: expect.stringContaining("scale 0.5000") });
    await service.handleDynamicTool(
      call("click", { x: 100, y: 100, coordinateSpace: "screenshot" }),
      "claude",
    );
    expect(requests.at(-1)).toMatchObject({ op: "click", x: 200, y: 200 });
  });

  it("clicks a named control at its centre", async () => {
    const { service, requests } = setup({
      replies: {
        find_element: {
          element: { type: "Button", name: "Don't save", x: 100, y: 50, width: 80, height: 30 },
        },
      },
    });
    const result = await service.handleDynamicTool(
      call("click", { element: "Don't save", title: "Notepad" }),
      "claude",
    );
    expect(result.success).toBe(true);
    expect(requests.map((request) => request.op)).toEqual(["find_element", "click"]);
    expect(requests[1]).toMatchObject({ x: 140, y: 65 });
  });

  it("passes host refusals (password field, Sahkarmi's window) back to the coworker", async () => {
    const { service } = setup({
      replies: { type: new Error("A password field has the keyboard focus.") as never },
    });
    const result = await service.handleDynamicTool(call("type", { text: "secret" }), "claude");
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toMatchObject({
      text: "A password field has the keyboard focus.",
    });
  });
});

describe("formatting", () => {
  it("lists windows compactly", () => {
    const text = formatWindows({
      windows: [
        {
          title: "Untitled - Notepad",
          process: "Notepad",
          pid: 12,
          handle: "0x1",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          foreground: true,
        },
        {
          title: "Sahkarmi",
          process: "Sahkarmi",
          pid: 1,
          handle: "0x2",
          minimized: true,
          sahkarmi: true,
        },
      ],
    });
    expect(text).toContain(
      '"Untitled - Notepad" — Notepad pid 12 handle 0x1 at (0, 0) 800x600 [in front]',
    );
    expect(text).toContain("Sahkarmi itself, cannot be controlled");
  });

  it("shows controls with a point to click and never a password value", () => {
    const text = formatUiTree({
      window: { title: "Sign in", process: "app" },
      nodes: [
        { depth: 0, type: "Window", name: "Sign in", x: 0, y: 0, width: 400, height: 300 },
        {
          depth: 1,
          type: "Edit",
          name: "Password",
          password: true,
          x: 10,
          y: 10,
          width: 100,
          height: 20,
        },
        { depth: 1, type: "Button", name: "OK", x: 10, y: 40, width: 60, height: 20 },
      ],
      truncated: true,
    });
    expect(text).toContain('  Button "OK" @(10,40 60x20) click (40, 50)');
    expect(text).toContain("password field: never typed into");
    expect(text).toContain("Cut short");
  });
});
