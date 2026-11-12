# Intelligence Core: research sources

Checked 10 Nov 2026. **yes** = fetched and showed the named work. **partly** = DOI resolves but the publisher returns 403 to scripts; title, authors and year confirmed via the Crossref API.

## 1. Agent selection (Beta-Bernoulli bandit)

- Russo, Van Roy et al., "A Tutorial on Thompson Sampling", 2018: <https://arxiv.org/abs/1707.02038> (yes)
- Raj and Kalyani, "Taming Non-stationary Bandits: A Bayesian Approach" (discounted Beta TS), 2017: <https://arxiv.org/abs/1707.09727> (yes). Gaussian variant: Qi et al., 2023, <https://arxiv.org/abs/2305.10718> (yes)
- Robinson, "Understanding empirical Bayes estimation", 2015: <http://varianceexplained.org/r/empirical_bayes_baseball/> (yes)
- Miller, "How Not To Sort By Average Rating", 2009: <https://www.evanmiller.org/how-not-to-sort-by-average-rating.html> (yes)

**Decision:** one Beta(α, β) per agent and category. The prior is fitted from the category's pooled rate and its strength is capped. α and β are discounted by γ on each update. A Thompson draw makes the choice; the UI shows the mean and a lower bound, so 2-of-2 never outranks 40-of-50.

**Routing precedent:** Ong et al., "RouteLLM", 2024: <https://arxiv.org/abs/2406.18665>, <https://github.com/lm-sys/RouteLLM> (yes). Chen, Zaharia and Zou, "FrugalGPT", 2023: <https://arxiv.org/abs/2305.05176> (yes). **Decision:** both route between model APIs using preference data or cost cascades. We only have outcome counts, so a bandit fits. The cascade becomes the one-time reassignment in item 5.

## 2. Failure prediction (online logistic regression)

- Gama, Sebastião and Rodrigues, "On evaluating stream learning algorithms", *Machine Learning*, 2013: <https://doi.org/10.1007/s10994-012-5320-9> (yes)
- Brier, "Verification of forecasts expressed in terms of probability", *Monthly Weather Review*, 1950: <https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml> (yes)
- Gneiting and Raftery, "Strictly Proper Scoring Rules, Prediction, and Estimation", *JASA*, 2007: <https://sites.stat.washington.edu/raftery/Research/PDF/Gneiting2007jasa.pdf> (yes)
- McMahan et al. (Google), "Ad Click Prediction: a View from the Trenches", 2013: <https://research.google/pubs/ad-click-prediction-a-view-from-the-trenches/> (yes)

**Decision:** score each run before training on it (test-then-train). Compare Brier score and log loss with a base-rate predictor on the same stream. Show risk only while the skill score stays above zero after a minimum sample.

## 3. Duration and queue estimates

- Hyndman and Fan, "Sample Quantiles in Statistical Packages", 1996: <https://robjhyndman.com/publications/quantiles/> (yes; DOI partly)
- Dean and Barroso, "The Tail at Scale", *CACM*, 2013: <https://research.google/pubs/the-tail-at-scale/> (yes)
- Little, "Little's Law as Viewed on Its 50th Anniversary", *Operations Research*, 2011: <https://people.cs.umass.edu/~emery/classes/cmpsci691st/readings/OS/Littles-Law-50-Years-Later.pdf> (yes, course mirror; 1961 original DOI 10.1287/opre.9.3.383 partly)

**Decision:** use one quantile definition (type 7) and report the median and p90, not the mean. Wait = queued work ÷ recent throughput (L = λW). Overload = arrivals faster than completions.

## 4. Repeated-error signatures

- He, Zhu, Zheng and Lyu, "Drain: An Online Log Parsing Approach with Fixed Depth Tree", 2017: <https://jiemingzhu.github.io/pub/pjhe_icws2017.pdf> (yes)
- Zhu et al., "Tools and Benchmarks for Automated Log Parsing", 2019: <https://arxiv.org/abs/1811.03509> (yes)
- logpai, Drain3 (masks IPs and numbers before mining): <https://github.com/logpai/Drain3> (yes)
- Sentry, "Issue Grouping": <https://docs.sentry.io/concepts/data-management/event-grouping/> (yes)

**Decision:** mask numbers, paths, hex values, UUIDs and IPs with regexes. Hash the error type with the masked text into a fingerprint and count it per window. A Drain tree is not needed at desktop volume.

## 5. Plan DAG, replanning, circuit breaker

- Kahn, "Topological sorting of large networks", *CACM*, 1962: <https://doi.org/10.1145/368996.369025> (partly)
- Kelley and Walker, "Critical-path planning and scheduling", 1959: <https://doi.org/10.1145/1460299.1460318> (partly)
- Fowler, "CircuitBreaker", 2014: <https://martinfowler.com/bliki/CircuitBreaker.html> (yes)
- Kim et al., "An LLM Compiler for Parallel Function Calling", 2023: <https://arxiv.org/abs/2312.04511> (yes)

**Decision:** one Kahn pass gives the order, cycles (nodes left over) and parallel width (the widest level). Forward and backward passes give slack, and the critical path is the chain with zero slack. Reassign a failed task once at most. Open the breaker after N repeats of the same item-4 fingerprint.

## 6. Evidence-based verification

- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet", 2023: <https://arxiv.org/abs/2310.01798> (yes)
- Jimenez et al., "SWE-bench", 2023: <https://arxiv.org/abs/2310.06770> (yes)
- Cemri et al., "Why Do Multi-Agent LLM Systems Fail?", 2025: <https://arxiv.org/abs/2503.13657> (yes)
- Anthropic, "Building effective agents", 2024: <https://www.anthropic.com/engineering/building-effective-agents> (yes)

**Decision:** the verdict comes only from what we observe: files, exit codes, tests, exception scans and criteria. The agent's claim counts for nothing. If no check can run, the result is "inconclusive", never "verified".

## 7. Experience memory and retrieval

- Park et al., "Generative Agents", 2023 (recency + importance + relevance): <https://arxiv.org/abs/2304.03442> (yes)
- Shinn et al., "Reflexion", 2023: <https://arxiv.org/abs/2303.11366>. Zhao et al., "ExpeL", 2023: <https://arxiv.org/abs/2308.10144> (both yes)
- Packer et al., "MemGPT", 2023: <https://arxiv.org/abs/2310.08560>. Letta (formerly MemGPT): <https://github.com/letta-ai/letta> (both yes)
- Robertson and Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", 2009: <https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf> (yes; DOI partly)

**Decision:** rank by BM25 × recency decay × trust weight. Lessons are stored ExpeL-style with provenance. Letta needs its own server, so we take the idea, not the package.

## 8. Security

- OWASP GenAI Security Project, "OWASP Top 10 for Agentic Applications for 2026", 9 Dec 2025: <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/> (yes; page and PDF). Exact names:
  - Memory poisoning: **ASI06 Memory & Context Poisoning** (mitigations include trust scores and "Expire unverified memory").
  - Tool misuse: **ASI02 Tool Misuse and Exploitation**.
  - Cascading failures: **ASI08 Cascading Failures** (mitigations include "circuit breakers between planner and executor").
  - Excessive autonomy: no ASI item has this name. The list uses its **Least-Agency** principle and links ASI02 to **LLM06:2025 Excessive Agency**, <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/> (yes). Also relevant: **ASI01 Agent Goal Hijack**, **ASI09 Human-Agent Trust Exploitation**, **ASI10 Rogue Agents**.
- Chen et al., "AgentPoison", 2024: <https://arxiv.org/abs/2407.12784>. Greshake et al., indirect prompt injection, 2023: <https://arxiv.org/abs/2302.12173> (both yes)
- LangGraph JS, "Interrupts": <https://docs.langchain.com/oss/javascript/langgraph/interrupts> (yes)

**Decision:** memory written from agent output is untrusted. It is quoted as data, never as instructions, and expires unless verified. Sensitive actions wait for human approval through a LangGraph `interrupt`.

## 9. Telemetry field names

- OpenTelemetry, "Semantic Conventions for GenAI agent and framework spans" (Development): <https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md> (yes). The old opentelemetry.io page now only says "Moved".
- OpenTelemetry, "AI Agent Observability – Evolving Standards and Best Practices", 2025: <https://opentelemetry.io/blog/2025/ai-agent-observability/> (yes)

**Decision:** spans are `invoke_workflow` (the spec's own example is LangGraph `StateGraph`), `invoke_agent {gen_ai.agent.name}`, `plan` and `execute_tool {gen_ai.tool.name}`. Attributes are `gen_ai.operation.name`, `gen_ai.agent.id`/`.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`/`output_tokens` and `gen_ai.tool.name`/`.call.id`. Keep them in one constants file while the spec is in Development.

## Candidate projects

| Project | Adopt? | Why |
|---|---|---|
| LangGraph JS | Keep | Already used. 1.7.3, MIT, 4 dependencies; use its interrupts and recursion limit. |
| River | No | Python 3.11+ with a Rust/Cython core, so it needs a sidecar. Reference only. |
| scikit-learn | No | Python batch ML. At most a test oracle during development. |
| MLflow | No | Python tracking server. Its TS `mlflow-tracing` package still needs that server. |
| Optuna | No | Python hyperparameter search. Too few constants to tune. |
| NetworkX | No | Python. The graph work is about 100 lines of TS. |
| LiteLLM | No | Python SDK and proxy for routing between LLM APIs, not CLI agents. |
| llama.cpp | No | Needs model files of several GB. `node-llama-cpp` is about 41 MB with 28 dependencies. |
| AutoGen | No | Python/.NET. Its README says it is archived (successor: Microsoft Agent Framework). |
| CrewAI | No | Python framework that overlaps with LangGraph. |
| OpenHands | No | Now a whole product ("Agent Canvas", about 133 MB, 56 dependencies) that runs ACP agents itself. A peer, not a library. |

## Did not resolve cleanly

- `npmjs.com` package pages: 403 to scripts. Versions were read from `registry.npmjs.org`.
- ACM, INFORMS, Taylor & Francis, Now/Emerald and `cacm.acm.org` landing pages: 403 (marked "partly").
- Not used: the MIT Little's Law PDF (redirects to a home page), the Stanford Efron 1977 PDF (host not found) and the Oxford Hyndman–Fan PDF (401).
- `genai.owasp.org` and GitHub blob pages sometimes return 403/429/503. Both were confirmed on a retry or through raw GitHub.
