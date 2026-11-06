import { render } from "solid-js/web";
// Inter for every Latin letter; Mukta and Hind Siliguri only draw Hindi and Bengali.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/hind-siliguri/400.css";
import "@fontsource/hind-siliguri/500.css";
import "@fontsource/hind-siliguri/600.css";
import { App } from "./App";
import { loadLanguage } from "./i18n";
import { applyStoredPreferences, language } from "./preferences";
import "./styles.css";
import "./routines.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

applyStoredPreferences();
// Only English is in the first bundle; wait for the chosen language so the first paint is in it.
void loadLanguage(language()).finally(() => render(() => <App />, root));
