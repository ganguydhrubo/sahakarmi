# Marketplace expansion — research, architecture and coverage

Date: 2026-10-25. Release: 0.8.0. Source of truth: `src/shared/agent-catalog/`.

## 1. What was there before

- **Catalogue:** `src/shared/marketplace.ts` listed 12 agents. Each was a name, a role, a
  one-line summary and a short description. Adding one created a coworker and copied the
  description into its "standing remit". The agents carried no workflow, validation,
  approvals or versioning.
- **Runtime:** coworkers already have real tools, so no separate execution engine was needed.
  `agent-service.ts` → `developerInstructions` gives every coworker:
  - **Files:** Shared files and its own folder.
  - **Code and web:** local commands and code, and web access.
  - **Browser:** Sahkarmi's browser (`sahkarmi_browser`), where the owner signs in through takeover.
  - **Approvals:** mandatory `sahkarmi.request_approval` before payments, sending, publishing,
    submitting forms, deleting data and sharing personal data.
  - **Teamwork:** delegation through `list_agents`, `send_message` and `create_coworker`.
  - **Also:** schedules (Run on schedule), long-term memory, and Marketplace skills (playbooks
    in `Shared/Skills`).

## 2. What changed

- **One versioned definition per agent:** `AgentTemplate` in `agent-catalog/types.ts`. Its
  fields are:
  - id, version, name, role, category and summary;
  - job functions (used by search);
  - required and optional inputs;
  - capabilities, each mapped to a real runtime tool, and integrations (via `browser`,
    `files` or `setup`);
  - workflow, outputs and validation rules;
  - approvals, completion criteria and professional limits;
  - Shared folder, availability (`ready` / `needs-setup`) and a featured flag.
- **Standing brief:** `agentBrief()` turns a definition into the coworker's brief. Every agent
  follows the same lifecycle: **UNDERSTAND → COLLECT → PLAN → EXECUTE → VALIDATE → DELIVER**.
  The brief also covers:
  - which tools and services to use, and what to do when a service is missing;
  - which actions need approval;
  - when the work counts as done;
  - the agent's limits.
- **Templates vs installed coworkers:** a coworker added from the Marketplace stores
  `template: { id, version, briefHash }`. This field is optional, and older data stays valid.
  - When a template's version goes up, the Marketplace shows **Update**.
  - If the owner edited the brief (the hash no longer matches), Update asks for confirmation
    first, so customisations are never overwritten silently.
  - Coworkers added before versioning are matched by name and role.
- **Brief size limit:** coworker descriptions now allow up to 4,000 characters (was 2,000) to
  fit full briefs.
- **Marketplace UI** (`MarketplaceView.tsx`), built entirely from the registered definitions:
  - search across name, category, job functions, capabilities and outputs, with multi-word AND;
  - category filters with counts, plus Featured and "On my team";
  - grouped browsing (6 per category with "Show all N"), and pages of 24 when filtered;
  - a details dialog listing what it covers, what it needs, how it works, what it delivers,
    its checks, approvals, services, tools, "done when" and limits;
  - Add, Open, Configure and Update actions, and a "Needs setup" badge.
- **Skills tab:** unchanged.

## 3. Coverage

175 coworkers across 15 categories:

| Category | Agents |
| --- | --- |
| Finance & accounts | 12 |
| Sales & customers | 12 |
| Marketing & growth | 14 |
| Writing & languages | 14 |
| Research & data | 12 |
| HR & hiring | 10 |
| Projects & operations | 12 |
| E-commerce & retail | 14 |
| Software & IT | 15 |
| Design & media | 13 |
| Websites | 11 |
| Legal & compliance | 8 |
| Education & training | 8 |
| Personal productivity | 10 |
| Industry specialists | 10 |

- **Operational (174):** works with built-in tools. Outside services (GST portal, CRMs, Seller
  Central, Gmail, GitHub, GA4 and so on) are used through the owner's own sign-in in Sahkarmi's
  browser, or through exports the owner puts in Shared.
- **Needs setup (1):** `design-image-generation` needs an image-model account or API key. Until
  that is set up it writes image briefs.

Full role-by-role matrices list core tasks, tools and integrations, approvals, status,
acceptance tests, and the roles that were merged or dropped with the reason. They also give
occupational references: O*NET-SOC, and ISCO-08, which NCO-2015 follows.

- [coverage-finance-research.md](coverage-finance-research.md): finance, sales, marketing,
  writing, research
- [coverage-hr-ops-commerce.md](coverage-hr-ops-commerce.md): HR, operations, e-commerce, legal,
  education, productivity
- [coverage-eng-design-web-industry.md](coverage-eng-design-web-industry.md): software, design,
  websites, industry. Includes the Software Engineering Team protocol: one plan file, owned
  paths, evidence for every subtask, and deployment only after approval.

## 4. The original 12, refined

The ids, names, roles and avatars stay the same, so existing coworkers still match. Each one
moved to version 2 and gained:
- inputs;
- a workflow, for example GST 2B reconciliation, ageing buckets, or reorder-point maths;
- validation checks;
- approvals and completion criteria;
- limits, where the work is regulated.

## 5. Approval and autonomy

- Each agent's approvals list names its real external or irreversible actions.
- The runtime rule in `developerInstructions` still applies on top of that: approval first,
  then STOP, and never work around a rejection.
- Logins, OTP/2FA and CAPTCHAs go through `request_browser_takeover`: automation pauses while
  the owner is in control, and the work resumes when the owner hands back.
- Legal, tax, payroll and healthcare agents say they are assistants, not licensed professionals.

## 6. What still needs outside setup

- An image-generation model account, for `design-image-generation`.
- **Direct API integrations:** Tally ODBC, GST API (GSP), Zoho / HubSpot / Shopify APIs,
  Google Ads API and Search Console API. None exist yet. Agents use the browser and exports
  instead, so these are improvements, not blockers.
- **Deeper delegation:** multi-agent work runs over the existing `create_coworker` /
  `send_message` tools. There is no separate scheduler for parallel sub-agents.

## 7. Verification

Recorded in the release notes and CHANGELOG 0.8.0: lint, typecheck, unit tests, the
Marketplace UI test (add, template stored, search, details dialog, "On my team"), the
catalogue integrity script (unique ids, field counts, brief lengths) and the production build.
