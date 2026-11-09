import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_FOR_PROVIDER,
  isAgentModel,
  modelWireId,
  providerForModel,
} from "../shared/ipc";
import {
  antigravityModelValue,
  createAntigravityClient,
  openCodeFreeModels,
  openCodeModelValue,
  probeOpenCodeFreeLimit,
  readAntigravityAccount,
  setAntigravityEmailFetch,
} from "./acp-providers";

describe("Google account emails for Gemini", () => {
  const homes: string[] = [];
  afterEach(async () => {
    setAntigravityEmailFetch(null);
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  /** A signed-in home whose token was saved by some Antigravity version, and a stand-in Google. */
  async function signedIn(token: Record<string, unknown>) {
    const home = await mkdtemp(join(tmpdir(), "sahkarmi-email-"));
    homes.push(home);
    const acp = join(home, ".gemini", "antigravity-acp");
    await mkdir(acp, { recursive: true });
    await writeFile(join(acp, "acp_token.json"), JSON.stringify(token));
    const called: string[] = [];
    setAntigravityEmailFetch(async (url) => {
      called.push(url);
      return url.endsWith("/token")
        ? Response.json({ access_token: "fresh" })
        : Response.json({ email: "owner@example.com" });
    });
    return { home, acp, called };
  }

  const base = { refresh_token: "r", client_id: "c", client_secret: "s" };

  it.each([
    ["no token address", base],
    [
      "Google's older token address",
      { ...base, token_uri: "https://accounts.google.com/o/oauth2/token" },
    ],
    ["the usual token address", { ...base, token_uri: "https://oauth2.googleapis.com/token" }],
  ])("shows the email when the sign-in saved %s", async (_label, token) => {
    const { home, acp, called } = await signedIn(token);
    const read = await readAntigravityAccount(home, {});
    expect(read.account?.email).toBe("owner@example.com");
    // Only Google's own token service and its user-info address are asked.
    expect(called).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/oauth2/v2/userinfo",
    ]);
    // Noted, so the next read needs no network.
    expect(JSON.parse(await readFile(join(acp, "sahkarmi-account.json"), "utf8")).email).toBe(
      "owner@example.com",
    );
  });

  it("never sends the token to an address that is not Google's", async () => {
    const { home, called } = await signedIn({ ...base, token_uri: "https://evil.example/token" });
    const read = await readAntigravityAccount(home, {});
    expect(read.account?.email).toBeNull();
    expect(called).toEqual([]);
  });
});

describe("acp-providers", () => {
  it("maps antigravity models correctly", () => {
    expect(isAgentModel("antigravity-default")).toBe(true);
    expect(isAgentModel("antigravity:gemini-pro")).toBe(true);
    expect(providerForModel("antigravity-default")).toBe("antigravity");
    expect(providerForModel("antigravity:gemini-pro")).toBe("antigravity");
    expect(modelWireId("antigravity:gemini-pro")).toBe("gemini-pro");
    expect(DEFAULT_MODEL_FOR_PROVIDER.antigravity).toBe("antigravity-default");

    const options = [
      { value: "default", name: "Default" },
      { value: "gemini-pro", name: "Gemini Pro" },
    ];
    expect(antigravityModelValue("antigravity-default", options)).toBe("default");
    expect(antigravityModelValue("antigravity:gemini-pro", options)).toBe("gemini-pro");
  });

  it("configures Antigravity client with sibling harness path", () => {
    const cli = {
      executable:
        process.platform === "win32" ? "C:\\tools\\agy_acp_server.exe" : "/tools/agy_acp_server",
      version: "1.0.0",
      bundled: false,
    };
    const client = createAntigravityClient(cli, "/tmp/transcripts");
    expect(client).toBeDefined();
  });

  it("reads account details from environment or config", async () => {
    const env = { ANTIGRAVITY_API_KEY: "test-api-key" };
    const result = await readAntigravityAccount("/tmp/nonexistent-home", env as NodeJS.ProcessEnv);
    expect(result.account?.type).toBe("antigravity");
  });
});

describe("OpenCode free model rotation", () => {
  const options = [
    { value: "anthropic/claude", name: "Claude" },
    { value: "opencode/big-pickle", name: "Big Pickle" },
    { value: "opencode/glm-5.3-flash-free", name: "GLM" },
    { value: "opencode/nemotron-3.5-lightning-free", name: "Nemotron" },
  ];
  it("lists OpenCode's default first, then every other free model", () => {
    expect(openCodeFreeModels(options)).toEqual([
      "opencode/big-pickle",
      "opencode/glm-5.3-flash-free",
      "opencode/nemotron-3.5-lightning-free",
    ]);
  });
  it("skips free models whose usage limit was hit and never leaves the free tier", () => {
    expect(openCodeModelValue("opencode-free", options)).toBe("opencode/big-pickle");
    expect(openCodeModelValue("opencode-free", options, new Set(["opencode/big-pickle"]))).toBe(
      "opencode/glm-5.3-flash-free",
    );
    expect(
      openCodeModelValue(
        "opencode-free",
        options,
        new Set([
          "opencode/big-pickle",
          "opencode/glm-5.3-flash-free",
          "opencode/nemotron-3.5-lightning-free",
        ]),
      ),
    ).toBe("opencode/big-pickle");
    expect(openCodeModelValue("opencode-default", options)).toBeNull();
  });
});

describe("OpenCode free limit check", () => {
  const reply = (status: number, body: string) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  it("reports a used-up free allowance", async () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "FreeUsageLimitError", message: "Free usage limit reached." },
    });
    await expect(probeOpenCodeFreeLimit("opencode/big-pickle", reply(429, body))).resolves.toBe(
      true,
    );
  });

  it("does not blame the limit for other errors or a working server", async () => {
    await expect(probeOpenCodeFreeLimit("opencode/big-pickle", reply(200, "{}"))).resolves.toBe(
      false,
    );
    await expect(
      probeOpenCodeFreeLimit("opencode/big-pickle", reply(429, "slow down")),
    ).resolves.toBe(false);
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(probeOpenCodeFreeLimit("opencode/big-pickle", offline)).resolves.toBe(false);
  });

  it("sends the model name without OpenCode's prefix", async () => {
    let sent = "";
    const capture = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeOpenCodeFreeLimit("opencode/glm-5.3-flash-free", capture);
    expect(JSON.parse(sent).model).toBe("glm-5.3-flash-free");
  });
});
