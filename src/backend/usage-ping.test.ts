import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsagePing } from "./usage-ping";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(day = new Date(2026, 10, 8, 10)) {
  const root = await mkdtemp(join(tmpdir(), "sahkarmi-usage-"));
  roots.push(root);
  let now = day;
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}'));
  const make = () =>
    new UsagePing(root, {
      version: "0.26.0",
      channel: "installer",
      url: "https://relay.test/exec",
      fetch,
      now: () => now,
      timeZone: () => "Asia/Kolkata",
    });
  return { root, fetch, make, setNow: (next: Date) => (now = next) };
}

describe("UsagePing", () => {
  it("sends nothing until the person says yes", async () => {
    const { fetch, make } = await setup();
    const ping = make();
    await ping.initialize();
    expect(ping.choice()).toBe("ask");
    expect(await ping.sendIfDue()).toBe("off");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends one anonymous note per day and marks the first day as new", async () => {
    const { fetch, make, setNow } = await setup();
    const ping = make();
    await ping.initialize();
    expect(await ping.setEnabled(true)).toBe("on");

    expect(await ping.sendIfDue()).toBe("sent");
    expect(await ping.sendIfDue()).toBe("already-sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1].body));
    expect(body).toMatchObject({
      v: 1,
      event: "app_active",
      version: "0.26.0",
      channel: "installer",
      newInstall: true,
      day: "2026-11-08",
      timeZone: "Asia/Kolkata",
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "channel",
        "day",
        "event",
        "firstDay",
        "install",
        "newInstall",
        "timeZone",
        "v",
        "version",
      ].sort(),
    );

    setNow(new Date(2026, 10, 9, 9));
    const restarted = make();
    await restarted.initialize();
    expect(await restarted.sendIfDue()).toBe("sent");
    const next = JSON.parse(String(fetch.mock.calls[1]?.[1].body));
    expect(next.install).toBe(body.install);
    expect(next.newInstall).toBe(false);
  });

  it("sends nothing when switched off and keeps the choice", async () => {
    const { fetch, make, root } = await setup();
    const ping = make();
    await ping.initialize();
    await ping.setEnabled(false);
    expect(await ping.sendIfDue()).toBe("off");

    const restarted = make();
    await restarted.initialize();
    expect(restarted.choice()).toBe("off");
    expect(await restarted.sendIfDue()).toBe("off");
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root, "usage-count.json"), "utf8")).enabled).toBe(false);
  });

  it("tries again later when the network is down, without throwing", async () => {
    const { fetch, make } = await setup();
    fetch.mockRejectedValueOnce(new Error("offline"));
    const ping = make();
    await ping.initialize();
    await ping.setEnabled(true);
    expect(await ping.sendIfDue()).toBe("failed");
    expect(await ping.sendIfDue()).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
