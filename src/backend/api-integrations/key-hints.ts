import type { ApiAuth } from "../../shared/ipc";

/**
 * Key formats a few providers publish. A match is only a guess: Sahkarmi says so, and it is
 * confirmed only when a real request with the key succeeds. Plain hex or random keys match
 * nothing here, and then the owner is asked which service the key is for.
 */
export interface KeyHint {
  provider: string;
  pattern: RegExp;
  baseUrl: string;
  auth: ApiAuth;
  docsUrl: string;
  /** A free reading request that needs no parameters, used by the tests. */
  testPath: string | null;
}

export const KEY_HINTS: KeyHint[] = [
  {
    provider: "Anthropic",
    pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    baseUrl: "https://api.anthropic.com/v1",
    auth: { kind: "header", name: "x-api-key" },
    docsUrl: "https://docs.anthropic.com/en/api/overview",
    testPath: "/models",
  },
  {
    provider: "OpenRouter",
    pattern: /^sk-or-v1-[A-Za-z0-9]{32,}$/,
    baseUrl: "https://openrouter.ai/api/v1",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://openrouter.ai/docs/api-reference/overview",
    testPath: "/models",
  },
  {
    provider: "OpenAI",
    pattern: /^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/,
    baseUrl: "https://api.openai.com/v1",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://platform.openai.com/docs/api-reference",
    testPath: "/models",
  },
  {
    provider: "Groq",
    pattern: /^gsk_[A-Za-z0-9]{40,}$/,
    baseUrl: "https://api.groq.com/openai/v1",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://console.groq.com/docs/api-reference",
    testPath: "/models",
  },
  {
    provider: "GitHub",
    pattern: /^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/,
    baseUrl: "https://api.github.com",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://docs.github.com/en/rest",
    testPath: "/user",
  },
  {
    provider: "Hugging Face",
    pattern: /^hf_[A-Za-z0-9]{30,}$/,
    baseUrl: "https://huggingface.co/api",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://huggingface.co/docs/hub/api",
    testPath: "/whoami-v2",
  },
  {
    provider: "Stripe",
    pattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/,
    baseUrl: "https://api.stripe.com/v1",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://docs.stripe.com/api",
    testPath: "/balance",
  },
  {
    provider: "Slack",
    pattern: /^xox[bpa]-[A-Za-z0-9-]{20,}$/,
    baseUrl: "https://slack.com/api",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://api.slack.com/methods",
    testPath: "/auth.test",
  },
  {
    provider: "SendGrid",
    pattern: /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/,
    baseUrl: "https://api.sendgrid.com/v3",
    auth: { kind: "bearer", name: null },
    docsUrl: "https://www.twilio.com/docs/sendgrid/api-reference",
    testPath: "/scopes",
  },
  {
    provider: "Google",
    pattern: /^AIza[A-Za-z0-9_-]{35}$/,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: { kind: "query", name: "key" },
    docsUrl: "https://ai.google.dev/api",
    testPath: "/models",
  },
];

/** The first provider whose published key format matches, or null (most keys). */
export function hintForKey(key: string): KeyHint | null {
  return KEY_HINTS.find((hint) => hint.pattern.test(key.trim())) ?? null;
}

/** "Open Weather Map" and "openweathermap.org" compare equal. */
export function providerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www|api)\./, "")
    .replace(/\.(com|org|io|net|dev|ai|co|app)(\/.*)?$/, "")
    .replace(/[^a-z0-9]/g, "");
}
