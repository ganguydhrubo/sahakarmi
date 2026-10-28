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
}

const DEFAULT_STATE: OnboardingState = {
  version: 1,
  welcome: "auto",
  tour: "never",
  checklistHidden: false,
};

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
    };
  } catch {
    // A damaged value is treated as seen, so it can never cause a popup loop.
    return { ...DEFAULT_STATE, welcome: "dismissed" };
  }
}

function readState(): OnboardingState {
  try {
    return parseOnboarding(window.localStorage.getItem(ONBOARDING_KEY));
  } catch {
    return { ...DEFAULT_STATE, welcome: "dismissed" };
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

/** Help → Reset guidance: the welcome card and checklist come back once. */
export function resetOnboarding(): void {
  update({ welcome: "show", tour: "never", checklistHidden: false });
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
}
