import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDesktopApi, HostStatus } from "../../../shared/ipc";
import { countdown, groupCode, HostSettings } from "./HostSettings";

function status(patch: Partial<HostStatus> = {}): HostStatus {
  return {
    enabled: true,
    running: true,
    port: 47821,
    startWithWindows: false,
    canStartWithWindows: true,
    address: null,
    addressFromTailscale: false,
    tailscale: { installed: false, connected: false, dnsName: null, serving: false },
    devices: [],
    pairing: null,
    activity: [],
    installQrSvg: "<svg data-install></svg>",
    error: null,
    ...patch,
  };
}

function mockHost(initial: HostStatus): HostDesktopApi {
  const api: HostDesktopApi = {
    status: vi.fn(async () => initial),
    setEnabled: vi.fn(async (enabled) => status({ enabled, running: enabled })),
    setStartWithWindows: vi.fn(async (enabled) => ({ ...initial, startWithWindows: enabled })),
    setAddress: vi.fn(async () => initial),
    setupTailscale: vi.fn(async () => initial),
    startPairing: vi.fn(async () => initial),
    cancelPairing: vi.fn(async () => initial),
    removeDevice: vi.fn(async () => initial),
  };
  Object.assign(window, { sahkarmi: { host: api, openExternal: vi.fn(async () => undefined) } });
  return api;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "sahkarmi");
});

describe("Phone & Host settings", () => {
  it("starts switched off with one clear switch", async () => {
    const api = mockHost(status({ enabled: false, running: false }));
    render(() => <HostSettings />);
    const toggle = await screen.findByRole("switch", { name: "Sahkarmi Host" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Three steps, once")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(true));
    // Not set up yet, so it does not claim the phone can connect.
    expect(await screen.findByText("On: finish the steps below")).toBeInTheDocument();
  });

  it("guides to the first missing step: get Tailscale", async () => {
    mockHost(status());
    render(() => <HostSettings />);
    expect(await screen.findByRole("button", { name: "Get Tailscale (free)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pair a phone" })).not.toBeInTheDocument();
  });

  it("offers one-click sharing once Tailscale is connected", async () => {
    const api = mockHost(
      status({
        tailscale: { installed: true, connected: true, dnsName: "pc.tail1.ts.net", serving: false },
      }),
    );
    render(() => <HostSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Set it up for me" }));
    await waitFor(() => expect(api.setupTailscale).toHaveBeenCalled());
  });

  it("shows the QR, the code in two groups and a countdown while pairing", async () => {
    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    mockHost(
      status({
        address: "https://pc.tail1.ts.net",
        addressFromTailscale: true,
        tailscale: { installed: true, connected: true, dnsName: "pc.tail1.ts.net", serving: true },
        pairing: {
          code: "ABCD2345",
          url: "https://pc.tail1.ts.net/#pair=ABCD2345",
          qrSvg: "<svg data-qr></svg>",
          expiresAt,
        },
      }),
    );
    const { container } = render(() => <HostSettings />);
    expect(await screen.findByText("ABCD 2345")).toBeInTheDocument();
    expect(container.querySelector(".host-qr svg")).not.toBeNull();
    expect(screen.getByText(/Expires in 1:[23]\d/)).toBeInTheDocument();
  });

  it("formats codes and time left", () => {
    expect(groupCode("ABCD2345")).toBe("ABCD 2345");
    expect(countdown(119_100)).toBe("2:00");
    expect(countdown(61_000)).toBe("1:01");
    expect(countdown(-5)).toBe("0:00");
  });
});
