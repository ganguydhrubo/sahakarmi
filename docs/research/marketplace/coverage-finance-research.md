# Marketplace coverage: finance, sales, marketing, writing, research

Date: 2026-10-25. Source of truth: `src/shared/agent-catalog/{finance,sales,marketing,writing,research}.ts`
(57 new coworkers) plus the 12 originals in `existing.ts`.

**Status key.** *Operational* = works today with Sahkarmi's built-in tools: Shared files, local
code/commands, web research, and Sahkarmi's browser with the owner signing in via takeover.
*Needs setup* = an outside API connection must be configured first. None of the 57 agents need
one: every outside service is used through the owner's own browser login or through exports in
Shared. So every row below is Operational. Where a service is optional (a CRM, Google Ads,
EPFO), the agent finishes the file-based part and says exactly what is missing.

**Occupational references.** Codes are from O\*NET-SOC 2019 (US) and ISCO-08 unit groups. India's
NCO-2015 is aligned to ISCO-08 at the unit-group level, so the ISCO 4-digit groups below also
match the NCO-2015 unit groups. These codes describe the occupations; the agents cover the
computer-based tasks of those occupations and never the licensed or signing duties.

---

## Finance

**What this work is.** Recording transactions, processing supplier and sales invoices, reconciling
bank and party ledgers, producing management reports, budgeting, running payroll calculations,
and organising tax paperwork. For an Indian small business this means Tally or Zoho Books exports,
GST invoices and e-invoice / e-way bill data, TDS sections, PF/ESI/PT, and Form 16 / 26AS / AIS.
References: O\*NET 43-3031.00 Bookkeeping, Accounting & Auditing Clerks; 43-3021.00 Billing &
Posting Clerks; 43-3051.00 Payroll & Timekeeping Clerks; 43-3061.00 Procurement Clerks;
13-2031.00 Budget Analysts; 13-2082.00 Tax Preparers. ISCO-08 / NCO-2015: 4311 Accounting &
bookkeeping clerks, 4313 Payroll clerks, 3313 Accounting associate professionals, 4132 Data
entry clerks, 3323 Buyers.

| Role (and merged titles) | Agent id | Core computer tasks | Tools / integrations | Approvals | Status | Acceptance test |
|---|---|---|---|---|---|---|
| Bookkeeper + Financial Data Entry | `bookkeeper` | OCR bills and statements, classify to ledgers, build import-ready vouchers, find duplicates | files, spreadsheets, documents, code; Tally / Zoho Books (files) | posting into live books; deleting entries | Operational | Given 20 mixed bills and a bank CSV, every voucher balances (Dr = Cr) and sheet totals equal source totals |
| Accounts Payable + Invoice Processing | `accounts-payable` | Capture supplier invoices, 3-way match to PO/GRN, note TDS and MSME 45-day dues, propose a payment run | files, spreadsheets, documents, code, schedule; Tally/Zoho (files), inbox (browser, read) | any payment; supplier disputes; marking approved | Operational | An invoice with a rate above its PO shows up as an exception and is left out of the payment schedule |
| Invoice Processing (sales side) / AR invoicing | `sales-invoicing` | Raise GST invoices and credit notes, CGST+SGST vs IGST, e-invoice / e-way bill upload files | files, documents, spreadsheets, browser; IRP and e-way bill portals (browser), Tally/Zoho (files) | IRN / e-way bill generation; sending; cancelling | Operational | An inter-state order gets IGST, and the invoice series has no gaps |
| Reconciliation (bank / ledger) | `bank-reconciliation` | Match bank, UPI and Razorpay/PayU settlements to the books, list reconciling items, suggest JEs | files, spreadsheets, code; bank/gateway dashboards (browser, read), Tally/Zoho (files) | posting adjusting entries | Operational | Book balance plus reconciling items equals the bank closing balance exactly |
| Financial Reporting (MIS, P&L) | `mis-reporting` | Map TB to MIS heads, variances against last month, last year and budget, ratios, notes, charts | files, spreadsheets, documents, code, schedule; Tally/Zoho (files) | sharing outside the owner | Operational | MIS revenue and net profit tie to the trial balance to the rupee |
| Expense Management | `expense-manager` | Read receipts, check claims against policy, decide each line, reimbursement list, ITC note | files, spreadsheets, documents, code, schedule | paying; rejecting on record; messaging staff | Operational | A duplicate receipt in two claims is rejected once with the policy reason cited |
| Budgeting / forecasting | `budget-forecaster` | Assumption-driven budget, 13-week cash forecast, scenarios, break-even | files, spreadsheets, code, documents; Tally/Zoho (files) | none (no external action) | Operational | Changing one assumption cell (for example sales growth) updates the budget and cash forecast with no #REF errors |
| Payroll Operations (PF/ESI/TDS working) | `payroll-operations` | Gross-to-net, PF/ESI/PT/TDS working, ECR and ESI files, bank sheet, payslips, month-on-month explanation | files, spreadsheets, documents, code, schedule; EPFO/ESIC (browser), attendance (files) | ECR/ESI upload; any salary payment; sending payslips | Operational | For each employee, net = gross − deductions, and the ECR total equals the register PF total |
| Tax Document Organizer (ITR, Form 16, 26AS/AIS) | `itr-document-organizer` | Checklist, download 26AS/AIS/TIS, match against Form 16 and certificates, mismatch list, indexed folder | files, documents, spreadsheets, browser; Income Tax e-filing portal (browser, read) | AIS feedback; filing/verifying; sharing | Operational | Every AIS income line is matched to a document or appears on the mismatch list |
| Procurement Documentation | `procurement-documentation` | Normalise quotes to landed cost, comparative statement, GSTIN/KYC check, draft PO, purchase file | files, documents, spreadsheets, web-research, browser; IndiaMART/TradeIndia (browser) | sending enquiries/PO; committing to a purchase | Operational | The comparative statement includes GST and freight per quote, and PO terms equal the chosen quote |

Accounts Receivable collections stay with the existing `payment-reminders`; GST returns stay
with `gst-accountant`. `limits` are set on AP (TDS), sales invoicing (e-invoice applicability),
budgeting (not advice), payroll and the tax organizer.

## Sales

**What this work is.** Finding and qualifying prospects, keeping the CRM accurate, analysing the
pipeline, writing quotations and decks, onboarding new customers, keeping key accounts healthy,
and turning feedback and support queues into action. Indian specifics: IndiaMART / JustDial
enquiries, WhatsApp-first contact, GST on quotations, +91 phone hygiene. References: O\*NET
41-4012.00 Sales Representatives, Wholesale & Manufacturing; 41-3091.00 Sales Representatives of
Services; 11-2022.00 Sales Managers; 43-4051.00 Customer Service Representatives; 13-1161.00
Market Research Analysts & Marketing Specialists. ISCO-08 / NCO-2015: 3322 Commercial sales
representatives, 2433 Technical & medical sales professionals, 4222 Contact centre information
clerks, 1221 Sales & marketing managers.

| Role (and merged titles) | Agent id | Core computer tasks | Tools / integrations | Approvals | Status | Acceptance test |
|---|---|---|---|---|---|---|
| SDR / Lead Research | `lead-researcher` | Build ICP queries, collect businesses from directories and maps with sources, score fit, draft first messages | web-research, browser, spreadsheets, files; LinkedIn, IndiaMART, Google Maps, JustDial (browser) | sending messages or connection requests; buying lists | Operational | Asked for 30 leads, returns 30 unique, sourced rows with no existing customers, or explains the shortfall |
| Lead Qualification | `lead-qualifier` | Extract need, quantity, location and timeline, score hot/warm/cold, draft next reply, hand off hot leads | files, spreadsheets, browser, schedule; IndiaMART Lead Manager, CRM (browser) | sending replies; changing CRM stages | Operational | Every enquiry in the export has a label and a one-line reason; a spam enquiry is labelled spam |
| CRM Administrator | `crm-administrator` | Profile fields, dedupe by phone/email/GSTIN/fuzzy name, flag stale deals, cleaned import file and change log | files, spreadsheets, code, browser, schedule; Zoho CRM, HubSpot, Salesforce, LeadSquared (browser) | import/merge/delete; reassigning | Operational | Records before = records after + merged duplicates, and every change is in the log |
| Sales Ops / RevOps Analyst | `sales-ops-analyst` | Pipeline by stage and age, conversion, cycle time, forecast, target vs actual, incentive working | files, spreadsheets, code, documents, schedule; CRM / Tally exports (files) | sharing performance with the team | Operational | Pipeline value in the review equals the sum of open deals in the export |
| Account Management + Customer Success | `account-manager` | Health scores, churn and renewal flags, upsell from look-alike customers, account reviews, check-in drafts | files, spreadsheets, documents, browser, schedule, delegation; WhatsApp/email (browser) | messaging customers; discounts or contract changes | Operational | A customer whose orders stopped 90 days ago is flagged at-risk with the order data cited |
| Proposal & Quotation Writer | `proposal-quotation-writer` | Line-by-line pricing, GST by HSN/SAC, terms, amount in words, margin floor check | files, documents, spreadsheets | sending; quoting below margin floor | Operational | Totals and GST recompute correctly, and the amount in words equals the figure |
| Sales Presentation Builder | `sales-deck-builder` | Research the customer, outline, write slides and notes, build PPTX, one-page leave-behind | files, documents, web-research, images, code | sending the deck | Operational | The PPTX opens, has 8–12 slides, and every number traces to owner material or a cited source |
| Customer Onboarding | `customer-onboarding` | Per-customer checklist, welcome and document-request drafts, document checks, scheduled check-ins | files, documents, spreadsheets, schedule, delegation, browser; WhatsApp/email (browser) | messaging; activating services | Operational | Every checklist step has an owner and date, and an inactive GSTIN is flagged |
| Customer Feedback Analyst | `customer-feedback-analyst` | Collect and dedupe reviews/surveys/complaints, theme and sentiment tagging (incl. Hinglish), trends, fix list | files, spreadsheets, code, documents, browser; Google Business Profile, marketplace reviews (browser, read) | public replies | Operational | Theme counts add up to the total number of items, and each quote is verbatim with its source |
| Support Ticket Triage | `support-ticket-triage` | Categorise and prioritise the whole queue, SLA timers in IST, routing, spike detection | files, spreadsheets, browser, schedule, delegation; Freshdesk, Zoho Desk, Gmail, WhatsApp Business (browser) | closing/merging/reassigning; replying | Operational | No open ticket is left untriaged, and a ticket past its SLA appears on the risk list |

Replying to individual tickets stays with the existing `customer-support`, and follow-ups with
`sales-follow-up`.

## Marketing

**What this work is.** Planning and publishing content, getting found in search, running and
measuring paid campaigns, email and WhatsApp campaigns, managing community and reviews, finding
creators, positioning against competitors, writing copy, improving landing pages, and measuring
channels end to end. Indian specifics: festival calendars, Hindi/Hinglish copy, ASCI influencer
disclosure, Google Business Profile for local search, WhatsApp as a channel. References: O\*NET
11-2021.00 Marketing Managers; 13-1161.00 Market Research Analysts & Marketing Specialists;
13-1161.01 Search Marketing Strategists; 27-3031.00 Public Relations Specialists; 27-3043.00
Writers & Authors (copywriters). ISCO-08 / NCO-2015: 2431 Advertising & marketing professionals,
2432 Public relations professionals, 2120 Mathematicians, actuaries & statisticians (analytics work, partially).

| Role (and merged titles) | Agent id | Core computer tasks | Tools / integrations | Approvals | Status | Acceptance test |
|---|---|---|---|---|---|---|
| Social Media Manager (publishing + inbox) | `social-media-manager` | Check approved posts, publish/schedule on own accounts, handle comments and DMs from FAQs, weekly insights | browser, files, spreadsheets, schedule, delegation; Meta Business Suite, LinkedIn, YouTube Studio, X (browser) | publishing; replying; hiding/deleting; boosting | Operational | Each published post has a live URL on the intended account, and report numbers match platform insights |
| Content Strategist | `content-strategist` | Personas, content audit, pillars, quarterly calendar, briefs handed to writer coworkers | web-research, files, spreadsheets, documents, delegation | assigning work outside the team | Operational | Every calendar item maps to a pillar, persona and goal, and the volume fits stated capacity |
| SEO Specialist + Keyword Research | `seo-specialist` | Keyword list (GSC, suggestions, competitors, Hindi/near-me), intent groups, page map, on-page rewrites | web-research, browser, spreadsheets, files, documents; Search Console, GBP, Keyword Planner (browser) | changing live pages; editing GBP | Operational | No two pages target the same keyword group, and titles stay under about 60 characters |
| Technical SEO Analyst | `technical-seo-analyst` | Polite local crawl, robots/sitemap/coverage, Core Web Vitals, schema validation, ranked fix list | code, browser, web-research, spreadsheets, files; Search Console, PageSpeed Insights (browser) | site changes; removals in GSC | Operational | A known broken link on the test site appears in the report with its source page |
| Paid Ads / Google Ads Specialist (+ Meta ads) | `paid-ads-specialist` | Tracking and UTMs, campaign structure, keywords/negatives or audiences, ad copy within limits, draft campaigns | browser, web-research, spreadsheets, files, images; Google Ads, Meta Ads Manager (browser) | launching; budget/bid increases; payment methods | Operational | Draft daily budgets add up to the approved monthly INR budget, and nothing is live before approval |
| Ads Performance Analyst / Campaign Reporting | `ads-performance-analyst` | Pull spend and conversions, CTR/CPC/CPL/ROAS vs target, search terms, CRM lead quality, action list | browser, files, spreadsheets, code, schedule; Google Ads, Meta (browser), CRM (files) | applying account changes | Operational | Reported spend equals platform billing for the same dates |
| Email Marketing & Automation (+ WhatsApp broadcast) | `email-marketing` | Consent-based list cleaning, segments, subject A/B, sequences, test sends, results | files, spreadsheets, documents, browser, schedule; Mailchimp, Brevo, Zoho Campaigns, WhatsApp Business (browser) | sending; enabling automations; importing contacts | Operational | No unsubscribed or no-consent contact is in any send segment |
| Community Manager (+ reviews / reputation) | `community-manager` | Sort reviews and group messages, reply drafts, moderation log, review requests, rating trend | browser, files, spreadsheets, schedule; GBP, WhatsApp Communities, Facebook Groups (browser) | posting replies; removing members/posts; review requests | Operational | No public reply contains private order details, and review requests offer no reward for ratings |
| Influencer Research | `influencer-researcher` | Find creators by niche, city and language, recent-post engagement, warning signs, outreach and ASCI-compliant brief | web-research, browser, spreadsheets, files, documents; Instagram, YouTube (browser, public) | contacting creators; agreeing fees | Operational | Every shortlisted creator has a working profile link and dated engagement figures |
| Brand & Competitor Research | `brand-competitor-research` | Collect promises, prices, ads (Meta Ad Library), review themes, messaging grid, positioning lines | web-research, browser, files, documents, spreadsheets, images; Meta Ad Library, Google Ads Transparency (browser) | none (public research only) | Operational | Every competitor claim in the grid has a dated link or screenshot |
| Marketing Copywriter | `marketing-copywriter` | Main message, three angles, format adaptation within limits, claims check | files, documents, web-research | none (drafts only) | Operational | Each format's copy fits its length limit, and any "best/No. 1" claim has proof or is flagged |
| Landing Page Optimization | `landing-page-optimizer` | Mobile/desktop audit, analytics and recordings, rewrite with mock-up, A/B test plan | browser, web-research, documents, code, files, images; GA4, Microsoft Clarity (browser) | publishing page changes; starting live tests | Operational | Each recommendation cites an observed problem (screenshot or metric) |
| Marketing Analytics | `marketing-analytics` | Tracking checks, GA4 by channel and landing page, CRM join, monthly dashboard, insights | browser, files, spreadsheets, code, schedule; GA4, GSC (browser), ads/CRM exports (files) | changing GA4 or tag settings | Operational | Channel totals equal GA4 totals for the same date range, and the CRM match rate is stated |

Post writing stays with the existing `social-media-writer`; `social-media-manager` publishes and
handles the inbox.

## Writing

**What this work is.** Producing and improving text: articles, edits, books, documentation,
reports, correspondence, bids, resumes, slides, localized strings and transcripts, plus keeping
a house style consistent. Indian specifics: GeM / CPPP / state e-procurement bids, KDP and Indian
self-publishing platforms, Indian English and lakh/crore conventions, Indian-language
localization. References: O\*NET 27-3043.00 Writers & Authors; 27-3041.00 Editors; 27-3042.00
Technical Writers; 27-3091.00 Interpreters & Translators; 43-9022.00 Word Processors & Typists.
ISCO-08 / NCO-2015: 2641 Authors & related writers, 2642 Journalists (editors), 2643 Translators,
interpreters & other linguists, 4131 Typists & word processing operators.

| Role (and merged titles) | Agent id | Core computer tasks | Tools / integrations | Approvals | Status | Acceptance test |
|---|---|---|---|---|---|---|
| General Content Writer | `content-writer` | Research with sources, outline, draft in brand voice, title/meta, source list | web-research, files, documents | publishing | Operational | A 1,200-word brief produces 1,080–1,320 words with every figure sourced |
| Proofreader / Copyeditor | `proofreader-copyeditor` | Proofread or copyedit with tracked changes, author queries, clean copy | files, documents, code | none | Operational | No figure or name changes between the original and the clean copy (script diff of numbers and names) |
| Manuscript Editor & Book Publishing Coordinator (KDP) | `manuscript-editor` | Editorial letter, copyedit, front/back matter, EPUB and print PDF, listing sheet | files, documents, code, web-research, browser, images; Amazon KDP, Pothi, Notion Press (browser) | submitting/publishing; pricing; buying ISBNs | Operational | The EPUB passes EPUBCheck and the print PDF's page size equals the chosen trim |
| Citation & Reference Checker | `citation-checker` | Two-way citation match, DOI/Scholar lookup, claim spot-checks, restyle references | web-research, files, documents, code | none | Operational | A planted fake reference is flagged as unverifiable, not "fixed" |
| Technical Writer / Documentation | `technical-writer` | Learn the product, task-based outline, numbered steps, test procedures | files, documents, code, browser, images | publishing to a public site | Operational | Each procedure is marked tested or untested, and tested ones run end to end |
| Business Report Writer (incl. bank DPR) | `business-report-writer` | Structure for the reader, figures/tables/charts, executive summary, appendix of sources | files, documents, spreadsheets, code, delegation | sending outside the business | Operational | Every figure in the summary appears with the same value in the body and source data |
| Email Drafting | `email-drafter` | Read the thread, draft with the ask first, variants, save as draft in mail | files, documents, browser; Gmail/Outlook (browser) | sending | Operational | The draft answers every question in the thread and is saved unsent |
| Proposal & Tender Writer (GeM / e-tenders) | `tender-proposal-writer` | Extract dates/EMD/eligibility, compliance matrix, technical bid drafts, missing-docs and pre-bid queries | files, documents, spreadsheets, browser, web-research; GeM, CPPP, state portals (browser) | upload/submit; EMD/fees; pre-bid queries | Operational | Dates are taken from the latest corrigendum, and every eligibility clause has a status |
| Resume & Cover Letter Writer | `resume-writer` | JD keyword extraction, achievement bullets from real facts, ATS layout, cover letter | files, documents, web-research | applying / sending | Operational | Every resume claim maps to something in the person's input (nothing invented) |
| Presentation Content Writer | `presentation-writer` | Storyline, headline-sentence slides, timed speaker notes, optional PPTX | files, documents, code, images | none | Operational | A 10-minute slot gives about 10 slides, each headline a full statement |
| Localization Specialist | `localization-specialist` | Extract strings, glossary, translate with Indian formats, rebuild files, placeholder/encoding checks | files, documents, code, spreadsheets | none | Operational | Every source key exists in each target file, and all `{placeholders}` match |
| Transcript Cleanup (+ subtitles) | `transcript-cleanup` | Optional local transcription, speaker labels, clean verbatim, SRT/VTT, highlights | files, documents, code | none | Operational | SRT cues are in time order and none ends after the media length |
| Editorial Consistency Reviewer | `editorial-consistency` | Draft/load house style, scripted term/number/date scans, sample tone review, per-document report | files, documents, code, web-research | none | Operational | Every reported issue cites document and line, and the guide has no contradicting rules |

Translation between English, Hindi and Bengali stays with the existing `translator`;
`localization-specialist` covers string files and the other Indian languages. A `limits` note
on localization asks for native review of customer-facing and legal text; the tender writer
leaves DSC signing and submission to the owner.

## Research

**What this work is.** Finding, collecting, cleaning and analysing information, and turning it
into dashboards, recurring reports, comparisons and reusable knowledge. Indian specifics:
official sources (MoSPI, RBI, Census, ministries, associations), DD/MM/YYYY and ₹ formats,
GSTIN/PIN validation, Google Sheets as the default "BI tool" for many small firms. References:
O\*NET 13-1161.00 Market Research Analysts; 15-2051.00 Data Scientists; 15-2051.01 Business
Intelligence Analysts; 15-2041.00 Statisticians; 43-9111.00 Statistical Assistants; 43-9021.00
Data Entry Keyers. ISCO-08 / NCO-2015: 2120 Mathematicians, actuaries & statisticians, 2511
Systems analysts, 3314 Statistical, mathematical & related associate professionals, 4312
Statistical, finance & insurance clerks.

| Role (and merged titles) | Agent id | Core computer tasks | Tools / integrations | Approvals | Status | Acceptance test |
|---|---|---|---|---|---|---|
| Market Research (sizing, demand, pricing) | `market-sizing-analyst` | Segment definition, top-down + bottom-up model, official-source inputs, price points, range result | web-research, files, spreadsheets, documents, code | none | Operational | Every model input cell has a source and date or an "assumption" label, and the result is a range |
| Web Research Assistant | `web-research-assistant` | Find facts and documents, official sources first, quote + URL + date, download key files | web-research, browser, files, documents | none | Operational | Each answer's link, when opened, contains the quoted text; unknowns say "not found" |
| Competitor Intelligence | `competitor-intelligence` | Watch list, scheduled snapshots, before/after change log, digest, battlecards | web-research, browser, code, spreadsheets, files, schedule | none (public pages only) | Operational | A price change on a watched page appears in the next digest with before, after and link |
| Data Collection | `data-collector` | Respect terms/robots, extraction script, PDF tables, source URL and date per row, sample check | web-research, browser, code, spreadsheets, files, schedule | members-only logins; paid data | Operational | A random 10-row sample matches the source pages exactly |
| Data Cleaning | `data-cleaner` | Column profiling, standardise dates/₹/phones/states/GSTIN/PIN, dedupe, change log, original preserved | files, spreadsheets, code | none | Operational | Original row count = clean rows + removed duplicates, and the original file hash is unchanged |
| Spreadsheet / Excel / Google Sheets Analyst | `spreadsheet-analyst` | Live formulas and pivots in new sheets, charts, plain-words answer, refresh notes | files, spreadsheets, code, browser; Google Sheets (browser) | overwriting the original sheet | Operational | The workbook recalculates with zero formula errors and totals equal the raw data |
| BI / Dashboard Builder + Data Visualization | `dashboard-builder` | KPI definitions, tidy data model, chart choice, dashboard in Excel/Sheets/Looker Studio/HTML, refresh guide | files, spreadsheets, code, browser, images; Looker Studio, Google Sheets (browser) | sharing outside the business | Operational | Each KPI tile equals a hand calculation, and the dashboard refreshes from a new export |
| Survey Analysis | `survey-analyst` | Neutral questionnaire drafts, response cleaning, cross-tabs, open-answer coding, findings with n | files, spreadsheets, code, documents, browser; Google Forms, Typeform, SurveyMonkey (browser) | sending the survey; publishing results | Operational | Every percentage shows its base (n), and segments with small samples are flagged |
| Report Generation | `report-generator` | Map the example report, script fills Excel/PDF template, threshold highlights, scheduled runs | files, spreadsheets, documents, code, schedule, delegation | sending the report | Operational | The first run matches a manual calculation, and a missing export stops the run with a message |
| Document Comparison (reports, price lists, specs, data) | `document-comparer` | Extract text/tables, key-column row diff with % change, text redline, change summary | files, documents, code, spreadsheets | none | Operational | Unchanged + changed + added + removed rows equal the row counts of both versions |
| Knowledge Base Builder | `knowledge-base-builder` | Inventory sources, structure, cited topic pages, FAQ pages, index, conflict list | files, documents, code, browser, delegation; Notion, Google Sites (browser, optional) | publishing outside Shared; deleting sources | Operational | Every page cites at least one source file, and every index link resolves |

Open-ended business questions stay with the existing `research-analyst`.

---

## Consolidated, merged or dropped roles

- **Financial Data Entry → `bookkeeper`.** Same workflow (read documents, key entries, check
  duplicates). Titles kept in `jobFunctions`.
- **Invoice Processing → split by direction.** Supplier-invoice processing is part of
  `accounts-payable` (capture + match is the AP workflow). Sales-side invoicing is its own agent,
  `sales-invoicing`, because raising GST invoices / IRN / e-way bills is a different workflow from
  collections.
- **Accounts Receivable** is not a new agent. Collections remain `payment-reminders`;
  invoicing is `sales-invoicing`; customer-ledger reconciliation is in `bank-reconciliation`.
- **Customer Success → `account-manager`.** Account management and customer success share the
  same loop (health, renewals, upsell, reviews) for small Indian businesses; both titles are in
  `jobFunctions`.
- **Support Ticket Triage** is its own agent (queue-level sorting, SLA, routing). Per-message
  reply drafting stays in the existing `customer-support`.
- **Paid Ads / Google Ads + Meta ads → `paid-ads-specialist`.** Building campaigns is the same
  workflow on either platform. Reporting is split out (`ads-performance-analyst`) because it is
  a recurring read-only job that different people do.
- **Community Manager** covers reviews / online reputation and WhatsApp/Facebook groups. Brand
  page comments and DMs belong to `social-media-manager`, to avoid two agents replying in the
  same inbox.
- **Keyword Research → `seo-specialist`.**
- **Data Visualization → `dashboard-builder`.** Choosing and building charts is the core of
  dashboard work; one agent avoids two near-identical briefs.
- **Market Research** in this list became `market-sizing-analyst` (sizing, demand, pricing). The
  general "answer a business question with sources" job is already the existing
  `research-analyst`.

## Overlaps with other categories (for the catalogue owner)

The other category files were written in parallel. Ids do not collide, but these pairs are
close, and search may show both:

- `document-comparer` (research) vs `document-comparison` (legal). To keep them apart, the
  research agent was narrowed to reports, price lists, spec sheets and datasets, and it points
  contracts and policies to the legal agent.
- `customer-feedback-analyst` (sales) vs `customer-review-analyst` (ecommerce): the sales agent
  covers all feedback sources (surveys, complaints, Google reviews); the ecommerce one is about
  marketplace reviews.
- `procurement-documentation` (finance) vs `procurement-research` (operations): finance covers
  the paperwork (comparative statement, PO, purchase file); operations covers finding suppliers.
- `expense-manager` (finance) vs `expense-documentation` (productivity): finance checks staff
  claims against policy; productivity is personal receipt-keeping.
- `knowledge-base-builder` (research) vs `knowledge-base-search` (education).

`src/shared/agent-catalog/index.ts` still lists only `EXISTING_AGENTS`; the new arrays still have
to be added to `AGENT_CATALOG` there.
