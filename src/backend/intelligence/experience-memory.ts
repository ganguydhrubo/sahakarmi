import { randomUUID } from "node:crypto";
import type {
  ExperienceHit,
  ExperienceKind,
  ExperienceRow,
  ExperienceTrust,
  IntelligenceDb,
} from "./intelligence-db";

/**
 * Experiences: short, searchable notes about how work went in one workspace ("Dev's code tasks
 * failed twice with: cannot find module …", "Kavya finished 'GST invoice summary' — verified").
 *
 * Rules that keep it safe and small:
 * - Every entry has a kind (fact, observation, preference, prediction, lesson) and a trust
 *   level. A coworker's own words can only ever be "untrusted"; only Sahkarmi's evidence makes
 *   "verified" or "observed", and only the owner makes "owner". Decisions read trusted entries
 *   only; untrusted ones are shown, never acted on.
 * - Entries expire (by kind) and each workspace keeps at most a fixed number; the least used
 *   and oldest go first, owner entries last.
 * - The owner can correct (the old text is kept as `correctedFrom`) or delete any entry.
 * - Text is stored as data, flattened and cut short; nothing in it is ever run or followed.
 */

const DAY_MS = 86_400_000;
export const EXPERIENCE_LIMIT_PER_WORKSPACE = 500;
const MAX_TEXT = 400;

const TTL_DAYS: Record<ExperienceKind, number | null> = {
  fact: null,
  preference: null,
  observation: 180,
  lesson: 60,
  prediction: 7,
};

/** Trust levels a decision may rely on. */
export const DECISION_TRUST: readonly ExperienceTrust[] = ["owner", "verified", "observed"];

export interface NewExperience {
  workspaceId: string;
  kind: ExperienceKind;
  trust: ExperienceTrust;
  text: string;
  category?: string | null;
  botId?: string | null;
  outcomeId?: string | null;
  /** Override the kind's default lifetime. null = keep until deleted. */
  ttlDays?: number | null;
}

export interface SimilarExperience extends ExperienceRow {
  /** Higher is better: text match, recency and trust together. */
  relevance: number;
}

/** Collapses whitespace, removes control characters and cuts the text to a safe length. */
export function cleanExperienceText(text: string): string {
  const flat = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

/** Words for an FTS5 query: letters and digits only, so the text can never be FTS syntax. */
export function ftsQuery(text: string, maxTerms = 12): string {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word, index, all) => all.indexOf(word) === index,
  );
  return words
    .slice(0, maxTerms)
    .map((word) => `"${word}"`)
    .join(" OR ");
}

export class ExperienceMemory {
  readonly #db: IntelligenceDb;
  readonly #now: () => number;
  readonly #limit: number;

  constructor(
    db: IntelligenceDb,
    now: () => number = Date.now,
    limit = EXPERIENCE_LIMIT_PER_WORKSPACE,
  ) {
    this.#db = db;
    this.#now = now;
    this.#limit = limit;
  }

  /**
   * Adds an entry, or refreshes an identical one (same workspace and text). Untrusted sources
   * can never claim a higher trust: the caller passes the trust, and `fromCoworker` forces it.
   */
  add(entry: NewExperience, options: { fromCoworker?: boolean } = {}): ExperienceRow | null {
    const text = cleanExperienceText(entry.text);
    if (!text || !entry.workspaceId) return null;
    const trust: ExperienceTrust = options.fromCoworker ? "untrusted" : entry.trust;
    const now = this.#now();
    const ttl = entry.ttlDays === undefined ? TTL_DAYS[entry.kind] : entry.ttlDays;
    const expiresAt = ttl === null ? null : now + ttl * DAY_MS;
    const existing = this.#db.experienceByText(entry.workspaceId, text);
    if (existing) {
      this.#db.updateExperience(existing.id, entry.workspaceId, { updatedAt: now, expiresAt });
      return { ...existing, updatedAt: now, expiresAt };
    }
    const row: ExperienceRow = {
      id: `exp-${randomUUID()}`,
      workspaceId: entry.workspaceId,
      kind: entry.kind,
      trust,
      category: entry.category ?? null,
      botId: entry.botId ?? null,
      outcomeId: entry.outcomeId ?? null,
      text,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      uses: 0,
      lastUsedAt: null,
      correctedFrom: null,
    };
    this.#db.insertExperience(row);
    this.#db.pruneExperiences(entry.workspaceId, this.#limit);
    return row;
  }

  list(
    workspaceId: string,
    options: { kind?: string; limit?: number; offset?: number } = {},
  ): ExperienceRow[] {
    return this.#db.experiences(workspaceId, { ...options, now: this.#now() });
  }

  /**
   * Past experiences like this text, best first. Relevance = text match (bm25) × recency
   * (90-day half-life) × trust. `trustedOnly` leaves out a coworker's own words.
   */
  similar(
    workspaceId: string,
    text: string,
    options: { limit?: number; trustedOnly?: boolean; markUsed?: boolean } = {},
  ): SimilarExperience[] {
    const query = ftsQuery(text);
    if (!query) return [];
    const now = this.#now();
    const limit = options.limit ?? 5;
    let hits: ExperienceHit[];
    try {
      hits = this.#db.searchExperiences(workspaceId, query, limit * 4, now);
    } catch {
      return [];
    }
    const trustWeight: Record<ExperienceTrust, number> = {
      owner: 1.3,
      verified: 1.15,
      observed: 1,
      untrusted: 0.5,
    };
    const ranked = hits
      .filter((hit) => !options.trustedOnly || DECISION_TRUST.includes(hit.trust))
      .map((hit) => {
        // bm25 in SQLite is negative; smaller (more negative) is better.
        const match = Math.max(0, -hit.rank);
        const age = Math.max(0, now - hit.updatedAt);
        const recency = 0.5 ** (age / (90 * DAY_MS));
        const relevance =
          Math.round(match * (0.5 + 0.5 * recency) * trustWeight[hit.trust] * 1000) / 1000;
        const { rank: _rank, ...row } = hit;
        return { ...row, relevance };
      })
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
    if (options.markUsed) {
      for (const hit of ranked) {
        this.#db.updateExperience(hit.id, workspaceId, { uses: hit.uses + 1, lastUsedAt: now });
      }
    }
    return ranked;
  }

  /** The owner's correction: new text, owner trust, the old text kept for the record. */
  correct(workspaceId: string, id: string, text: string): ExperienceRow | null {
    const existing = this.#db.experience(id, workspaceId);
    const cleaned = cleanExperienceText(text);
    if (!existing || !cleaned) return null;
    const now = this.#now();
    this.#db.updateExperience(id, workspaceId, {
      text: cleaned,
      trust: "owner",
      correctedFrom: existing.correctedFrom ?? existing.text,
      updatedAt: now,
      expiresAt: TTL_DAYS[existing.kind] === null ? null : existing.expiresAt,
    });
    return this.#db.experience(id, workspaceId);
  }

  delete(workspaceId: string, id: string): boolean {
    return this.#db.deleteExperience(id, workspaceId);
  }

  /** Expired entries out, every workspace kept within its limit. */
  maintain(): { expired: number; pruned: number } {
    const expired = this.#db.deleteExpiredExperiences(this.#now());
    let pruned = 0;
    for (const workspaceId of this.#db.workspaces()) {
      pruned += this.#db.pruneExperiences(workspaceId, this.#limit);
    }
    return { expired, pruned };
  }
}
