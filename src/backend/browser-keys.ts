/**
 * Keyboard input for coworkers, shared by the built-in and the Chrome browser. Both send it
 * through DevTools, so pages get real key events (key combos, Tab between spreadsheet cells).
 */

/** Sends one DevTools command to the page being acted on. */
export type CdpSend = (method: string, params: Record<string, unknown>) => Promise<unknown>;

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
};

const MODIFIERS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  commandorcontrol: 2,
  cmdorctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/** The DevTools key event for a key name like "Enter", "a", "Tab" or "Ctrl+A". */
export function cdpKeyEvent(input: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
} {
  if (!/^[a-zA-Z0-9+_-]{1,32}$/.test(input)) throw new Error("Invalid browser key.");
  const parts = input.split("+").filter(Boolean);
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase()];
    if (bit === undefined) throw new Error("Invalid browser key.");
    modifiers |= bit;
  }
  const named = NAMED_KEYS[name.toLowerCase()];
  if (named) {
    return {
      key: named.key,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      modifiers,
      ...(named.text && modifiers === 0 ? { text: named.text } : {}),
    };
  }
  if (name.length === 1) {
    const upper = name.toUpperCase();
    const code = /[0-9]/.test(name) ? `Digit${name}` : `Key${upper}`;
    const text = modifiers & ~8 ? undefined : modifiers & 8 ? upper : name;
    return {
      key: modifiers & 8 ? upper : name,
      code,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      modifiers,
      ...(text ? { text } : {}),
    };
  }
  const functionKey = /^F([1-9]|1[0-2])$/i.exec(name);
  if (functionKey) {
    const number = Number(functionKey[1]);
    return {
      key: `F${number}`,
      code: `F${number}`,
      windowsVirtualKeyCode: 111 + number,
      modifiers,
    };
  }
  throw new Error("Invalid browser key.");
}

/** Presses a key name like "Enter", "Tab" or "Ctrl+V": key down, then key up. */
export async function pressCdpKey(send: CdpSend, input: string): Promise<void> {
  const event = cdpKeyEvent(input);
  await send("Input.dispatchKeyEvent", { type: event.text ? "keyDown" : "rawKeyDown", ...event });
  const { text: _text, ...up } = event;
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...up });
}

/**
 * Types into whatever has focus, the way a person would. A tab presses Tab and a new line
 * presses Enter, so text like "a\tb\nc\td" fills a spreadsheet cell by cell and row by row.
 * Each piece starts with a real key press (a spreadsheet grid starts editing a cell only on a
 * key press); the rest of the piece is inserted at once so long text stays fast.
 */
export async function typeIntoFocus(send: CdpSend, text: string): Promise<void> {
  for (const piece of text.split(/(\t|\r?\n)/)) {
    if (piece === "\t") await pressCdpKey(send, "Tab");
    else if (piece === "\n" || piece === "\r\n") await pressCdpKey(send, "Enter");
    else if (piece) {
      const [first = "", ...rest] = Array.from(piece);
      await pressCharacter(send, first);
      if (rest.length > 0) await send("Input.insertText", { text: rest.join("") });
    }
  }
}

async function pressCharacter(send: CdpSend, character: string): Promise<void> {
  const keyCode = /^[a-z0-9]$/i.test(character) ? character.toUpperCase().charCodeAt(0) : 0;
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: character,
    text: character,
    unmodifiedText: character,
    windowsVirtualKeyCode: keyCode,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: character,
    windowsVirtualKeyCode: keyCode,
  });
}
