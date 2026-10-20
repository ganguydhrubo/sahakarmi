# Agent safety report (v0.5.0)

This report maps the AI-agent failures in the owner's field report to what Sahkarmi now does about each one.
No agent can be made perfectly safe. The goal is that the known failure patterns are either blocked
in code or need a human decision, and that whatever happens is recorded and can be stopped.

**How strong each control is**

- **Enforced:** checked by the app before the action runs. The model cannot skip it, and it
  survives context compaction.
- **Prompt-level:** written into every coworker's instructions. This helps, but a model can still
  get it wrong.
- **Not possible / owner action:** outside what a desktop app can control.

## Incident → control

| Incident (field report) | Pattern | What Sahkarmi does now | Strength |
|---|---|---|---|
| Instinct reading Gmail OTPs | Opaque access to secrets | New **credentials** category: `.env`, SSH/cloud keys, credential files, `printenv`, `gh auth token`, keychain reads, and typing into password, OTP, PIN or CVV fields always ask. OTPs and private keys are redacted from logs. The instructions forbid fetching OTPs to log in. | Enforced + prompt |
| OpenClaw sending 500+ iMessages | Mass outbound | **Hourly cap** per coworker on messages, posts, orders and payments (default 20). It applies even with a pre-approval or approvals, and clearing the log does not reset it. | Enforced |
| Meta Muse, overreach | Too much standing access | **Suggest-only mode** per coworker: read and research only. Every change is blocked, and the coworker describes what it would do instead. Sensitive categories still can never be automatic. | Enforced |
| Chevy $1 deal, DPD swearing | Prompt injection, persona hijack | Browser output is **labelled as untrusted data**. Injection phrasing ("ignore previous instructions", "legally binding", "reveal system prompt", and similar) switches the task to **strict mode**: every non-read action asks, the event is logged as Flagged, and the owner sees a Hinglish notice. | Enforced (heuristic) + prompt |
| EchoLeak, Amazon Q, Moltbook | Lethal trifecta: private data + untrusted input + a way out | After a task reads web or external content, **exfiltration-shaped actions ask**: outbound messages, `curl`/`wget`/`scp`/`nc`, and URLs with long query strings. Pre-approvals do not apply to these. | Enforced |
| Replit DB wipe, PocketOS `volumeDelete`, Supabase reset | Destructive action | New **destructive** category, always ask: `rm -rf`, `DROP`/`TRUNCATE`/`DELETE FROM`, force-push, `reset --hard`, `git clean -f`, `prisma migrate reset`/`db push --accept-data-loss`, `supabase db reset`, volume deletes, `railway`/`fly`/`vercel` deletes, `kubectl delete`, `terraform destroy`, `aws … rm`, `docker prune`, `gh repo delete`, `curl -X DELETE`, `find -delete`, and more. | Enforced |
| Gemini CLI "moved" files that were gone; false "done" | False success | The instructions require checking the result after every change. The **task-done line shows real counts** of tools that ran and failed, taken from the actual tool results. | Prompt + enforced (display) |
| Cursor ignoring plan mode | Constraint in context only | Suggest-only, limits and emergency stop live in `permissions.json`, **outside the context window**, and are checked on every tool call. | Enforced |
| Summer Yue: "confirm before acting" lost in compaction | Constraint lost in compaction | Same as above: approval rules are app rules, not prompt text, so compaction cannot remove them. | Enforced |
| Air Canada, NYC MyCity, Cursor "Sam" | Hallucinated authority | Instructions: ground prices and policies only in `Shared/Policies` or what the owner said, otherwise say "I don't know"; never claim to be human; customer drafts go out only after approval (outbound messages always ask). | Prompt + enforced (sending) |
| Project Vend, endless loops | Goal drift, runaway | **Per-task limits:** tool calls (default 80), minutes (30), and the same action repeated (6 = loop). Breaking one stops the task, pauses the queue, and logs it as Stopped. | Enforced |
| Any of the above, live | Need to stop now | **Emergency stop** in the sidebar and with Ctrl/Cmd+Shift+Esc. It interrupts all tasks, pauses all queues, blocks every tool call, rejects pending permission prompts, and stays on after a restart. | Enforced |

## The ten cross-cutting controls

| # | Control | Status |
|---|---|---|
| 1 | Least privilege | Suggest-only mode; destructive and credentials are always ask; sensitive categories never automatic; per-category levels; pre-approvals limited by time and number of uses. |
| 2 | Hard human-in-the-loop in code | Yes: every adapter (Codex, Claude, Gemini, OpenCode, browser) goes through `PermissionService.authorize`. |
| 3 | Trust zones | Coworker folder plus Shared as the workspace zone. Web and browser content is untrusted and taints the task. Strict mode starts on detection. |
| 4 | Constraints outside the context | Yes: `permissions.json` holds levels, grants, suggest-only, limits and the emergency stop. |
| 5 | Prod/dev isolation and backups | **Partial.** Destructive commands always ask. A desktop app cannot snapshot your databases or cloud. Keep backups and separate production credentials from the machine the coworkers run on. |
| 6 | Verify after action | Prompt-level instruction, plus real counts of tools run and failed shown at the end. |
| 7 | Immutable audit log | Hash-chained (`sha256(prevHash + entry)`); the Activity view verifies it. Clearing leaves a chained marker. It is tamper-*evident*, not tamper-proof: a local administrator can still delete the file, and that is detected only if a later entry exists. |
| 8 | Budgets and kill switch | Per-task tool, time and loop limits; hourly outbound cap; emergency stop. Token spend is shown in Model usage (v0.4.0). |
| 9 | Grounded answers and AI labelling | Prompt-level: `Shared/Policies` grounding and never claiming to be human. |
| 10 | Red-team against OWASP | Unit tests cover the LLM01 prompt injection, LLM02 sensitive information disclosure, LLM06 excessive agency and LLM10 unbounded consumption patterns (`permission-policy.test.ts`, `agent-service.test.ts`). This is not a substitute for an external red team. |

## Known limits (honest)

- Injection detection is pattern-based. A novel phrasing can get past it. The always-ask
  categories and the exfiltration check are the real backstop.
- Codex executes commands in its own sandbox. Sahkarmi sees them through approval requests and
  classifies them. Commands Codex considers read-only may run without asking.
- The hourly outbound counter is kept in memory, so restarting the app resets it.
- Backups and production isolation are your infrastructure's job. Sahkarmi only makes sure a
  destructive command needs your click.
