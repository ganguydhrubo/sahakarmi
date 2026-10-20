import { render } from "solid-js/web";
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/baloo-2/500.css";
import "@fontsource/baloo-2/600.css";
import "@fontsource/baloo-2/700.css";
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
