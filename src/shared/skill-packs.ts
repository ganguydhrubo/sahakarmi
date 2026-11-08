/**
 * Sahkarmi skill packs: curated sets of open-source skills, each pinned to one exact commit and
 * installed on demand (one click per pack or per skill) through the skill importer, with the
 * usual risk scan. Nothing here is bundled into the installer; only this list is.
 *
 * Owner rule: packs are named by what they do. Upstream project names, authors, URLs and
 * licences appear only in Settings > About > Open-source credits (see open-source-credits.ts).
 * `repo` below is used only to download; the UI never shows it.
 *
 * Every pack was checked at its pinned commit: licence read from LICENSE / per-skill
 * LICENSE.txt, and every skill folder that ships scripts or programs was looked at. Skills whose
 * instructions run bundled scripts are left out (listed in `skipped`); a pack never downloads
 * script or program files at all.
 */
import type { AllowedLicence } from "./open-source-credits";

export type SkillPackNotice = "legal";

export interface SkillPack {
  /** Neutral id; also the i18n key stem (packs.<id>.title / .summary). */
  id: string;
  /** English title and summary (the renderer shows the translated ones). */
  title: string;
  summary: string;
  /** Shown on the pack and on every skill from it. */
  notice?: SkillPackNotice;
  /** owner/repo, for downloading only; its credit is the entry with this repo's GitHub URL. */
  repo: string;
  /** Exact 40-character commit every download is pinned to. */
  commit: string;
  licence: AllowedLicence;
  /** Folder that holds the skills ("" for the repo root). */
  base: string;
  /** Skill folder names under `base` ("" when the repo root is the skill). */
  skills: string[];
  /** Left out, with the reason (for the record; never offered). */
  skipped: Array<{ skill: string; reason: string }>;
}

const KWP = {
  repo: "anthropics/knowledge-work-plugins",
  commit: "e050c2ec856373787143d7057663a6ebd1277df3",
  licence: "Apache-2.0",
} as const;

export const SKILL_PACKS: SkillPack[] = [
  {
    id: "small-business",
    title: "Small business pack",
    summary:
      "Run the shop: cash flow, invoices to chase, payroll prep, hiring, leads, reviews, social posts and a Monday brief. You approve anything that touches money or customers.",
    ...KWP,
    base: "small-business/skills",
    skills: [
      "ad-manager",
      "ap-processor",
      "brand-style",
      "build-agent",
      "build-connector",
      "business-pulse",
      "call-list",
      "canva-creator",
      "cash-flow-snapshot",
      "close-month",
      "content-strategy",
      "contract-review",
      "crm-autopilot",
      "grant-rfp-writer",
      "grow-pipeline",
      "growth-pulse",
      "hiring-screener",
      "inbox-manager",
      "inventory-planner",
      "invoice-chase",
      "job-post-builder",
      "lead-finder",
      "lead-triage",
      "marketing-monday",
      "monday-brief",
      "month-end-prep",
      "outreach-composer",
      "pay-the-bills",
      "payroll-prep",
      "plan-payroll",
      "proposal-builder",
      "reactivate",
      "report-builder",
      "report-pack",
      "restock",
      "review-reputation",
      "seo-ai-visibility",
      "smb-onboard",
      "smb-router",
      "social-content-engine",
      "speed-to-lead",
      "tax-prep",
      "tax-season-organizer",
      "ticket-deflector",
    ],
    skipped: [],
  },
  {
    id: "sales",
    title: "Sales pack",
    summary:
      "Account research, call prep and summaries, pipeline and forecast reviews, outreach drafts, objection handling and weekly wraps.",
    ...KWP,
    base: "sales/skills",
    skills: [
      "account-context",
      "account-plan",
      "account-research",
      "account-tiering",
      "call-prep",
      "call-summary",
      "close-plan",
      "competitive-intelligence",
      "create-an-asset",
      "crm-hygiene-check",
      "customer-health",
      "customer-voice",
      "daily-briefing",
      "deal-advance-gap",
      "deal-review",
      "deal-signals",
      "deal-slip-scenario",
      "draft-outreach",
      "end-of-day",
      "expansion-whitespace",
      "forecast",
      "handle-objection",
      "inbox-sweep",
      "lead-triage",
      "log-activity",
      "pipeline-review",
      "renewal-radar",
      "rep-context",
      "route-lead",
      "schedule-meeting",
      "setup",
      "stakeholder-map",
      "team-pipeline",
      "update-opportunity",
      "weekly-wrap",
      "win-loss-review",
    ],
    skipped: [],
  },
  {
    id: "customer-support",
    title: "Customer support pack",
    summary:
      "Triage tickets, draft replies, write help-centre articles, research a customer and escalate well.",
    ...KWP,
    base: "customer-support/skills",
    skills: [
      "customer-escalation",
      "customer-research",
      "draft-response",
      "kb-article",
      "ticket-triage",
    ],
    skipped: [],
  },
  {
    id: "hr",
    title: "HR pack",
    summary:
      "Offers, onboarding, interview prep, performance reviews, pay analysis, org planning and policy look-ups.",
    ...KWP,
    base: "human-resources/skills",
    skills: [
      "comp-analysis",
      "draft-offer",
      "interview-prep",
      "onboarding",
      "org-planning",
      "people-report",
      "performance-review",
      "policy-lookup",
      "recruiting-pipeline",
    ],
    skipped: [],
  },
  {
    id: "legal",
    title: "Legal pack (not legal advice)",
    summary:
      "First-pass contract and NDA reviews, compliance checks, risk notes and meeting briefs, for you to take to a lawyer.",
    notice: "legal",
    ...KWP,
    base: "legal/skills",
    skills: [
      "brief",
      "compliance-check",
      "legal-response",
      "legal-risk-assessment",
      "meeting-briefing",
      "review-contract",
      "signature-request",
      "triage-nda",
      "vendor-check",
    ],
    skipped: [],
  },
  {
    id: "finance",
    title: "Finance & accounting pack",
    summary:
      "Month-end close, journal entries, reconciliations, financial statements, variance analysis and audit support.",
    ...KWP,
    base: "finance/skills",
    skills: [
      "audit-support",
      "close-management",
      "financial-statements",
      "journal-entry-prep",
      "journal-entry",
      "reconciliation",
      "sox-testing",
      "variance-analysis",
    ],
    skipped: [],
  },
  {
    id: "product-management",
    title: "Product management pack",
    summary:
      "Write specs, plan sprints, update the roadmap, review metrics, brainstorm and summarise research.",
    ...KWP,
    base: "product-management/skills",
    skills: [
      "competitive-brief",
      "metrics-review",
      "product-brainstorming",
      "roadmap-update",
      "sprint-planning",
      "stakeholder-update",
      "synthesize-research",
      "write-spec",
    ],
    skipped: [],
  },
  {
    id: "operations",
    title: "Operations pack",
    summary:
      "Process docs, runbooks, change requests, capacity plans, vendor reviews, risk and status reports.",
    ...KWP,
    base: "operations/skills",
    skills: [
      "capacity-plan",
      "change-request",
      "compliance-tracking",
      "process-doc",
      "process-optimization",
      "risk-assessment",
      "runbook",
      "status-report",
      "vendor-review",
    ],
    skipped: [],
  },
  {
    id: "marketing",
    title: "Marketing pack",
    summary:
      "Campaign plans, content drafts, email sequences, brand reviews, SEO audits and performance reports.",
    ...KWP,
    base: "marketing/skills",
    skills: [
      "brand-review",
      "campaign-plan",
      "competitive-brief",
      "content-creation",
      "draft-content",
      "email-sequence",
      "performance-report",
      "seo-audit",
    ],
    skipped: [],
  },
  {
    id: "data",
    title: "Data & analysis pack",
    summary: "Explore and validate data, write SQL, run statistics, build charts and dashboards.",
    ...KWP,
    base: "data/skills",
    skills: [
      "analyze",
      "build-dashboard",
      "create-viz",
      "data-visualization",
      "explore-data",
      "sql-queries",
      "statistical-analysis",
      "validate-data",
      "write-query",
    ],
    skipped: [{ skill: "data-context-extractor", reason: "Ships a Python script." }],
  },
  {
    id: "productivity",
    title: "Productivity pack",
    summary: "Task lists, a daily start and update routine, and a tidy working memory.",
    ...KWP,
    base: "productivity/skills",
    skills: ["memory-management", "start", "task-management", "update"],
    skipped: [],
  },
  {
    id: "documents",
    title: "Documents & writing pack",
    summary:
      "Internal updates and newsletters, colour and font themes for documents, polished web page design, and follow-up questions that check a draft before you act on it.",
    repo: "anthropics/skills",
    commit: "2c5958ecac7cee2b583967a2c4981d0f4a75c579",
    licence: "Apache-2.0",
    base: "skills",
    skills: ["internal-comms", "theme-factory", "frontend-design", "discernment-nudge"],
    skipped: [
      { skill: "docx", reason: "Runs bundled Python scripts." },
      { skill: "pdf", reason: "Runs bundled Python scripts." },
      { skill: "pptx", reason: "Runs bundled Python scripts." },
      { skill: "xlsx", reason: "Runs bundled Python scripts." },
      { skill: "skill-creator", reason: "Runs bundled Python scripts." },
      { skill: "mcp-builder", reason: "Runs bundled Python scripts." },
      { skill: "webapp-testing", reason: "Runs bundled Python scripts." },
      { skill: "web-artifacts-builder", reason: "Runs bundled shell scripts." },
      { skill: "slack-gif-creator", reason: "Runs bundled Python code." },
      { skill: "algorithmic-art", reason: "Ships a JavaScript template it runs." },
      { skill: "claude-api", reason: "Ships scripts; about one vendor's own product." },
      { skill: "canvas-design", reason: "Mostly font files (5 MB); binaries are never copied." },
      { skill: "brand-guidelines", reason: "Applies another company's brand." },
      { skill: "academy-guide", reason: "Promotes one vendor's courses." },
      { skill: "doc-coauthoring", reason: "No licence file in its folder; licence not verified." },
    ],
  },
  {
    id: "growth-marketing",
    title: "Growth marketing pack",
    summary:
      "Copywriting, SEO, ads, landing-page conversion, pricing, launches, referrals, email and social: 51 marketing playbooks.",
    repo: "coreyhaines31/marketingskills",
    commit: "96798cf38736ecdba015a1d2b0521b0c8f8f41dd",
    licence: "MIT",
    base: "skills",
    skills: [
      "ab-testing",
      "ad-creative",
      "ads",
      "ai-seo",
      "analytics",
      "aso",
      "attribution",
      "churn-prevention",
      "co-marketing",
      "cold-email",
      "community-marketing",
      "competitor-profiling",
      "competitors",
      "content-strategy",
      "copy-editing",
      "copywriting",
      "cro",
      "customer-research",
      "directory-submissions",
      "emails",
      "events",
      "free-tools",
      "image",
      "influencer-marketing",
      "launch",
      "lead-magnets",
      "link-building",
      "marketing-council",
      "marketing-ideas",
      "marketing-loops",
      "marketing-plan",
      "marketing-psychology",
      "offers",
      "onboarding",
      "paywalls",
      "popups",
      "pricing",
      "product-marketing",
      "programmatic-seo",
      "prospecting",
      "public-relations",
      "referrals",
      "revops",
      "sales-enablement",
      "schema",
      "seo-audit",
      "signup",
      "site-architecture",
      "sms",
      "social",
      "video",
    ],
    skipped: [
      { skill: "conversion-tracking", reason: "Ships 28 JavaScript snippets." },
      { skill: "reverse-engineer-marketing", reason: "Runs a bundled script." },
    ],
  },
  {
    id: "product-playbooks",
    title: "Product playbooks pack",
    summary:
      "PRDs, user stories, OKRs, RICE scoring, launch checklists, positioning, journey maps, churn and cohort analysis.",
    repo: "mohitagw15856/pm-claude-skills",
    commit: "0246bd45ee7bd6cef57ec6fcec9dd0062c301652",
    licence: "MIT",
    base: "skills",
    skills: [
      "prd-template",
      "user-story-writer",
      "okr-builder",
      "rice-impact-matrix",
      "roadmap-narrative",
      "sprint-brief",
      "stakeholder-update",
      "product-launch-checklist",
      "product-positioning-doc",
      "go-to-market",
      "press-release",
      "customer-journey-map",
      "job-story-mapper",
      "assumption-mapper",
      "discovery-interview-guide",
      "user-interview-synthesis",
      "user-research-synthesis",
      "competitive-analysis",
      "competitor-teardown",
      "metrics-framework",
      "product-health-analysis",
      "ab-test-planner",
      "churn-analysis",
      "cohort-analysis",
      "retention-analysis",
      "retro-analysis",
    ],
    skipped: [
      {
        skill: "(1,300+ other folders)",
        reason: "Only product-management skills were picked; 69 others ship scripts.",
      },
    ],
  },
  {
    id: "design-ux",
    title: "Design & UX pack",
    summary: "Banners for social, ads and print, and HTML slide decks with charts.",
    repo: "nextlevelbuilder/ui-ux-pro-max-skill",
    commit: "4f2dbb67e64969a9a30ab00742f2d55d66ddec2b",
    licence: "MIT",
    base: ".claude/skills",
    skills: ["banner-design", "slides"],
    skipped: [
      { skill: "ui-ux-pro-max", reason: "Runs 20 bundled Python scripts." },
      { skill: "design", reason: "Runs bundled Python scripts." },
      { skill: "design-system", reason: "Runs bundled scripts." },
      { skill: "brand", reason: "Runs bundled scripts." },
      { skill: "ui-styling", reason: "Runs bundled Python scripts." },
    ],
  },
  {
    id: "contract-review",
    title: "Contract review pack (not legal advice)",
    summary:
      "Read a contract, NDA, employment or SaaS agreement, flag one-sided terms and suggest edits to discuss with a lawyer.",
    notice: "legal",
    repo: "evolsb/claude-legal-skill",
    commit: "bca0d2e9d5ec81298ddfbfde78fa4f38fb4589b0",
    licence: "MIT",
    base: "",
    skills: [""],
    skipped: [],
  },
  {
    id: "privacy-dpdp",
    title: "Privacy & DPDP pack (not legal advice)",
    summary:
      "India's DPDP Act 2023 and GDPR: consent, records of processing, DPIAs, processor contracts, gap analysis and remediation plans.",
    notice: "legal",
    repo: "mukul975/Privacy-Data-Protection-Skills",
    commit: "9b2ef9eae161c00a17241d42a388571321b33e9f",
    licence: "Apache-2.0",
    base: "skills/privacy",
    skills: [
      "india-dpdp-act",
      "conducting-gdpr-dpia",
      "gdpr-accountability",
      "gdpr-certification-scheme",
      "gdpr-certification",
      "gdpr-codes-of-conduct",
      "gdpr-compliance-audit",
      "gdpr-doc-review",
      "gdpr-dpa-art28",
      "gdpr-dpa-cooperation",
      "gdpr-eu-representative",
      "gdpr-gap-analysis",
      "gdpr-one-stop-shop",
      "gdpr-parental-consent",
      "gdpr-policy-framework",
      "gdpr-prior-consultation",
      "gdpr-remediation-roadmap",
      "gdpr-ropa-audit",
      "gdpr-self-assessment",
      "gdpr-valid-consent",
    ],
    skipped: [
      {
        skill: "(every other privacy law)",
        reason: "Only the India DPDP Act and GDPR subset was picked.",
      },
      {
        skill: "scripts/process.py (in each skill)",
        reason: "Optional helper scripts the instructions never call; not downloaded.",
      },
    ],
  },
  {
    id: "hr-handbook",
    title: "HR handbook pack",
    summary:
      "Hiring, job descriptions, interviews, onboarding and exits, payroll, pay and benefits, policies, engagement and wellbeing.",
    repo: "tuanductran/hr-skills",
    commit: "8b379bdc8c1c896651b9bf2e67b69a14f307fb65",
    licence: "MIT",
    base: "skills",
    skills: [
      "hr-recruiting",
      "hr-job-description",
      "hr-interviewing",
      "hr-reference-checking",
      "hr-offer-management",
      "hr-onboarding",
      "hr-offboarding",
      "hr-payroll",
      "hr-compensation-benefits",
      "hr-salary-benchmarking",
      "hr-time-attendance",
      "hr-policy-management",
      "hr-compliance",
      "hr-performance-review",
      "hr-performance-management",
      "hr-employee-relations",
      "hr-conflict-resolution",
      "hr-employee-engagement",
      "hr-recognition",
      "hr-wellbeing",
      "hr-learning-development",
      "hr-workforce-planning",
      "hr-diversity-inclusion",
      "hr-culture",
    ],
    skipped: [],
  },
];

/** Repo path of a pack skill's folder. */
export function packSkillPath(pack: SkillPack, skill: string): string {
  return [pack.base, skill].filter(Boolean).join("/");
}

/** "invoice-chase" -> "Invoice chase"; the pack title for a repo-root skill. */
export function packSkillTitle(pack: SkillPack, skill: string): string {
  const words = skill.replace(/^hr-/, "").replace(/[-_]+/g, " ").trim();
  if (!words) return pack.title.replace(/\s*\(.*\)$/, "").replace(/ pack$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Source recorded for an installed pack skill: "pack:<pack id>/<skill>". */
export function packSource(packId: string, skill: string): string {
  return `pack:${packId}/${skill}`;
}

export function parsePackSource(source: string): { packId: string; skill: string } | null {
  const match = /^pack:([a-z0-9-]+)\/(.*)$/.exec(source);
  return match ? { packId: match[1] ?? "", skill: match[2] ?? "" } : null;
}

export function skillPackById(id: string): SkillPack | undefined {
  return SKILL_PACKS.find((pack) => pack.id === id);
}

export const PACK_NOTICE_TEXT: Record<SkillPackNotice, string> = {
  legal: "Not legal advice — check with a lawyer before you rely on it.",
};
