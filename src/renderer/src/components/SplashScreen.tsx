import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { LogoMark } from "./Logo";

const SPLASH_KEY = "sahkarmi:splash-shown";
/** Total time on screen (the app keeps loading underneath); it never loops. */
const SPLASH_MS = 1_700;
const FADE_MS = 320;

/**
 * One short 3D reveal of the Sahkarmi mark when the app opens: the two coworker shapes swing in,
 * settle, the wordmark rises, then the whole thing fades out. Shown once per launch (reloads
 * inside the same window skip it) and reduced to a plain fade when the OS asks for less motion.
 */
export function SplashScreen() {
  const [visible, setVisible] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  onMount(() => {
    let shown = false;
    try {
      shown = window.sessionStorage.getItem(SPLASH_KEY) === "1";
      window.sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // storage unavailable: show it anyway
    }
    if (shown) return;
    setVisible(true);
    const leave = window.setTimeout(() => setLeaving(true), SPLASH_MS - FADE_MS);
    const done = window.setTimeout(() => setVisible(false), SPLASH_MS);
    onCleanup(() => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
    });
  });
  return (
    <Show when={visible()}>
      <div class="splash" classList={{ "splash-leaving": leaving() }} aria-hidden="true">
        <div class="splash-stage">
          <div class="splash-glow" />
          <div class="splash-mark">
            <LogoMark size={148} class="splash-logo" />
          </div>
          <div class="splash-word">
            <span class="splash-name">Sahkarmi</span>
            <span class="splash-native">सहकर्मी</span>
          </div>
        </div>
      </div>
    </Show>
  );
}
