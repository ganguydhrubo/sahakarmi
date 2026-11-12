import { createSignal } from "solid-js";

/**
 * Getting-started guidance: what the owner has already seen, and nothing else.
 * No prompts, task text or account details are stored here.
 */
export const ONBOARDING_KEY = "sahkarmi:onboarding";

/**
 * auto: never decided; shown only to a new install (no chat history yet) ·
 * show: the owner chose Reset guidance · dismissed: never shown again on its own.
 */
export type WelcomeState = "auto" | "show" | "dismissed";
export type TourState = "never" | "skipped" | "finished";

export interface OnboardingState {
  version: 1;
  welcome: WelcomeState;
  tour: TourState;
  checklistHidden: boolean;
  /** The owner turned off the one-time tips next to features. */
  tipsOff: boolean;
  /** Tips already shown and closed; each appears once. */
  seenTips: string[];
}

const DEFAULT_STATE: OnboardingState = {
  version: 1,
  welcome: "auto",
  tour: "never",
  checklistHidden: false,
  tipsOff: false,
  seenTips: [],
};

const MAX_SEEN_TIPS = 100;

/**
 * Nothing opens by itself unless storage can both save and read back: otherwise a dismissed
 * welcome would come back on every launch.
 */
function probeStorage(): boolean {
  try {
    const probe = `${ONBOARDING_KEY}:probe`;
    window.localStorage.setItem(probe, "1");
    const ok = window.localStorage.getItem(probe) === "1";
    window.localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const value = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      version: 1,
      welcome: value.welcome === "show" || value.welcome === "dismissed" ? value.welcome : "auto",
      tour: value.tour === "skipped" || value.tour === "finished" ? value.tour : "never",
      checklistHidden: value.checklistHidden === true,
      tipsOff: value.tipsOff === true,
      seenTips: Array.isArray(value.seenTips)
        ? value.seenTips.filter((id): id is string => typeof id === "string").slice(-MAX_SEEN_TIPS)
        : [],
    };
  } catch {
    // A damaged value is treated as seen, so it can never cause a popup loop.
    return { ...DEFAULT_STATE, welcome: "dismissed", tipsOff: true };
  }
}

function readState(): OnboardingState {
  try {
    return parseOnboarding(window.localStorage.getItem(ONBOARDING_KEY));
  } catch {
    return { ...DEFAULT_STATE, welcome: "dismissed", tipsOff: true };
  }
}

const [storageWorks, setStorageWorks] = createSignal(probeStorage());
const [state, setStateSignal] = createSignal<OnboardingState>(readState());

export { state as onboardingState, storageWorks as onboardingStorageWorks };

function update(changes: Partial<OnboardingState>): void {
  const next = { ...state(), ...changes };
  // The screen follows the choice even if saving fails; it just will not be remembered.
  setStateSignal(next);
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(next));
  } catch {
    setStorageWorks(false);
  }
}

export function dismissWelcome(): void {
  if (state().welcome !== "dismissed") update({ welcome: "dismissed" });
}

export function setTourResult(result: Exclude<TourState, "never">): void {
  update({ tour: result });
}

export function setChecklistHidden(hidden: boolean): void {
  update({ checklistHidden: hidden });
}

/** Help → Reset guidance: the welcome card, checklist and tips come back once. */
export function resetOnboarding(): void {
  update({ welcome: "show", tour: "never", checklistHidden: false, tipsOff: false, seenTips: [] });
}

export function setTipsOff(off: boolean): void {
  update({ tipsOff: off });
}

export function markTipSeen(id: string): void {
  const seen = state().seenTips;
  if (!seen.includes(id)) update({ seenTips: [...seen, id].slice(-MAX_SEEN_TIPS) });
}

/** The welcome card, the tour and Help hold tips back while they are open. */
const [tipHolds, setTipHolds] = createSignal(0);
export function holdTips(): () => void {
  setTipHolds((count) => count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setTipHolds((count) => Math.max(0, count - 1));
  };
}

/** One tip at a time: the first that asks keeps the spot until it is closed or leaves. */
const [activeTip, setActiveTip] = createSignal<string | null>(null);

export { activeTip };

/** Whether this tip may show at all right now (not seen, tips on, nothing else open). */
export function tipEligible(id: string): boolean {
  const current = state();
  return !current.tipsOff && storageWorks() && !current.seenTips.includes(id) && tipHolds() === 0;
}

/** Takes the single tip spot if it is free. */
export function claimTip(id: string): void {
  if (activeTip() === null) setActiveTip(id);
}

export function releaseTip(id: string): void {
  if (activeTip() === id) setActiveTip(null);
}

/**
 * Whether the welcome card may appear: after Reset guidance, or on a new install (no chat
 * history yet). Pure, so it is safe inside a memo; see settleWelcomeForExistingUser.
 */
export function welcomeEligible(input: { botsLoaded: boolean; hasHistory: boolean }): boolean {
  const welcome = state().welcome;
  if (welcome === "dismissed" || !storageWorks()) return false;
  if (welcome === "show") return true;
  return input.botsLoaded && !input.hasHistory;
}

/** Someone who already has chats is not new: upgrading never shows a first-run message. */
export function settleWelcomeForExistingUser(input: {
  botsLoaded: boolean;
  hasHistory: boolean;
}): void {
  if (state().welcome === "auto" && input.botsLoaded && input.hasHistory) dismissWelcome();
}

/** Test helper: re-reads storage as a fresh launch would. */
export function reloadOnboardingForTests(): void {
  setStorageWorks(probeStorage());
  setStateSignal(readState());
  setActiveTip(null);
  setTipHolds(0);
}
