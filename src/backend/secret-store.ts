import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

/**
 * Electron's `safeStorage` (DPAPI on Windows: only this Windows user on this PC can decrypt).
 * Injected so tests and the CLI run without Electron.
 */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Marks a value Sahkarmi encrypted; anything else is read as it is (older plain values). */
export const SEALED_PREFIX = "sahkarmi-sealed:v1:";

/** Encrypts single values for files that keep secrets next to other settings. */
export class SecretCodec {
  readonly #cipher: SecretCipher | null;

  constructor(cipher: SecretCipher | null) {
    this.#cipher = cipher;
  }

  /** False before the app is ready, on a PC without DPAPI, or with no cipher at all. */
  get available(): boolean {
    try {
      return this.#cipher?.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  isSealed(value: string): boolean {
    return value.startsWith(SEALED_PREFIX);
  }

  /** Encrypted when possible; otherwise the value as it is (the old behaviour). */
  seal(value: string): string {
    if (!value || this.isSealed(value) || !this.available || !this.#cipher) return value;
    return `${SEALED_PREFIX}${this.#cipher.encryptString(value).toString("base64")}`;
  }

  /** The plain value, or null when it was sealed on another PC or account and cannot be read. */
  open(value: string): string | null {
    if (!this.isSealed(value)) return value;
    if (!this.available || !this.#cipher) return null;
    try {
      return this.#cipher.decryptString(Buffer.from(value.slice(SEALED_PREFIX.length), "base64"));
    } catch {
      return null;
    }
  }
}

interface SecretFileState {
  version: 1;
  secrets: Record<string, string>;
}

function isSecretFileState(value: unknown): value is SecretFileState {
  return isRecord(value) && value.version === 1 && isRecord(value.secrets);
}

export interface SecretStoreOptions {
  /** Where the sealed values live (userData/secrets.enc.json). */
  filePath: string;
  codec: SecretCodec;
  /**
   * The plain-text file each secret used to be saved in. Read when the secret is not in the
   * store yet, written instead of the store when encryption is unavailable, and removed once
   * the secret has been encrypted and read back.
   */
  legacyFiles?: Record<string, string>;
}

/**
 * API keys and tokens, by name (the environment variable each one is for). Values are sealed
 * with DPAPI; when that is not available, Sahkarmi keeps the old plain-text files so sign-in
 * keeps working, exactly as before.
 */
export class SecretStore {
  readonly #file: JsonFile<SecretFileState>;
  readonly #filePath: string;
  readonly #codec: SecretCodec;
  readonly #legacy: Record<string, string>;
  #secrets: Record<string, string> = {};

  constructor(options: SecretStoreOptions) {
    this.#filePath = options.filePath;
    this.#file = new JsonFile(options.filePath);
    this.#codec = options.codec;
    this.#legacy = { ...(options.legacyFiles ?? {}) };
  }

  get encrypted(): boolean {
    return this.#codec.available;
  }

  async load(): Promise<void> {
    const stored = await this.#file
      .read(() => ({ version: 1, secrets: {} }), isSecretFileState)
      .catch(() => ({ version: 1 as const, secrets: {} }));
    this.#secrets = Object.fromEntries(
      Object.entries(stored.secrets).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  /** The secret, from the sealed store or else from its old plain-text file. */
  async get(name: string): Promise<string | null> {
    const stored = this.#secrets[name];
    if (stored !== undefined) {
      const value = this.#codec.open(stored);
      if (value?.trim()) return value.trim();
    }
    const legacy = this.#legacy[name];
    if (!legacy) return null;
    const text = await readFile(legacy, "utf8").catch(() => "");
    return text.trim() || null;
  }

  /** Saves (or with an empty value, forgets) a secret. */
  async set(name: string, value: string | null): Promise<void> {
    const trimmed = value?.trim() ?? "";
    const legacy = this.#legacy[name];
    if (!trimmed) {
      delete this.#secrets[name];
      await this.#persist();
      if (legacy) await rm(legacy, { force: true }).catch(() => undefined);
      return;
    }
    if (!this.#codec.available) {
      // No DPAPI: the old plain-text file, readable by this user only, as before.
      if (legacy) {
        await writePrivate(legacy, trimmed);
        delete this.#secrets[name];
      } else {
        this.#secrets[name] = trimmed;
      }
      await this.#persist();
      return;
    }
    this.#secrets[name] = this.#codec.seal(trimmed);
    await this.#persist();
    if (legacy && (await this.#readsBack(name, trimmed))) {
      await rm(legacy, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Moves every old plain-text key into the sealed store. A plain file is removed only after
   * the sealed copy was written and read back from disk with the same value; if anything fails,
   * the file stays and is still used.
   */
  async migrate(): Promise<{ migrated: string[]; kept: string[] }> {
    const migrated: string[] = [];
    const kept: string[] = [];
    for (const [name, path] of Object.entries(this.#legacy)) {
      const text = (await readFile(path, "utf8").catch(() => "")).trim();
      if (!text) continue;
      if (!this.#codec.available) {
        kept.push(name);
        continue;
      }
      const current = this.#secrets[name];
      const currentValue = current === undefined ? null : this.#codec.open(current);
      // A key saved since (sealed) wins over an older plain file left behind.
      if (!currentValue) {
        this.#secrets[name] = this.#codec.seal(text);
        await this.#persist();
      }
      const expected = currentValue ?? text;
      if (await this.#readsBack(name, expected)) {
        await rm(path, { force: true }).catch(() => undefined);
        migrated.push(name);
      } else {
        kept.push(name);
      }
    }
    // Values written before DPAPI was available are sealed now too.
    if (this.#codec.available) {
      let changed = false;
      for (const [name, value] of Object.entries(this.#secrets)) {
        if (!this.#codec.isSealed(value)) {
          this.#secrets[name] = this.#codec.seal(value);
          changed = true;
        }
      }
      if (changed) await this.#persist();
    }
    return { migrated, kept };
  }

  /** Every secret Sahkarmi holds, for putting into its own process environment at start. */
  async entries(): Promise<Array<[string, string]>> {
    const names = new Set([...Object.keys(this.#secrets), ...Object.keys(this.#legacy)]);
    const result: Array<[string, string]> = [];
    for (const name of names) {
      const value = await this.get(name);
      if (value) result.push([name, value]);
    }
    return result;
  }

  async #readsBack(name: string, expected: string): Promise<boolean> {
    try {
      const fresh = new SecretStore({ filePath: this.#filePath, codec: this.#codec });
      await fresh.load();
      return (await fresh.get(name)) === expected;
    } catch {
      return false;
    }
  }

  async #persist(): Promise<void> {
    await this.#file.write({ version: 1, secrets: { ...this.#secrets } });
  }
}

async function writePrivate(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
}

// -----------------------------------------------------------------------------
// Which keys each AI tool may see

/**
 * Every environment variable through which Sahkarmi hands an AI tool a key or token. Each
 * tool is started with its own and none of the others.
 */
export const SECRET_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ANTIGRAVITY_API_KEY",
  "COMPOSIO_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "CURSOR_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  "CLINE_API_KEY",
  "XAI_API_KEY",
  "FACTORY_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "MISTRAL_API_KEY",
] as const;

const GOOGLE_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTIGRAVITY_API_KEY"];

/** The keys each provider's own tool reads. A provider not listed gets none. */
export const PROVIDER_SECRET_ENV: Record<string, readonly string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  antigravity: GOOGLE_KEYS,
  gemini: GOOGLE_KEYS,
  cursor: ["CURSOR_API_KEY"],
  copilot: ["COPILOT_GITHUB_TOKEN"],
  cline: ["CLINE_API_KEY"],
  grok: ["XAI_API_KEY"],
  droid: ["FACTORY_API_KEY"],
  qoder: ["QODER_PERSONAL_ACCESS_TOKEN"],
  vibe: ["MISTRAL_API_KEY"],
};

/** A copy of `env` without the keys that belong to other tools. Names compare case-blind. */
export function envWithOnlyKeys(
  env: NodeJS.ProcessEnv,
  keep: readonly string[],
): NodeJS.ProcessEnv {
  const kept = new Set(keep.map((name) => name.toUpperCase()));
  const secret = new Set<string>(SECRET_ENV_NAMES);
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => {
      const upper = name.toUpperCase();
      return !secret.has(upper) || kept.has(upper);
    }),
  );
}

/** The environment for one provider's tool: its own key, nobody else's. */
export function envForProvider(provider: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return envWithOnlyKeys(env, PROVIDER_SECRET_ENV[provider] ?? []);
}

/**
 * An MCP server started by an AI tool inherits that tool's environment, key included. Blank
 * values hide the tool's key unless the owner gave the server that variable on purpose.
 */
export function hideInheritedKeys(
  serverEnv: Record<string, string>,
  provider: string,
): Record<string, string> {
  const result = { ...serverEnv };
  for (const name of PROVIDER_SECRET_ENV[provider] ?? []) {
    if (!(name in result)) result[name] = "";
  }
  return result;
}
