// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACP_AGENT_SPECS } from "./acp-agents";
import { ComposioClient } from "./integrations/composio-client";
import { McpServerStore } from "./mcp-servers";
import {
  envForProvider,
  hideInheritedKeys,
  PROVIDER_SECRET_ENV,
  SEALED_PREFIX,
  SECRET_ENV_NAMES,
  type SecretCipher,
  SecretCodec,
  SecretStore,
} from "./secret-store";

/** Stands in for DPAPI: reversible, and plainly not the original text. */
function fakeCipher(options: { available?: boolean; garble?: boolean } = {}): SecretCipher {
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: (text) => Buffer.from(`x${[...text].reverse().join("")}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (options.garble) return "garbled";
      if (!text.startsWith("x")) throw new Error("not ours");
      return [...text.slice(1)].reverse().join("");
    },
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-secrets-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function legacy() {
  return {
    ANTHROPIC_API_KEY: join(root, "home", ".claude", "anthropic_api_key.txt"),
    OPENAI_API_KEY: join(root, "home", ".codex", "openai_api_key.txt"),
    GEMINI_API_KEY: join(root, "home", ".gemini", "antigravity-acp", "api_key.txt"),
    COMPOSIO_API_KEY: join(root, "userData", "composio_api_key.txt"),
  };
}

async function writeLegacy(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

describe("SecretCodec", () => {
  it("seals and opens values, and reads older plain values as they are", () => {
    const codec = new SecretCodec(fakeCipher());
    const sealed = codec.seal("sk-ant-123");
    expect(sealed.startsWith(SEALED_PREFIX)).toBe(true);
    expect(sealed).not.toContain("sk-ant-123");
    expect(codec.open(sealed)).toBe("sk-ant-123");
    expect(codec.open("plain-old-value")).toBe("plain-old-value");
    expect(codec.seal(sealed)).toBe(sealed);
  });

  it("keeps values plain when encryption is unavailable, and cannot open foreign ones", () => {
    const off = new SecretCodec(fakeCipher({ available: false }));
    expect(off.available).toBe(false);
    expect(off.seal("sk-1")).toBe("sk-1");
    expect(off.open(`${SEALED_PREFIX}abc`)).toBeNull();
    expect(new SecretCodec(null).available).toBe(false);
    const broken = new SecretCodec({
      ...fakeCipher(),
      isEncryptionAvailable: () => {
        throw new Error("not ready");
      },
    });
    expect(broken.available).toBe(false);
  });
});

describe("SecretStore", () => {
  it("moves 0.23.0 plain key files into encrypted storage and removes them after reading back", async () => {
    const files = legacy();
    await writeLegacy(files.ANTHROPIC_API_KEY, "sk-ant-old\n");
    await writeLegacy(files.OPENAI_API_KEY, "sk-openai-old");
    await writeLegacy(files.GEMINI_API_KEY, "AIza-old");
    await writeLegacy(files.COMPOSIO_API_KEY, "ak_old\n");
    const filePath = join(root, "userData", "secrets.enc.json");
    const store = new SecretStore({
      filePath,
      codec: new SecretCodec(fakeCipher()),
      legacyFiles: files,
    });
    await store.load();
    const result = await store.migrate();
    expect(result.migrated.sort()).toEqual(Object.keys(files).sort());
    expect(result.kept).toEqual([]);
    for (const path of Object.values(files)) expect(existsSync(path)).toBe(false);
    const onDisk = await readFile(filePath, "utf8");
    for (const secret of ["sk-ant-old", "sk-openai-old", "AIza-old", "ak_old"]) {
      expect(onDisk).not.toContain(secret);
    }
    const reopened = new SecretStore({ filePath, codec: new SecretCodec(fakeCipher()) });
    await reopened.load();
    expect(await reopened.get("ANTHROPIC_API_KEY")).toBe("sk-ant-old");
    expect(await reopened.get("COMPOSIO_API_KEY")).toBe("ak_old");
    expect(new Map(await reopened.entries()).get("OPENAI_API_KEY")).toBe("sk-openai-old");
    // Running again is harmless.
    expect(await store.migrate()).toEqual({ migrated: [], kept: [] });
  });

  it("keeps the plain file when the encrypted copy does not read back", async () => {
    const files = legacy();
    await writeLegacy(files.OPENAI_API_KEY, "sk-openai-old");
    const store = new SecretStore({
      filePath: join(root, "secrets.enc.json"),
      codec: new SecretCodec(fakeCipher({ garble: true })),
      legacyFiles: files,
    });
    await store.load();
    const result = await store.migrate();
    expect(result.kept).toEqual(["OPENAI_API_KEY"]);
    expect(await readFile(files.OPENAI_API_KEY, "utf8")).toBe("sk-openai-old");
  });

  it("falls back to the old plain files when encryption is unavailable", async () => {
    const files = legacy();
    await writeLegacy(files.ANTHROPIC_API_KEY, "sk-ant-old");
    const store = new SecretStore({
      filePath: join(root, "secrets.enc.json"),
      codec: new SecretCodec(fakeCipher({ available: false })),
      legacyFiles: files,
    });
    await store.load();
    expect(await store.migrate()).toEqual({ migrated: [], kept: ["ANTHROPIC_API_KEY"] });
    expect(await store.get("ANTHROPIC_API_KEY")).toBe("sk-ant-old");
    await store.set("OPENAI_API_KEY", "sk-new");
    expect(await readFile(files.OPENAI_API_KEY, "utf8")).toBe("sk-new");
    await store.set("CURSOR_API_KEY", "cur-1");
    expect(await store.get("CURSOR_API_KEY")).toBe("cur-1");
  });

  it("saves new keys encrypted, removes an old file for the same key, and forgets on empty", async () => {
    const files = legacy();
    await writeLegacy(files.ANTHROPIC_API_KEY, "sk-ant-old");
    const filePath = join(root, "secrets.enc.json");
    const store = new SecretStore({
      filePath,
      codec: new SecretCodec(fakeCipher()),
      legacyFiles: files,
    });
    await store.load();
    await store.set("ANTHROPIC_API_KEY", "sk-ant-new");
    expect(existsSync(files.ANTHROPIC_API_KEY)).toBe(false);
    expect(await readFile(filePath, "utf8")).not.toContain("sk-ant-new");
    expect(await store.get("ANTHROPIC_API_KEY")).toBe("sk-ant-new");
    await store.set("ANTHROPIC_API_KEY", "");
    expect(await store.get("ANTHROPIC_API_KEY")).toBeNull();
  });

  it("seals values that were written while encryption was unavailable", async () => {
    const filePath = join(root, "secrets.enc.json");
    const off = new SecretStore({
      filePath,
      codec: new SecretCodec(fakeCipher({ available: false })),
    });
    await off.load();
    await off.set("CURSOR_API_KEY", "cur-plain");
    expect(await readFile(filePath, "utf8")).toContain("cur-plain");
    const on = new SecretStore({ filePath, codec: new SecretCodec(fakeCipher()) });
    await on.load();
    await on.migrate();
    expect(await readFile(filePath, "utf8")).not.toContain("cur-plain");
    expect(await on.get("CURSOR_API_KEY")).toBe("cur-plain");
  });
});

describe("keys per AI tool", () => {
  const env = {
    PATH: "C:\\Windows",
    ANTHROPIC_API_KEY: "a",
    OPENAI_API_KEY: "o",
    GEMINI_API_KEY: "g",
    GOOGLE_API_KEY: "g",
    COMPOSIO_API_KEY: "c",
    TELEGRAM_BOT_TOKEN: "t",
    CURSOR_API_KEY: "cur",
    GITHUB_TOKEN: "owner-own",
  };

  it("gives each provider only its own key", () => {
    const claude = envForProvider("claude", env);
    expect(claude).toMatchObject({ PATH: "C:\\Windows", ANTHROPIC_API_KEY: "a" });
    for (const name of ["OPENAI_API_KEY", "GEMINI_API_KEY", "COMPOSIO_API_KEY", "CURSOR_API_KEY"]) {
      expect(claude[name]).toBeUndefined();
    }
    expect(claude.TELEGRAM_BOT_TOKEN).toBeUndefined();
    // Variables Sahkarmi does not manage are left alone.
    expect(claude.GITHUB_TOKEN).toBe("owner-own");
    expect(envForProvider("codex", env)).toMatchObject({ OPENAI_API_KEY: "o" });
    expect(envForProvider("codex", env).ANTHROPIC_API_KEY).toBeUndefined();
    expect(envForProvider("antigravity", env)).toMatchObject({ GEMINI_API_KEY: "g" });
    expect(envForProvider("cursor", env)).toMatchObject({ CURSOR_API_KEY: "cur" });
    expect(envForProvider("cursor", env).OPENAI_API_KEY).toBeUndefined();
    const opencode = envForProvider("opencode", env);
    for (const name of SECRET_ENV_NAMES) expect(opencode[name]).toBeUndefined();
    // Windows names are case-blind.
    expect(envForProvider("codex", { anthropic_api_key: "a" }).anthropic_api_key).toBeUndefined();
  });

  it("knows the key of every agent Sahkarmi can set one for", () => {
    for (const [id, spec] of Object.entries(ACP_AGENT_SPECS)) {
      for (const name of spec.apiKeyEnv ?? []) {
        expect(SECRET_ENV_NAMES as readonly string[]).toContain(name);
        expect(PROVIDER_SECRET_ENV[id]).toContain(name);
      }
    }
  });

  it("hides the tool's own key from an MCP server unless the owner set it", () => {
    expect(hideInheritedKeys({ X: "1" }, "claude")).toMatchObject({
      X: "1",
      ANTHROPIC_API_KEY: "",
    });
    expect(hideInheritedKeys({ ANTHROPIC_API_KEY: "mine" }, "claude").ANTHROPIC_API_KEY).toBe(
      "mine",
    );
  });
});

describe("stores that keep keys next to settings", () => {
  it("encrypts MCP env and header values on disk and migrates plain ones", async () => {
    const plain = {
      version: 1,
      servers: [
        {
          id: "1",
          name: "notes",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: [],
          env: { NOTES_TOKEN: "tok-123" },
          url: "",
          headers: {},
          source: "added by hand",
          addedAt: "2026-11-01T00:00:00Z",
        },
      ],
    };
    await writeFile(join(root, "mcp-servers.json"), JSON.stringify(plain));
    const codec = new SecretCodec(fakeCipher());
    const store = new McpServerStore(root, undefined, codec);
    await store.load();
    expect(store.enabled()[0]?.env.NOTES_TOKEN).toBe("tok-123");
    const onDisk = await readFile(join(root, "mcp-servers.json"), "utf8");
    expect(onDisk).not.toContain("tok-123");
    expect(onDisk).toContain(SEALED_PREFIX);
    const again = new McpServerStore(root, undefined, codec);
    await again.load();
    expect(again.enabled()[0]?.env.NOTES_TOKEN).toBe("tok-123");
    // Without DPAPI the file is read and written as before.
    const legacyStore = new McpServerStore(root, undefined, null);
    await writeFile(join(root, "mcp-servers.json"), JSON.stringify(plain));
    await legacyStore.load();
    expect(legacyStore.enabled()[0]?.env.NOTES_TOKEN).toBe("tok-123");
  });

  it("reads and saves the Composio key through the secret store", async () => {
    const saved = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    try {
      const keyFile = join(root, "composio_api_key.txt");
      await writeFile(keyFile, "ak_old\n");
      const secrets = new SecretStore({
        filePath: join(root, "secrets.enc.json"),
        codec: new SecretCodec(fakeCipher()),
        legacyFiles: { COMPOSIO_API_KEY: keyFile },
      });
      await secrets.load();
      // Before migration the old file still counts.
      expect(await new ComposioClient({ userDataPath: root, secrets }).getApiKey()).toBe("ak_old");
      await secrets.migrate();
      expect(existsSync(keyFile)).toBe(false);
      const client = new ComposioClient({ userDataPath: root, secrets });
      expect(await client.getApiKey()).toBe("ak_old");
      await client.setApiKey("ak_new", { verify: false });
      expect(await secrets.get("COMPOSIO_API_KEY")).toBe("ak_new");
      expect(existsSync(keyFile)).toBe(false);
    } finally {
      if (saved !== undefined) process.env.COMPOSIO_API_KEY = saved;
    }
  });
});
