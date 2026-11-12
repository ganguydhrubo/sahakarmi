// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, BotSummary, ConversationSnapshot } from "../shared/ipc";
import { PHONE_FILES } from "./host-phone-page";
import {
  cleanAddress,
  type HostAgentPort,
  HostServer,
  PAIRING_MS,
  pairingCode,
  phoneMessage,
} from "./host-server";
import {
  enableLink,
  parseTailscaleStatus,
  servesPort,
  sharesSomethingElse,
  shareWithTailscale,
  tailscaleStatus,
  unshareTailscale,
} from "./tailscale";

const bot = {
  id: "asha",
  name: "Asha",
  role: "Accounts",
  preview: '[Routine "x" · step 1/2] Done',
} as BotSummary;

function approval(status: ApprovalRequest["status"] = "pending"): ApprovalRequest {
  return {
    id: "ap-1",
    botId: "asha",
    title: "Send the invoice to Ravi",
    details: "Email invoice #42",
    category: "other",
    amount: null,
    status,
    createdAt: "2026-11-12T10:00:00.000Z",
    decidedAt: null,
    note: null,
  };
}

let dir: string;
let now: number;
let host: HostServer;
let agent: {
  listBots: ReturnType<typeof vi.fn>;
  readConversation: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  listApprovals: ReturnType<typeof vi.fn>;
  decideApproval: ReturnType<typeof vi.fn>;
  routines: ReturnType<typeof vi.fn>;
  runRoutine: ReturnType<typeof vi.fn>;
};

function make(): HostServer {
  return new HostServer({
    userDataPath: dir,
    agent: agent as unknown as HostAgentPort,
    makeQr: async (text) => `<svg data-text="${text}"/>`,
    tailscale: {
      status: async () => ({
        installed: true,
        connected: true,
        dnsName: "pc.tail1.ts.net",
        serving: true,
      }),
      share: async () => ({ ok: true, enableUrl: null, message: "" }),
    },
    setStartWithWindows: vi.fn(),
    now: () => now,
    basePort: 0,
  });
}

function base(): string {
  return `http://127.0.0.1:${host.port}`;
}

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base()}${path}`, init);
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, unknown>,
  };
}

function post(path: string, body: unknown, key?: string) {
  return call(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function pairPhone(): Promise<string> {
  const status = await host.startPairing();
  const result = await post("/api/pair", { code: status.pairing?.code, name: "Dhrubo's phone" });
  expect(result.status).toBe(200);
  return result.body.key as string;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sahkarmi-host-"));
  now = Date.parse("2026-11-12T10:00:00.000Z");
  agent = {
    listBots: vi.fn(() => [bot]),
    readConversation: vi.fn(
      async (): Promise<ConversationSnapshot> => ({
        botId: "asha",
        threadId: "t",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "1",
            author: "user",
            text: "Hello",
            createdAt: "2026-11-12T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "2",
            author: "assistant",
            text: "Hi!",
            createdAt: "2026-11-12T10:00:01.000Z",
            status: "completed",
          },
          {
            id: "3",
            author: "assistant",
            text: "ran a command",
            createdAt: "2026-11-12T10:00:02.000Z",
            status: "completed",
            tool: { name: "shell" } as never,
          },
        ],
      }),
    ),
    sendMessage: vi.fn(async () => ({})),
    listApprovals: vi.fn(() => [approval()]),
    decideApproval: vi.fn(async () => approval("approved")),
    routines: vi.fn(async () => ({
      routines: [
        {
          id: "r1",
          name: "Month-end",
          steps: [{}, {}],
          cadence: null,
          enabled: true,
          createdAt: "",
          lastRunAt: null,
          nextRunAt: null,
        },
      ],
      runs: [],
    })),
    runRoutine: vi.fn(async () => ({})),
  };
  host = make();
  await host.load();
  await host.setEnabled(true);
});

afterEach(async () => {
  await host.close();
  await host.flush();
  await rm(dir, { recursive: true, force: true });
});

describe("Sahkarmi Host", () => {
  it("listens on this PC only and serves the phone page with strict headers", async () => {
    expect(host.port).toBeGreaterThan(0);
    const response = await fetch(`${base()}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).toContain("Use Sahkarmi from your phone");
  });

  it("pairs a phone with a one-time code carried in the link fragment", async () => {
    const status = await host.startPairing();
    expect(status.pairing?.url).toBe(`https://pc.tail1.ts.net/#pair=${status.pairing?.code}`);
    expect(status.pairing?.qrSvg).toContain(status.pairing?.code);
    const key = await pairPhone();
    expect(key.length).toBeGreaterThan(30);
    const after = await host.status();
    expect(after.devices).toHaveLength(1);
    expect(after.devices[0]?.name).toBe("Dhrubo's phone");
    expect(after.activity[0]?.action).toBe("paired");
    // Only a hash of the key is kept on disk.
    await host.flush();
    const saved = await readFile(join(dir, "host.json"), "utf8");
    expect(saved).not.toContain(key);
  });

  it("replaces a phone's old entry when it pairs again", async () => {
    const key = await pairPhone();
    const again = await host.startPairing();
    const result = await post("/api/pair", {
      code: again.pairing?.code,
      name: "Phone",
      previousKey: key,
    });
    expect(result.status).toBe(200);
    expect((await host.status()).devices).toHaveLength(1);
    expect(
      (await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(401);
  });

  it("uses each code once and lets it expire after two minutes", async () => {
    const first = await host.startPairing();
    const code = first.pairing?.code;
    expect((await post("/api/pair", { code })).status).toBe(200);
    expect((await post("/api/pair", { code })).status).toBe(410);
    const second = await host.startPairing();
    now += PAIRING_MS;
    expect((await post("/api/pair", { code: second.pairing?.code })).status).toBe(410);
  });

  it("ends a code after too many wrong guesses", async () => {
    const status = await host.startPairing();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await post("/api/pair", { code: "WRONG234" })).status).toBe(401);
    }
    expect((await post("/api/pair", { code: status.pairing?.code })).status).toBe(410);
  });

  it("answers only to its own names, never to a rebound site name", async () => {
    const { request } = await import("node:http");
    const statusFor = (name: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port: host.port ?? 0, path: "/", headers: { Host: name } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
    expect(await statusFor(`127.0.0.1:${host.port}`)).toBe(200);
    expect(await statusFor("evil.example")).toBe(421);
    expect(await statusFor("pc.tail1.ts.net")).toBe(200);
  });

  it("refuses requests without a paired key, from other sites, or not sent as JSON", async () => {
    expect((await call("/api/overview")).status).toBe(401);
    expect(
      (await call("/api/overview", { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401);
    const key = await pairPhone();
    const evil = await call("/api/overview", {
      headers: { Authorization: `Bearer ${key}`, Origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    const form = await call("/api/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/plain" },
      body: JSON.stringify({ botId: "asha", text: "hi" }),
    });
    expect(form.status).toBe(415);
    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it("shows coworkers, open requests and routines in plain words", async () => {
    const key = await pairPhone();
    const { body } = await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } });
    expect(body.coworkers).toEqual([
      expect.objectContaining({ id: "asha", name: "Asha", preview: "Done" }),
    ]);
    expect(body.approvals).toEqual([expect.objectContaining({ id: "ap-1", coworker: "Asha" })]);
    expect(body.routines).toEqual([expect.objectContaining({ id: "r1", steps: 2 })]);
    const chat = await call("/api/chat?bot=asha", { headers: { Authorization: `Bearer ${key}` } });
    expect(
      (chat.body.messages as Array<{ text: string; mine: boolean }>).map((m) => m.text),
    ).toEqual(["Hello", "Hi!"]);
  });

  it("decides through the desktop call, marked as from this phone, and logs it", async () => {
    const key = await pairPhone();
    const result = await post(
      "/api/approval",
      { approvalId: "ap-1", decision: "approved", note: "Only to Ravi" },
      key,
    );
    expect(result.status).toBe(200);
    const deviceId = (await host.status()).devices[0]?.id;
    expect(agent.decideApproval).toHaveBeenCalledWith({
      approvalId: "ap-1",
      decision: "approved",
      decidedBy: `phone:${deviceId}`,
      note: "Only to Ravi",
    });
    expect((await host.status()).activity[0]).toMatchObject({ action: "approved" });
    agent.listApprovals.mockReturnValue([approval("approved")]);
    expect(
      (await post("/api/approval", { approvalId: "ap-1", decision: "rejected" }, key)).status,
    ).toBe(409);
  });

  it("sends messages as remote and runs routines", async () => {
    const key = await pairPhone();
    expect(
      (await post("/api/chat", { botId: "asha", text: "Send the GST file" }, key)).status,
    ).toBe(200);
    expect(agent.sendMessage).toHaveBeenCalledWith({
      botId: "asha",
      text: "Send the GST file",
      remote: true,
    });
    expect((await post("/api/chat", { botId: "nobody", text: "x" }, key)).status).toBe(404);
    expect((await post("/api/routine", { routineId: "r1" }, key)).status).toBe(200);
    expect(agent.runRoutine).toHaveBeenCalledWith("r1");
  });

  it("stops a removed phone at once and remembers phones across a restart", async () => {
    const key = await pairPhone();
    const deviceId = (await host.status()).devices[0]?.id ?? "";
    await host.close();
    await host.flush();
    host = make();
    await host.load();
    expect(host.port).toBeGreaterThan(0);
    expect(
      (await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(200);
    await host.removeDevice(deviceId);
    expect(
      (await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(401);
  });

  it("never locks a paired phone out because of other people's wrong keys", async () => {
    const key = await pairPhone();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await call("/api/overview", { headers: { Authorization: "Bearer wrong" } });
    }
    expect(
      (await call("/api/overview", { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(429);
    expect(
      (await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(200);
  });

  it("shows the exact command and where a request came from, flagging outside content", async () => {
    agent.listApprovals.mockReturnValue([
      {
        ...approval(),
        technical: "git push origin main",
        provenance: { kind: "web", label: "example.com" },
      },
    ]);
    const key = await pairPhone();
    const { body } = await call("/api/overview", { headers: { Authorization: `Bearer ${key}` } });
    expect(body.approvals).toEqual([
      expect.objectContaining({
        technical: "git push origin main",
        source: "A web page it read (example.com)",
        outside: true,
      }),
    ]);
  });

  it("says already decided when the PC decides a moment before the phone", async () => {
    agent.listApprovals.mockReturnValueOnce([approval()]).mockReturnValue([]);
    agent.decideApproval.mockRejectedValueOnce(new Error("Approval is no longer pending."));
    const key = await pairPhone();
    const result = await post("/api/approval", { approvalId: "ap-1", decision: "approved" }, key);
    expect(result.status).toBe(409);
  });

  it("answers a too-large message with a clear error", async () => {
    const key = await pairPhone();
    const result = await post("/api/chat", { botId: "asha", text: "x".repeat(40_000) }, key);
    expect(result.status).toBe(413);
  });

  it("stays off when switched off while it was still starting", async () => {
    await host.setEnabled(false);
    const starting = host.setEnabled(true);
    await host.setEnabled(false);
    await starting;
    expect(host.port).toBeNull();
  });

  it("ignores a damaged saved address instead of failing every request", async () => {
    await host.close();
    await host.flush();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "host.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        port: null,
        address: "not a url %%",
        devices: [],
      }),
    );
    host = make();
    await host.load();
    expect((await host.status()).address).toBe("https://pc.tail1.ts.net");
    expect((await fetch(`${base()}/`)).status).toBe(200);
  });

  it("turns off completely", async () => {
    await host.setEnabled(false);
    expect(host.port).toBeNull();
    await expect(host.startPairing()).rejects.toThrow("Turn on Sahkarmi Host first.");
  });
});

describe("phone page", () => {
  it("never writes PC text into the page as HTML", () => {
    const script = PHONE_FILES["/app.js"]?.body ?? "";
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(PHONE_FILES["/index.html"]?.body).not.toMatch(/<script>(?!<\/script>)/);
  });
});

describe("helpers", () => {
  it("turns app notes and routine drafts into one plain line for the phone", () => {
    expect(
      phoneMessage('[Approval APPROVED] "Send the invoice" (approval id ab-1). Carry on.', true),
    ).toEqual({ text: "You approved: Send the invoice", note: true });
    expect(phoneMessage('[Routine "Month-end" · step 2/4] Check the bank file.', true)).toEqual({
      text: 'Routine "Month-end", step 2 of 4',
      note: true,
    });
    expect(
      phoneMessage(
        [
          "```json",
          '{"name":"Payment chaser","steps":[{"type":"task"},{"type":"output"}]}',
          "```",
        ].join("\n"),
        false,
      ),
    ).toEqual({ text: 'Drafted the routine "Payment chaser" with 2 steps.', note: true });
    expect(phoneMessage("Here are the totals.", false)).toEqual({
      text: "Here are the totals.",
      note: false,
    });
  });

  it("makes readable 8-letter codes", () => {
    const code = pairingCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("accepts only plain https addresses", () => {
    expect(cleanAddress("my-pc.tail1.ts.net")).toBe("https://my-pc.tail1.ts.net");
    expect(cleanAddress("https://x.trycloudflare.com/path")).toBe("https://x.trycloudflare.com");
    expect(cleanAddress("")).toBeNull();
    expect(() => cleanAddress("http://insecure.example")).toThrow("https://");
  });

  it("reads Tailscale status", async () => {
    expect(
      parseTailscaleStatus(
        JSON.stringify({ BackendState: "Running", Self: { DNSName: "PC.tail1.ts.net." } }),
      ),
    ).toEqual({ connected: true, dnsName: "pc.tail1.ts.net" });
    expect(parseTailscaleStatus("nope")).toEqual({ connected: false, dnsName: null });
    expect(servesPort('{"Proxy":"http://127.0.0.1:47821"}', 47821)).toBe(true);
    expect(servesPort('{"Proxy":"http://127.0.0.1:478210"}', 47821)).toBe(false);
    expect(
      enableLink("To enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\n"),
    ).toBe("https://login.tailscale.com/f/serve?node=abc");
    const ours = JSON.stringify({
      Web: { "pc.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:47821" } } } },
    });
    const theirs = JSON.stringify({
      Web: { "pc.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
    });
    expect(sharesSomethingElse(ours, 47821)).toBe(false);
    expect(sharesSomethingElse(theirs, 47821)).toBe(true);
    const calls: string[][] = [];
    const runner = (status: string) => async (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[1] === "status" ? status : "", stderr: "" };
    };
    expect((await shareWithTailscale(47821, runner(theirs))).ok).toBe(false);
    expect(calls.some((args) => args.includes("--bg"))).toBe(false);
    calls.length = 0;
    await unshareTailscale(47821, runner(theirs));
    expect(calls.some((args) => args.includes("off"))).toBe(false);
    await unshareTailscale(47821, runner(ours));
    expect(calls.some((args) => args.includes("off"))).toBe(true);
    const missing = await tailscaleStatus(1, async () => ({
      ok: false,
      stdout: "",
      stderr: "not found",
    }));
    expect(missing).toEqual({ installed: false, connected: false, dnsName: null, serving: false });
  });
});
