/** Shared by every runtime's copy of the act tool, so the upload instructions stay identical. */
export const ACT_DESCRIPTION =
  "Click, type, press a key, paste, scroll, upload local files, navigate back/forward, or reload. " +
  "Returns a short status (address, title, focus, whether your refs still work), not the page: " +
  "call snapshot when you need to read it, or pass snapshot true to get the page and fresh refs " +
  "in the same call. " +
  "type with ref fills that field; type WITHOUT ref types into whatever has focus, like a person " +
  "at the keyboard: a tab presses Tab and a new line presses Enter. Use it for Google Sheets and " +
  "other grids: click the cell (or type its address like A91 in the Name box with submit), then " +
  'type without ref and submit true, e.g. "17-Oct\\tFri\\n18-Oct\\tSat" fills two rows (a cell ' +
  "is saved only by Tab, Enter or submit). " +
  'key takes names and combos: "Enter", "Tab", "Escape", "ArrowDown", "Ctrl+A", "Ctrl+V", ' +
  '"Shift+Tab". paste pastes text (or the clipboard if text is left out) into whatever has ' +
  "focus, like Ctrl+V; tab-separated lines paste as rows and columns in a spreadsheet. " +
  "upload attaches files from this computer to a page's file picker: ref is the page's Upload / " +
  "Add photo / Attach button or its file input, paths are full local file paths (up to 10). " +
  "Use it instead of asking the owner to take over for an upload. " +
  "A finished action is not a finished task: after a click or Enter that submits, sends, posts, " +
  "saves, books or pays, read the page (snapshot true) and look for the confirmation, the sent " +
  "item or an error before telling the owner it worked. If the page shows an error, or nothing " +
  "changed, say so plainly instead of reporting success.";

export const SNAPSHOT_DESCRIPTION =
  "Read a page and obtain current element references. Each element is one line: the ref, the " +
  "tag (with its role in brackets), then its name; (disabled) marks a control that cannot be " +
  "used. Long page text comes in parts: when the result has nextOffset, call snapshot again with " +
  "offset set to it to read on (the references stay the same).";

export const SCREENSHOT_DESCRIPTION =
  "Capture the visible page as an image. With ref, only that element (scrolled into view).";
