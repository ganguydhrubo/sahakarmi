import type { BotSummary } from "../shared/ipc";
import type { GeminiAccountSource } from "./gemini-accounts";

/**
 * Keeping Google's Antigravity server warm, and moving Gemini coworkers to the next signed-in
 * Google account when one reaches Google's usage limit.
 *
 * Why warm: agy_acp_server is a self-unpacking Python program. Every start unpacks ~7,400 files
 * (~340 MB) into %TEMP% before it can answer `initialize`, which takes one to two minutes on a
 * normal Windows PC (measured 65-124 s). A coworker's first reply used to wait for all of that.
 */

/** How many Gemini coworkers have their conversation reopened in the background after a start. */
export const GEMINI_PREWARM_LIMIT = 2;
/** Gemini unused this long: its server (and Google's helper processes) are stopped. */
export const GEMINI_IDLE_MS = 30 * 60_000;
/** A rotation chain for one coworker is forgotten after this long. */
const ROTATION_MEMORY_MS = 15 * 60_000;

export const geminiIdleMs = (): number => {
  const fromEnv = Number(process.env.SAHKARMI_GEMINI_IDLE_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : GEMINI_IDLE_MS;
};

/**
 * The Gemini coworkers whose conversations are reopened in the background once the server is up,
 * so their next message skips that step: the most recently used ones that already have a
 * conversation (a coworker that never ran keeps no thread, so moving it to another AI stays free).
 */
export function pickPrewarmBots(
  bots: readonly BotSummary[],
  isGemini: (bot: BotSummary) => boolean,
  loadedThreads: ReadonlySet<string>,
  limit = GEMINI_PREWARM_LIMIT,
): BotSummary[] {
  return bots
    .filter((bot) => isGemini(bot) && bot.threadId && !loadedThreads.has(bot.threadId))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .slice(0, limit);
}

/**
 * Stops the Gemini server after a quiet spell, re-armed by every sign of use. `isBusy` is asked
 * again when the timer fires, so a long turn without updates is never cut short.
 */
export class IdleWatch {
  readonly #onIdle: () => void | Promise<void>;
  readonly #isBusy: () => boolean;
  readonly #delayMs: () => number;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    onIdle: () => void | Promise<void>;
    isBusy: () => boolean;
    delayMs?: () => number;
  }) {
    this.#onIdle = options.onIdle;
    this.#isBusy = options.isBusy;
    this.#delayMs = options.delayMs ?? geminiIdleMs;
  }

  get armed(): boolean {
    return this.#timer !== null;
  }

  touch(): void {
    this.cancel();
    this.#timer = setTimeout(() => this.#fire(), this.#delayMs());
    this.#timer.unref?.();
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #fire(): void {
    this.#timer = null;
    if (this.#isBusy()) {
      this.touch();
      return;
    }
    void Promise.resolve(this.#onIdle()).catch(() => undefined);
  }
}

/** What to do when a Gemini coworker's message hit Google's usage limit. */
export type RotationPlan =
  /** Another signed-in account is ready: switch to it, restart the server and send again. */
  | { kind: "switch"; accountId: string }
  /** Another coworker already switched accounts since this turn began: just send again. */
  | { kind: "resend" }
  /** No other signed-in account left (or none at all): fall back as before. */
  | { kind: "none" };

/**
 * Remembers which Google accounts each coworker already tried for its current message, so a
 * limit on every account ends in the usual fallback instead of a loop.
 */
export class GeminiRotation {
  readonly #accounts: GeminiAccountSource;
  readonly #tried = new Map<string, { accounts: Set<string>; at: number }>();
  readonly #now: () => number;

  constructor(accounts: GeminiAccountSource, now: () => number = Date.now) {
    this.#accounts = accounts;
    this.#now = now;
  }

  /**
   * `failedOn` is the account the server was running on when the limit hit. When the account in
   * use is already a different one (another coworker rotated first), the message is simply sent
   * again on it, once.
   */
  async plan(botId: string, failedOn: string | null): Promise<RotationPlan> {
    const now = this.#now();
    const entry = this.#tried.get(botId);
    const tried = entry && now - entry.at < ROTATION_MEMORY_MS ? entry.accounts : new Set<string>();
    if (failedOn) tried.add(failedOn);
    this.#tried.set(botId, { accounts: tried, at: now });
    const active = this.#accounts.activeId();
    if (failedOn && active !== failedOn && !tried.has(active)) {
      tried.add(active);
      return { kind: "resend" };
    }
    const next = await this.#accounts.nextSignedIn(tried);
    if (!next) return { kind: "none" };
    tried.add(next);
    await this.#accounts.setActive(next);
    return { kind: "switch", accountId: next };
  }

  /** The coworker got an answer: its next limit starts a fresh chain. */
  forget(botId: string): void {
    this.#tried.delete(botId);
  }
}
