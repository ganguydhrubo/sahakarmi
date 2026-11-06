import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodShape } from "./desktop-claude-tools";
import { DESKTOP_HOST_SCRIPT } from "./desktop-host-script";
import {
  DESKTOP_TOOL_DEFINITIONS,
  DESKTOP_TOOL_NAMES,
  DesktopArgumentError,
  desktopDynamicTools,
  parseDesktopCall,
  parseKeys,
  SAHKARMI_DESKTOP_NAMESPACE,
  toScreen,
  validateLaunchTarget,
} from "./desktop-tools";

describe("desktop tool definitions", () => {
  it("offers the namespace on Windows only", () => {
    expect(desktopDynamicTools("darwin")).toEqual([]);
    expect(desktopDynamicTools("linux")).toEqual([]);
    const [namespace] = desktopDynamicTools("win32") as Array<{ name: string; tools: unknown[] }>;
    expect(namespace?.name).toBe(SAHKARMI_DESKTOP_NAMESPACE);
    expect(namespace?.tools).toHaveLength(12);
  });

  it("has every tool the coworkers are promised", () => {
    expect([...DESKTOP_TOOL_NAMES].sort()).toEqual(
      [
        "click",
        "close_window",
        "drag",
        "focus_window",
        "key",
        "launch_app",
        "list_windows",
        "move",
        "read_ui",
        "screenshot",
        "scroll",
        "type",
      ].sort(),
    );
  });

  it("turns every schema into a zod shape that the Claude SDK accepts", () => {
    for (const definition of DESKTOP_TOOL_DEFINITIONS) {
      const shape = zodShape(
        definition.inputSchema.properties as Record<string, never>,
        definition.inputSchema.required,
      );
      const schema = z.object(shape);
      for (const key of definition.inputSchema.required) {
        expect(schema.safeParse({}).success, `${definition.name} needs ${key}`).toBe(false);
      }
    }
    const click = DESKTOP_TOOL_DEFINITIONS.find((definition) => definition.name === "click");
    const schema = z.object(
      zodShape(
        click?.inputSchema.properties as Record<string, never>,
        click?.inputSchema.required ?? [],
      ),
    );
    expect(schema.safeParse({ x: 1, y: 2, button: "left" }).success).toBe(true);
    expect(schema.safeParse({ x: 1, y: 2, button: "side" }).success).toBe(false);
  });

  it("ships a host script that guards Sahkarmi's window and password fields", () => {
    expect(DESKTOP_HOST_SCRIPT).toContain("KEYEVENTF_UNICODE");
    expect(DESKTOP_HOST_SCRIPT).toContain("SetProcessDpiAwarenessContext");
    expect(DESKTOP_HOST_SCRIPT).toContain("IsPassword");
    expect(DESKTOP_HOST_SCRIPT).toContain("Protected.Contains");
    // A template placeholder would be replaced by JavaScript before PowerShell ever saw it.
    expect(DESKTOP_HOST_SCRIPT).not.toMatch(/\$\{/);
  });
});

describe("parseDesktopCall", () => {
  it("builds host requests for pointer tools", () => {
    expect(parseDesktopCall("click", { x: 10.4, y: 20 }).request).toEqual({
      op: "click",
      x: 10,
      y: 20,
      button: "left",
      clicks: 1,
    });
    const double = parseDesktopCall("click", { x: 1, y: 2, button: "right", double: true });
    expect(double.request).toMatchObject({ button: "right", clicks: 2 });
    expect(parseDesktopCall("move", { x: 5, y: 6 }).request).toEqual({ op: "move", x: 5, y: 6 });
    expect(parseDesktopCall("scroll", { x: 5, y: 6, deltaY: 3 }).summary).toBe(
      "Scroll down at (5, 6)",
    );
    expect(parseDesktopCall("drag", { fromX: 1, fromY: 2, toX: 3, toY: 4 }).request).toEqual({
      op: "drag",
      fromX: 1,
      fromY: 2,
      toX: 3,
      toY: 4,
      button: "left",
    });
  });

  it("maps screenshot positions back to the screen", () => {
    const transform = { left: -1920, top: 0, scale: 0.5 };
    expect(toScreen({ x: 100, y: 50 }, transform)).toEqual({ x: -1720, y: 100 });
    const call = parseDesktopCall(
      "click",
      { x: 100, y: 50, coordinateSpace: "screenshot" },
      transform,
    );
    expect(call.request).toMatchObject({ x: -1720, y: 100 });
    expect(() => parseDesktopCall("click", { x: 1, y: 1, coordinateSpace: "screenshot" })).toThrow(
      /screenshot first/,
    );
  });

  it("clicks a named control by looking it up first", () => {
    const call = parseDesktopCall("click", {
      element: "Don't save",
      controlType: "Button",
      title: "Notepad",
    });
    expect(call.findElement).toEqual({
      op: "find_element",
      name: "Don't save",
      controlType: "Button",
      title: "Notepad",
    });
    expect(call.request).toEqual({ op: "click", button: "left", clicks: 1 });
  });

  it("rejects bad arguments with messages the model can act on", () => {
    const bad: Array<[string, unknown, RegExp]> = [
      ["click", {}, /x and y, or the element/],
      ["click", { x: "10", y: 1 }, /x must be a number/],
      ["click", { x: 1, y: 1, button: "side" }, /button must be one of/],
      ["move", { x: 1e9, y: 0 }, /between/],
      ["scroll", { x: 1, y: 1 }, /deltaY/],
      ["type", { text: "" }, /empty/],
      ["type", { text: "x".repeat(5001) }, /too long/],
      ["key", { keys: "ctrl+banana" }, /Unknown key "banana"/],
      ["focus_window", {}, /Name the window/],
      ["focus_window", { handle: "notepad" }, /handle must look like/],
      ["launch_app", { target: "cmd.exe", arguments: "/c del *" }, /Command shells/],
      ["screenshot", [], /must be an object/],
      ["nope", {}, /Unknown desktop tool/],
    ];
    for (const [tool, args, message] of bad) {
      expect(() => parseDesktopCall(tool, args), `${tool} ${JSON.stringify(args)}`).toThrow(
        message,
      );
      expect(() => parseDesktopCall(tool, args)).toThrow(DesktopArgumentError);
    }
  });

  it("closes a named window and passes the typing method", () => {
    expect(parseDesktopCall("close_window", { handle: "0xA0780" }).request).toEqual({
      op: "close_window",
      handle: "0xA0780",
    });
    expect(() => parseDesktopCall("close_window", {})).toThrow(/Name the window/);
    expect(parseDesktopCall("type", { text: "hi" }).request).toEqual({
      op: "type",
      text: "hi",
      method: "auto",
    });
    expect(parseDesktopCall("type", { text: "hi", method: "paste" }).request).toMatchObject({
      method: "paste",
    });
    expect(() => parseDesktopCall("type", { text: "hi", method: "voice" })).toThrow(/method/);
  });

  it("defaults screenshots to a sensible width", () => {
    expect(parseDesktopCall("screenshot", {}).request).toEqual({
      op: "screenshot",
      maxWidth: 1280,
    });
    expect(parseDesktopCall("screenshot", { title: "Notepad", maxWidth: 800 }).request).toEqual({
      op: "screenshot",
      title: "Notepad",
      maxWidth: 800,
    });
  });

  it("opens web addresses through the shell but apps by name", () => {
    expect(parseDesktopCall("launch_app", { target: "https://example.com" }).request).toEqual({
      op: "launch",
      target: "https://example.com",
      shellOnly: true,
    });
    expect(parseDesktopCall("launch_app", { target: "notepad" }).request).toEqual({
      op: "launch",
      target: "notepad",
    });
    expect(
      parseDesktopCall("launch_app", { target: "C:\\Program Files\\App\\app.exe" }).request,
    ).not.toHaveProperty("shellOnly");
  });
});

describe("parseKeys", () => {
  it("parses chords and sequences", () => {
    const parsed = parseKeys("ctrl+shift+s alt+tab Enter");
    expect(parsed.chords).toEqual([
      [{ vk: 0x11 }, { vk: 0x10 }, { vk: 0x53 }],
      [{ vk: 0x12 }, { vk: 0x09 }],
      [{ vk: 0x0d }],
    ]);
    expect(parsed.label).toBe("ctrl+shift+s alt+tab enter");
    expect(parseKeys("f12").chords).toEqual([[{ vk: 0x7b }]]);
    expect(parseKeys("ctrl++").chords).toEqual([[{ vk: 0x11 }, { vk: 0xbb }]]);
    expect(parseKeys("delete").chords).toEqual([[{ vk: 0x2e, extended: true }]]);
  });

  it("marks only keys that cannot enter characters as safe in a password field", () => {
    expect(parseKeys("tab").passwordSafe).toBe(true);
    expect(parseKeys("shift+tab enter").passwordSafe).toBe(true);
    expect(parseKeys("a").passwordSafe).toBe(false);
    expect(parseKeys("ctrl+v").passwordSafe).toBe(false);
  });

  it("refuses nonsense", () => {
    expect(() => parseKeys("ctrl+a+b")).toThrow(/more than one main key/);
    expect(() => parseKeys("ctrl+ctrl")).toThrow(/same key twice/);
    expect(() => parseKeys("ctrl+")).toThrow(/not a key combination/);
    expect(() => parseKeys(Array(21).fill("a").join(" "))).toThrow(/At most 20/);
  });
});

describe("validateLaunchTarget", () => {
  it("allows apps, files and web addresses", () => {
    for (const target of [
      "notepad",
      "Excel",
      "C:\\Users\\me\\report.xlsx",
      "https://x.org",
      "ms-settings:display",
    ]) {
      expect(() => validateLaunchTarget(target, undefined), target).not.toThrow();
    }
  });

  it("refuses shells, scripts and dangerous links", () => {
    for (const target of [
      "powershell",
      "C:\\Windows\\System32\\cmd.exe",
      '"pwsh.exe"',
      "wsl",
      "run.bat",
      "setup.msi",
      "javascript:alert(1)",
      "file:///C:/x.exe",
      "notepad\nevil",
    ]) {
      expect(() => validateLaunchTarget(target, undefined), target).toThrow(DesktopArgumentError);
    }
  });

  it("refuses interpreters, terminals and programs that were just downloaded", () => {
    for (const target of [
      "node",
      "node.exe",
      "python",
      "python3.12.exe",
      "py",
      "pyw",
      "wt",
      "wt.exe",
      "pwsh",
      "powershell.exe",
      "cmd",
      "wscript",
      "cscript.exe",
      "mshta",
      "rundll32.exe",
      "regsvr32",
      "C:\\Users\\me\\Downloads\\setup.exe",
      "C:\\Users\\me\\Sahkarmi\\Downloads\\invoice.exe",
      "C:\\Users\\me\\AppData\\Local\\Temp\\x.exe",
      "%TEMP%\\x.exe",
      "C:\\Users\\me\\Downloads\\run.vbs",
      "C:\\Users\\me\\Downloads\\a.ps1",
    ]) {
      expect(() => validateLaunchTarget(target, undefined), target).toThrow(DesktopArgumentError);
    }
    // Handing a downloaded program to another app is refused too.
    expect(() => validateLaunchTarget("explorer", "C:\\Users\\me\\Downloads\\setup.exe")).toThrow(
      DesktopArgumentError,
    );
    // Opening a downloaded document is fine.
    expect(() =>
      validateLaunchTarget("C:\\Users\\me\\Downloads\\invoice.pdf", undefined),
    ).not.toThrow();
    expect(() => validateLaunchTarget("C:\\Program Files\\App\\app.exe", undefined)).not.toThrow();
  });

  it("marks Win+R and Win+X as opening a command line", () => {
    const step = (keys: string) => parseDesktopCall("key", { keys }, null).shellStep ?? null;
    expect(step("win+r")).toContain("Run box");
    expect(step("ctrl+c win+x")).toContain("Win+X");
    expect(step("win+e")).toBeNull();
    expect(step("ctrl+r")).toBeNull();
  });
});
