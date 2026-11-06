import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

/**
 * What this build of SQLite can do. Knowledge Bases and team memory need FTS5 with the porter
 * tokenizer; vector search uses the sqlite-vec extension when it loads, and otherwise falls back
 * to a brute-force scan in JavaScript.
 */

export interface SqliteCapabilities {
  fts5: boolean;
  /** Path of the loaded sqlite-vec library, or null when it could not be loaded. */
  vec: string | null;
  vecVersion: string | null;
  error: string | null;
}

let vecPathCache: string | null | undefined;
let vecFailure: string | null = null;

/**
 * The sqlite-vec library for this platform. Inside the packaged app the file sits in
 * app.asar.unpacked (SQLite loads it with the OS loader, which cannot read the asar archive).
 */
export function vecExtensionPath(): string | null {
  if (vecPathCache !== undefined) return vecPathCache;
  if (process.env.SAHKARMI_DISABLE_SQLITE_VEC === "1") {
    vecPathCache = null;
    return null;
  }
  try {
    const load = createRequire(import.meta.url)("sqlite-vec") as { getLoadablePath: () => string };
    vecPathCache = load.getLoadablePath().replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  } catch (error) {
    vecFailure = error instanceof Error ? error.message : String(error);
    vecPathCache = null;
  }
  return vecPathCache;
}

/**
 * Opens a database that may load sqlite-vec; `vector` is true when the extension is loaded.
 * A build without extension support (or a missing library) still opens the database.
 */
export function openDatabase(
  path: string,
  options: { vector?: boolean } = {},
): { db: DatabaseSync; vector: boolean } {
  const extension = options.vector === false ? null : vecExtensionPath();
  if (!extension) return { db: new DatabaseSync(path), vector: false };
  const db = new DatabaseSync(path, { allowExtension: true });
  try {
    db.loadExtension(extension);
    return { db, vector: true };
  } catch (error) {
    vecFailure = error instanceof Error ? error.message : String(error);
    return { db, vector: false };
  } finally {
    try {
      // Nothing after this point may load another library into this connection.
      db.enableLoadExtension(false);
    } catch {
      /* older builds have no switch */
    }
  }
}

/** The startup check: one in-memory database, an FTS5 table, and sqlite-vec if present. */
export function sqliteCapabilities(): SqliteCapabilities {
  const result: SqliteCapabilities = { fts5: false, vec: null, vecVersion: null, error: null };
  let opened: { db: DatabaseSync; vector: boolean } | null = null;
  try {
    opened = openDatabase(":memory:");
    opened.db.exec(
      "CREATE VIRTUAL TABLE probe USING fts5(text, tokenize='porter unicode61 remove_diacritics 2')",
    );
    opened.db.prepare("INSERT INTO probe(text) VALUES (?)").run("registrations");
    const found = opened.db
      .prepare("SELECT count(*) AS n FROM probe WHERE probe MATCH 'registration'")
      .get() as { n: number };
    result.fts5 = Number(found.n) === 1;
    if (opened.vector) {
      const row = opened.db.prepare("SELECT vec_version() AS v").get() as { v: string };
      result.vec = vecExtensionPath();
      result.vecVersion = String(row.v);
    } else if (vecFailure) {
      result.error = `sqlite-vec not loaded: ${vecFailure}`;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    opened?.db.close();
  }
  return result;
}
