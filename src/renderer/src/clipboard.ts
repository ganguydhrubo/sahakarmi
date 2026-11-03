/**
 * Ctrl+C on selected chat text copies the words only, not the app's colours and layout, so a
 * paste into WhatsApp, a mail or a document looks like plain text. Typing fields are left alone.
 */
export function copySelectionAsPlainText(event: ClipboardEvent): void {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')
  ) {
    return;
  }
  const text = window.getSelection()?.toString() ?? "";
  if (!text || !event.clipboardData) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}

/** Copies text, falling back to a hidden textarea where the async clipboard is unavailable. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
