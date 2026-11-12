import { Menu, type NativeImage, Tray } from "electron";

export interface BackgroundTrayActions {
  open: () => void;
  /** Pause (true) or resume (false) every coworker, schedule and routine. */
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  quit: () => void;
  /** A status line for the top of the menu, e.g. "Sahkarmi Host is on · 1 phone". */
  statusLine?: () => string | null;
}

/**
 * Whether closing the window should hide it to the tray instead of quitting. Only on Windows,
 * only when the owner turned the option on, and never while the app is quitting.
 */
export function shouldHideToTray(input: {
  platform: NodeJS.Platform;
  enabled: boolean;
  quitting: boolean;
}): boolean {
  return input.platform === "win32" && input.enabled && !input.quitting;
}

/** The notification-area icon shown while the window is hidden in background mode. */
export class BackgroundTray {
  readonly #icon: NativeImage;
  readonly #actions: BackgroundTrayActions;
  #tray: Tray | null = null;

  constructor(icon: NativeImage, actions: BackgroundTrayActions) {
    this.#icon = icon;
    this.#actions = actions;
  }

  get visible(): boolean {
    return this.#tray !== null && !this.#tray.isDestroyed();
  }

  show(): void {
    if (!this.visible) {
      this.#tray = new Tray(this.#icon);
      this.#tray.setToolTip("Sahkarmi is running in the background");
      this.#tray.on("click", () => this.#actions.open());
      this.#tray.on("double-click", () => this.#actions.open());
    }
    this.refresh();
  }

  /** Rebuilds the menu so the pause tick matches the current state. */
  refresh(): void {
    if (!this.#tray || this.#tray.isDestroyed()) return;
    const paused = this.#actions.isPaused();
    const status = this.#actions.statusLine?.() ?? null;
    this.#tray.setToolTip(
      paused ? "Sahkarmi: coworkers paused" : "Sahkarmi is running in the background",
    );
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(status ? ([{ label: status, enabled: false }, { type: "separator" }] as const) : []),
        { label: "Open Sahkarmi", click: () => this.#actions.open() },
        {
          label: "Pause all coworkers",
          type: "checkbox",
          checked: paused,
          click: (item) => {
            this.#actions.setPaused(item.checked);
            this.refresh();
          },
        },
        { type: "separator" },
        { label: "Quit Sahkarmi", click: () => this.#actions.quit() },
      ]),
    );
  }

  destroy(): void {
    if (this.#tray && !this.#tray.isDestroyed()) this.#tray.destroy();
    this.#tray = null;
  }
}
