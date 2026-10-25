import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACP_AGENT_PROVIDERS,
  DEFAULT_MODEL_FOR_PROVIDER,
  isAgentModel,
  modelWireId,
  PROVIDER_LABELS,
  providerForModel,
} from "../shared/ipc";
import { PROVIDER_CATALOG } from "../shared/provider-catalog";
import {
  ACP_AGENT_SPECS,
  acpAgentModelValue,
  createAcpAgentClient,
  findAcpAgentExecutable,
  signInCommandFor,
} from "./acp-agents";
import type { AccountReadResult } from "./protocol";

const roots: string[] = [];
afterEach(async () => {
  process.env.SAHKARMI_KIMI_PATH = "<not-installed-in-tests>";
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sahkarmi-acp-agents-"));
  roots.push(root);
  return root;
}

/** A tiny ACP agent: signed in (opens sessions) or not (answers "Authentication required"). */
async function fakeAgent(root: string, signedIn: boolean): Promise<string> {
  const script = join(root, "agent.js");
  await writeFile(
    script,
    `const write = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const { id, method } = JSON.parse(line);
    if (method === "initialize") write({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
    else if (method === "session/new" && ${signedIn})
      write({ id, result: { sessionId: "s1", models: { currentModelId: "k2", availableModels: [{ modelId: "k2", name: "K2" }] } } });
    else if (method === "session/new")
      write({ id, error: { code: -32000, message: "Authentication required: run kimi login first" } });
    else if (id !== undefined) write({ id, error: { code: -32601, message: "unknown" } });
  }
});
`,
  );
  if (process.platform !== "win32") return script;
  const cmd = join(root, "agent.cmd");
  await writeFile(cmd, `@node "%~dp0agent.js" %*\r\n`);
  return cmd;
}

describe("other ACP agents", () => {
  it("gives every agent a label, a catalog entry and a default model it accepts", () => {
    for (const provider of ACP_AGENT_PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
      expect(PROVIDER_CATALOG.some((entry) => entry.id === provider)).toBe(true);
      expect(ACP_AGENT_SPECS[provider].commands.length).toBeGreaterThan(0);
      const model = DEFAULT_MODEL_FOR_PROVIDER[provider];
      expect(isAgentModel(model)).toBe(true);
      expect(providerForModel(model)).toBe(provider);
      expect(modelWireId(model)).toBe("default");
    }
    expect(isAgentModel("kimi:kimi-k2.5")).toBe(true);
    expect(isAgentModel("unknown:model")).toBe(false);
  });

  it("keeps the agent's own model for the default and only picks models it reports", () => {
    const options = [{ value: "k2", name: "K2" }];
    expect(acpAgentModelValue("kimi:default", options)).toBeNull();
    expect(acpAgentModelValue("kimi:k2", options)).toBe("k2");
    expect(acpAgentModelValue("kimi:gone", options)).toBeNull();
  });

  it("signs Mistral Vibe in through its main program", () => {
    expect(signInCommandFor(ACP_AGENT_SPECS.vibe, "C:\\bin\\vibe-acp.exe")).toBe(
      "C:\\bin\\vibe.exe",
    );
    expect(signInCommandFor(ACP_AGENT_SPECS.kimi, "C:\\bin\\kimi.cmd")).toBe("C:\\bin\\kimi.cmd");
  });

  it("finds an agent through its path override, and treats a missing one as not installed", async () => {
    const root = await tempRoot();
    const program = join(root, "kimi.exe");
    await writeFile(program, "");
    process.env.SAHKARMI_KIMI_PATH = program;
    await expect(findAcpAgentExecutable(ACP_AGENT_SPECS.kimi)).resolves.toBe(program);
    process.env.SAHKARMI_KIMI_PATH = join(root, "missing.exe");
    await expect(findAcpAgentExecutable(ACP_AGENT_SPECS.kimi)).resolves.toBeNull();
  });

  it.each([
    [true, "kimi"],
    [false, null],
  ])("treats an agent that opens a session as signed in (%s)", async (signedIn, type) => {
    const root = await tempRoot();
    const client = createAcpAgentClient(
      "kimi",
      { executable: await fakeAgent(root, signedIn), version: "1.0.0", bundled: false },
      root,
    );
    try {
      client.start();
      await client.request("initialize", {});
      const account = await client.request<AccountReadResult>("account/read", {});
      expect(account.account?.type ?? null).toBe(type);
    } finally {
      await client.stop();
    }
  });
});
