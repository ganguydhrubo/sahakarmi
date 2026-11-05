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
import { applyStoredPreferences } from "./preferences";
import "./styles.css";
import "./routines.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

applyStoredPreferences();
render(() => <App />, root);
