import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { HostTailscaleStatus } from "../shared/ipc";

/** Runs the Tailscale command line; injectable so tests never touch the real app. */
export type TailscaleRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

const WINDOWS_CLI = "C:\\Program Files\\Tailscale\\tailscale.exe";

function cliPath(): string {
  return existsSync(WINDOWS_CLI) ? WINDOWS_CLI : "tailscale";
}

export const runTailscale: TailscaleRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      cliPath(),
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
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
  const result = await run(["serve", "--bg", `http://127.0.0.1:${port}`], 20_000);
  const output = `${result.stdout}\n${result.stderr}`;
  const enableUrl = enableLink(output);
  if (enableUrl) return { ok: false, enableUrl, message: "allow" };
  return { ok: result.ok, enableUrl: null, message: result.ok ? "" : output.trim().slice(0, 300) };
}
