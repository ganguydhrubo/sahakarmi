/**
 * Two safety layers for the coworker browser, each behind its own Settings > Features switch:
 *
 * - Hide secrets (on by default): before a page is handed to a coworker's AI, sign-in tokens,
 *   API keys and secret web-address parameters are replaced with [hidden]. Password and one-time
 *   code fields are already left out of every page reading. Only text that matches a strict,
 *   known secret shape is touched, so ordinary pages read exactly as before.
 * - Remember clicked elements (off by default): after a click or typing into a field works, its
 *   description (kind, role, name, a few attributes and the text around it) is remembered for
 *   that page. When the coworker later uses the same reference after the page changed, the
 *   element is found again only if exactly one element on the same page matches every detail.
 *   Zero or several matches: the step stops exactly as before.
 */

let hideSecretsOn: () => boolean = () => true;
let actionMemoryOn: () => boolean = () => false;

export function configureBrowserGuards(options: {
  hideSecrets?: () => boolean;
  actionMemory?: () => boolean;
}): void {
  if (options.hideSecrets) hideSecretsOn = options.hideSecrets;
  if (options.actionMemory) actionMemoryOn = options.actionMemory;
}

export function hideSecretsEnabled(): boolean {
  try {
    return hideSecretsOn();
  } catch {
    return true;
  }
}

export function actionMemoryEnabled(): boolean {
  try {
    return actionMemoryOn();
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Hide secrets

export const HIDDEN = "[hidden]";

/** Secret shapes that never occur in ordinary prose: each has a fixed prefix and a long body. */
const TOKEN_PATTERNS: RegExp[] = [
  // JSON Web Tokens: two base64url parts that both start with {" ("eyJ"), and a signature.
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // OpenAI / Anthropic / OpenRouter style keys: sk-, sk-proj-, sk-ant-…, sk-or-v1-…
  /\bsk-(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}/g,
  // Stripe secret and restricted keys.
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // GitHub tokens.
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  // Slack tokens.
  /\bxox[abeposr]-[A-Za-z0-9-]{10,}/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{35}/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Hugging Face and GitLab tokens.
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
];

/** Web-address parameters that always carry a secret, whatever their value looks like. */
const ALWAYS_SECRET_PARAMS =
  "password|passwd|pwd|secret|client_secret|access_token|refresh_token|id_token|api_key|apikey|api-key|otp";
/** Parameters that carry a secret only when the value is long and random-looking. */
const MAYBE_SECRET_PARAMS =
  "token|auth|key|code|sig|signature|session|sessionid|session_id|sid|x-amz-signature|x-amz-credential|x-amz-security-token";

const ALWAYS_PARAM = new RegExp(`([?&#;](?:${ALWAYS_SECRET_PARAMS})=)([^&#\\s"'<>]+)`, "gi");
const MAYBE_PARAM = new RegExp(`([?&#;](?:${MAYBE_SECRET_PARAMS})=)([^&#\\s"'<>]+)`, "gi");

/** Long, random-looking: 16+ characters of a token alphabet with both letters and digits. */
export function looksRandomSecret(value: string, minLength = 16): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the raw value.
  }
  if (decoded.length < minLength || decoded.length > 4_096) return false;
  if (!/^[A-Za-z0-9+/=_.~-]+$/.test(decoded)) return false;
  if (!/[0-9]/.test(decoded) || !/[A-Za-z]/.test(decoded)) return false;
  // Short words joined by dashes, dots or underscores ("summer-sale-2026", "en_US.UTF-8") are
  // names, not secrets.
  const parts = decoded.split(/[-_.~]/);
  if (parts.length > 1 && parts.every((part) => part.length <= 10)) return false;
  return true;
}

/** Replaces every known secret shape and secret address parameter in a piece of text. */
export function hideSecretsInText(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, HIDDEN);
  result = result.replace(ALWAYS_PARAM, (_match, prefix: string, value: string) =>
    value === HIDDEN ? `${prefix}${value}` : `${prefix}${HIDDEN}`,
  );
  result = result.replace(MAYBE_PARAM, (match, prefix: string, value: string) =>
    looksRandomSecret(value) ? `${prefix}${HIDDEN}` : match,
  );
  return result;
}

/**
 * A field's name in a page reading is its label, or its value when it has no label. A value
 * that is one long random-looking token (a pasted key, a session id) is hidden as a whole.
 */
export function hideSecretInFieldName(tag: string, name: string): string {
  const hidden = hideSecretsInText(name);
  if (hidden !== name) return hidden;
  if ((tag === "input" || tag === "textarea") && looksRandomSecret(name.trim(), 24)) return HIDDEN;
  return name;
}

interface ReadingLike {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  focus?: unknown;
  elements?: unknown;
}

/** A copy of a page reading or action status with secrets hidden; other fields are untouched. */
export function hideSecretsInReading<T extends ReadingLike>(reading: T): T {
  const copy: ReadingLike = { ...reading };
  if (typeof copy.title === "string") copy.title = hideSecretsInText(copy.title);
  if (typeof copy.url === "string") copy.url = hideSecretsInText(copy.url);
  if (typeof copy.text === "string") copy.text = hideSecretsInText(copy.text);
  if (typeof copy.focus === "string") copy.focus = hideSecretsInText(copy.focus);
  if (Array.isArray(copy.elements)) {
    copy.elements = copy.elements.map((element: unknown) => {
      if (typeof element !== "object" || element === null) return element;
      const record = element as { tag?: unknown; name?: unknown };
      if (typeof record.name !== "string") return element;
      const name = hideSecretInFieldName(
        typeof record.tag === "string" ? record.tag : "",
        record.name,
      );
      return name === record.name ? element : { ...record, name };
    });
  }
  return copy as T;
}

// -----------------------------------------------------------------------------
// Remember clicked elements

/** Everything that must match, exactly, for an element to count as the same one again. */
export interface ElementLocator {
  tag: string;
  role: string;
  name: string;
  type: string;
  field: string;
  href: string;
  nearby: string;
}

const LOCATOR_KEYS: Array<keyof ElementLocator> = [
  "tag",
  "role",
  "name",
  "type",
  "field",
  "href",
  "nearby",
];

export function isElementLocator(value: unknown): value is ElementLocator {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    LOCATOR_KEYS.every((key) => typeof record[key] === "string") &&
    (record.name as string).length > 0
  );
}

/** The label permission checks use for an element: the same shape as a page reading's. */
export function locatorLabel(locator: ElementLocator): string {
  return `${locator.name} ${locator.role} ${locator.tag}`.replace(/\s+/g, " ").trim();
}

/** The page an element belongs to: address without query or #part. Null for other schemes. */
export function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

interface Remembered {
  page: string;
  locator: ElementLocator;
}

const MAX_REMEMBERED_PER_TAB = 100;

/** Per tab: the elements recent references pointed to when an action on them worked. */
export class ActionMemory {
  readonly #tabs = new Map<string, Map<string, Remembered>>();

  remember(tabId: string, ref: string, url: string, locator: ElementLocator): void {
    const page = pageKey(url);
    if (!page || !isElementLocator(locator)) return;
    let refs = this.#tabs.get(tabId);
    if (!refs) {
      refs = new Map();
      this.#tabs.set(tabId, refs);
    }
    refs.delete(ref);
    refs.set(ref, { page, locator });
    while (refs.size > MAX_REMEMBERED_PER_TAB) {
      const oldest = refs.keys().next().value;
      if (oldest === undefined) break;
      refs.delete(oldest);
    }
  }

  /** The remembered element for this reference, only while the tab is on the same page. */
  recall(tabId: string, ref: string, url: string): ElementLocator | null {
    const page = pageKey(url);
    const remembered = this.#tabs.get(tabId)?.get(ref);
    if (!page || !remembered || remembered.page !== page) return null;
    return remembered.locator;
  }

  forget(tabId: string): void {
    this.#tabs.delete(tabId);
  }
}

const CANDIDATES =
  'a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';

/** In-page helpers shared by both scripts, so an element is described the same way twice. */
const PAGE_HELPERS = `
    const visible = (node) => {
      const shown = typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ visibilityProperty: true })
        : getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
      if (!shown) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const squash = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const describe = (node) => {
      if (node instanceof HTMLInputElement && (node.type === 'password' || /one-time-code/.test(node.autocomplete))) return null;
      const name = squash(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.innerText || node.value || '').slice(0, 500);
      if (!name) return null;
      const parent = node.parentElement;
      return {
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || '',
        name,
        type: node.getAttribute('type') || '',
        field: node.getAttribute('name') || '',
        href: node.getAttribute('href') || '',
        nearby: squash(parent ? parent.innerText : '').slice(0, 300),
      };
    };`;

/**
 * Describes the element a reference points to now. { missing: true } when no element carries
 * the reference any more; null when it is there but cannot be described (hidden, no name).
 */
export function describeElementScript(ref: string): string {
  return `(() => {${PAGE_HELPERS}
    const node = document.querySelector('[data-sahkarmi-ref=' + ${JSON.stringify(JSON.stringify(ref))} + ']');
    if (!(node instanceof HTMLElement)) return { missing: true };
    if (!visible(node)) return null;
    return describe(node);
  })()`;
}

/** True when a describe result says no element carries the reference any more. */
export function isMissingElement(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { missing?: unknown }).missing === true;
}

export function sameLocator(left: ElementLocator, right: ElementLocator): boolean {
  return LOCATOR_KEYS.every((key) => left[key] === right[key]);
}

/**
 * Looks for the remembered element on the whole page. Exactly one visible element must match
 * every detail; it keeps its current reference or gets the old one back. Returns the count.
 */
export function findElementScript(locator: ElementLocator, ref: string): string {
  return `(() => {${PAGE_HELPERS}
    const want = ${JSON.stringify(locator)};
    const keys = ${JSON.stringify(LOCATOR_KEYS)};
    const matches = [];
    for (const node of document.querySelectorAll(${JSON.stringify(CANDIDATES)})) {
      if (!(node instanceof HTMLElement) || !visible(node)) continue;
      const found = describe(node);
      if (!found || !keys.every((key) => found[key] === want[key])) continue;
      matches.push(node);
      if (matches.length > 1) break;
    }
    if (matches.length !== 1) return { count: matches.length };
    const node = matches[0];
    let ref = node.getAttribute('data-sahkarmi-ref');
    if (!ref) {
      ref = ${JSON.stringify(ref)};
      node.setAttribute('data-sahkarmi-ref', ref);
    }
    return { count: 1, ref };
  })()`;
}

/** Reads a find result: the reference to use, or null unless exactly one element matched. */
export function uniqueMatch(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { count?: unknown; ref?: unknown };
  return record.count === 1 && typeof record.ref === "string" && record.ref ? record.ref : null;
}

export function recalledNotice(locator: ElementLocator): string {
  const name = locator.name.length > 60 ? `${locator.name.slice(0, 57)}...` : locator.name;
  return `The page had changed since you read it. Sahkarmi found the same ${locator.tag} "${name}" again (the only exact match on this page) and used it. Take a fresh snapshot before using other references.`;
}
