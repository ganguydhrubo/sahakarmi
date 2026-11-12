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
}

export interface HostServerOptions {
  userDataPath: string;
  agent: HostAgentPort;
  /** Turns the QR link into an SVG picture. */
  makeQr: (text: string) => Promise<string>;
  tailscale: {
    status: (port: number | null) => Promise<HostTailscaleStatus>;
    share: (port: number) => Promise<{ ok: boolean; enableUrl: string | null; message: string }>;
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
        address: typeof value.address === "string" ? value.address : null,
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
            return [JSON.parse(line) as HostActivity];
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
      await this.close();
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

  async #listen(): Promise<void> {
    if (this.#server) return;
    const base = this.#options.basePort ?? this.#data.port ?? DEFAULT_HOST_PORT;
    const tries = base === 0 ? 1 : PORT_TRIES;
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
    this.#error = "Every port Sahkarmi Host can use is busy. Restart the PC and try again.";
  }

  async #tailscaleStatus(refresh: boolean): Promise<HostTailscaleStatus> {
    const cached = this.#tailscale;
    if (!refresh && cached && this.#now() - cached.at < TAILSCALE_CACHE_MS) return cached.value;
    let value: HostTailscaleStatus;
    try {
      value = await this.#options.tailscale.status(this.port);
    } catch {
      value = { installed: false, connected: false, dnsName: null, serving: false };
    }
    this.#tailscale = { at: this.#now(), value };
    return value;
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
      if (!response.headersSent) this.#json(response, status, { error: message });
      else response.end();
    }
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
    if (now - this.#badKeys.windowStart > 60_000) this.#badKeys = { windowStart: now, count: 0 };
    if (this.#badKeys.count >= BAD_KEY_LIMIT)
      throw new HttpError(429, "Too many tries. Wait a minute.");
    const header = request.headers.authorization ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const hash = key ? hashKey(key) : "";
    const device = hash
      ? this.#data.devices.find((candidate) => sameText(candidate.tokenHash, hash))
      : undefined;
    if (!device) {
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
            details: approval.details.slice(0, 600),
            amount: approval.amount,
            risk: approval.riskLevel ?? null,
            createdAt: approval.createdAt,
            expiresAt: approval.expiresAt ?? null,
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
      await agent.decideApproval({ approvalId, decision, decidedBy: `phone:${device.id}` });
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
    if (size > MAX_BODY) throw new HttpError(413, "That is too large.");
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
