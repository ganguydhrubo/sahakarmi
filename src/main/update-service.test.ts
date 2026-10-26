// @vitest-environment node

import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppUpdater, CancellationToken } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import {
  cleanPendingUpdates,
  compareVersions,
  isFileInUse,
  reasonOf,
  runningInstallerName,
  supportsInstalledUpdates,
  UpdateService,
} from "./update-service";

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
  it("checks again after wake but throttles focus while downloads are ready", async () => {
    const updater = new FakeUpdater();
    const service = createService(updater);
    service.start(false);
    try {
      updater.checkForUpdates.mockImplementation(async () => {
        updater.emit("update-not-available");
        return null;
      });
      await service.checkOnWake();
      await service.checkOnWake();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
      updater.emit("update-downloaded", { version: "0.1.1" });
      await service.checkOnWake();
      expect(service.getStatus().phase).toBe("ready");
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      service.stop();
    }
  });
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

  it("does not retry when Windows still holds the update file", async () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const service = createService(updater);
    service.start(false);
    updater.emit("update-available", { version: "0.1.1" });
    updater.downloadUpdate.mockRejectedValue(
      new Error("EPERM: operation not permitted, rename 'temp-Sahkarmi-0.1.1-x64.exe'"),
    );
    try {
      await service.downloadUpdate();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
      expect(service.getStatus()).toMatchObject({ phase: "error" });
      expect(service.getStatus().message).toContain("Close Sahkarmi");
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
    expect(updater.autoInstallOnAppQuit).toBe(false);
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
      message:
        "Could not check for updates: unexpected error (details are in Export diagnostics). Try again.",
    });
    expect(service.getStatus().message).not.toContain("network details");
  });

  it("explains known causes in plain words", () => {
    expect(reasonOf(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("no internet connection");
    expect(reasonOf(new Error("HttpError: 404 Cannot find latest.yml"))).toBe(
      "the update files were not found",
    );
    expect(reasonOf(new Error("Could not get code signature for running application"))).toBe(
      "this build is not signed for automatic updates",
    );
  });

  it("opens the installer download on a Mac build that cannot replace itself", async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("update-available", { version: "0.5.0" });
      return null;
    });
    const openDownload = vi.fn(async () => undefined);
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.4.0",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      manualInstall: async () => true,
      openDownload,
    });
    service.start(false);
    await service.checkForUpdates();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await service.downloadUpdate();
    expect(openDownload).toHaveBeenCalledWith("0.5.0");
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ phase: "available", availableVersion: "0.5.0" });
    expect(service.getStatus().message).toContain("Applications");
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

describe("pending update files", () => {
  it("keeps a finished newer download and removes half-finished or old ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-pending-"));
    for (const name of [
      "Sahkarmi-0.12.1-x64.exe",
      "Sahkarmi-0.12.0-x64.exe",
      "Sahkarmi-0.11.4-x64.exe",
      "temp-Sahkarmi-0.12.1-x64.exe",
    ]) {
      writeFileSync(join(dir, name), "x");
    }
    writeFileSync(
      join(dir, "update-info.json"),
      JSON.stringify({ fileName: "Sahkarmi-0.12.1-x64.exe" }),
    );
    await cleanPendingUpdates(dir, "0.12.0");
    expect(readdirSync(dir).sort()).toEqual(["Sahkarmi-0.12.1-x64.exe", "update-info.json"]);

    await cleanPendingUpdates(dir, "0.12.1");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes an unreadable update-info.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-pending-"));
    writeFileSync(join(dir, "update-info.json"), "{not json");
    await cleanPendingUpdates(dir, "0.12.0");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does nothing when the folder is missing", async () => {
    await expect(
      cleanPendingUpdates(join(tmpdir(), "sahkarmi-no-such-dir"), "0.12.0"),
    ).resolves.toBeUndefined();
  });

  it("compares versions number by number", () => {
    expect(compareVersions("0.12.1", "0.12.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.12.0")).toBe(-1);
    expect(compareVersions("0.12.0", "0.12.0")).toBe(0);
  });

  it("knows a file-in-use error from other errors", () => {
    expect(isFileInUse(new Error("EPERM: operation not permitted, rename"))).toBe(true);
    expect(isFileInUse(new Error("EBUSY: resource busy or locked"))).toBe(true);
    expect(isFileInUse(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
  });

  it("finds a running Sahkarmi installer in tasklist output", () => {
    const tasks = [
      '"System Idle Process","0","Services","0","8 K"',
      '"Sahkarmi.exe","2210","Console","1","180,000 K"',
      '"Sahkarmi-0.12.1-x64.exe","14456","Console","1","6,512 K"',
    ].join("\r\n");
    expect(runningInstallerName(tasks, "0.12.0")).toBe("Sahkarmi-0.12.1-x64.exe");
    expect(
      runningInstallerName('"Sahkarmi.exe","2210","Console","1","180,000 K"', "0.12.0"),
    ).toBeNull();
    expect(runningInstallerName("", "0.12.0")).toBeNull();
  });

  it("ignores a leftover installer for this version or an older one", () => {
    const stuck = '"Sahkarmi-0.8.0-x64.exe","31176","Console","1","6,512 K"';
    expect(runningInstallerName(stuck, "0.12.3")).toBeNull();
    const same = '"Sahkarmi-0.12.3-x64.exe","31176","Console","1","6,512 K"';
    expect(runningInstallerName(same, "0.12.3")).toBeNull();
  });
});
