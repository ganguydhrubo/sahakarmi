import type { BrowserWindow } from "electron";
import { BrowserHost, type CoworkerBrowser } from "./browser-host";
import { ChromeBrowserHost, findInstalledBrowser } from "./chrome-browser-host";

/**
 * The coworker browser: the real Chrome (or Edge) installed on this computer when there is one,
 * because sites accept its sign-ins; otherwise the browser built into Sahkarmi.
 * SAHKARMI_BROWSER=builtin forces the built-in one.
 */
export function createCoworkerBrowser(
  window: BrowserWindow,
  downloadsRoot: string,
  statePath: string,
  profileDir: string,
): CoworkerBrowser {
  if (process.env.SAHKARMI_BROWSER !== "builtin") {
    const installed = findInstalledBrowser();
    if (installed) {
      return new ChromeBrowserHost(window, installed, profileDir, downloadsRoot, statePath);
    }
  }
  return new BrowserHost(window, downloadsRoot, statePath);
}
