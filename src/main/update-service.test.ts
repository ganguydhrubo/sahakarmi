// @vitest-environment node

import { EventEmitter } from "node:events";
import type { AppUpdater, CancellationToken } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import { supportsInstalledUpdates, UpdateService } from "./update-service";

class FakeUpdater extends EventEmitter {
  disableDifferentialDownload = false;
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async (_token?: CancellationToken) => [] as string[]);
  quitAndInstall = vi.fn();
}

function createService(updater: FakeUpdater, beforeInstall = vi.fn(async () => undefined)) {
  return new UpdateService(updater as unknown as AppUpdater, {
    currentVersion: "0.1.0",
    enabled: true,
    beforeInstall,
  });
}

describe("UpdateService", () => {
  it("cancels a download stuck at 60% and automatically retries a full installer", async () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("update-available", { version: "0.1.1" });
      return null;
    });
    updater.downloadUpdate
      .mockImplementationOnce(
        (token) =>
          new Promise((_resolve, reject) => {
            updater.emit("download-progress", { percent: 60, transferred: 60 });
            token?.on("cancel", () => reject(new Error("cancelled")));
          }),
      )
      .mockImplementationOnce(async () => {
        updater.emit("update-downloaded", { version: "0.1.1" });
        return [];
      });
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: async () => undefined,
      stallTimeoutMs: 100,
      retryDelayMs: 10,
    });
    service.start(false);
    try {
      await service.checkForUpdates();
      expect(service.getStatus()).toMatchObject({ phase: "downloading", progress: 60 });
      await vi.advanceTimersByTimeAsync(100);
      expect(service.getStatus().message).toContain("Retrying automatically");
      await vi.advanceTimersByTimeAsync(10);
      expect(updater.disableDifferentialDownload).toBe(true);
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
      expect(service.getStatus()).toMatchObject({ phase: "ready", progress: 100 });
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it("bounds retries and allows a manual retry after repeated network failures", async () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const service = createService(updater);
    service.start(false);
    updater.emit("update-available", { version: "0.1.1" });
    updater.downloadUpdate.mockRejectedValue(new Error("offline"));
    try {
      await service.downloadUpdate();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(3);
      expect(service.getStatus().message).toContain("Check your connection");
      updater.downloadUpdate.mockImplementation(async () => {
        updater.emit("update-downloaded", { version: "0.1.1" });
        return [];
      });
      await service.downloadUpdate();
      expect(service.getStatus().phase).toBe("ready");
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it("cancels a transfer on shutdown without starting another attempt", async () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const service = createService(updater);
    service.start(false);
    updater.emit("update-available", { version: "0.1.1" });
    updater.downloadUpdate.mockImplementation(
      (token) =>
        new Promise((_resolve, reject) => {
          token?.on("cancel", () => reject(new Error("cancelled")));
        }),
    );
    try {
      const pending = service.downloadUpdate();
      await Promise.resolve();
      service.stop();
      await pending;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it("checks, downloads, and installs an available update", async () => {
    const updater = new FakeUpdater();
    const beforeInstall = vi.fn(async () => undefined);
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("checking-for-update");
      updater.emit("update-available", { version: "0.1.1" });
      return null;
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit("download-progress", { percent: 42.4, transferred: 42 });
      updater.emit("update-downloaded", { version: "0.1.1" });
      return [];
    });
    const service = createService(updater, beforeInstall);
    service.start(false);

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowPrerelease).toBe(false);

    await service.checkForUpdates();
    await service.downloadUpdate();
    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      currentVersion: "0.1.0",
      availableVersion: "0.1.1",
    });

    await service.downloadUpdate();
    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      availableVersion: "0.1.1",
      progress: 100,
    });

    await service.installUpdate();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("surfaces up-to-date and recoverable error states", async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates
      .mockImplementationOnce(async () => {
        updater.emit("update-not-available", { version: "0.1.0" });
        return null;
      })
      .mockRejectedValueOnce(new Error("network details that should not reach the renderer"));
    const service = createService(updater);
    service.start(false);

    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({ phase: "up-to-date", availableVersion: null });

    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({
      phase: "error",
      message: "Could not check for updates. Try again.",
    });
  });

  it("does not contact the update provider from an unsupported build", async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: false,
      beforeInstall: vi.fn(async () => undefined),
    });
    service.start(false);

    expect((await service.checkForUpdates()).phase).toBe("unsupported");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("supportsInstalledUpdates", () => {
  it.each([
    ["darwin", true],
    ["win32", true],
    ["linux", false],
  ] as const)("returns %s support as %s", (platform, expected) => {
    expect(supportsInstalledUpdates(platform)).toBe(expected);
  });
});
