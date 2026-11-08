/**
 * Two guards for the built-in browser, as pure logic the host calls:
 * - a per-coworker page budget (each coworker keeps at most a few awake pages), and
 * - a crash counter per site (a site whose page keeps crashing stays asleep for a while).
 */

/** Awake pages one coworker may keep with the page budget on. */
export const PAGES_PER_COWORKER = 2;
/** A page used more recently than this is never put to sleep by the budget (no thrashing). */
export const PAGE_BUDGET_IDLE_MS = 60_000;

export interface BudgetTab {
  id: string;
  ownerBotId: string | null;
  lastUsed: number;
  /** On screen, in use, with unsaved typing or playing sound: it never sleeps for the budget. */
  protected: boolean;
}

/**
 * Awake tabs to put to sleep so each coworker keeps at most `perCoworker` awake pages. The most
 * recently used pages are kept; protected pages count toward the budget but are never chosen,
 * and a page used in the last `idleMs` is left alone. The owner's own tabs (no coworker) are
 * not counted. Least recently used first.
 */
export function pagesOverBudget(
  awakeTabs: BudgetTab[],
  now: number,
  perCoworker = PAGES_PER_COWORKER,
  idleMs = PAGE_BUDGET_IDLE_MS,
): string[] {
  const byOwner = new Map<string, BudgetTab[]>();
  for (const tab of awakeTabs) {
    if (!tab.ownerBotId) continue;
    const list = byOwner.get(tab.ownerBotId);
    if (list) list.push(tab);
    else byOwner.set(tab.ownerBotId, [tab]);
  }
  const sleep: BudgetTab[] = [];
  for (const tabs of byOwner.values()) {
    if (tabs.length <= perCoworker) continue;
    let awake = tabs.length;
    // Least recently used first; protected tabs are skipped but still count as awake.
    const oldestFirst = [...tabs].sort((left, right) => left.lastUsed - right.lastUsed);
    for (const tab of oldestFirst) {
      if (awake <= perCoworker) break;
      if (tab.protected || now - tab.lastUsed < idleMs) continue;
      sleep.push(tab);
      awake -= 1;
    }
  }
  return sleep.sort((left, right) => left.lastUsed - right.lastUsed).map((tab) => tab.id);
}

/** Crashes of one site within the window before its tab stays asleep. */
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 10 * 60_000;
/** A page of the site that stayed up this long after loading counts as working again. */
export const CRASH_HEALTHY_MS = 2 * 60_000;

/**
 * Counts renderer crashes per site (hostname). After CRASH_LIMIT crashes within CRASH_WINDOW_MS
 * the site is "resting": its sleeping tabs are not woken for a coworker. A page of the site that
 * worked (stayed up CRASH_HEALTHY_MS after loading, or the owner opened it) clears the count.
 */
export class SiteCrashGuard {
  readonly #crashes = new Map<string, number[]>();
  readonly #loadedAt = new Map<string, number>();

  /** A page of this site finished loading. */
  noteLoaded(site: string, now: number): void {
    if (!site) return;
    this.#loadedAt.set(site, now);
  }

  /** A page of this site worked: its count starts again. */
  noteSuccess(site: string): void {
    this.#crashes.delete(site);
  }

  /** A page of this site crashed; returns how many crashes are counted in the window now. */
  noteCrash(site: string, now: number): number {
    if (!site) return 0;
    const loaded = this.#loadedAt.get(site);
    this.#loadedAt.delete(site);
    // The page ran fine for a good while before this crash: earlier crashes no longer count.
    if (loaded !== undefined && now - loaded >= CRASH_HEALTHY_MS) this.#crashes.delete(site);
    const recent = (this.#crashes.get(site) ?? []).filter((at) => now - at < CRASH_WINDOW_MS);
    recent.push(now);
    this.#crashes.set(site, recent);
    return recent.length;
  }

  /** True while the site has crashed CRASH_LIMIT times within the window. */
  isResting(site: string, now: number): boolean {
    if (!site) return false;
    const recent = (this.#crashes.get(site) ?? []).filter((at) => now - at < CRASH_WINDOW_MS);
    if (recent.length === 0) this.#crashes.delete(site);
    else this.#crashes.set(site, recent);
    return recent.length >= CRASH_LIMIT;
  }
}

/** The site (hostname) a crash counts against; "" for anything that is not a web page. */
export function siteOfPage(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** What the coworker is told when it tries to use a resting site's tab. Plain words only. */
export function restingSiteMessage(site: string): string {
  return `The page for ${site} stopped working ${CRASH_LIMIT} times in the last ${CRASH_WINDOW_MS / 60_000} minutes, so Sahkarmi keeps this tab asleep for now to keep the computer steady. Do not retry it right away: carry on without this site, try again in about ten minutes, or ask the owner to open the tab on screen.`;
}
