import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopHost } from "./desktop-host";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** A pretend PowerShell: answers each JSON line with `respond`, after saying it is ready. */
function fakeSpawn(respond: (request: Record<string, unknown>) => Record<string, unknown> | null) {
  const launches: { command: string; args: string[] }[] = [];
  const spawnImpl = ((command: string, args: string[]) => {
    launches.push({ command, args });
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit("exit", null);
    let buffer = "";
    child.stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const request = JSON.parse(line) as Record<string, unknown>;
        if (request.op === "crash") {
          child.emit("exit", 3);
        } else {
          const reply = respond(request);
          if (reply) child.stdout.write(`${JSON.stringify({ id: request.id, ...reply })}\n`);
        }
        index = buffer.indexOf("\n");
      }
    });
    child.stdin.on("finish", () => child.emit("exit", 0));
    setImmediate(() =>
      child.stdout.write(`${JSON.stringify({ ready: true, dpi: "per-monitor-v2" })}\n`),
    );
    return child;
  }) as never;
  return { spawnImpl, launches };
}

async function folder() {
  const path = await mkdtemp(join(tmpdir(), "sahkarmi-desktop-"));
  folders.push(path);
  return path;
}

describe("DesktopHost", () => {
  it("starts one hidden host, writes the script and speaks JSON lines", async () => {
    const dir = await folder();
    const { spawnImpl, launches } = fakeSpawn((request) => ({ ok: true, echo: request.op }));
    const host = new DesktopHost({
      scriptDir: dir,
      protectedPids: [42, 7],
      spawnImpl,
      powershellPath: "ps.exe",
    });
    expect(await host.request({ op: "ping" })).toMatchObject({ ok: true, echo: "ping" });
    expect(await host.request({ op: "list_windows" })).toMatchObject({ echo: "list_windows" });
    expect(launches).toHaveLength(1);
    expect(launches[0]?.command).toBe("ps.exe");
    expect(launches[0]?.args).toEqual(
      expect.arrayContaining(["-NoProfile", "-ProtectedPids", "42,7"]),
    );
    expect(host.dpiMode).toBe("per-monitor-v2");
    const script = await readFile(join(dir, "desktop-host.ps1"), "utf8");
    expect(script.charCodeAt(0)).toBe(0xfeff);
    await host.dispose();
  });

  it("turns a host error into a rejected request", async () => {
    const dir = await folder();
    const { spawnImpl } = fakeSpawn(() => ({ ok: false, error: "That is Sahkarmi's own window." }));
    const host = new DesktopHost({ scriptDir: dir, protectedPids: [1], spawnImpl });
    await expect(host.request({ op: "click", x: 1, y: 1 })).rejects.toThrow(
      "Sahkarmi's own window",
    );
    await host.dispose();
  });

  it("runs requests one at a time, in order", async () => {
    const dir = await folder();
    const seen: unknown[] = [];
    const { spawnImpl } = fakeSpawn((request) => {
      seen.push(request.op);
      return { ok: true };
    });
    const host = new DesktopHost({ scriptDir: dir, protectedPids: [1], spawnImpl });
    await Promise.all([
      host.request({ op: "a" }),
      host.request({ op: "b" }),
      host.request({ op: "c" }),
    ]);
    expect(seen).toEqual(["a", "b", "c"]);
    await host.dispose();
  });

  it("restarts after the host dies", async () => {
    const dir = await folder();
    const { spawnImpl, launches } = fakeSpawn(() => ({ ok: true }));
    const host = new DesktopHost({ scriptDir: dir, protectedPids: [1], spawnImpl });
    await host.request({ op: "ping" });
    await expect(host.request({ op: "crash" })).rejects.toThrow(/stopped \(code 3\)/);
    await host.request({ op: "ping" });
    expect(launches).toHaveLength(2);
    await host.dispose();
  });

  it("gives up on a hung request and starts fresh next time", async () => {
    const dir = await folder();
    const { spawnImpl, launches } = fakeSpawn((request) =>
      request.op === "hang" ? null : { ok: true },
    );
    const host = new DesktopHost({ scriptDir: dir, protectedPids: [1], spawnImpl });
    await expect(host.request({ op: "hang" }, 50)).rejects.toThrow(/took too long/);
    await host.request({ op: "ping" });
    expect(launches).toHaveLength(2);
    await host.dispose();
  });
});
