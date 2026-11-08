// Daily active count: once a day this copy of Sahkarmi tells the owner's mail relay (the same
// Apps Script that mails download clicks, deploy/apps-script/download-notify) "I was used today".
// The note carries a random ID made for this copy, the app version, how it was installed,
// whether it is new and the time zone. No name, account, chat, file or PC detail is sent, it is
// sent at most once a day in the background, and only after the person said yes (asked once in
// the sidebar, changeable any time in Settings > About).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

/** The download-click relay (repository variable DOWNLOAD_NOTIFY_URL); public by design. */
export const USAGE_RELAY_URL =
  "https://script.google.com/macros/s/AKfycbxEy-lV3Zztk-uh50lldAfo7xVQfK8lEKLsXwf-Y8QjYlteH1mtHtfHGChMQQ9db5s0yA/exec";

export type InstallChannel = "installer" | "store" | "scoop" | "other";

interface UsageState {
  v: 1;
  installId: string;
  /** The local day this copy first started with daily counting (YYYY-MM-DD). */
  firstDay: string;
  /** The last local day the relay got the note. */
  lastSentDay: string | null;
  /** null until the person answered; nothing is sent before a yes. */
  enabled: boolean | null;
}

export type UsageCountChoice = "ask" | "on" | "off";

export interface UsagePingOptions {
  version: string;
  channel: InstallChannel;
  url?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  timeZone?: () => string;
}

export type UsagePingResult = "sent" | "already-sent" | "off" | "failed";

export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isUsageState(value: unknown): value is UsageState {
  return (
    isRecord(value) &&
    value.v === 1 &&
    typeof value.installId === "string" &&
    ID.test(value.installId) &&
    typeof value.firstDay === "string" &&
    DAY.test(value.firstDay) &&
    (value.lastSentDay === null ||
      (typeof value.lastSentDay === "string" && DAY.test(value.lastSentDay))) &&
    (value.enabled === null || typeof value.enabled === "boolean")
  );
}

export class UsagePing {
  readonly #file: JsonFile<UsageState>;
  readonly #options: UsagePingOptions;
  #state: UsageState | null = null;
  #sending: Promise<UsagePingResult> | null = null;

  constructor(userDataPath: string, options: UsagePingOptions) {
    this.#file = new JsonFile(join(userDataPath, "usage-count.json"), { recoverCorrupt: true });
    this.#options = options;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(
      () => ({
        v: 1,
        installId: randomUUID(),
        firstDay: localDay(this.#now()),
        lastSentDay: null,
        enabled: null,
      }),
      isUsageState,
    );
    await this.#file.write(this.#state);
  }

  choice(): UsageCountChoice {
    const enabled = this.#state?.enabled ?? null;
    return enabled === null ? "ask" : enabled ? "on" : "off";
  }

  async setEnabled(enabled: boolean): Promise<UsageCountChoice> {
    if (!this.#state) throw new Error("Daily count is not ready yet.");
    this.#state = { ...this.#state, enabled };
    await this.#file.write(this.#state);
    return this.choice();
  }

  /** Sends today's note unless it went out already; never throws and never retries in a loop. */
  sendIfDue(): Promise<UsagePingResult> {
    this.#sending ??= this.#send().finally(() => {
      this.#sending = null;
    });
    return this.#sending;
  }

  async #send(): Promise<UsagePingResult> {
    const state = this.#state;
    if (state?.enabled !== true) return "off";
    const today = localDay(this.#now());
    if (state.lastSentDay === today) return "already-sent";
    let timeZone = "";
    try {
      timeZone = this.#options.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // An unknown zone only costs the country estimate.
    }
    const body = {
      v: 1,
      event: "app_active",
      install: state.installId,
      version: this.#options.version,
      channel: this.#options.channel,
      newInstall: state.firstDay === today,
      firstDay: state.firstDay,
      day: today,
      timeZone,
    };
    try {
      const send = this.#options.fetch ?? fetch;
      // text/plain keeps it a simple request, the same way the website beacon talks to the relay.
      const response = await send(this.#options.url ?? USAGE_RELAY_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      // Any answer means the relay got it; only a network failure is tried again later.
      void response.body?.cancel().catch(() => undefined);
    } catch {
      return "failed";
    }
    // Read the state again: the switch may have moved while the note was on its way.
    this.#state = { ...(this.#state ?? state), lastSentDay: today };
    await this.#file.write(this.#state).catch(() => undefined);
    return "sent";
  }
}
