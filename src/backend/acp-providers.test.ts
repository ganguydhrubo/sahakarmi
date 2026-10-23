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
