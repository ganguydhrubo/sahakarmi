import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type {
  ApprovalRequest,
  BotSummary,
  ConversationSnapshot,
  DecideApprovalInput,
  HostActivity,
  HostDevice,
  HostStatus,
  HostTailscaleStatus,
  RoutinesState,
  SendMessageInput,
} from "../shared/ipc";
import { PHONE_FILES } from "./host-phone-page";

/** What the phone may reach: the same calls the desktop makes, nothing more. */
export interface HostAgentPort {
  listBots(): BotSummary[];
  readConversation(botId: string): Promise<ConversationSnapshot>;
  sendMessage(input: SendMessageInput): Promise<unknown>;
  listApprovals(): ApprovalRequest[];
  decideApproval(input: DecideApprovalInput): Promise<ApprovalRequest>;
  routines(): Promise<RoutinesState>;
  runRoutine(routineId: string): Promise<unknown>;
  /** Private details a coworker waits for; typed on the PC only, never on the phone. */
  waitingOnPc?(): Array<{ botId: string; title: string }>;
}

export interface HostServerOptions {
  userDataPath: string;
  agent: HostAgentPort;
  /** Turns the QR link into an SVG picture. */
  makeQr: (text: string) => Promise<string>;
  tailscale: {
    status: (port: number | null) => Promise<HostTailscaleStatus>;
    share: (port: number) => Promise<{ ok: boolean; enableUrl: string | null; message: string }>;
    /** Stops sharing, but only when the shared link points at this port. */
    unshare?: (port: number) => Promise<void>;
  };
  /** Start hidden with Windows; null where Windows manages startup itself (Store build). */
  setStartWithWindows: ((enabled: boolean) => void) | null;
  log?: (level: "info" | "warn" | "error", message: string, detail?: unknown) => void;
  now?: () => number;
  /** Tests listen on port 0 (any free port). */
  basePort?: number;
}

interface StoredDevice extends HostDevice {
  tokenHash: string;
}

interface StoredHost {
  version: 1;
  enabled: boolean;
  port: number | null;
  startWithWindows: boolean;
  address: string | null;
  devices: StoredDevice[];
}

interface Pairing {
  code: string;
  url: string;
  qrSvg: string;
  expiresAt: number;
  failures: number;
}

export const DEFAULT_HOST_PORT = 47821;
/** Tailscale's own page: it sends an iPhone to the App Store and Android to Google Play. */
const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";
const ACTIVITY_ACTIONS = new Set<HostActivity["action"]>([
  "paired",
  "message",
  "approved",
  "rejected",
  "routine",
  "unpaired",
  "removed",
]);
const PORT_TRIES = 10;
export const PAIRING_MS = 2 * 60_000;
const PAIRING_FAILURES = 8;
const MAX_DEVICES = 10;
const MAX_BODY = 32 * 1024;
const ACTIVITY_KEEP = 200;
const CHAT_MESSAGES = 40;
const TAILSCALE_CACHE_MS = 15_000;
const LAST_SEEN_SAVE_MS = 60_000;
const BAD_KEY_LIMIT = 30;
/** No 0/O, 1/I/L: easy to read aloud and type on a phone. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function pairingCode(): string {
  let code = "";
  for (let index = 0; index < 8; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A typed address must be a plain https origin, e.g. https://my-pc.tail1234.ts.net. */
export function cleanAddress(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error("That address is not a web address. Example: https://my-pc.tail1234.ts.net");
  }
  if (url.protocol !== "https:") throw new Error("The phone address must start with https://");
  if (url.username || url.password) throw new Error("The phone address cannot hold a password.");
  return url.origin;
}

/** "Where this request came from", worded as on the desktop card. */
function provenanceLine(provenance: ApprovalRequest["provenance"]): string | null {
  if (!provenance) return null;
  const name = provenance.label ? oneLine(provenance.label, 80) : "";
  switch (provenance.kind) {
    case "owner":
      return "You asked";
    case "remote":
      return "You asked, from your phone";
    case "routine":
      return name ? `A routine (${name})` : "A routine";
    case "schedule":
      return "A schedule";
    case "team-run":
      return "A team project";
    case "coworker":
      return name ? `Another coworker (${name})` : "Another coworker";
    case "system":
      return "Sahkarmi itself";
    case "web":
      return `A web page it read (${name || "?"})`;
    case "app":
      return `A reply from a connected app or tool (${name || "?"})`;
    case "file":
      return `A file from outside its folders (${name || "?"})`;
    default:
      return null;
  }
}

function safeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return cleanAddress(value);
  } catch {
    return null;
  }
}

/** Folds app notes such as "[Routine "x" · step 1/3]" to their words for the phone. */
function phoneText(text: string): string {
  return text.replace(/^\[[^\]\n]{1,120}\]\s*/, "").trim();
}

const DESIGN_REPLY = /^\s*(?:```(?:json)?\s*)?\{\s*"name"\s*:[\s\S]*"steps"\s*:\s*\[/;

/**
 * How one chat message reads on the phone. Notes the app wrote (approval results, routine steps,
 * "Describe it" drafts) become one short line instead of raw prompts or JSON.
 */
export function phoneMessage(text: string, mine: boolean): { text: string; note: boolean } {
  if (mine) {
    const approval = /^\[Approval (APPROVED|REJECTED)\] "([\s\S]*?)"/.exec(text);
    if (approval) {
      return {
        text: `You ${approval[1] === "APPROVED" ? "approved" : "rejected"}: ${oneLine(approval[2] ?? "", 120)}`,
        note: true,
      };
    }
    if (text.startsWith("[Browser handed back]"))
      return { text: "You handed the browser back.", note: true };
    if (text.startsWith("[Browser takeover declined]"))
      return { text: "You kept the browser.", note: true };
    if (text.startsWith("[Secure input entered]"))
      return { text: "You entered the private details.", note: true };
    if (text.startsWith("[Secure input declined]"))
      return { text: "You did not enter the private details.", note: true };
    const design = /^\[Routine design\][\s\S]*?What the owner wants: (.*)/.exec(text);
    if (design)
      return { text: `You asked for a routine: ${oneLine(design[1] ?? "", 160)}`, note: true };
    const step = /^\[Routine "(.*?)" · step (\d+)\/(\d+)/.exec(text);
    if (step) return { text: `Routine "${step[1]}", step ${step[2]} of ${step[3]}`, note: true };
  } else if (DESIGN_REPLY.test(text)) {
    try {
      const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
        name?: unknown;
        steps?: unknown;
      };
      if (Array.isArray(value.steps)) {
        const name = typeof value.name === "string" ? ` "${oneLine(value.name, 80)}"` : "";
        return { text: `Drafted the routine${name} with ${value.steps.length} steps.`, note: true };
      }
    } catch {
      // Not the JSON it looked like: show the text as it is.
    }
  }
  return { text: phoneText(text), note: false };
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Sahkarmi Host: a small web page for the owner's phone, served by this PC.
 *
 * It listens on 127.0.0.1 only, so nothing on the network or the internet can reach it. The owner's
 * own tunnel (Tailscale Serve, private to their devices) forwards the phone to it. A phone pairs with
 * a one-time code that lives two minutes, then holds its own key (stored here only as a hash) that
 * the owner can remove at any time. Phone actions go through the same calls and approval policy as
 * the desktop, and each one is written to the activity list.
 */
export class HostServer {
  readonly #options: HostServerOptions;
  readonly #file: string;
  readonly #activityFile: string;
  readonly #now: () => number;
  #data: StoredHost = {
    version: 1,
    enabled: false,
    port: null,
    startWithWindows: false,
    address: null,
    devices: [],
  };
  #activity: HostActivity[] = [];
  #server: Server | null = null;
  #pairing: Pairing | null = null;
  #error: string | null = null;
  #tailscale: { at: number; value: HostTailscaleStatus } | null = null;
  #lastSeenSaved = 0;
  #badKeys = { windowStart: 0, count: 0 };
  #listening: Promise<void> | null = null;
  #installQr: string | null = null;
  #tailscaleAsking: Promise<HostTailscaleStatus> | null = null;
  #saving: Promise<void> = Promise.resolve();

  constructor(options: HostServerOptions) {
    this.#options = options;
    this.#file = join(options.userDataPath, "host.json");
    this.#activityFile = join(options.userDataPath, "host-activity.jsonl");
    this.#now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.#data.enabled;
  }

  get port(): number | null {
    return this.#server ? this.#data.port : null;
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.#file, "utf8")) as Partial<StoredHost>;
      this.#data = {
        version: 1,
        enabled: value.enabled === true,
        port: typeof value.port === "number" && value.port > 0 ? value.port : null,
        startWithWindows: value.startWithWindows === true,
        address: safeAddress(value.address),
        devices: Array.isArray(value.devices)
          ? value.devices.filter(
              (device): device is StoredDevice =>
                typeof device?.id === "string" &&
                typeof device.name === "string" &&
                typeof device.tokenHash === "string" &&
                /^[0-9a-f]{64}$/.test(device.tokenHash),
            )
          : [],
      };
    } catch {
      // No file yet, or a damaged one: start switched off. Paired phones must pair again.
    }
    try {
      const lines = (await readFile(this.#activityFile, "utf8")).split("\n").filter(Boolean);
      this.#activity = lines
        .slice(-ACTIVITY_KEEP)
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as HostActivity;
            return ACTIVITY_ACTIONS.has(entry?.action) && typeof entry.at === "string"
              ? [entry]
              : [];
          } catch {
            return [];
          }
        })
        .reverse();
      if (lines.length > ACTIVITY_KEEP * 2) {
        await writeFile(
          this.#activityFile,
          `${[...this.#activity]
            .reverse()
            .map((entry) => JSON.stringify(entry))
            .join("\n")}\n`,
        );
      }
    } catch {
      this.#activity = [];
    }
    if (this.#data.enabled) await this.#listen();
  }

  async status(options: { refresh?: boolean } = {}): Promise<HostStatus> {
    this.#expirePairing();
    this.#installQr ??= await this.#options.makeQr(TAILSCALE_DOWNLOAD).catch(() => "");
    const tailscale = await this.#tailscaleStatus(options.refresh === true);
    const fromTailscale =
      !this.#data.address && tailscale.serving && tailscale.dnsName
        ? `https://${tailscale.dnsName}`
        : null;
    return {
      enabled: this.#data.enabled,
      running: this.#server !== null,
      port: this.port,
      startWithWindows: this.#data.startWithWindows,
      canStartWithWindows: this.#options.setStartWithWindows !== null,
      address: this.#data.address ?? fromTailscale,
      addressFromTailscale: fromTailscale !== null,
      tailscale,
      devices: this.#data.devices.map(({ tokenHash: _hash, ...device }) => device),
      installQrSvg: this.#installQr,
      pairing: this.#pairing
        ? {
            code: this.#pairing.code,
            url: this.#pairing.url,
            qrSvg: this.#pairing.qrSvg,
            expiresAt: new Date(this.#pairing.expiresAt).toISOString(),
          }
        : null,
      activity: this.#activity.slice(0, 20),
      error: this.#error,
    };
  }

  async setEnabled(enabled: boolean): Promise<HostStatus> {
    this.#data.enabled = enabled;
    if (enabled) await this.#listen();
    else {
      this.#pairing = null;
      const port = this.#data.port;
      await this.close();
      // Nothing else on this PC should ever receive what phones send to the shared link.
      if (port) await this.#options.tailscale.unshare?.(port).catch(() => undefined);
      this.#tailscale = null;
      // Starting hidden with Windows only makes sense while the host is on.
      if (this.#data.startWithWindows) {
        this.#options.setStartWithWindows?.(false);
        this.#data.startWithWindows = false;
      }
    }
    await this.#save();
    return this.status();
  }

  async setStartWithWindows(enabled: boolean): Promise<HostStatus> {
    if (!this.#options.setStartWithWindows)
      throw new Error("Windows manages startup for this copy.");
    this.#options.setStartWithWindows(enabled);
    this.#data.startWithWindows = enabled;
    await this.#save();
    return this.status();
  }

  async setAddress(address: string): Promise<HostStatus> {
    this.#data.address = cleanAddress(address);
    this.#pairing = null;
    this.#error = null;
    await this.#save();
    return this.status();
  }

  /** Shares the page with the owner's devices through Tailscale Serve, on their click. */
  async setupTailscale(): Promise<HostStatus & { enableUrl?: string }> {
    if (!this.#server || !this.#data.port) throw new Error("Turn on Sahkarmi Host first.");
    const result = await this.#options.tailscale.share(this.#data.port);
    this.#error =
      result.ok || result.enableUrl ? null : result.message || "Tailscale did not answer.";
    const status = await this.status({ refresh: true });
    return result.enableUrl ? { ...status, enableUrl: result.enableUrl } : status;
  }

  async startPairing(): Promise<HostStatus> {
    if (!this.#server) throw new Error("Turn on Sahkarmi Host first.");
    const { address } = await this.status();
    if (!address) throw new Error("Set up the phone address first.");
    if (this.#data.devices.length >= MAX_DEVICES) {
      throw new Error(`Up to ${MAX_DEVICES} phones can be paired. Remove one first.`);
    }
    const code = pairingCode();
    // The code rides in the #fragment: browsers never send it to any server or log.
    const url = `${address}/#pair=${code}`;
    this.#pairing = {
      code,
      url,
      qrSvg: await this.#options.makeQr(url),
      expiresAt: this.#now() + PAIRING_MS,
      failures: 0,
    };
    return this.status();
  }

  async cancelPairing(): Promise<HostStatus> {
    this.#pairing = null;
    return this.status();
  }

  async removeDevice(deviceId: string): Promise<HostStatus> {
    const device = this.#data.devices.find((candidate) => candidate.id === deviceId);
    if (device) {
      this.#data.devices = this.#data.devices.filter((candidate) => candidate.id !== deviceId);
      await this.#save();
      await this.#record(device.name, "removed", "");
    }
    return this.status();
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Waits for pending writes; tests and quit use it. */
  async flush(): Promise<void> {
    await this.#saving;
  }

  #listen(): Promise<void> {
    if (this.#server) return Promise.resolve();
    // One start at a time: a switch flipped while starting waits for the same start.
    this.#listening ??= this.#listenOnce().finally(() => {
      this.#listening = null;
    });
    return this.#listening;
  }

  async #listenOnce(): Promise<void> {
    await this.#bind();
    // Switched off while it was starting: do not leave it running.
    if (!this.#data.enabled) await this.close();
  }

  async #bind(): Promise<void> {
    const saved = this.#options.basePort === undefined ? this.#data.port : null;
    const base = this.#options.basePort ?? saved ?? DEFAULT_HOST_PORT;
    // A port Tailscale already forwards to is kept: moving would send phones somewhere else.
    const tries = base === 0 || saved ? 1 : PORT_TRIES;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const port = base === 0 ? 0 : base + attempt;
      const server = createServer((request, response) => void this.#handle(request, response));
      server.requestTimeout = 15_000;
      server.headersTimeout = 10_000;
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          // Loopback only: the owner's tunnel is the only way in from outside this PC.
          server.listen(port, "127.0.0.1", () => resolve());
        });
      } catch (cause) {
        server.close();
        if ((cause as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
        this.#error = cause instanceof Error ? cause.message : String(cause);
        this.#options.log?.("error", "host could not start", { error: this.#error });
        return;
      }
      const address = server.address();
      this.#server = server;
      this.#error = null;
      const chosen = typeof address === "object" && address ? address.port : port;
      if (this.#data.port !== chosen && this.#options.basePort !== 0) {
        this.#data.port = chosen;
        await this.#save();
      } else this.#data.port = chosen;
      this.#options.log?.("info", "host listening", { port: chosen });
      return;
    }
    this.#error = saved
      ? `Another program on this PC is using port ${saved}, which your phone link points to. Close it or restart the PC, then turn Sahkarmi Host off and on.`
      : "Every port Sahkarmi Host can use is busy. Restart the PC and try again.";
  }

  async #tailscaleStatus(refresh: boolean): Promise<HostTailscaleStatus> {
    const cached = this.#tailscale;
    if (!refresh && cached && this.#now() - cached.at < TAILSCALE_CACHE_MS) return cached.value;
    // One question to Tailscale at a time; callers in the meantime share the answer.
    this.#tailscaleAsking ??= this.#options.tailscale
      .status(this.port)
      .catch(() => ({ installed: false, connected: false, dnsName: null, serving: false }))
      .then((value) => {
        this.#tailscale = { at: this.#now(), value };
        return value;
      })
      .finally(() => {
        this.#tailscaleAsking = null;
      });
    return this.#tailscaleAsking;
  }

  #expirePairing(): void {
    if (this.#pairing && this.#now() >= this.#pairing.expiresAt) this.#pairing = null;
  }

  #save(): Promise<void> {
    const text = `${JSON.stringify(this.#data, null, 2)}\n`;
    this.#saving = this.#saving
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.#options.userDataPath, { recursive: true });
        const temp = `${this.#file}.${process.pid}.tmp`;
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, this.#file);
      })
      .catch((cause) => {
        this.#options.log?.("warn", "host settings not saved", { error: String(cause) });
      });
    return this.#saving;
  }

  async #record(deviceName: string, action: HostActivity["action"], detail: string): Promise<void> {
    const entry: HostActivity = {
      at: new Date(this.#now()).toISOString(),
      deviceName: oneLine(deviceName, 60),
      action,
      detail: oneLine(detail, 120),
    };
    this.#activity = [entry, ...this.#activity].slice(0, ACTIVITY_KEEP);
    try {
      await appendFile(this.#activityFile, `${JSON.stringify(entry)}\n`);
    } catch (cause) {
      this.#options.log?.("warn", "host activity not saved", { error: String(cause) });
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://host.invalid");
      // Only names this PC really answers to: a site that points its own name at 127.0.0.1
      // (DNS rebinding) is turned away before anything else.
      if (!(await this.#knownHost(request.headers.host ?? ""))) {
        throw new HttpError(421, "Open this page from the address shown on your PC.");
      }
      // A page on another site cannot drive this one through the visitor's browser.
      const origin = request.headers.origin;
      if (origin && origin !== "null") {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = "";
        }
        if (originHost !== request.headers.host) throw new HttpError(403, "Not allowed.");
      } else if (origin === "null") throw new HttpError(403, "Not allowed.");

      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        const file = PHONE_FILES[url.pathname === "/" ? "/index.html" : url.pathname];
        if (!file) throw new HttpError(404, "Not found.");
        response.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": file.type });
        response.end(file.body);
        return;
      }
      if (!url.pathname.startsWith("/api/")) throw new HttpError(405, "Not allowed.");
      const body = request.method === "POST" ? await readBody(request) : {};
      if (request.method !== "GET" && request.method !== "POST") {
        throw new HttpError(405, "Not allowed.");
      }
      if (url.pathname === "/api/pair" && request.method === "POST") {
        this.#json(response, 200, await this.#pair(body));
        return;
      }
      const device = this.#authenticate(request);
      const result = await this.#route(request.method, url, body, device);
      this.#json(response, 200, result);
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500;
      const message =
        cause instanceof HttpError
          ? cause.message
          : "Something went wrong on your PC. Try again in a moment.";
      if (!(cause instanceof HttpError)) {
        this.#options.log?.("warn", "host request failed", { error: String(cause) });
      }
      if (status === 413) response.setHeader("Connection", "close");
      if (!response.headersSent) this.#json(response, status, { error: message });
      else response.end();
    }
  }

  async #knownHost(header: string): Promise<boolean> {
    const host = header.trim().toLowerCase();
    if (!host) return false;
    const port = this.port;
    const names = (): Set<string> => {
      const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (this.#data.address) allowed.add(new URL(this.#data.address).host.toLowerCase());
      const dnsName = this.#tailscale?.value.dnsName;
      if (dnsName) allowed.add(dnsName).add(`${dnsName}:443`);
      return allowed;
    };
    if (names().has(host)) return true;
    // The first phone visit after a start can come before Tailscale was asked for this PC's name.
    if (host.endsWith(".ts.net") || host.endsWith(".ts.net:443")) {
      await this.#tailscaleStatus(false);
      return names().has(host);
    }
    return false;
  }

  #json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  }

  async #pair(body: Record<string, unknown>): Promise<{ key: string; deviceId: string }> {
    this.#expirePairing();
    const pairing = this.#pairing;
    const code =
      typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/[\s-]/g, "") : "";
    if (!pairing) {
      throw new HttpError(
        410,
        "This code has expired. Press Pair a phone on your PC for a new one.",
      );
    }
    if (!sameText(code, pairing.code)) {
      pairing.failures += 1;
      // Too many wrong guesses end the code: guessing one is then hopeless.
      if (pairing.failures >= PAIRING_FAILURES) this.#pairing = null;
      throw new HttpError(401, "That code is not right. Check the code on your PC.");
    }
    this.#pairing = null;
    const key = randomBytes(32).toString("base64url");
    const name = oneLine(
      typeof body.name === "string" && body.name.trim() ? body.name : "Phone",
      40,
    );
    const device: StoredDevice = {
      id: randomUUID(),
      name,
      pairedAt: new Date(this.#now()).toISOString(),
      lastSeenAt: new Date(this.#now()).toISOString(),
      tokenHash: hashKey(key),
    };
    // A phone pairing again hands in its old key: that entry is replaced, not duplicated.
    const previous =
      typeof body.previousKey === "string" && body.previousKey ? hashKey(body.previousKey) : "";
    const kept = this.#data.devices.filter(
      (candidate) => !previous || !sameText(candidate.tokenHash, previous),
    );
    this.#data.devices = [...kept, device].slice(-MAX_DEVICES);
    await this.#save();
    await this.#record(name, "paired", "");
    return { key, deviceId: device.id };
  }

  #authenticate(request: IncomingMessage): StoredDevice {
    const now = this.#now();
    const header = request.headers.authorization ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const hash = key ? hashKey(key) : "";
    const device = hash
      ? this.#data.devices.find((candidate) => sameText(candidate.tokenHash, hash))
      : undefined;
    if (!device) {
      // Wrong keys slow down further guessing; a paired phone is never locked out by them.
      if (now - this.#badKeys.windowStart > 60_000) this.#badKeys = { windowStart: now, count: 0 };
      if (this.#badKeys.count >= BAD_KEY_LIMIT) {
        throw new HttpError(429, "Too many tries. Wait a minute.");
      }
      this.#badKeys.count += 1;
      throw new HttpError(401, "This phone is not paired. Pair it again from your PC.");
    }
    device.lastSeenAt = new Date(now).toISOString();
    if (now - this.#lastSeenSaved > LAST_SEEN_SAVE_MS) {
      this.#lastSeenSaved = now;
      void this.#save();
    }
    return device;
  }

  async #route(
    method: string | undefined,
    url: URL,
    body: Record<string, unknown>,
    device: StoredDevice,
  ): Promise<unknown> {
    const agent = this.#options.agent;
    const bots = () => agent.listBots();
    if (method === "GET" && url.pathname === "/api/overview") {
      const all = bots();
      const names = new Map(all.map((bot) => [bot.id, bot.name]));
      const routines = await agent.routines();
      return {
        coworkers: all.map((bot) => ({
          id: bot.id,
          name: bot.name,
          role: bot.role,
          preview: oneLine(phoneText(bot.preview ?? ""), 90),
          updatedAt: bot.updatedAt,
        })),
        approvals: agent
          .listApprovals()
          .filter((approval) => approval.status === "pending")
          .map((approval) => ({
            id: approval.id,
            coworker: names.get(approval.botId) ?? "A coworker",
            title: approval.title,
            details:
              approval.details.length > 600
                ? `${approval.details.slice(0, 600)}…`
                : approval.details,
            // What exactly will run, and where the request came from, as on the desktop card.
            technical: approval.technical ? approval.technical.slice(0, 1_500) : null,
            source: provenanceLine(approval.provenance),
            // Outside content can carry instructions the owner never gave: the phone flags it.
            outside: ["web", "app", "file"].includes(approval.provenance?.kind ?? ""),
            amount: approval.amount,
            risk: approval.riskLevel ?? null,
            createdAt: approval.createdAt,
            expiresAt: approval.expiresAt ?? null,
          })),
        waitingOnPc: (agent.waitingOnPc?.() ?? []).map((item) => ({
          coworker: names.get(item.botId) ?? "A coworker",
          title: item.title,
        })),
        routines: routines.routines.map((routine) => {
          const lastRun = routines.runs.find((run) => run.routineId === routine.id);
          return {
            id: routine.id,
            name: routine.name,
            enabled: routine.enabled,
            steps: routine.steps.length,
            lastRunAt: routine.lastRunAt,
            lastStatus: lastRun?.status ?? null,
          };
        }),
      };
    }
    if (method === "GET" && url.pathname === "/api/chat") {
      const botId = url.searchParams.get("bot") ?? "";
      if (!bots().some((bot) => bot.id === botId)) throw new HttpError(404, "Coworker not found.");
      const snapshot = await agent.readConversation(botId);
      return {
        busy: snapshot.activeTurnId !== null,
        messages: snapshot.messages
          .filter(
            (message) =>
              message.text.trim() &&
              (message.author === "user" ||
                message.author === "assistant" ||
                message.author === "agent") &&
              !message.tool,
          )
          .slice(-CHAT_MESSAGES)
          .map((message) => {
            const mine = message.author === "user";
            const shown = phoneMessage(message.text, mine);
            return {
              id: message.id,
              mine,
              note: shown.note,
              text: shown.text.slice(0, 8_000),
              at: message.createdAt,
              status: message.status,
            };
          }),
      };
    }
    if (method === "POST" && url.pathname === "/api/chat") {
      const botId = typeof body.botId === "string" ? body.botId : "";
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const bot = bots().find((candidate) => candidate.id === botId);
      if (!bot) throw new HttpError(404, "Coworker not found.");
      if (!text) throw new HttpError(400, "Write a message first.");
      if (text.length > 8_000) throw new HttpError(400, "That message is too long for the phone.");
      await agent.sendMessage({ botId, text, remote: true });
      await this.#record(device.name, "message", bot.name);
      return { ok: true };
    }
    if (method === "POST" && url.pathname === "/api/approval") {
      const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
      const decision =
        body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
      if (!decision) throw new HttpError(400, "Choose Approve or Reject.");
      const pending = agent
        .listApprovals()
        .find((approval) => approval.id === approvalId && approval.status === "pending");
      if (!pending) throw new HttpError(409, "This request was already decided or has expired.");
      // The same call and policy as the desktop card; only the audit label differs.
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1_000) : "";
      try {
        await agent.decideApproval({
          approvalId,
          decision,
          decidedBy: `phone:${device.id}`,
          ...(note ? { note } : {}),
        });
      } catch (error) {
        // Decided on the PC a moment ago: say so instead of "something went wrong".
        const still = agent
          .listApprovals()
          .some((approval) => approval.id === approvalId && approval.status === "pending");
        if (!still) throw new HttpError(409, "This request was already decided or has expired.");
        throw error;
      }
      await this.#record(device.name, decision, pending.title);
      return { ok: true };
    }
    if (method === "POST" && url.pathname === "/api/routine") {
      const routineId = typeof body.routineId === "string" ? body.routineId : "";
      const routine = (await agent.routines()).routines.find(
        (candidate) => candidate.id === routineId,
      );
      if (!routine) throw new HttpError(404, "Routine not found.");
      await agent.runRoutine(routineId);
      await this.#record(device.name, "routine", routine.name);
      return { ok: true };
    }
    if (method === "POST" && url.pathname === "/api/unpair") {
      this.#data.devices = this.#data.devices.filter((candidate) => candidate.id !== device.id);
      await this.#save();
      await this.#record(device.name, "unpaired", "");
      return { ok: true };
    }
    throw new HttpError(404, "Not found.");
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  // JSON only: a plain form or text post from another page cannot reach these calls.
  const type = request.headers["content-type"] ?? "";
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      // Stop reading; the answer still goes out, then the connection closes.
      request.pause();
      throw new HttpError(413, "That is too large.");
    }
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "That request was not readable.");
  }
}
