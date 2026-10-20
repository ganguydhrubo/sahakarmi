/// <reference types="vite/client" />

import type { SahkarmiDesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    sahkarmi: SahkarmiDesktopApi;
  }
}
