import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { HostTailscaleStatus } from "../shared/ipc";

/** Runs the Tailscale command line; injectable so tests never touch the real app. */
export type TailscaleRunner = (
  args: string[],
  timeoutMs: number,
  /** Ends the wait early (the command keeps running) once the output holds what is needed. */
  enough?: (output: string) => boolean,
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

const WINDOWS_CLI = "C:\\Program Files\\Tailscale\\tailscale.exe";

function cliPath(): string {
  return existsSync(WINDOWS_CLI) ? WINDOWS_CLI : "tailscale";
}

export const runTailscale: TailscaleRunner = (args, timeoutMs, enough) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    // Answering early leaves the command running until it ends or the time limit stops it.
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve({ ok, stdout, stderr });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cliPath(), args, { windowsHide: true });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    const read = (chunk: Buffer, into: "out" | "err") => {
      if (into === "out") stdout = (stdout + chunk.toString()).slice(-1_000_000);
      else stderr = (stderr + chunk.toString()).slice(-100_000);
      if (enough?.(`${stdout}\n${stderr}`)) finish(false);
    };
    child.stdout?.on("data", (chunk: Buffer) => read(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => read(chunk, "err"));
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });

/** Reads `tailscale status --json`: connected or not, and this PC's private name. */
export function parseTailscaleStatus(
  json: string,
): Pick<HostTailscaleStatus, "connected" | "dnsName"> {
  try {
    const value = JSON.parse(json) as { BackendState?: unknown; Self?: { DNSName?: unknown } };
    const dnsName =
      typeof value.Self?.DNSName === "string" ? value.Self.DNSName.replace(/\.$/, "") : "";
    return {
      connected: value.BackendState === "Running",
      dnsName: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dnsName) ? dnsName.toLowerCase() : null,
    };
  } catch {
    return { connected: false, dnsName: null };
  }
}

/** Whether `tailscale serve status --json` already forwards to this port on this PC. */
export function servesPort(json: string, port: number): boolean {
  return new RegExp(`(127\\.0\\.0\\.1|localhost):${port}(?!\\d)`).test(json);
}

/** Whether the main https address already forwards somewhere other than this port. */
export function sharesSomethingElse(json: string, port: number): boolean {
  try {
    const value = JSON.parse(json || "{}") as {
      Web?: Record<string, { Handlers?: Record<string, unknown> }>;
    };
    const handlers = Object.entries(value.Web ?? {})
      .filter(([host]) => host.endsWith(":443"))
      .flatMap(([, web]) => Object.values(web.Handlers ?? {}));
    return handlers.some((handler) => !servesPort(JSON.stringify(handler), port));
  } catch {
    return false;
  }
}

/** Stops sharing the phone page, and only when the shared link points at this port. */
export async function unshareTailscale(
  port: number,
  run: TailscaleRunner = runTailscale,
): Promise<void> {
  const current = await run(["serve", "status", "--json"], 4_000);
  if (
    !current.ok ||
    !servesPort(current.stdout, port) ||
    sharesSomethingElse(current.stdout, port)
  ) {
    return;
  }
  await run(["serve", "--https=443", "off"], 10_000);
}

/** The approval page Tailscale prints when Serve is not yet allowed on the owner's network. */
export function enableLink(output: string): string | null {
  const match = /https:\/\/login\.tailscale\.com\/[^\s"']+/.exec(output);
  return match ? match[0] : null;
}

export async function tailscaleStatus(
  port: number | null,
  run: TailscaleRunner = runTailscale,
): Promise<HostTailscaleStatus> {
  const status = await run(["status", "--json"], 4_000);
  // The app prints JSON even when logged out; no output at all means it is not installed.
  if (!status.stdout.trim().startsWith("{")) {
    return {
      installed: status.ok || /tailscale/i.test(status.stderr),
      connected: false,
      dnsName: null,
      serving: false,
    };
  }
  const parsed = parseTailscaleStatus(status.stdout);
  let serving = false;
  if (parsed.connected && port) {
    const serve = await run(["serve", "status", "--json"], 4_000);
    serving = servesPort(serve.stdout, port);
  }
  return { installed: true, ...parsed, serving };
}

/**
 * Shares this PC's phone page with the owner's own devices only (`tailscale serve`, never the
 * public `funnel`). Returns a link when Tailscale first needs the owner to allow it.
 */
export async function shareWithTailscale(
  port: number,
  run: TailscaleRunner = runTailscale,
): Promise<{ ok: boolean; enableUrl: string | null; message: string }> {
  // Never replace a link the owner already shares for something else on this PC.
  const current = await run(["serve", "status", "--json"], 4_000);
  if (current.ok && sharesSomethingElse(current.stdout, port)) {
    return {
      ok: false,
      enableUrl: null,
      message:
        "Tailscale on this PC already shares another app at its main address. Sahkarmi left it alone. Use your own address below, or stop that share first.",
    };
  }
  // Tailscale may wait for the owner to allow sharing: show that page as soon as it is printed.
  const result = await run(
    ["serve", "--bg", `http://127.0.0.1:${port}`],
    60_000,
    (output) => enableLink(output) !== null,
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const enableUrl = enableLink(output);
  if (enableUrl) return { ok: false, enableUrl, message: "allow" };
  return { ok: result.ok, enableUrl: null, message: result.ok ? "" : output.trim().slice(0, 300) };
}
