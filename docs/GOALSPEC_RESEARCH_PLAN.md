# GoalSpec research implementation and gates

## Accepted architecture

The user approved an independent Python research package in this repo, native
benchmark actor interfaces, GoalSpec scientific criteria as acceptance, and a
practical A/B gate before full scheduler development. The starting branch head is
`e257708d44b2279f72cc542d527cb2bf445e3adf`.

The implementation and reproduction guide is
[research/goalspec/README.md](../research/goalspec/README.md).

Retain the CRM and its historical benchmark artifacts. Adapt temporal state hashes,
dependency validation, provenance, and clustered paired statistics as concepts;
do not import freight-specific database readers, chat dispatch, intent labels,
mailbox workflows, or the hardcoded model client into the research runtime.

## Implemented pre-scheduler platform

- Python 3.12/uv package, versioned Pydantic contracts, source-bound artifacts,
  grouped corpus splits and exact declared trial grids.
- Native tau3 context capture, execution worker and Results import pinned to
  `2174a603f6d014ef94473ffa95957f6ce27100db`, with the benchmark's own environment.
- Public prefix isolation, full batch withholding, parallel result ordering,
  greeting-first initial user handling, and retained invalid actor calls.
- Offline endpoint normalization, success-only training, PrefixSpan mining,
  empirical symbolic argument mappings, goal-posterior mixtures and backoff.
- Lexical, LiteLLM classifier and cosine/FAISS embedding goal backends, with
  configurable development calibration and captured model artifacts.
- Paired PASTE/oracle/initial-goal/dynamic-goal/shuffled prediction pilot, exact
  argument matching, goal diagnostics, native pass^k and latency availability.
- Provenance-checked A/B gates, native failure/exclusion accounting, uncertainty
  estimates and append-only prediction/observation logs.
- Public Sierra release import with independently reconstructed tool catalogs,
  automatic terminal-semantics annotations and full source/version audits.
- Shared structural context across goal conditions, matched shuffled initial and
  oracle controls, domain-scoped unknown labels, and task-consistent endpoints.
- Isolated Codex CLI initial-goal capture with strict output validation, exact
  public-input caches and recorded classifier usage/timing.
- Bounded fit-local reference caches, verified benchmark reports and standalone
  depth/confidence analysis plots.

Endpoint predicates and template-family assignments still require offline
annotation and review. Automatic semantic endpoint extraction from arbitrary
terminal states is not claimed. The initial symbolic binder supports identity
references and repeated constants; unsupported transformations abstain.

## Current validation and scientific status

At the initial implementation checkpoint on September 11, 2026:

- `python -m uv run ruff check src tests`: passed.
- `python -m uv run pytest -q --basetemp=runs/release-pytest`: 114 passed.
- `python -m uv lock --check`: passed.
- Full offline demo: 360 synthetic trajectories, frozen grouped split, training,
  paired replay, and gate report. Gate status is `insufficient_evidence` and
  `scheduler_allowed=false`, as required for synthetic data.
- Actual pinned native mock and retail context construction succeeded without
  model calls. The public CLI's retail context capture also succeeded.
- A scripted native mock test exercised collection, native scoring and import:
  reward 1.0, seven imported events, provider completion/embedding calls blocked.
  This is integration-test evidence only. Mock imports are marked synthetic.
- No real API actor trajectories or endpoint corpus were available in the checkout,
  and no API key was present in the active process. No paid actor run was made.

The subsequent public-replay evaluation uses 1,500 published real trajectories
across airline, retail, telecom and banking. All 19,074 observed tool names and
argument objects validate against independently reconstructed catalogs. These
remain `tau3-public-replay` diagnostics with automatic endpoint proxies, not
native gate-eligible evidence or a new live actor run.

Prediction retains 1,044 trajectories across airline, retail and banking;
telecom's three request families fail the unchanged five-family split criterion.
Its 456 trajectories remain in descriptive actor outcomes. The frozen split is
616 training, 204 development and 224 test trials. No model or mining parameter
is selected using the reported development/test scores.

The optimized implementation passes 179 tests and Ruff. Its full training fit
took 78.85 seconds, producing 45 goal signatures, 16,294 patterns and 1,753
argument bindings. A bounded cache preserves exact pattern artifacts; its
engineering stress-test timings are separate from prediction and agent latency.
Source SHA-256: `e44f25558951f10291a4060246d4e0388927274263f2fee4e865d20f627c1572`.

All four frozen lexical/LLM development/test runs completed. On 2,865 test calls,
LLM GoalSpec tool Top-1 is 35.15% versus local PASTE 33.58%, but primary macro
NLL is 1.98323 versus 1.96176. Paired NLL improvement is -0.02146, 95% CI
[-0.14618, +0.06073]. Full-match gains persist under shuffled goals. The initial
LLM goal Top-1/Top-3 is 63.27%/79.59% including unknown, or 59.21%/73.68% on
seen goals. These diagnostics do not establish the primary research hypothesis.
Development proxy-oracle NLL reduction is only 0.48% and its interval includes
zero. Scheduling remains disabled; no original-system PASTE or SOTA win is claimed.

See the [public-replay report](../research/goalspec/reports/2026-09-11-public-replay/README.md)
for measured comparisons and remaining evidence requirements. Local raw data,
training artifacts and replay logs are in `research/goalspec/runs/public-pilot-20260911`.

Run artifacts are intentionally ignored under `research/goalspec/runs/`. The demo
is under `runs/implementation-demo`; the public native capture is under
`runs/cli-native-context`. Earlier interrupted test artifacts remain distinguishable
from complete runs. No production database, mailbox, CRM dependency, or deployment
was changed. The new GitHub Actions workflow has been added but not remotely run.

## Next evidence, before scheduler work

1. Preserve the completed public-replay negative result, then capture four
   independently seeded native trials for each declared task in
   airline, retail, telecom and banking knowledge. Freeze exact actor/user model
   snapshots and retrieval settings. Preserve failures and native evaluator output.
2. Review terminal signatures and related task/template groups offline. Include
   direct query-conditioned and goal-independent candidate-pool controls in the
   new protocol. Import
   with captured public contexts and source hashes. Split before building any
   ontology, patterns, embeddings or episode indexes.
3. Run Experiment A on development data: oracle conditioning must lower held-out
   next-tool NLL by at least 10%, with paired 95% improvement lower bound above zero.
4. Run Experiment B using only the initial visible request and public context:
   inferred goals must recover at least 25% of the positive oracle gap, again with
   a positive paired 95% interval. Report Top-1/Top-3 and calibration as diagnostics.
5. If evidence is insufficient, collect a complete preregistered cohort. If a gate
   fails, deliver the negative result and stop scheduler work. Do not relax the
   thresholds, score test data to select models, or relabel synthetic runs.

The gate compares bounded structural-context predictors by held-out log loss.
Lower predicted-distribution entropy alone cannot establish the claim, and a goal
derived from full context adds no new Shannon information to that full context.

## Work authorized only after real A/B evidence passes

1. Complete primary replay adapters for PlanBench-XL and ToolSandbox, preserving
   native tool visibility, blockers, mutable-state semantics and Milestone DAGs.
2. Add Salesforce transition, episode and confusion memory. Run Base Actor, PASTE,
   PASTE+Memory, GoalSpec, GoalSpec+Memory, Oracle GoalSpec and shuffled-goal control
   on identical tasks. Include standalone stateless/Salesforce predictor conditions
   for direct comparison, clearly distinguishing hybrid and reproduced baselines.
3. Build one shared read-only speculative executor. Use isolated execution,
   explicit eligibility, canonical arguments, task/version/dependency freshness,
   strict authoritative capacity, promotion, cancellation and resource accounting.
   Unknown effects or unverifiable freshness must be ineligible. Start top-1/top-3,
   one-step speculation; validate before adding bounded dependency chains.
4. Separate offline prediction from actual execution timing. Keep actor inputs
   unchanged for lossless speculation. Report real latency including all predictor,
   scheduler and provider overhead; label injected-latency studies separately.
5. Run goal-visible actor guidance as a separate paired live experiment for task
   success and path-quality effects. LLMCompiler belongs to this orchestration
   comparison rather than frozen-actor predictor replacement.
6. Add BFCL V4 and GTA-2 diagnostics, then DeepResearchBench, SWE-bench and ScholarQA
   for PASTE-family comparability. Preserve native scorers and exact revisions.
7. Wire optional OpenTelemetry/Langfuse/W&B, analysis exports and research figures.
   Publish all requested prediction, speculation efficiency, call counts, pass^k,
   mean/p95/p99 latency and uncertainty-by-depth/confidence/benchmark measurements.

The CRM's current retrieval/state benchmarks remain supporting regressions; they
cannot be counted as GoalSpec task-success or speculative-execution evidence.
