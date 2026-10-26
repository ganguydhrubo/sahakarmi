import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GeminiAccount, GeminiAccountsState } from "../shared/ipc";
import { readAntigravityAccount } from "./acp-providers";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface StoredAccount {
  id: string;
  /** Folder that stands in for the user's home for Google's server; null = the real home. */
  home: string | null;
  addedAt: string;
}

interface AccountsFile {
  version: 1;
  activeId: string;
  accounts: StoredAccount[];
}

export const DEFAULT_GEMINI_ACCOUNT_ID = "default";

/** What AgentService needs to start Gemini on the right account and move on at a limit. */
export interface GeminiAccountSource {
  activeId(): string;
  /** GEMINI_HOME for the account in use, or null for the first account (the real home). */
  activeGeminiHome(): string | null;
  nextSignedIn(exclude: ReadonlySet<string>): Promise<string | null>;
  setActive(id: string): Promise<void>;
}

/**
 * Google accounts for Gemini (Antigravity). Google's server keeps its sign-in under its Gemini
 * home folder ($GEMINI_HOME, by default ~/.gemini), so every extra account gets a folder of its
 * own and the server is started with GEMINI_HOME pointing into it. The first account is the one
 * in the real home folder.
 */
export class GeminiAccountStore implements GeminiAccountSource {
  readonly #file: JsonFile<AccountsFile>;
  readonly #root: string;
  readonly #home: string;
  readonly #environment: NodeJS.ProcessEnv;
  #state: AccountsFile = fresh();

  constructor(userDataPath: string, home = homedir(), environment = process.env) {
    this.#file = new JsonFile(join(userDataPath, "gemini-accounts.json"));
    this.#root = join(userDataPath, "gemini-accounts");
    this.#home = home;
    this.#environment = environment;
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(fresh, isAccountsFile);
    if (!this.#state.accounts.some((account) => account.id === this.#state.activeId)) {
      this.#state.activeId = DEFAULT_GEMINI_ACCOUNT_ID;
    }
  }

  activeId(): string {
    return this.#active().id;
  }

  activeGeminiHome(): string | null {
    return geminiHomeOf(this.#active());
  }

  /** The folder an account's sign-in lives under (its stand-in home). */
  homeOf(id: string): string {
    return this.#homeOf(this.#find(id));
  }

  /** GEMINI_HOME for an account, or null for the first account. */
  geminiHomeOf(id: string): string | null {
    return geminiHomeOf(this.#find(id));
  }

  async list(): Promise<GeminiAccountsState> {
    const accounts: GeminiAccount[] = [];
    for (const account of this.#state.accounts) {
      // The real home also counts an API key from the environment; extra accounts never do.
      const read = await readAntigravityAccount(
        this.#homeOf(account),
        account.home === null ? this.#environment : {},
      ).catch(() => null);
      accounts.push({
        id: account.id,
        email: read?.account?.email ?? null,
        tier: read?.account?.tier ?? null,
        signedIn: Boolean(read?.account),
        active: account.id === this.activeId(),
      });
    }
    return { accounts };
  }

  /** A new, empty account folder; Google's sign-in runs in it next. */
  async add(): Promise<string> {
    const id = randomUUID();
    const home = join(this.#root, id);
    await mkdir(join(home, ".gemini"), { recursive: true });
    this.#state.accounts.push({ id, home, addedAt: new Date().toISOString() });
    await this.#file.write(this.#state);
    return id;
  }

  async setActive(id: string): Promise<void> {
    this.#find(id);
    if (this.#state.activeId === id) return;
    this.#state.activeId = id;
    await this.#file.write(this.#state);
  }

  /** Removes an extra account and its sign-in folder. The first account stays. */
  async remove(id: string): Promise<void> {
    const account = this.#find(id);
    if (account.home === null) {
      throw new Error("The first Google account stays; sign it out in Google instead.");
    }
    this.#state.accounts = this.#state.accounts.filter((candidate) => candidate.id !== id);
    if (this.#state.activeId === id) this.#state.activeId = DEFAULT_GEMINI_ACCOUNT_ID;
    await this.#file.write(this.#state);
    await rm(account.home, { recursive: true, force: true, maxRetries: 3 });
  }

  /** The signed-in account after the one in use, for when it reaches Google's usage limit. */
  async nextSignedIn(exclude: ReadonlySet<string>): Promise<string | null> {
    const { accounts } = await this.list();
    const start = Math.max(
      0,
      accounts.findIndex((account) => account.active),
    );
    for (let step = 1; step <= accounts.length; step += 1) {
      const candidate = accounts[(start + step) % accounts.length];
      if (candidate?.signedIn && !candidate.active && !exclude.has(candidate.id)) {
        return candidate.id;
      }
    }
    return null;
  }

  #find(id: string): StoredAccount {
    const account = this.#state.accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error("That Google account is not on this computer.");
    return account;
  }

  #active(): StoredAccount {
    return (
      this.#state.accounts.find((account) => account.id === this.#state.activeId) ??
      this.#state.accounts[0] ?? { id: DEFAULT_GEMINI_ACCOUNT_ID, home: null, addedAt: "" }
    );
  }

  #homeOf(account: StoredAccount): string {
    return account.home ?? this.#home;
  }
}

function geminiHomeOf(account: StoredAccount): string | null {
  return account.home === null ? null : join(account.home, ".gemini");
}

function fresh(): AccountsFile {
  return {
    version: 1,
    activeId: DEFAULT_GEMINI_ACCOUNT_ID,
    accounts: [{ id: DEFAULT_GEMINI_ACCOUNT_ID, home: null, addedAt: new Date(0).toISOString() }],
  };
}

function isAccountsFile(value: unknown): value is AccountsFile {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.activeId === "string" &&
    Array.isArray(value.accounts) &&
    value.accounts.every(
      (account) =>
        isRecord(account) &&
        typeof account.id === "string" &&
        (account.home === null || typeof account.home === "string"),
    ) &&
    value.accounts.some((account: unknown) => isRecord(account) && account.home === null)
  );
}
