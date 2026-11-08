import { createSignal } from "solid-js";

export type UsageCountChoice = "ask" | "on" | "off";

/** The anonymous daily user number choice, shared by the sidebar question and Settings > About. */
const [choice, setChoice] = createSignal<UsageCountChoice | null>(null);
let requested = false;

export function usageCountChoice(): UsageCountChoice | null {
  if (!requested) {
    requested = true;
    void (window.sahkarmi.usageCount?.get() ?? Promise.resolve(null))
      .then((value) => setChoice(value))
      .catch(() => undefined);
  }
  return choice();
}

export async function chooseUsageCount(enabled: boolean): Promise<void> {
  setChoice(await window.sahkarmi.usageCount.set(enabled));
}
