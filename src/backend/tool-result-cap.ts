/**
 * Results from outside services (web APIs, connected apps such as Notion) can be megabytes of
 * JSON. Sent whole, one call fills a coworker's context and makes every later step slower and
 * dearer, so text is cut at 40,000 characters with a note that says how to get the rest.
 */
export const MAX_TOOL_TEXT_CHARS = 40_000;

export function capToolText(text: string, max = MAX_TOOL_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Sahkarmi cut this result at ${max.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters. Ask for a smaller part (a filter, one page, fewer fields) to see the rest.]`;
}

export function capContentItems<T extends { contentItems: Array<{ type: string; text?: string }> }>(
  result: T,
  max = MAX_TOOL_TEXT_CHARS,
): T {
  let left = max;
  const contentItems = result.contentItems.map((item) => {
    if (item.type !== "inputText" || typeof item.text !== "string") return item;
    const text = left > 0 ? capToolText(item.text, left) : "";
    left -= item.text.length;
    return { ...item, text };
  });
  return { ...result, contentItems: contentItems.filter((item) => item.text !== "") };
}
