/**
 * The coworker-facing desktop tools: their definitions (one "sahkarmi_desktop" namespace, given
 * to Codex and ACP coworkers as dynamic tools and to Claude coworkers as an SDK MCP server, so
 * Claude sees mcp__sahkarmi_desktop__click and so on), and the strict validation that turns a
 * model's arguments into one host request. Pure: no process, no Electron.
 */

export const SAHKARMI_DESKTOP_NAMESPACE = "sahkarmi_desktop";

/** Desktop control drives Windows itself; other systems never get these tools. */
export function desktopControlSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

const COORDINATE_HELP =
  'x and y are real screen pixels (the numbers desktop_read_ui and desktop_list_windows give). To use a position you see in the latest desktop screenshot instead, pass coordinateSpace "screenshot".';

export const DESKTOP_NAMESPACE_DESCRIPTION =
  "Control this Windows PC like a person at the keyboard: see the screen, find and focus windows, read an app's controls, click, type, press keys and open apps. Works with any desktop or web app. Prefer desktop_read_ui (exact control names and positions) over guessing from pixels. Passwords are never typed here; Sahkarmi's own window cannot be controlled. The owner sees in your chat that you are using the desktop.";

const SPACE_PROPERTY = {
  type: "string",
  enum: ["screen", "screenshot"],
  description: 'Default "screen".',
} as const;

const WINDOW_PROPERTIES = {
  title: { type: "string", description: "Part of the window title (case-insensitive)." },
  pid: { type: "integer", minimum: 1 },
  handle: { type: "string", description: "The handle from desktop_list_windows, e.g. 0x30892." },
} as const;

function tool(name: string, description: string, properties: object, required: string[] = []) {
  return {
    type: "function" as const,
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

export const DESKTOP_TOOL_DEFINITIONS = [
  tool(
    "screenshot",
    "Take a picture of the screen (the main display by default) or of one window. The reply says how the picture maps to screen pixels.",
    {
      ...WINDOW_PROPERTIES,
      display: { type: "integer", minimum: 0, description: "Display index; 0 is the first." },
      allDisplays: { type: "boolean" },
      maxWidth: { type: "integer", minimum: 320, maximum: 1920, description: "Default 1280." },
    },
  ),
  tool(
    "list_windows",
    "List the open app windows: title, process, pid, handle, position and size, minimized.",
    { includeMinimized: { type: "boolean", description: "Default true." } },
  ),
  tool(
    "focus_window",
    "Bring a window to the front (restoring it if minimized) so keys and typing go to it.",
    WINDOW_PROPERTIES,
  ),
  tool(
    "click",
    `Click at a point, or on a named control. ${COORDINATE_HELP} Or pass element (a control's name from desktop_read_ui), optionally with controlType and a window.`,
    {
      x: { type: "integer" },
      y: { type: "integer" },
      coordinateSpace: SPACE_PROPERTY,
      element: { type: "string", description: "Name of a control to click, from desktop_read_ui." },
      controlType: { type: "string", description: "E.g. Button, Edit, MenuItem, ListItem." },
      ...WINDOW_PROPERTIES,
      button: { type: "string", enum: ["left", "right", "middle"] },
      double: { type: "boolean" },
    },
  ),
  tool(
    "move",
    `Move the mouse pointer (to hover). ${COORDINATE_HELP}`,
    {
      x: { type: "integer" },
      y: { type: "integer" },
      coordinateSpace: SPACE_PROPERTY,
    },
    ["x", "y"],
  ),
  tool(
    "scroll",
    `Scroll with the mouse wheel over a point. deltaY is in wheel notches: positive scrolls down, negative up; deltaX scrolls sideways. ${COORDINATE_HELP}`,
    {
      x: { type: "integer" },
      y: { type: "integer" },
      coordinateSpace: SPACE_PROPERTY,
      deltaY: { type: "integer", minimum: -50, maximum: 50 },
      deltaX: { type: "integer", minimum: -50, maximum: 50 },
    },
    ["x", "y"],
  ),
  tool(
    "drag",
    `Press the mouse at one point, move to another and release (drag and drop, selecting, sliders). ${COORDINATE_HELP}`,
    {
      fromX: { type: "integer" },
      fromY: { type: "integer" },
      toX: { type: "integer" },
      toY: { type: "integer" },
      coordinateSpace: SPACE_PROPERTY,
      button: { type: "string", enum: ["left", "right"] },
    },
    ["fromX", "fromY", "toX", "toY"],
  ),
  tool(
    "type",
    'Type text into whatever has the keyboard focus, exactly as given (any language, emoji; a newline presses Enter). Focus the window and click the field first, and after launching an app wait until it has loaded (desktop_read_ui) before typing. Refused in password fields. method "auto" (default) types key by key, and pastes in Windows 11 style (XAML) apps that drop fast keys, putting the clipboard back afterwards.',
    {
      text: { type: "string", minLength: 1, maxLength: 5000 },
      method: { type: "string", enum: ["auto", "keys", "paste"] },
    },
    ["text"],
  ),
  tool(
    "key",
    'Press keys or shortcuts, e.g. "enter", "ctrl+s", "alt+tab", "ctrl+shift+esc", "f5". Several in a row separated by spaces: "ctrl+a delete".',
    {
      keys: { type: "string", minLength: 1, maxLength: 200 },
      repeat: { type: "integer", minimum: 1, maximum: 50 },
    },
    ["keys"],
  ),
  tool(
    "close_window",
    "Close a window the way its own close button does (alt+f4 does not reach every app). The app may still ask whether to save; read that prompt with desktop_read_ui and answer it with desktop_key or desktop_click.",
    WINDOW_PROPERTIES,
  ),
  tool(
    "launch_app",
    'Open an app by name ("notepad", "calc", "Excel", a Start menu name) or by the full path of its .exe, or open a file, folder or web address with its default app. Returns the windows that opened.',
    {
      target: { type: "string", minLength: 1, maxLength: 1000 },
      arguments: { type: "string", maxLength: 1000 },
    },
    ["target"],
  ),
  tool(
    "read_ui",
    "Read a window's controls through Windows UI Automation: type, name, value, position and the point to click. The front window unless one is named. Much more reliable than reading pixels.",
    {
      ...WINDOW_PROPERTIES,
      maxDepth: { type: "integer", minimum: 1, maximum: 25 },
      maxNodes: { type: "integer", minimum: 10, maximum: 1500 },
    },
  ),
];

/** The namespace as dynamic tools (Codex, ACP); empty where desktop control is not supported. */
export function desktopDynamicTools(platform: NodeJS.Platform = process.platform): unknown[] {
  if (!desktopControlSupported(platform)) return [];
  return [
    {
      type: "namespace",
      name: SAHKARMI_DESKTOP_NAMESPACE,
      description: DESKTOP_NAMESPACE_DESCRIPTION,
      tools: DESKTOP_TOOL_DEFINITIONS,
    },
  ];
}

export type DesktopToolName =
  | "screenshot"
  | "list_windows"
  | "focus_window"
  | "click"
  | "move"
  | "scroll"
  | "drag"
  | "type"
  | "key"
  | "launch_app"
  | "close_window"
  | "read_ui";

export const DESKTOP_TOOL_NAMES: readonly DesktopToolName[] = DESKTOP_TOOL_DEFINITIONS.map(
  (definition) => definition.name as DesktopToolName,
);

/** How the latest screenshot maps to the screen: screenX = left + imageX / scale. */
export interface ScreenshotTransform {
  left: number;
  top: number;
  scale: number;
}

export interface DesktopCall {
  tool: DesktopToolName;
  /** The host request, ready to send (no id). */
  request: Record<string, unknown>;
  /** One plain-English line for the owner's approval card and the audit log. */
  summary: string;
  /** For click on a named control: look it up first, then click its centre. */
  findElement?: Record<string, unknown>;
  /**
   * Set when the step opens a way to run commands (Win+R, Win+X): it is asked under the
   * Commands permission as well, every time, whatever the desktop approval says.
   */
  shellStep?: string;
}

export class DesktopArgumentError extends Error {}

const MAX_COORDINATE = 100_000;

function fail(message: string): never {
  throw new DesktopArgumentError(message);
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail("Arguments must be an object.");
  return value as Record<string, unknown>;
}

function int(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a number.`);
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) fail(`${key} must be between ${min} and ${max}.`);
  return rounded;
}

function optionalInt(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  return args[key] === undefined || args[key] === null ? undefined : int(args, key, min, max);
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(`${key} must be text.`);
  if (value.length > max) fail(`${key} is too long (at most ${max} characters).`);
  return value;
}

function optionalBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(`${key} must be true or false.`);
  return value;
}

function oneOf<T extends string>(
  args: Record<string, unknown>,
  key: string,
  options: readonly T[],
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !options.includes(value as T)) {
    fail(`${key} must be one of: ${options.join(", ")}.`);
  }
  return value as T;
}

/** title / pid / handle, validated; empty when none was given. */
function windowTarget(args: Record<string, unknown>): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  const title = optionalString(args, "title", 300)?.trim();
  if (title) target.title = title;
  const pid = optionalInt(args, "pid", 1, 4_294_967_295);
  if (pid !== undefined) target.pid = pid;
  const handle = optionalString(args, "handle", 24)?.trim();
  if (handle) {
    if (!/^(0x[0-9a-f]{1,16}|\d{1,20})$/i.test(handle)) fail("handle must look like 0x30892.");
    target.handle = handle;
  }
  return target;
}

function describeWindow(target: Record<string, unknown>): string {
  if (typeof target.title === "string") return `"${target.title}"`;
  if (typeof target.pid === "number") return `the window of process ${target.pid}`;
  if (typeof target.handle === "string") return `window ${target.handle}`;
  return "the front window";
}

/** A point in screen pixels; screenshot positions are mapped back through the last screenshot. */
function point(
  args: Record<string, unknown>,
  xKey: string,
  yKey: string,
  transform: ScreenshotTransform | null,
): { x: number; y: number } {
  const x = int(args, xKey, -MAX_COORDINATE, MAX_COORDINATE);
  const y = int(args, yKey, -MAX_COORDINATE, MAX_COORDINATE);
  const space = oneOf(args, "coordinateSpace", ["screen", "screenshot"] as const) ?? "screen";
  if (space === "screen") return { x, y };
  if (!transform) fail('coordinateSpace "screenshot" needs a desktop screenshot first.');
  return toScreen({ x, y }, transform);
}

export function toScreen(
  imagePoint: { x: number; y: number },
  transform: ScreenshotTransform,
): { x: number; y: number } {
  const scale = transform.scale > 0 ? transform.scale : 1;
  return {
    x: Math.round(transform.left + imagePoint.x / scale),
    y: Math.round(transform.top + imagePoint.y / scale),
  };
}

// ----------------------------------------------------------------------------- keys

export interface KeyStroke {
  vk: number;
  extended?: boolean;
}

const MODIFIERS: Record<string, KeyStroke> = {
  ctrl: { vk: 0x11 },
  control: { vk: 0x11 },
  alt: { vk: 0x12 },
  shift: { vk: 0x10 },
  win: { vk: 0x5b, extended: true },
  windows: { vk: 0x5b, extended: true },
  meta: { vk: 0x5b, extended: true },
  cmd: { vk: 0x5b, extended: true },
  super: { vk: 0x5b, extended: true },
};

const NAMED_KEYS: Record<string, KeyStroke> = {
  enter: { vk: 0x0d },
  return: { vk: 0x0d },
  tab: { vk: 0x09 },
  esc: { vk: 0x1b },
  escape: { vk: 0x1b },
  space: { vk: 0x20 },
  backspace: { vk: 0x08 },
  delete: { vk: 0x2e, extended: true },
  del: { vk: 0x2e, extended: true },
  insert: { vk: 0x2d, extended: true },
  ins: { vk: 0x2d, extended: true },
  home: { vk: 0x24, extended: true },
  end: { vk: 0x23, extended: true },
  pageup: { vk: 0x21, extended: true },
  pgup: { vk: 0x21, extended: true },
  pagedown: { vk: 0x22, extended: true },
  pgdn: { vk: 0x22, extended: true },
  up: { vk: 0x26, extended: true },
  down: { vk: 0x28, extended: true },
  left: { vk: 0x25, extended: true },
  right: { vk: 0x27, extended: true },
  arrowup: { vk: 0x26, extended: true },
  arrowdown: { vk: 0x28, extended: true },
  arrowleft: { vk: 0x25, extended: true },
  arrowright: { vk: 0x27, extended: true },
  capslock: { vk: 0x14 },
  printscreen: { vk: 0x2c, extended: true },
  prtsc: { vk: 0x2c, extended: true },
  menu: { vk: 0x5d, extended: true },
  apps: { vk: 0x5d, extended: true },
  plus: { vk: 0xbb },
  minus: { vk: 0xbd },
  ";": { vk: 0xba },
  "=": { vk: 0xbb },
  ",": { vk: 0xbc },
  "-": { vk: 0xbd },
  ".": { vk: 0xbe },
  "/": { vk: 0xbf },
  "`": { vk: 0xc0 },
  "[": { vk: 0xdb },
  "\\": { vk: 0xdc },
  "]": { vk: 0xdd },
  "'": { vk: 0xde },
};

/** Keys that never put a character into a field: allowed while a password field has focus. */
const PASSWORD_SAFE_VKS = new Set([0x09, 0x0d, 0x1b, 0x10, 0x25, 0x26, 0x27, 0x28, 0x24, 0x23]);

function keyStroke(name: string): KeyStroke | null {
  const lower = name.toLowerCase();
  const named = NAMED_KEYS[lower];
  if (named) return named;
  if (/^[a-z0-9]$/.test(lower)) return { vk: lower.toUpperCase().charCodeAt(0) };
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (fn) return { vk: 0x6f + Number(fn[1]) };
  return null;
}

export interface ParsedKeys {
  chords: KeyStroke[][];
  /** True when nothing here can enter a character (Tab, Enter, arrows, Escape). */
  passwordSafe: boolean;
  /** Normalised, for the approval card: "ctrl+s". */
  label: string;
}

/** "ctrl+shift+s alt+tab enter" → three chords of virtual-key codes. */
export function parseKeys(input: string): ParsedKeys {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) fail("keys is empty.");
  if (words.length > 20) fail("At most 20 shortcuts at a time.");
  const chords: KeyStroke[][] = [];
  const labels: string[] = [];
  let passwordSafe = true;
  for (const word of words) {
    // "ctrl++" means ctrl and the plus key.
    const parts = word === "+" ? ["+"] : word.replace(/\+\+$/, "+plus").split("+");
    if (parts.some((part) => part === "")) fail(`"${word}" is not a key combination.`);
    const chord: KeyStroke[] = [];
    const seen = new Set<number>();
    let mainKeys = 0;
    for (const part of parts) {
      const modifier = MODIFIERS[part.toLowerCase()];
      const stroke = modifier ?? keyStroke(part === "+" ? "plus" : part);
      if (!stroke) {
        fail(
          `Unknown key "${part}". Use names like ctrl, alt, shift, win, enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, up, down, left, right, f1-f24, a letter or a digit.`,
        );
      }
      if (!modifier) mainKeys += 1;
      if (seen.has(stroke.vk)) fail(`"${word}" names the same key twice.`);
      seen.add(stroke.vk);
      chord.push(stroke);
    }
    if (mainKeys > 1) fail(`"${word}" has more than one main key; press them one after another.`);
    if (chord.some((stroke) => !PASSWORD_SAFE_VKS.has(stroke.vk))) passwordSafe = false;
    chords.push(chord);
    labels.push(parts.map((part) => part.toLowerCase()).join("+"));
  }
  return { chords, passwordSafe, label: labels.join(" ") };
}

const WIN_KEY = 0x5b;
/** Win+R opens Run, Win+X the menu with Terminal: both are a command line. */
const COMMAND_PROMPT_KEYS: Record<number, string> = { 82: "the Run box", 88: "the Win+X menu" };

/** What command line a chord opens, or null. */
export function opensCommandPrompt(chords: KeyStroke[][]): string | null {
  for (const chord of chords) {
    if (!chord.some((stroke) => stroke.vk === WIN_KEY || stroke.vk === 0x5c)) continue;
    for (const stroke of chord) {
      const what = COMMAND_PROMPT_KEYS[stroke.vk];
      if (what) return what;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------- launching

/** Interpreters that would run arbitrary commands: those go through the coworker's shell tool. */
const SHELL_PROGRAMS =
  /^(cmd|powershell|powershell_ise|pwsh|wt|windowsterminal|conhost|wscript|cscript|mshta|rundll32|regsvr32|bash|wsl|sh|msiexec|reg|schtasks|certutil|bitsadmin|node|nodejs|npx|deno|bun|python[\d.]*|pythonw|py|pyw|ruby|perl|php|java|javaw)(\.exe)?$/i;
const SCRIPT_FILES = /\.(bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|scr|reg|lnk|pif|com)$/i;
/** Programs and scripts a page could have just put on this PC. */
const RUNNABLE_FILES = /\.(exe|msi|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|scr|com|pif|lnk)\b/i;
/** Downloads (Sahkarmi's or the owner's) and temporary folders, as written or as %TEMP%. */
const DROP_FOLDERS = /(^|[\\/"'\s])(downloads|temp|tmp)[\\/]|%(temp|tmp)%|\$env:(temp|tmp)/i;

/** True when the text names a program or script inside a Downloads or temporary folder. */
export function namesDroppedProgram(text: string): boolean {
  return DROP_FOLDERS.test(text) && RUNNABLE_FILES.test(text);
}
const BLOCKED_SCHEMES = /^(javascript|vbscript|data|file|ms-msdt|search-ms|ms-officecmd):/i;

export function validateLaunchTarget(target: string, args: string | undefined): void {
  const clean = target.trim().replace(/^"(.*)"$/, "$1");
  if (!clean) fail("target is empty.");
  if (/[\r\n\0]/.test(clean) || (args && /[\r\n\0]/.test(args))) fail("target has a line break.");
  if (BLOCKED_SCHEMES.test(clean)) fail("That kind of link cannot be opened from here.");
  // A web address (or ms-settings: and the like) opens in its own app; only paths and names below.
  if (/^[a-z][a-z0-9+.-]+:/i.test(clean)) return;
  const base = clean.split(/[\\/]/).pop() ?? clean;
  if (SHELL_PROGRAMS.test(base)) {
    fail(
      "Command shells and script hosts are not started from the desktop tools. Run commands with your own command tool, which asks the owner under the Commands permission.",
    );
  }
  if (SCRIPT_FILES.test(base)) {
    fail(
      "Scripts, installers and shortcuts are not opened from the desktop tools. Run them with your own command tool, which asks the owner first.",
    );
  }
  if (namesDroppedProgram(clean) || (args && namesDroppedProgram(args))) {
    fail(
      "Programs in a Downloads or temporary folder are not started from the desktop tools: they may have just been downloaded. Ask the owner to run it, or use your own command tool, which asks first.",
    );
  }
}

// ----------------------------------------------------------------------------- the parser

/**
 * Validates one tool call and builds the host request. Throws DesktopArgumentError with a
 * message the model can act on. The coordinates of screenshot-space calls are mapped here.
 */
export function parseDesktopCall(
  tool: string,
  rawArgs: unknown,
  transform: ScreenshotTransform | null = null,
): DesktopCall {
  const args = record(rawArgs);
  switch (tool) {
    case "screenshot": {
      const target = windowTarget(args);
      const request: Record<string, unknown> = { op: "screenshot", ...target };
      const display = optionalInt(args, "display", 0, 16);
      if (display !== undefined) request.display = display;
      if (optionalBool(args, "allDisplays")) request.allDisplays = true;
      request.maxWidth = optionalInt(args, "maxWidth", 320, 1920) ?? 1280;
      const what = Object.keys(target).length ? describeWindow(target) : "the screen";
      return { tool, request, summary: `Take a screenshot of ${what}` };
    }
    case "list_windows":
      return {
        tool,
        request: {
          op: "list_windows",
          includeMinimized: optionalBool(args, "includeMinimized") ?? true,
        },
        summary: "List the open windows",
      };
    case "focus_window": {
      const target = windowTarget(args);
      if (Object.keys(target).length === 0) fail("Name the window: title, pid or handle.");
      return {
        tool,
        request: { op: "focus_window", ...target },
        summary: `Bring ${describeWindow(target)} to the front`,
      };
    }
    case "click": {
      const button = oneOf(args, "button", ["left", "right", "middle"] as const) ?? "left";
      const clicks = optionalBool(args, "double") ? 2 : 1;
      const verb = `${clicks === 2 ? "Double-click" : button === "left" ? "Click" : `${button[0]?.toUpperCase()}${button.slice(1)}-click`}`;
      const element = optionalString(args, "element", 300)?.trim();
      if (element) {
        const target = windowTarget(args);
        const controlType = optionalString(args, "controlType", 60)?.trim();
        return {
          tool,
          request: { op: "click", button, clicks },
          findElement: {
            op: "find_element",
            name: element,
            ...(controlType ? { controlType } : {}),
            ...target,
          },
          summary: `${verb} "${element}" in ${describeWindow(target)}`,
        };
      }
      if (args.x === undefined || args.y === undefined) {
        fail("Give x and y, or the element name to click.");
      }
      const at = point(args, "x", "y", transform);
      return {
        tool,
        request: { op: "click", ...at, button, clicks },
        summary: `${verb} at (${at.x}, ${at.y})`,
      };
    }
    case "move": {
      const at = point(args, "x", "y", transform);
      return {
        tool,
        request: { op: "move", ...at },
        summary: `Move the mouse to (${at.x}, ${at.y})`,
      };
    }
    case "scroll": {
      const at = point(args, "x", "y", transform);
      const deltaY = optionalInt(args, "deltaY", -50, 50) ?? 0;
      const deltaX = optionalInt(args, "deltaX", -50, 50) ?? 0;
      if (deltaY === 0 && deltaX === 0) fail("Give deltaY (positive scrolls down) or deltaX.");
      const direction = deltaY > 0 ? "down" : deltaY < 0 ? "up" : deltaX > 0 ? "right" : "left";
      return {
        tool,
        request: { op: "scroll", ...at, deltaY, deltaX },
        summary: `Scroll ${direction} at (${at.x}, ${at.y})`,
      };
    }
    case "drag": {
      const from = point(args, "fromX", "fromY", transform);
      const to = point(args, "toX", "toY", transform);
      const button = oneOf(args, "button", ["left", "right"] as const) ?? "left";
      return {
        tool,
        request: { op: "drag", fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, button },
        summary: `Drag from (${from.x}, ${from.y}) to (${to.x}, ${to.y})`,
      };
    }
    case "type": {
      const text = optionalString(args, "text", 5_000);
      if (!text) fail("text is empty.");
      const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
      const method = oneOf(args, "method", ["auto", "keys", "paste"] as const) ?? "auto";
      return {
        tool,
        request: { op: "type", text, method },
        summary: `Type "${preview.replace(/\s+/g, " ")}"`,
      };
    }
    case "key": {
      const keys = optionalString(args, "keys", 200);
      if (!keys) fail("keys is empty.");
      const parsed = parseKeys(keys);
      const repeat = optionalInt(args, "repeat", 1, 50) ?? 1;
      const runBox = opensCommandPrompt(parsed.chords);
      return {
        tool,
        request: { op: "key", chords: parsed.chords, passwordSafe: parsed.passwordSafe, repeat },
        summary: `Press ${parsed.label}${repeat > 1 ? ` ×${repeat}` : ""}`,
        ...(runBox ? { shellStep: `Press ${parsed.label} (${runBox})` } : {}),
      };
    }
    case "close_window": {
      const target = windowTarget(args);
      if (Object.keys(target).length === 0) fail("Name the window: title, pid or handle.");
      return {
        tool,
        request: { op: "close_window", ...target },
        summary: `Close ${describeWindow(target)}`,
      };
    }
    case "launch_app": {
      const target = optionalString(args, "target", 1_000)?.trim();
      if (!target) fail("target is empty.");
      const extra = optionalString(args, "arguments", 1_000)?.trim();
      validateLaunchTarget(target, extra);
      const request: Record<string, unknown> = {
        op: "launch",
        target: target.replace(/^"(.*)"$/, "$1"),
      };
      if (extra) request.arguments = extra;
      // A web address or a path opens with its default app; only a bare name falls back to the Start menu.
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target))
        request.shellOnly = true;
      return { tool, request, summary: `Open ${target}${extra ? ` ${extra}` : ""}` };
    }
    case "read_ui": {
      const target = windowTarget(args);
      const request: Record<string, unknown> = { op: "read_ui", ...target };
      const maxDepth = optionalInt(args, "maxDepth", 1, 25);
      if (maxDepth !== undefined) request.maxDepth = maxDepth;
      const maxNodes = optionalInt(args, "maxNodes", 10, 1_500);
      if (maxNodes !== undefined) request.maxNodes = maxNodes;
      return { tool, request, summary: `Read the controls of ${describeWindow(target)}` };
    }
    default:
      fail(`Unknown desktop tool: ${tool}.`);
  }
}
