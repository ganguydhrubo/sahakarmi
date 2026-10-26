import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramStatus } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { TelegramSettings } from "./TelegramSettings";

const OFF: TelegramStatus = {
  configured: false,
  botUsername: null,
  paired: false,
  chatName: null,
  pairingCode: null,
  coworkerId: null,
  running: false,
  error: null,
};
const WAITING: TelegramStatus = {
  ...OFF,
  configured: true,
  botUsername: "sahkarmi_test_bot",
  pairingCode: "482913",
  coworkerId: "bot-a",
  running: true,
};

const BOTS = [
  { id: "bot-a", name: "Asha" },
  { id: "bot-b", name: "1xl reporting" },
] as BotProfile[];

function mockTelegram(first: TelegramStatus) {
  const telegram = {
    status: vi.fn(async () => first),
    setToken: vi.fn(async (token: string) => (token ? WAITING : OFF)),
    setCoworker: vi.fn(async (botId: string) => ({ ...first, coworkerId: botId })),
    unpair: vi.fn(async () => WAITING),
  };
  Object.defineProperty(window, "sahkarmi", {
    value: { telegram, openUrl: vi.fn(async () => undefined) },
    configurable: true,
    writable: true,
  });
  return telegram;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TelegramSettings", () => {
  it("connects a bot token and shows the pairing code to send", async () => {
    const telegram = mockTelegram(OFF);
    render(() => <TelegramSettings bots={BOTS} />);
    const field = await screen.findByLabelText("Bot token");
    fireEvent.input(field, { target: { value: "123:abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("/start 482913")).toBeTruthy();
    expect(telegram.setToken).toHaveBeenCalledWith("123:abc");
    expect(screen.getByText("https://t.me/sahkarmi_test_bot")).toBeTruthy();
    // The token is cleared from the screen once saved.
    expect(screen.queryByLabelText("Bot token")).toBeNull();
  });

  it("changes the coworker and unpairs a paired chat", async () => {
    const telegram = mockTelegram({
      ...WAITING,
      paired: true,
      pairingCode: null,
      chatName: "Dhrubo",
    });
    render(() => <TelegramSettings bots={BOTS} />);
    expect(await screen.findByText(/Paired with Dhrubo/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Coworker"), { target: { value: "bot-b" } });
    expect(telegram.setCoworker).toHaveBeenCalledWith("bot-b");
    const unpair = screen.getByRole("button", { name: "Unpair chat" }) as HTMLButtonElement;
    await waitFor(() => expect(unpair.disabled).toBe(false));
    fireEvent.click(unpair);
    expect(telegram.unpair).toHaveBeenCalled();
  });
});
