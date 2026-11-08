import type { ApprovalProvenance } from "../shared/ipc";
import { isSecretPath, mentionsSecretPath, type PermissionRequest } from "./permission-policy";

/**
 * Untrusted-content rule ("taint-guard" in Settings > Features).
 *
 * Once a coworker's turn has read something from outside (a web page, a fetched URL, a reply from
 * a connected app, a tool server or a web API, a file outside its folders), the first command it
 * runs, the first message it sends outward and the first key file it reads in that same turn is
 * shown to the owner, even when a pre-authorisation, auto mode or an earlier "yes for this task"
 * would let it through. One question per turn at most: the owner's answer covers the rest of that
 * turn, and the next turn starts clean.
 *
 * Pure state, no I/O: AgentService marks sources and asks `gate` before each permission check.
 */

/** Where outside content came from, in the owner's words. */
export interface TaintSource {
  kind: "web" | "app" | "file";
  /** A site's domain, an app or tool name, or a file name. Data, never instructions. */
  label: string;
}

type TurnState =
  | { status: "open" }
  | { status: "asking"; answer: Promise<GateOutcome> }
  | { status: "approved" }
  | { status: "declined" }
  | { status: "deferred" };

interface BotTaint {
  turnId: string;
  sources: TaintSource[];
  state: TurnState;
}

/** What the caller does with a guarded request. */
export type GateOutcome = "approved" | "declined" | "deferred";

const MAX_SOURCES = 5;

/** Only these, in a turn that read outside content, get the one extra question. */
export function isTaintGuarded(request: PermissionRequest, isCommand: boolean): boolean {
  if (request.category === "external_messages") return true;
  if (request.category === "file_read" && request.paths.some(isSecretPath)) return true;
  if (!isCommand) return false;
  if (request.category === "shell" || request.category === "file_delete") return true;
  // A "read-only" command that names a key file is a secret read.
  return mentionsSecretPath(request.action);
}

export function webSource(url: string | null | undefined): TaintSource {
  return { kind: "web", label: domainOf(url) ?? "a web page" };
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.replace(/^www\./, "") || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** "a web page it read (example.com)" style label for cards and audit. */
export function describeSource(source: TaintSource): string {
  switch (source.kind) {
    case "web":
      return `a web page it read (${source.label})`;
    case "app":
      return `a reply from ${source.label}`;
    case "file":
      return `a file from outside its folders (${source.label})`;
  }
}

export function provenanceOfSource(source: TaintSource): ApprovalProvenance {
  return {
    kind: source.kind === "web" ? "web" : source.kind === "app" ? "app" : "file",
    label: source.label.slice(0, 120),
  };
}

export class TaintGuard {
  readonly #bots = new Map<string, BotTaint>();

  /** This turn has now read outside content. */
  mark(botId: string, turnId: string | null, source: TaintSource): void {
    const key = turnId ?? "";
    let entry = this.#bots.get(botId);
    if (!entry || entry.turnId !== key) {
      entry = { turnId: key, sources: [], state: { status: "open" } };
      this.#bots.set(botId, entry);
    }
    const same = entry.sources.some(
      (known) => known.kind === source.kind && known.label === source.label,
    );
    if (!same && entry.sources.length < MAX_SOURCES) entry.sources.push(source);
  }

  /** The first outside source of this turn, or null when the turn is clean. */
  source(botId: string, turnId: string | null): TaintSource | null {
    const entry = this.#current(botId, turnId);
    return entry?.sources[0] ?? null;
  }

  /** A turn ended: its taint goes with it. */
  endTurn(botId: string, turnId: string | null): void {
    const entry = this.#bots.get(botId);
    if (entry && (turnId === null || entry.turnId === turnId)) this.#bots.delete(botId);
  }

  forget(botId: string): void {
    this.#bots.delete(botId);
  }

  /**
   * Runs `ask` for the first guarded request of a tainted turn and remembers the answer.
   * Returns null when nothing extra is needed (clean turn, or the owner already said yes this
   * turn): the caller then decides exactly as before. Concurrent requests share one question.
   */
  async gate(
    botId: string,
    turnId: string | null,
    ask: (source: TaintSource) => Promise<GateOutcome>,
  ): Promise<{ outcome: GateOutcome; asked: boolean; source: TaintSource } | null> {
    const entry = this.#current(botId, turnId);
    const source = entry?.sources[0];
    if (!entry || !source) return null;
    switch (entry.state.status) {
      case "approved":
        return null;
      case "declined":
        return { outcome: "declined", asked: false, source };
      case "deferred":
        return { outcome: "deferred", asked: false, source };
      case "asking": {
        const outcome = await entry.state.answer;
        return outcome === "approved" ? null : { outcome, asked: false, source };
      }
      case "open": {
        const answer = ask(source).catch((): GateOutcome => "declined");
        entry.state = { status: "asking", answer };
        const outcome = await answer;
        // The turn may have ended while the owner thought about it; only that turn's state moves.
        if (this.#bots.get(botId) === entry) entry.state = { status: outcome };
        return { outcome, asked: true, source };
      }
    }
  }

  #current(botId: string, turnId: string | null): BotTaint | null {
    const entry = this.#bots.get(botId);
    if (!entry || entry.turnId !== (turnId ?? "")) return null;
    return entry;
  }
}
