import type { PermissionLevel } from "../../shared/ipc";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { DesktopHostLike } from "./desktop-host";
import {
  DesktopArgumentError,
  type DesktopCall,
  parseDesktopCall,
  type ScreenshotTransform,
} from "./desktop-tools";

export interface DesktopControlDeps {
  host: DesktopHostLike;
  /** The owner's current "Control this PC" level (Settings > Permissions). */
  level: () => PermissionLevel;
  /** Asks the permission service (and through it the owner) once; see the gate below. */
  authorize: (input: {
    botId: string;
    provider: string;
    threadId: string;
    /** Always the same words, so a deferred approval matches when the coworker repeats it. */
    action: string;
    reason: string;
    /** "shell" for a step that opens a command line (Win+R); otherwise desktop control. */
    category?: "desktop_control" | "shell";
  }) => Promise<{ allowed: boolean; reason: string }>;
  /** A line in that coworker's chat, so the owner always sees who is using the desktop. */
  notify: (botId: string, message: string) => void;
  botName: (botId: string) => string;
  now?: () => number;
}

/** Another coworker waits this long after the last desktop step before it may take over. */
const EXCLUSIVE_MS = 20_000;
/**
 * A chat gets one "is using your desktop" line, and another only after this long without a
 * desktop step there. Three minutes repeated it during one long task (a slow upload, a model
 * thinking) and after the coworker's last reply, when its follow-up turns checked the screen.
 */
const NOTICE_AGAIN_MS = 30 * 60_000;
export const DESKTOP_APPROVAL_ACTION = "Use this PC's screen, mouse and keyboard in any app";
const SCREENSHOT_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 45_000;

function text(message: string, success = true): DynamicToolResult {
  return { success, contentItems: [{ type: "inputText", text: message }] };
}

/**
 * Runs the sahkarmi_desktop tools for every coworker, whatever its AI provider.
 *
 * Permission gate (category "desktop_control"):
 *   - "deny": every desktop tool is refused.
 *   - "auto" (or Auto mode): allowed, no card.
 *   - "ask" (the default): the first desktop step of a coworker files one approval card; once the
 *     owner approves, that coworker may use the desktop until Sahkarmi restarts, the owner
 *     changes the level, or the coworker is deleted. Pre-authorisations work as everywhere else.
 * Only one coworker drives the desktop at a time, and the first step after a quiet spell puts a
 * line in its chat saying it is using the desktop.
 */
export class DesktopControlService {
  readonly #deps: DesktopControlDeps;
  readonly #now: () => number;
  /** Coworkers the owner approved this session, with the level that was in force then. */
  readonly #approved = new Map<string, PermissionLevel>();
  readonly #lastStep = new Map<string, number>();
  readonly #transforms = new Map<string, ScreenshotTransform>();
  #holder: { botId: string; at: number } | null = null;

  constructor(deps: DesktopControlDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** True while the coworker holds an approval from this session (for tests and the UI). */
  isApproved(botId: string): boolean {
    return this.#approved.get(botId) === this.#deps.level();
  }

  forgetBot(botId: string): void {
    this.#approved.delete(botId);
    for (const chat of this.#lastStep.keys()) {
      if (chat.startsWith(`${botId}\n`)) this.#lastStep.delete(chat);
    }
    this.#transforms.delete(botId);
    if (this.#holder?.botId === botId) this.#holder = null;
  }

  async handleDynamicTool(
    params: DynamicToolCallParams,
    provider: string,
  ): Promise<DynamicToolResult> {
    const botId = params.botId;
    if (!botId)
      return text("This chat is not linked to a coworker, so it cannot use the desktop.", false);
    let call: DesktopCall;
    try {
      call = parseDesktopCall(params.tool, params.arguments, this.#transforms.get(botId) ?? null);
    } catch (error) {
      if (error instanceof DesktopArgumentError) return text(error.message, false);
      throw error;
    }

    const refusal = await this.#gate(botId, provider, params.threadId, call);
    if (refusal) return text(refusal, false);

    const now = this.#now();
    const holder = this.#holder;
    if (holder && holder.botId !== botId && now - holder.at < EXCLUSIVE_MS) {
      return text(
        `${this.#deps.botName(holder.botId)} is using the desktop right now. Wait a little and try again, or ask them in Sahkarmi.`,
        false,
      );
    }
    this.#holder = { botId, at: now };
    const chat = `${botId}\n${params.threadId}`;
    const last = this.#lastStep.get(chat);
    if (last === undefined || now - last > NOTICE_AGAIN_MS) {
      this.#deps.notify(
        botId,
        `${this.#deps.botName(botId)} is using your desktop: it can see the screen and use the mouse and keyboard. Stop its reply to take back control.`,
      );
    }
    this.#lastStep.set(chat, now);

    try {
      return await this.#run(botId, call);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), false);
    } finally {
      const end = this.#now();
      this.#lastStep.set(chat, end);
      if (this.#holder?.botId === botId) this.#holder = { botId, at: end };
    }
  }

  async #gate(
    botId: string,
    provider: string,
    threadId: string,
    call: DesktopCall,
  ): Promise<string | null> {
    const level = this.#deps.level();
    if (level === "deny") {
      return "The owner has turned off desktop control (Settings > Permissions > Control this PC). Do the task another way, or ask the owner.";
    }
    const desktop = await this.#desktopGate(botId, provider, threadId, call, level);
    if (desktop || !call.shellStep) return desktop;
    // Typing into Run is running a command: it follows the Commands permission every time.
    const verdict = await this.#deps.authorize({
      botId,
      provider,
      threadId,
      action: call.shellStep,
      reason: "This opens a box where typed text runs as a command.",
      category: "shell",
    });
    return verdict.allowed ? null : verdict.reason;
  }

  async #desktopGate(
    botId: string,
    provider: string,
    threadId: string,
    call: DesktopCall,
    level: PermissionLevel,
  ): Promise<string | null> {
    if (this.#approved.get(botId) === level) return null;
    this.#approved.delete(botId);
    const verdict = await this.#deps.authorize({
      botId,
      provider,
      threadId,
      action: DESKTOP_APPROVAL_ACTION,
      reason: `First step: ${call.summary}.`,
    });
    if (!verdict.allowed) return verdict.reason;
    // Remembered only when it took an approval: "auto" is re-checked every time anyway.
    if (level !== "auto") this.#approved.set(botId, level);
    return null;
  }

  async #run(botId: string, call: DesktopCall): Promise<DynamicToolResult> {
    const host = this.#deps.host;
    if (call.findElement) {
      const found = await host.request(call.findElement);
      const element = found.element as Record<string, unknown> | undefined;
      const x = Number(element?.x) + Math.floor(Number(element?.width) / 2);
      const y = Number(element?.y) + Math.floor(Number(element?.height) / 2);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("That control has no position on screen.");
      const reply = await host.request({ ...call.request, x, y });
      return text(
        `Clicked ${String(element?.type ?? "control")} "${String(element?.name ?? "")}" at (${x}, ${y})${windowNote(reply.window)}.`,
      );
    }
    switch (call.tool) {
      case "screenshot": {
        const reply = await host.request(call.request, SCREENSHOT_TIMEOUT_MS);
        const transform = {
          left: Number(reply.left) || 0,
          top: Number(reply.top) || 0,
          scale: Number(reply.scale) || 1,
        };
        this.#transforms.set(botId, transform);
        return {
          success: true,
          contentItems: [
            { type: "inputText", text: describeScreenshot(reply) },
            {
              type: "inputImage",
              imageUrl: `data:${String(reply.mime ?? "image/jpeg")};base64,${String(reply.data ?? "")}`,
            },
          ],
        };
      }
      case "list_windows":
        return text(formatWindows(await host.request(call.request)));
      case "focus_window": {
        const reply = await host.request(call.request);
        return text(`In front now${windowNote(reply.window)}.`);
      }
      case "read_ui":
        return text(formatUiTree(await host.request(call.request)));
      case "close_window": {
        const reply = await host.request(call.request);
        return text(
          reply.closed
            ? `Closed${windowNote(reply.window)}.`
            : `Asked${windowNote(reply.window)} to close; it is still open, probably asking whether to save. Read it with desktop_read_ui.`,
        );
      }
      case "launch_app":
        return text(formatLaunch(await host.request(call.request, LAUNCH_TIMEOUT_MS)));
      case "type": {
        const reply = await host.request(call.request, 120_000);
        const how = reply.method === "paste" ? " (pasted; your clipboard was put back)" : "";
        return text(`Typed ${Number(reply.typed) || 0} characters${how}.`);
      }
      default: {
        const reply = await host.request(call.request);
        return text(`Done: ${call.summary}${windowNote(reply.window)}.`);
      }
    }
  }

  async dispose(): Promise<void> {
    await this.#deps.host.dispose();
  }
}

// ----------------------------------------------------------------------------- formatting

function windowNote(window: unknown): string {
  if (!window || typeof window !== "object") return "";
  const value = window as Record<string, unknown>;
  const title = String(value.title ?? "").slice(0, 120);
  return title ? ` (window "${title}", ${String(value.process ?? "?")})` : "";
}

export function describeScreenshot(reply: Record<string, unknown>): string {
  const scale = Number(reply.scale) || 1;
  const left = Number(reply.left) || 0;
  const top = Number(reply.top) || 0;
  const lines = [
    `Screenshot ${reply.width}x${reply.height} of the screen area ${reply.captureWidth}x${reply.captureHeight} at (${left}, ${top})${windowNote(reply.window)}.`,
    scale === 1
      ? `1 image pixel = 1 screen pixel: screenX = ${left} + imageX, screenY = ${top} + imageY.`
      : `scale ${scale.toFixed(4)}: screenX = ${left} + imageX / ${scale.toFixed(4)}, screenY = ${top} + imageY / ${scale.toFixed(4)}.`,
    'To click a spot you see here, pass its image position with coordinateSpace "screenshot" and Sahkarmi converts it.',
  ];
  if (Array.isArray(reply.displays) && reply.displays.length > 1) {
    lines.push(
      `Displays: ${reply.displays
        .map((display) => {
          const d = display as Record<string, unknown>;
          return `${d.index}${d.primary ? " (main)" : ""} ${d.width}x${d.height} at (${d.x}, ${d.y})`;
        })
        .join("; ")}.`,
    );
  }
  return lines.join("\n");
}

export function formatWindows(reply: Record<string, unknown>): string {
  const windows = Array.isArray(reply.windows) ? (reply.windows as Record<string, unknown>[]) : [];
  if (windows.length === 0) return "No app windows are open.";
  const lines = windows.map((window) => {
    const flags = [
      window.foreground ? "in front" : "",
      window.minimized ? "minimized" : "",
      window.maximized ? "maximized" : "",
      window.sahkarmi ? "Sahkarmi itself, cannot be controlled" : "",
    ].filter(Boolean);
    const place = window.minimized
      ? ""
      : ` at (${window.x}, ${window.y}) ${window.width}x${window.height}`;
    return `- "${String(window.title)}" — ${String(window.process)} pid ${window.pid} handle ${window.handle}${place}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
  });
  return `${windows.length} windows:\n${lines.join("\n")}`;
}

export function formatUiTree(reply: Record<string, unknown>): string {
  const nodes = Array.isArray(reply.nodes) ? (reply.nodes as Record<string, unknown>[]) : [];
  const lines = nodes.map((node) => {
    const indent = "  ".repeat(Math.min(Number(node.depth) || 0, 25));
    const parts = [`${indent}${String(node.type || "Control")}`];
    if (node.name) parts.push(`"${String(node.name)}"`);
    if (node.automationId) parts.push(`#${String(node.automationId)}`);
    if (node.value !== undefined) parts.push(`value="${String(node.value)}"`);
    if (node.toggle) parts.push(`toggle=${String(node.toggle)}`);
    if (typeof node.x === "number" && typeof node.width === "number" && node.width > 0) {
      const cx = Number(node.x) + Math.floor(Number(node.width) / 2);
      const cy = Number(node.y) + Math.floor(Number(node.height) / 2);
      parts.push(`@(${node.x},${node.y} ${node.width}x${node.height}) click (${cx}, ${cy})`);
    }
    const flags = [
      node.focused ? "focused" : "",
      node.disabled ? "disabled" : "",
      node.offscreen ? "offscreen" : "",
      node.password ? "password field: never typed into" : "",
    ].filter(Boolean);
    if (flags.length) parts.push(`[${flags.join(", ")}]`);
    return parts.join(" ");
  });
  const header = `Controls of${windowNote(reply.window) || " the window"} (screen pixels):`;
  const footer = reply.truncated
    ? "\n(Cut short: pass a larger maxNodes, or read a smaller window.)"
    : "";
  return `${header}\n${lines.join("\n")}${footer}`;
}

export function formatLaunch(reply: Record<string, unknown>): string {
  const fresh = Array.isArray(reply.newWindows)
    ? (reply.newWindows as Record<string, unknown>[])
    : [];
  const how = String(reply.how ?? "started");
  const head = `${how[0]?.toUpperCase() ?? ""}${how.slice(1)}${reply.pid ? ` (pid ${reply.pid})` : ""}.`;
  if (fresh.length === 0) {
    return `${head} No new window yet; it may still be opening, or it reused an open window. Call desktop_list_windows.`;
  }
  return `${head} New windows:\n${fresh
    .map(
      (window) =>
        `- "${String(window.title)}" — ${String(window.process)} pid ${window.pid} handle ${window.handle}`,
    )
    .join(
      "\n",
    )}\nSome apps reopen the owner's earlier documents: check with desktop_read_ui what is in front before typing.`;
}
