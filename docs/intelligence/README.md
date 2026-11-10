# Intelligence Core

Sahkarmi's Intelligence Core learns from finished work: who is good at what kind of work, what is likely to fail or run late, and what went wrong before. It turns that into advice. Behind a separate switch, it can also act inside team runs.

Everything runs locally on the CPU in one small SQLite file. It uses no new paid API, sends nothing outside, and trains no language model. "Learning" here means counting verified results and updating a small logistic model.

## Switches

| Feature id | Name in Settings > Features | Default | What it does |
|---|---|---|---|
| `intelligence-core` | Intelligence: learn from finished work | On | Records each finished turn, grades it on evidence, learns, and shows Settings > Intelligence. It only watches. When off, nothing is recorded. |
| `intelligence-adaptive` | Intelligence: adaptive team runs (Labs) | Off | Needs the first switch. Team runs may use the evidence to pick or replace coworkers and to stop repeated failures. When off, team runs behave exactly as before. |

Mode: **off** (first switch off) → **observe** (first switch only) → **adaptive** (both on).

## How it works

```
AgentService / AdaptiveOrchestrator events
  turn-started · turn-completed · error · orchestrator-task-updated
        │  handleEvent(): filter + push to a bounded queue (2,000), never throws
        ▼
  drained in batches of 200 on setImmediate (off the hot path)
        │
        ├─ start  → outcome row "running" + predictions made BEFORE the work
        │            (failure chance, duration; source = model / history / estimate)
        ├─ end    → read the chat once: reply, tool calls, tool errors
        │            files-only check of named files (VerificationRepairEngine, no commands)
        │            grade: verified / partial / failed / inconclusive
        │            error signature (numbers, paths, ids removed)
        │            learn (except team-run turns, which wait for the task verdict)
        └─ task   → team-run verdict (files + owner's check + reviewer) regrades the turn,
                     settles the routing decision, then learns
```

### Grading (verification-grader.ts)

- Only outside evidence can raise a grade: files that exist, the owner's check command, or a reviewer.
- The coworker's own claims ("all tests pass") can only lower a grade, never raise it.
- When nothing outside the coworker's word can be checked, the result is **inconclusive**. It is never "verified".

### What a result teaches (outcome-label.ts)

| Evidence | Success | Failure |
|---|---|---|
| Owner 👍 | 1.5 | 0 |
| Owner 👎 | 0 | 1.5 |
| Verified | 1 | 0 |
| Partial | 0.5 | 0.5 |
| Failed / turn failed | 0 | 1 |
| Inconclusive success | 0.5 | 0 |
| Cancelled, interrupted, excluded | nothing | nothing |

### Choosing a coworker (decision-engine.ts)

- **Track record:** Beta-Bernoulli posterior per coworker and kind of work. Older results count less, with a 30-day half-life. The prior comes from the workspace's rate on that kind of work, shifted a little by the coworker's record on other kinds (never the same results counted twice).
- **Ranking:** by the cautious end of the estimate (lower 90% bound), with small penalties for being slow and for a long queue.
- **Switching:** the usual coworker keeps the task unless another has at least 5 results, a lead of at least 10 points, and a lead unlikely to be luck (one-sided 95% test using both coworkers' uncertainty), and is not buried in a queue.
- **Trials** (adaptive team runs only): if the usual coworker's record on that kind of work is weak (below 60% over at least 5 tasks), the pick is drawn by Thompson sampling. Others get a share until one proves better. A usual coworker that does well is never disturbed.
- **Explanations:** every choice comes with one, with numbers, and is written to the decisions table.

### Predictions (predictor.ts, online-logistic.ts)

- **Failure chance:**
  1. The online logistic model, used only after 30 examples and only while its Brier score beats the plain failure rate. It is scored prequentially: each example is predicted before it is learnt.
  2. Otherwise the coworker's own record (at least 3 results).
  3. Otherwise a rule-based number, labelled **Estimate** and listing its parts.
- **Duration:** median and 90th percentile of the coworker's own history, else the kind of work's history, else round-number estimates (labelled).
- **Overload:** 5 or more queued, or 30 minutes or more of expected wait.
- **Other forecasts:** repeated error signatures in 14 days, bottlenecks, and memory pressure.
- **Accuracy:** every recorded prediction is scored against what happened (Brier, and duration error) and shown in Settings.

### Plans (plan-analyzer.ts)

Settings > Intelligence > "Check a team-run plan" runs:

- Kahn layers and cycle detection.
- Missing dependencies.
- The critical path, with predicted time remaining.
- The chance that every remaining step succeeds.
- Same-file parallel writes, one coworker given parallel steps, steps blocked by a failed step, high-risk steps and retry loops.
- Suggested reassignments from the evidence.

### Replanning inside a team run (team-run-engine.ts, adaptive mode only)

- **Coworker gone:** the best other coworker takes the task, at most once per task.
- **Same failure twice in a row:** the task goes once to a coworker with a better record. If none has one, the retries stop and the task fails with a plain reason. A third identical attempt is not made.
- **Template plans:** may be re-routed before the run starts. CEO-written plans are never re-routed.
- **Notifications:** each change posts a chat notice (`team_run_reassigned`) and is logged.

### Experience memory (experience-memory.ts)

- **Kinds:** fact, preference, observation, lesson and prediction, kept apart.
- **Trust levels:** owner, verified, observed and untrusted.
  - A coworker's own text is always untrusted.
  - Decisions use only owner, verified and observed entries.
  - The service never stores reply text as a note.
- **Lifetimes:** facts and preferences never expire; observations last 180 days, lessons 60 and predictions 7.
- **Size:** at most 500 entries per workspace, with owner entries kept first.
- **Search:** FTS5 bm25, ranked by relevance × recency × trust. Queries are reduced to quoted words, so text can never become FTS syntax.
- **Owner control:** the owner can add, correct (the old text is kept) and delete entries.

### Undo

Learning is reversible in five ways:

- 👍/👎 or **Leave out** on any record; the model is rebuilt by replay.
- **Return the failure prediction** to one of the last 5 snapshots (taken every 25 updates).
- **Forget learning** for a workspace (records, notes, decisions and model in one transaction).
- Turning the switches off.

### Workspaces

Every query filters by workspace. Each workspace has its own model (`failure:<workspace>`), deleted by exact name.

### Housekeeping

Housekeeping runs when the database opens and every 200 events, never on a timer:

- A turn still "running" after 6 hours becomes interrupted, and teaches nothing.
- A team-run turn with no verdict after 2 hours is learnt as it stands.
- Limits: 5,000 outcomes and 2,000 decisions per workspace.

## Files

| File | Role |
|---|---|
| `src/backend/intelligence/intelligence-service.ts` | Facade: events, recording, learning, engine hooks, IPC answers |
| `intelligence-db.ts` | `userData/intelligence/intelligence.sqlite` (new file; no existing table changed) |
| `decision-engine.ts` | Ranking, switching rule, trials |
| `predictor.ts`, `online-logistic.ts`, `stats.ts` | Predictions and the maths behind them |
| `verification-grader.ts`, `outcome-label.ts`, `error-signature.ts` | Grading and labels |
| `task-classifier.ts` | Kind of work from the words (and team-run role) |
| `plan-analyzer.ts` | Team-run plan checks |
| `experience-memory.ts` | Notes, lessons, trust, expiry |
| `resource-meter.ts` | Time and CPU per operation, shown in Settings |
| `src/shared/intelligence.ts` | Types shared with the window |
| `src/renderer/src/components/IntelligenceSettings.tsx` | Settings > Intelligence |

## Tests

- **`intelligence-core.test.ts`:** unit tests for every module.
- **`intelligence-service.test.ts`:** end to end, with fake coworkers and real SQLite.
- **`intelligence-simulation.test.ts`:** routing simulation and performance measurements. The numbers are synthetic. Set `SAHKARMI_BENCH_OUT=<file>` to save them as JSON.
- **`team-run-engine.test.ts`** ("team runs with the Intelligence Core"): engine regressions with the hooks off, broken or on.

## Known limits

- **Turns that leave no record:** a turn that fails before it starts, or ends in a provider crash, emits no `turn-completed`, so it is not recorded. The 6-hour sweep marks any started row as interrupted.
- **Tokens and cost:** not recorded yet.
- **Thin evidence:** chat replies are checked only against files they name. With no files named and no check command, the grade is inconclusive. That is honest, but it means less evidence.
- **Unlucky streaks:** with equally good coworkers, an unlucky streak can start trials and move work for a while. In the simulation this cost no success, but 19–42% of tasks moved.
- **Drift:** the 30-day half-life adapts slowly to a coworker that suddenly gets worse.
- **Resource meter:** `process.cpuUsage()` covers the whole main process, so CPU per operation is an upper bound.
