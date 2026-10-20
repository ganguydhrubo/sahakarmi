(() => {
  try {
    const saved = localStorage.getItem("sahkarmi:theme");
    const theme = saved === "light" || saved === "dark" ? saved : "system";
    if (theme !== "system") document.documentElement.dataset.theme = theme;
    void window.sahkarmi?.setTheme?.(theme)?.catch(() => undefined);
  } catch {
    /* Storage may be unavailable; the system theme remains usable. */
  }
})();
