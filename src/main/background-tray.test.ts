// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const trays: FakeTray[] = [];
class FakeTray {
  destroyed = false;
  menu: Array<{ label?: string; checked?: boolean; click?: (item: { checked: boolean }) => void }> =
    [];
  readonly handlers = new Map<string, () => void>();
  constructor() {
    trays.push(this);
  }
  setToolTip() {}
  on(event: string, handler: () => void) {
    this.handlers.set(event, handler);
  }
  setContextMenu(menu: { items: FakeTray["menu"] }) {
    this.menu = menu.items;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}

vi.mock("electron", () => ({
  Tray: FakeTray,
  Menu: { buildFromTemplate: (items: unknown[]) => ({ items }) },
}));

const { BackgroundTray, shouldHideToTray } = await import("./background-tray");

describe("shouldHideToTray", () => {
  it("hides only on Windows, only when turned on, and never while quitting", () => {
    expect(shouldHideToTray({ platform: "win32", enabled: true, quitting: false })).toBe(true);
    // Off by default: closing the window quits exactly as before.
    expect(shouldHideToTray({ platform: "win32", enabled: false, quitting: false })).toBe(false);
    expect(shouldHideToTray({ platform: "win32", enabled: true, quitting: true })).toBe(false);
    expect(shouldHideToTray({ platform: "linux", enabled: true, quitting: false })).toBe(false);
  });
});

describe("BackgroundTray", () => {
  it("offers Open, Pause all coworkers and Quit", () => {
    let paused = false;
    const actions = {
      open: vi.fn(),
      quit: vi.fn(),
      setPaused: vi.fn((next: boolean) => {
        paused = next;
      }),
      isPaused: () => paused,
    };
    const tray = new BackgroundTray({} as never, actions);
    tray.show();
    tray.show();
    expect(trays).toHaveLength(1);
    const fake = trays[0] as FakeTray;
    expect(fake.menu.map((item) => item.label).filter(Boolean)).toEqual([
      "Open Sahkarmi",
      "Pause all coworkers",
      "Quit Sahkarmi",
    ]);
    fake.menu[1]?.click?.({ checked: true });
    expect(actions.setPaused).toHaveBeenCalledWith(true);
    expect(fake.menu[1]?.checked).toBe(true);
    fake.handlers.get("click")?.();
    expect(actions.open).toHaveBeenCalled();
    fake.menu[3]?.click?.({ checked: false });
    expect(actions.quit).toHaveBeenCalled();
    tray.destroy();
    expect(tray.visible).toBe(false);
  });
});
