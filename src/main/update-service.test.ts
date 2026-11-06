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
  fileInstallAttemptStore,
  type InstallAttempt,
  type InstallAttemptStore,
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

function memoryAttempts(initial: InstallAttempt | null = null) {
  let attempt = initial;
  const store: InstallAttemptStore & { writes: (InstallAttempt | null)[] } = {
    writes: [],
    read: () => attempt,
    write: (next) => {
      attempt = next;
      store.writes.push(next);
    },
  };
  return store;
}

/** A fake updater whose download is already on disk: available and downloaded at once. */
function readyUpdater(version = "0.1.1") {
  const updater = new FakeUpdater();
  updater.checkForUpdates.mockImplementation(async () => {
    updater.emit("update-available", { version });
    return null;
  });
  updater.downloadUpdate.mockImplementation(async () => {
    updater.emit("update-downloaded", { version });
    return [];
  });
  return updater;
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
    expect(service.getStatus().phase).toBe("installing");
    service.stop();
  });

  it("records the attempt before the installer starts and notices next start that it failed", async () => {
    const attempts = memoryAttempts();
    const updater = readyUpdater();
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      installAttempts: attempts,
    });
    service.start(false);
    await service.checkForUpdates();
    await service.downloadUpdate();
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(service.getStatus()).toMatchObject({ phase: "ready", message: null });

    const order: string[] = [];
    updater.quitAndInstall.mockImplementation(() => order.push("install"));
    attempts.write = (next) => {
      order.push("record");
      attempts.writes.push(next);
    };
    await service.installUpdate();
    expect(order).toEqual(["record", "install"]);
    expect(attempts.writes.at(-1)).toMatchObject({ version: "0.1.1", count: 1 });
    service.stop();

    // Next start, still 0.1.0: Windows asked for permission and got No (or blocked the file).
    const again = readyUpdater();
    const second = new UpdateService(again as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      installAttempts: memoryAttempts({ version: "0.1.1", count: 1, at: "" }),
    });
    second.start(false);
    await second.checkForUpdates();
    await second.downloadUpdate();
    expect(second.getStatus().phase).toBe("ready");
    expect(second.getStatus().message).toContain("did not install");
    expect(second.getStatus().message).toContain("choose Yes");
    // No silent install at quit either: that would raise the same prompt every time the app closes.
    expect(again.autoInstallOnAppQuit).toBe(false);
    second.stop();
  });

  it("hands the update to the browser after two attempts that changed nothing", async () => {
    const updater = readyUpdater();
    const openDownload = vi.fn(async () => undefined);
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      installAttempts: memoryAttempts({ version: "0.1.1", count: 2, at: "" }),
      openDownload,
    });
    service.start(false);
    await service.checkForUpdates();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ phase: "available", availableVersion: "0.1.1" });
    expect(service.getStatus().message).toContain("Download the update");

    await service.downloadUpdate();
    expect(openDownload).toHaveBeenCalledWith("0.1.1");
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getStatus().message).toContain("Run anyway");
    service.stop();
  });

  it("forgets the attempt once the new version is running", () => {
    const attempts = memoryAttempts({ version: "0.1.1", count: 2, at: "" });
    const service = new UpdateService(new FakeUpdater() as unknown as AppUpdater, {
      currentVersion: "0.1.1",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      installAttempts: attempts,
    });
    service.start(false);
    expect(attempts.writes).toEqual([null]);
    service.stop();
  });

  it("shows an installer that could not start instead of staying on Installing forever", async () => {
    const updater = readyUpdater();
    const afterFailedInstall = vi.fn();
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: vi.fn(async () => undefined),
      afterFailedInstall,
    });
    service.start(false);
    await service.checkForUpdates();
    await service.downloadUpdate();
    updater.quitAndInstall.mockImplementation(() => {
      updater.emit("error", new Error("No update filepath provided, can't quit and install"));
    });
    await service.installUpdate();
    expect(service.getStatus().phase).toBe("error");
    expect(service.getStatus().message).toContain("Could not start the installer");
    expect(service.getStatus().message).toContain("sahkarmi.site");
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(afterFailedInstall).toHaveBeenCalledOnce();
    service.stop();
  });

  it("gives up on an install that neither quit the app nor reported an error", async () => {
    vi.useFakeTimers();
    try {
      const updater = readyUpdater();
      const service = new UpdateService(updater as unknown as AppUpdater, {
        currentVersion: "0.1.0",
        enabled: true,
        beforeInstall: vi.fn(async () => undefined),
        installTimeoutMs: 5_000,
      });
      service.start(false);
      await service.checkForUpdates();
      await service.downloadUpdate();
      await service.installUpdate();
      expect(service.getStatus().phase).toBe("installing");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(service.getStatus().phase).toBe("error");
      expect(service.getStatus().message).toContain("did not start");
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last install attempt in a small file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sahkarmi-attempt-"));
    const store = fileInstallAttemptStore(join(dir, "nested"));
    expect(store.read()).toBeNull();
    store.write({ version: "0.1.1", count: 1, at: "2026-11-03T12:00:00.000Z" });
    expect(store.read()).toEqual({ version: "0.1.1", count: 1, at: "2026-11-03T12:00:00.000Z" });
    writeFileSync(join(dir, "nested", "update-attempt.json"), "{not json");
    expect(store.read()).toBeNull();
    writeFileSync(join(dir, "nested", "update-attempt.json"), JSON.stringify({ version: 3 }));
    expect(store.read()).toBeNull();
    store.write(null);
    expect(readdirSync(join(dir, "nested"))).toEqual([]);
  });

  it("names the Microsoft Store as the updater of a Store copy", () => {
    const service = new UpdateService(new FakeUpdater() as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: false,
      beforeInstall: vi.fn(async () => undefined),
      unsupportedMessage: "This copy of Sahkarmi is updated by the Microsoft Store.",
    });
    expect(service.getStatus()).toMatchObject({
      phase: "unsupported",
      message: "This copy of Sahkarmi is updated by the Microsoft Store.",
    });
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

describe("UpdateService with Sahkarmi's install helper", () => {
  function helperService(
    updater: FakeUpdater,
    extra: Partial<ConstructorParameters<typeof UpdateService>[1]> = {},
  ) {
    const launches: Array<{ installer: string; version: string; mode: string }> = [];
    const service = new UpdateService(updater as unknown as AppUpdater, {
      currentVersion: "0.1.0",
      enabled: true,
      beforeInstall: async () => undefined,
      installAttempts: memoryAttempts(),
      launchInstaller: async (installer, version, mode) => {
        launches.push({ installer, version, mode });
      },
      ...extra,
    });
    return { service, launches };
  }
  const downloaded = { version: "0.1.1", downloadedFile: "C:cacheSahkarmi-0.1.1-x64.exe" };

  it("runs the installer through the helper, never electron-updater's launcher or install-on-quit", async () => {
    const updater = new FakeUpdater();
    const { service, launches } = helperService(updater);
    service.start(false);
    updater.emit("update-downloaded", downloaded);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await service.installUpdate();
    expect(launches).toEqual([
      { installer: downloaded.downloadedFile, version: "0.1.1", mode: "restart" },
    ]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    // The quit that follows Restart must not start a second, silent install.
    expect(await service.installOnQuit()).toBe(false);
    expect(launches).toHaveLength(1);
  });

  it("installs silently when the owner quits with an update ready", async () => {
    const updater = new FakeUpdater();
    const { service, launches } = helperService(updater);
    service.start(false);
    updater.emit("update-downloaded", downloaded);
    expect(await service.installOnQuit()).toBe(true);
    expect(await service.installOnQuit()).toBe(false);
    expect(launches).toEqual([
      { installer: downloaded.downloadedFile, version: "0.1.1", mode: "quit" },
    ]);
  });

  it("falls back to electron-updater when the helper cannot start", async () => {
    const updater = new FakeUpdater();
    const { service } = helperService(updater, {
      launchInstaller: async () => {
        throw new Error("cmd.exe blocked");
      },
    });
    service.start(false);
    updater.emit("update-downloaded", downloaded);
    await service.installUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("says why the last install failed, from the helper's record, and does not install on quit", () => {
    const updater = new FakeUpdater();
    const { service, launches } = helperService(updater, {
      installAttempts: memoryAttempts({ version: "0.1.1", count: 1, at: "" }),
      installResult: () => ({ version: "0.1.1", code: 2 }),
      describeInstallFailure: (code) => `code ${code} in plain words.`,
    });
    service.start(false);
    updater.emit("update-downloaded", downloaded);
    expect(service.getStatus()).toMatchObject({
      phase: "ready",
      message:
        "The last update did not install. code 2 in plain words. Click Restart to try again.",
    });
    return service.installOnQuit().then((started) => {
      expect(started).toBe(false);
      expect(launches).toEqual([]);
    });
  });

  it("ignores the helper's record once that version runs", () => {
    const updater = new FakeUpdater();
    const { service } = helperService(updater, {
      currentVersion: "0.1.1",
      installResult: () => ({ version: "0.1.1", code: 0 }),
    });
    service.start(false);
    updater.emit("update-downloaded", { version: "0.1.2", downloadedFile: "x.exe" });
    expect(service.getStatus().message).toBeNull();
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
