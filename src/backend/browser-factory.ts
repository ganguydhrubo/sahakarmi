import type { BrowserWindow } from "electron";
import { BrowserHost, type CoworkerBrowser } from "./browser-host";
import { ChromeBrowserHost, findInstalledBrowser } from "./chrome-browser-host";

/**
 * The coworker browser: the one built into Sahkarmi, shown in the side panel.
 * SAHKARMI_BROWSER=chrome drives the Chrome (or Edge) installed on this computer instead.
 */
export function createCoworkerBrowser(
  window: BrowserWindow,
  downloadsRoot: string,
  statePath: string,
  profileDir: string,
): CoworkerBrowser {
  if (process.env.SAHKARMI_BROWSER === "chrome") {
    const installed = findInstalledBrowser();
    if (installed) {
      return new ChromeBrowserHost(window, installed, profileDir, downloadsRoot, statePath);
    }
  }
  return new BrowserHost(window, downloadsRoot, statePath);
}
