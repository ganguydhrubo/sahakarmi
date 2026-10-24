# Sahkarmi — ICPs, growth channels and 30-day plan (research, 2026-10-24)

Research date: 2026-10-24. "Verified" = read on a primary/official page or API that day. "Secondary" = press/trackers. "Hypothesis" = inference, not evidence. Nothing here is a claim of adoption; it is research to decide where to spend effort.

## 0. Ground truth about the product as the market sees it (verified 2026-10-24)

| Fact | Source |
|---|---|
| Repo created 2026-10-19; 0 stars, 0 forks; Discussions disabled; Apache-2.0; topics include ai-agents, hindi-ai, india, local-first | GitHub API `repos/ganguydhrubo/sahakarmi` |
| Four releases published on 2026-10-24 within ~95 minutes (v0.6.1 → v0.7.1). Asset download counts single digits (v0.7.1 x64.exe: 2, dmg: 1, AppImage: 1) | GitHub API `/releases` |
| README: no badges, no demo GIF, no Install/Quick-start section (setup is under "Development"), no roadmap/FAQ/comparison, no Discussions link. No Ollama / local-model / OpenAI-compatible endpoint support mentioned | raw README.md |
| Website: `winget install Sahkarmi.Sahkarmi` advertised; the winget PR microsoft/winget-pkgs#458967 (v0.5.6) is still **awaiting moderator approval** since 2026-10-22, so the command does not work yet and is two minor versions behind. Windows installer unsigned (SmartScreen). Page says approvals rely on the AI following instructions | sahkarmi.site, github.com/microsoft/winget-pkgs/pull/458967 |

Implication: fix repo presentation and version/winget inconsistencies before any channel push; HN and Reddit readers find these within minutes.

## 1. Ranked ICP table (for open-source adoption in the next 90 days, zero budget)

| # | Segment | Primary use case | Pain point | Reason to try | Adoption barrier | Geo | Best channel | Proposed message | Evidence | Confidence | Experiment |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Developers already paying for Claude Code / Codex / Antigravity | Reuse existing CLI logins for non-coding ops work with approvals | Siloed subscriptions; tools are terminal/IDE-bound | Free, Apache-2.0, reuses logins; browser Take over; approvals | Trust in an unsigned Electron wrapper; provider ToS on third-party reuse unknown; HN skews macOS | Global (US/EU/AU/India) | Show HN; r/ClaudeAI; X; dev.to | "You already pay for Claude Code or Codex. Give those logins a team of coworkers with a browser, memory, schedules and approvals. Free, open source, local." | SO 2025: 47.1% of devs use AI tools daily; agent users: Claude Code 40.8%, ChatGPT 81.7%, Gemini 47.4% (survey.stackoverflow.co/2025/ai). Eigent (same pitch, Apache-2.0) 15,650 stars in ~15 months (GitHub API) | High demand / Medium fit | Show HN with an honest first comment; measure stars + issues in 72 h |
| 2 | AI enthusiasts / early adopters | Try a multi-agent team on their own PC with free models, no signup | Hosted agents cost money, need accounts, send data to cloud | Zero-login free models; local-first; Windows build (most peers are mac-first) | SmartScreen; "development preview"; Electron scepticism; "for Indian businesses" narrows global appeal | Global | HN, r/SideProject, r/artificial, X, YouTube | "An open-source AI team for your PC. No account, no card, your data stays local." | Jan 45,052★, AnythingLLM 67,497★, Cherry Studio 52,928★, Open WebUI 156,607★ (GitHub API). Pew Feb 2026: 24% of US adults use chatbots daily | High | 60-second GIF post; A/B global vs India-first headline on different days |
| 3 | Open-source contributors / maintainers (esp. India) | i18n, coworker templates, provider adapters | Want meaningful, visible-result projects | Has CONTRIBUTING, CoC, SECURITY; TypeScript/SolidJS approachable; i18n is a low-barrier surface | 0 stars; no Discussions; no `good first issue`; four same-day releases look unstable | India, then global | `good-first-issue`, FOSS United forum and chapters | "Help build India's open-source AI coworker: add your language, add a coworker template." | Octoverse 2025: India 21.9M devs, +5.2M in a year, largest OSS contributor base; only 5.5% of repos have contributor guides (github.blog) | High | 10 labelled good-first-issues; FOSS United forum post; measure external PRs in 30 days |
| 4 | Indie developers / freelancers | Invoicing follow-ups, lead research, content drafts | Solo operators drowning in admin | Accounts/Sales/Content coworkers map to freelancer admin; free | Desktop-only; GST/INR focus; trust in autonomous actions | India, global | r/SideProject, Indie Hackers, Peerlist Launchpad | "Your first hires are free: an accounts, sales and content coworker on your own PC." | No official freelancer census; Redseer Jul 2026: 6M+ monthly-active gig workers (secondary) | Medium | Peerlist + Indie Hackers posts; track release download counts |
| 5 | Startup founders / small technical teams (India) | Research, support drafts, reports, approvals inbox | Can't hire ops; fear agents acting unsupervised | Approval gate; team metaphor; free | Single-machine; unsigned installer in company context | India, SEA | r/IndianStartups, LinkedIn, Peerlist, Product Hunt | "An approvals-first AI team for lean startups: nothing gets paid or sent without you." | 2.23 lakh DPIIT-recognised startups (2026-03-31, secondary) | Medium | Product Hunt + LinkedIn founder post with a GST demo |
| 6 | Students & technical learners (India) | Learn agents hands-on; college projects | Want free tools, Hindi/Bengali UI; low-spec Windows laptops | Free models, no card, Hindi/Bengali UI, open code | Electron RAM on low-end laptops (publish numbers); low household PC ownership | India, SEA | Hindi YouTube, GDG on Campus, college FOSS clubs | "Build and run your own AI team. Free, in Hindi/Bengali, open source." | AISHE 2023-24: 4.50 crore enrolled (secondary); SO 2025: 44% use AI to learn | Medium | One Hindi walkthrough video + a GDG on Campus demo |
| 7 | Technical educators & AI communities | Demo agents with guardrails | Need a free, inspectable demo app | Multilingual, local, open; Take over browser is a teachable safety pattern | Preview stability; no docs site | Global; India; Japan | HF Discord, FOSS United, GDG DevFest, OSS Summit Japan (Dec 7–9, 2026) | "A teachable, open-source agent team: approvals, memory, take-over browser." | HF Discord ~226K (secondary) | Medium-Low | One dev.to tutorial + a lightning talk |
| 8 | Indian MSMEs / traders / D2C sellers | GST paperwork, invoices, follow-ups, supplier research | Compliance load; staff cost; English-only tools | Hindi/Bengali UI, INR/lakh-crore, GST conventions, free, local | ~7% household PC ownership; unsigned installer; "AI coworker" abstraction; no Tally/WhatsApp integration; approvals not hard-enforced | India (tier-1/2), Bangladesh | Hindi GST/Tally YouTube, CA influencers, WhatsApp groups, trade associations (not Reddit) | "Hindi mein kaam karne wali AI team: GST, invoices, follow-ups. Free. Aapke computer par." | Udyam 8.84 crore registrations (2026-06-30, Rajya Sabha reply, secondary); GST taxpayers 1.65 crore (secondary); Windows 82.3% of India desktop (StatCounter Sep 2026, verified); wired broadband 47.7M of 1,087M subscribers (TRAI Jun 2026) | High market size / Low near-term fit | 2–3 Hindi GST/Tally YouTubers; measure .exe downloads for 7 days after |
| 9 | Researchers & local-model enthusiasts | Agents on local models | Want Ollama/llama.cpp endpoints | Local-first shell, open code | No documented local-model support; r/LocalLLaMA self-promo rule tightened | Global | r/LocalLLaMA (only after local models ship) | (later) "Your AI team, fully offline with Ollama." | Ollama 184,509★; 51.1% of agent developers use Ollama (SO 2025) | Low fit | Do not post until local models work |
| 10 | Non-technical users | Chat-driven tasks with an approvals inbox | Chatbots don't act; agents feel unsafe | Named coworkers, approvals, three languages | Installer friction, SmartScreen, no onboarding video | Global, India | YouTube, WhatsApp forwards, LinkedIn | "Tell it in your language. It asks before it pays or sends." | Pew Feb 2026 (secondary) | Low-Medium | Defer; learn from segments 2 and 8 first |

## 2. Initial free-user ICP vs future potential paying customers

Initial free-user ICP (next 90 days):
1. Developers with Claude Code / Codex / Antigravity logins (global).
2. AI enthusiasts wanting a free, no-login, local-first agent desktop on Windows.
3. Indian OSS contributors who can own i18n, templates and docs.
4. Indian indie developers and freelancers.

Future potential paying customers (research only; not a current goal): Indian MSMEs with a CA and a Windows PC running Tally; D2C / marketplace sellers; startups needing shared coworkers across machines; CA firms and system integrators. The repo topic `enterprise-ai` is not supported by the product today and reads as noise.

## 3. Channel table

| Channel | Rules / norms | Fit | Realistic outcome |
|---|---|---|---|
| GitHub repo presentation | opensource.guide: one home URL, clear message, help first, expect months | Core. Badges, GIF at top, Install → Quick start → Providers → Approvals, roadmap, FAQ, compare table, enable Discussions, 10 good-first-issues, explicit telemetry statement | Necessary condition; stars come from the channels below |
| Show HN | Must be tryable; author present; no vote solicitation; title "Show HN:" (news.ycombinator.com/showhn.html, verified) | Good for ICP 1–2; make macOS first-class | <2% of Show HNs reach the front page; plan for a flop, a hit is 100–300 points |
| Product Hunt | Free; may share link but not ask for upvotes; 12:01 am PT (producthunt.com/launch, verified) | Medium for ICP 5 | Tens of upvotes without a network; a backlink |
| r/LocalLLaMA | Self-promotion rule tightened (secondary; verify sidebar) | Poor until local models work | Removal risk if posted now |
| r/selfhosted | Centres on network services (secondary) | Weak | Low |
| r/opensource | "Promotional" flair required (secondary) | OK for ICP 3 | 10–50 upvotes (hypothesis) |
| r/developersIndia | Self-promotion restricted; monthly Showcase Sunday megathread (secondary) | Good via the megathread | Feedback + a few contributors |
| r/india | Self-promotion not allowed; contact mods (secondary) | Poor | Skip |
| r/SideProject, r/ClaudeAI, r/IndianStartups | Rule text not retrieved (unknown; verify before posting) | Good for ICP 1/2/4/5 | Low tens to low hundreds of upvotes |
| dev.to / Hashnode | Value beyond promotion required (verified for Hashnode CoC) | Good for tutorials | Hundreds of views; SEO long tail |
| Hindi YouTube (tech and GST/Tally) | Creator partnerships, not rules | Best path to ICP 6 and 8 | One mid-size creator demo could out-pull all Reddit posts for Indian downloads (hypothesis) |
| LinkedIn | Company-page reach ~1–2% (secondary) | Medium via personal profile | Dozens to hundreds of views |
| winget | Community PR needs moderator approval; PR #458967 pending | High for Windows discovery; fix version drift | Modest, durable |
| Homebrew cask | Needs ≥75★ (third-party) or 225★ (self) and ≥30 days (docs.brew.sh, verified) | Not eligible yet; own tap possible now | Later |
| AUR | `-bin` convention, anyone can submit | Eligible today as `sahkarmi-bin` | Small, cheap credibility |
| Flathub | Build from source, no precompiled binaries (verified) | Hard: bundled OpenCode binary and downloaded Antigravity conflict | Defer |
| awesome lists | awesome-electron: wait 30 days after creation (eligible ~2026-11-18); awesome-ai-agents | Do both | Long-tail traffic |
| SEO | Intent clusters: "open source AI agent desktop app windows", "Claude Cowork alternative open source", "Eigent alternative", "AI coworker app", "free AI assistant Hindi for business" (volumes unknown) | Comparison pages convert best (hypothesis) | Months to rank |

## 4. 30-day launch plan sketch

Days 1–5: fix the funnel (README, Discussions, good-first-issues, weekly release cadence, winget manifest, SignPath Foundation application, publish RAM/CPU numbers).
Days 6–10: soft launches (r/developersIndia Showcase Sunday, r/SideProject, Peerlist Launchpad, Indie Hackers, FOSS United forum; dev.to tutorial; own Homebrew tap; AUR).
Days 11–15: Show HN (Tue–Thu, 7–10 am PT) with an honest first comment; X thread; r/ClaudeAI (check rules and ToS first).
Days 16–22: India push (3-minute Hindi and Bengali demos; Hindi GST/Tally creators; LinkedIn; Product Hunt).
Days 23–30: awesome-electron and awesome-ai-agents PRs; Ollama/OpenAI-compatible provider if feasible, then one disclosed r/LocalLLaMA post; CFPs for FOSS United chapters and GDG DevFest; retro on stars, forks, external PRs, downloads per OS.

Realistic 30-day targets (hypothesis): 50–300 stars without an HN hit, 500–1,500 with one; 3–10 external contributors if good-first-issues exist; downloads in the low hundreds, Windows-majority.

## 5. Sources (observed 2026-10-24 unless stated)

Product: https://github.com/ganguydhrubo/sahakarmi · https://api.github.com/repos/ganguydhrubo/sahakarmi · https://sahkarmi.site · https://github.com/microsoft/winget-pkgs/pull/458967

Comparables (GitHub API): eigent-ai/eigent · kortix-ai/suna · janhq/jan · Mintplex-Labs/anything-llm · CherryHQ/cherry-studio · open-webui/open-webui · ollama/ollama · browser-use/browser-use · OpenHands/OpenHands · sst/opencode · anthropics/claude-code

Surveys: https://survey.stackoverflow.co/2025/ai · https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ · https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/ · https://www.pewresearch.org/chart/about-half-of-u-s-adults-now-use-ai-chatbots-up-from-a-third-in-2024/

OS share: https://gs.statcounter.com/os-market-share/desktop/india (and worldwide, asia, japan, south-korea, australia, united-states-of-america, europe)

India: https://knnindia.co.in/news/newsdetails/msme/over-884-crore-msmes-registered-on-udyam-platforms-mos-karandlaje · https://www.trai.gov.in/sites/default/files/2026-07/PR_No104of2026_0.pdf · https://www.idc.com/resource-center/press-releases/india-pc-market-growth-q2-2026/ · https://www.dataforindia.com/computers/ · https://inc42.com/buzz/centre-recognises-record-55200-startups-in-fy26/

Channel rules: https://news.ycombinator.com/showhn.html · https://www.producthunt.com/launch · https://opensource.guide/finding-users/ · https://docs.brew.sh/Package-Acceptance-Policy · https://docs.flathub.org/docs/for-app-authors/requirements · https://cdn.jsdelivr.net/npm/awesome-electron@2.6.0/contributing.md · https://hashnode.com/code-of-conduct · https://signpath.org/terms · https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options

Communities: https://platform.fossunited.org/indiafoss/2026 · https://forum.fossunited.org/ · https://opensearch.org/event/open-source-summit-japan-2026/

Known unknowns: live Reddit rule text (verify sidebars before posting); provider ToS on third-party reuse of Claude Code/Codex logins; app RAM footprint (measured separately in the QA report); SEO volumes; X reach.
