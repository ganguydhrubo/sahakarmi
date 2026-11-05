/**
 * Places a header menu just under its button, right edges aligned. The menu is rendered in a
 * Portal with position: fixed, so a header that clips its overflow (it wraps onto two rows when
 * the browser is open) or a strip drawn after it (the task queue) can never hide it.
 */
export function anchorBelow(anchor: Element | undefined): Record<string, string> {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return {};
  const margin = 12;
  const top = rect.bottom + 6;
  return {
    top: `${Math.round(top)}px`,
    right: `${Math.round(Math.max(margin, window.innerWidth - rect.right))}px`,
    "max-height": `${Math.round(Math.max(160, window.innerHeight - top - margin))}px`,
  };
}
