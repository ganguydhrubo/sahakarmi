import { describe, expect, it } from "vitest";
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
  readAntigravityAccount,
} from "./acp-providers";

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
