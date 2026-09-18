For the GitHub publication scope and current v5 results, see
[GitHub checkout](../../docs/goalspec/GITHUB_CHECKOUT.md) and
[the closed v5 report](reports/2026-09-16-v5-local/README.md).
The historical research guide below is preserved; full raw evaluation artifacts
remain local, and V6 is deferred.

# GoalSpec research pilot

This package implements the pre-scheduler stages of the accepted GoalSpec plan:
native trace capture/import, endpoint normalization, PrefixSpan pattern mining,
safe symbolic argument binding, goal prediction, paired replay, and the A/B
scientific gates. It runs independently of the CRM, Next.js, Prisma, and mailboxes.

**The full scheduler is intentionally not implemented yet.** The agreed plan
requires real tau3 development evidence before that stage. Synthetic mechanism
checks cannot pass the gate, regardless of their numeric improvements. Published
real-trace replay is available with explicit reconstruction and annotation limits.
No new live actor run, latency reduction, or SOTA result is claimed by this package.

The [completed published-trajectory pilot](reports/2026-09-11-public-replay/README.md)
passes 179 tests and replays 224 held-out trials over 2,865 tool calls. LLM goals
raise tool Top-1 from 33.58% to 35.15%, but primary macro NLL rises from 1.96176
to 1.98323 with an inconclusive paired interval. Shuffled goals retain the
argument-match gains. The current evidence does not establish outperformance;
the full measurements, controls, classifier usage and conclusion are retained.

## Install and exercise the complete offline pipeline

From this directory:

```sh
python -m pip install uv
python -m uv sync --frozen --group dev
python -m uv run goalspec demo --output runs/demo
python -m uv run goalspec gate-status runs/demo/replay/gates.json
```

`uv` installs Python 3.12 if needed. `gate-status` exits 2 for insufficient evidence,
3 for a failed hypothesis, and 0 only for passed real evidence. The demo command
itself exits 0 when the pipeline works and the synthetic gate remains closed.
Use a new output directory on every run; frozen artifacts are not overwritten.

```sh
python -m uv run ruff check src tests
python -m uv run pytest
```

On machines with restricted system temporary directories, use a new project-local
directory, for example `pytest --basetemp=runs/pytest-local`.

## Architecture and retained repository work

- `schemas.py` separates complete trajectories/evaluator outcomes from the
  `PrefixView` that predictors receive. Native model/config/seed and input hashes
  stay in non-model-facing provenance.
- `replay.py` withholds the entire next actor batch and its generated prose.
  Results are visible only after their recorded completion. Concurrent batches
  become order-independent control-flow signatures. Invalid actor calls remain
  scored misses and never expand the visible tool catalog.
- `goals.py` creates a training-only ontology from normalized terminal predicates.
  Object instance values are excluded from cluster identity. Unknown goals back
  off to the unconditioned pool.
- `patterns.py` mines frequent order-preserving contexts using prefix projection,
  scoped by benchmark/domain and optionally terminal goal. Defaults are context
  length 3, history 12, independent-group support 2, and additive smoothing 0.5.
- `binding.py` infers field/index identity mappings and repeated safe constants,
  measures binding precision, and validates arguments against tool JSON Schema.
  Unsupported transformations abstain; no generated code is executed.
- `goal_backends.py` provides lexical, LiteLLM classifier, and embedding retrieval
  backends. Goal posteriors are mixed over the same pattern pool. Backend caches
  and vectors are saved to make model stochasticity auditable.
- `metrics.py` and `gates.py` enforce paired cohort completeness, clustered
  uncertainty estimates, native success semantics, and evidence eligibility.
- `adapters/` contains the pinned native tau3 importer and isolated JSONL worker.

The new code adapts the existing repo's state/provenance principles and statistical
methods. Existing application memory, temporal state runtime, business tools, and
published retrieval benchmarks stay unchanged. They are not trajectory training
data or evidence for speculative execution performance.

The PASTE conformance fixtures include search -> first URL fetch and failed fetch
-> alternate URL fetch. This is an independent implementation from the
[PASTE paper](https://arxiv.org/html/2603.18897v1); an official public implementation
was not identified during the audit. This pilot's argument language is deliberately bounded;
string synthesis and the paper's scheduler remain unimplemented.

## Capture native tau3 data

The official tau3 repository remains named `tau2-bench`. Its revision and required
extras are recorded in `benchmarks.lock.json`. Each benchmark owns a separate
environment; its dependencies are not installed into this package.

```sh
git clone https://github.com/sierra-research/tau2-bench.git .benchmarks/tau3
git -C .benchmarks/tau3 checkout 2174a603f6d014ef94473ffa95957f6ce27100db
python -m uv sync --project .benchmarks/tau3 --frozen --extra knowledge --extra voice --python 3.12
```

The pinned upstream eagerly imports voice components even during text runs, so
its voice extra is needed. This is an upstream dependency constraint, not an
expansion of the experiment into voice.

Create a run specification, explicitly naming model snapshots and task IDs:

```sh
python -m uv run goalspec tau-spec runs/retail-spec.json runs/retail-native --actor-model PROVIDER/ACTOR-SNAPSHOT --user-model PROVIDER/USER-SNAPSHOT --domain retail --task-id 0
python -m uv run goalspec tau-run runs/retail-spec.json .benchmarks/tau3 --contexts-only
```

Replace the model placeholders with actual identifiers before a model run.
`tau-spec` defaults to four explicit trial seeds, 0 through 3. Repeat `--task-id`
for the complete cohort. The native worker captures public policy, tool schemas,
and agent system prompts before execution. It rejects a changed benchmark checkout.
The `UV` executable set by `uv run` is discovered automatically; `--uv` accepts an
explicit executable path when necessary.

`--contexts-only` makes no model calls for the audited configurations. Banking
knowledge requires an explicit provider-free retrieval variant for this mode;
dense retrieval may build an embedding index during environment construction.
Preserve the chosen native retrieval configuration across paired conditions.

For real runs, configure provider credentials in the process environment using
your normal credential mechanism. This package does not read the CRM's `.env`
files. Create a **new specification with a new run-output directory** and run
without `--contexts-only`. The native actor, simulator, and evaluator then run
through the pinned benchmark. Real runs incur provider usage.

Capture artifacts include native `results.json`, `contexts.json`, and a capture
manifest. Native result timestamps are not reliable execution clocks, so imported
per-tool timings remain null. The full provider execution path exists but was not
validated against a live model in the initial implementation.

## Offline endpoint labels and task-family splits

Prepare an offline labels JSON matching `examples/endpoint-labels.json`.
Replace every example identifier and provide each task's audited template family
and intended terminal signature. Labels for failed tasks describe their target
endpoint, not an assertion that they achieved it. Only successful training paths
contribute to endpoint discovery and mining.

Use terminal predicates and constraints, not reference tool-call paths. Keep
instance IDs/names separate. The normalizer removes known structured identities
and recognizable IDs; it is not a general entity-recognition model. Review labels
before freezing the corpus. Related task variants must share `group_id`.
Unlabeled imports are grouped conservatively as one domain family and cannot be
silently split into training and evaluation data.

```sh
python -m uv run goalspec import-tau runs/retail-native/results.json runs/retail-native/contexts.json runs/retail.jsonl --labels runs/retail-labels.json
python -m uv run goalspec validate runs/retail.jsonl
python -m uv run goalspec split runs/retail.jsonl runs/split.json
python -m uv run goalspec fit runs/retail.jsonl runs/split.json runs/artifacts
python -m uv run goalspec replay runs/retail.jsonl runs/split.json runs/artifacts runs/development
```

Use at least five independent template families per domain to create a grouped
split, and enough development families for paired bootstrap estimation. The
declared trial grid is checked exactly. Repeated trials are never independent
split units. The default grouped partition is 60/20/20. For official partitions,
supply a `SplitManifest` with `method="official"`; the same group, membership,
trial-grid, and content checks apply. Never split related templates merely to
increase sample size.

Capture other domains separately, then combine them with
`goalspec merge OUTPUT.jsonl FIRST.jsonl SECOND.jsonl ...` before splitting.
Report the resulting held-out task subset explicitly rather than calling it a
full official leaderboard evaluation.

## Goal predictor experiments

The default lexical backend is a transparent offline baseline, not an asserted
best model. To use an API classifier or embedding retrieval:

```sh
python -m uv sync --frozen --extra models --group dev
python -m uv run goalspec replay CORPUS SPLIT ARTIFACTS OUTPUT --goal-config CONFIG.json
```

Configuration fields are `backend` (`lexical`, `llm`, `embedding`, or `cached_llm`), `model`
(required for API backends), `calibration_temperature`, and `retrieval_engine`
(`numpy` or `faiss`). API calls receive only domain-scoped training signatures and
public context. Fit calibration on development data using `models.fit_temperature`,
freeze the resulting configuration, and use it unchanged on test. There is no
automatic model-selection claim or hidden test-time tuning.

The pilot records `paste`, `oracle`, `goalspec_initial`, dynamically updated
`goalspec`, and matched task-shuffled dynamic, initial and oracle predictions. Base actor native task
statistics are separate. Experiment B uses `goalspec_initial`, which observes the
first visible user request even when the native conversation begins with an
assistant greeting. Later user/environment observations affect only the dynamic
condition. All predictions share frozen actor trajectories and the same binder.
The unconditioned pool chooses the structural context once; every goal uses that
exact context, including sparse-goal fallback. Goal IDs depend only on normalized
terminal semantics, never on the realized actor path. Labels must be consistent
across all trials of a task. Unknown endpoints are resolved within domain.

## Published real-trace evaluation

The public-release importer preserves official published actor trajectories,
rewards, source commits and complete task/trial grids. It uses the distinct
`tau3-public-replay` identity because the original tool catalogs were omitted.
Schema catalogs are reconstructed independently from pinned public source.
Automatic endpoint annotations are explicit semantic proxies requiring review.
These artifacts cannot authorize the native tau3 scheduler gate.

From this directory:

```sh
python -m uv run python scripts/public_replay.py --help
python -m uv run goalspec fit runs/public-pilot-20260911/prediction-corpus.jsonl runs/public-pilot-20260911/split.json runs/public-pilot-20260911/artifacts
python -m uv run goalspec replay runs/public-pilot-20260911/prediction-corpus.jsonl runs/public-pilot-20260911/split.json runs/public-pilot-20260911/artifacts runs/public-pilot-20260911/development-lexical
python -m uv run goalspec replay runs/public-pilot-20260911/prediction-corpus.jsonl runs/public-pilot-20260911/split.json runs/public-pilot-20260911/artifacts runs/public-pilot-20260911/test-lexical --partition test
```

These are reproduction examples for new output directories. The completed
September 11 measurements use the frozen `artifacts-v2` bundle; the initial fit
attempt was preserved unfinished before a semantics-preserving cache optimization.
Use the actual bundle path when inspecting the retained local runs.

For an API-key-free classifier experiment, the installed Codex CLI can use its
existing authenticated session. `classify-initial` never reads credentials. Each
request gets its own fresh process, an isolated directory, disabled tool features,
and only its public context plus the domain-scoped training signatures. Tool-use
events, incomplete output, out-of-scope goal IDs and invalid probability mass fail
closed. Multiple requests in one prompt are rejected to avoid transductive leakage.
Default concurrency is four independent classifier requests.

```sh
python -m uv run goalspec classify-initial CORPUS SPLIT ARTIFACTS runs/classifier-dev --model gpt-5.6-sol
python -m uv run goalspec replay CORPUS SPLIT ARTIFACTS runs/replay-cli --goal-config runs/classifier-dev/backend.json
python -m uv run --extra analysis goalspec report runs/replay-cli runs/report-cli --plots
```

The generated backend freezes `update_policy="initial"` and verifies the exact
public-input hash, training catalog, model and capture-file SHA-256. It fails if
a prediction is missing; it never silently falls back to another classifier.
Capture files include prompts, raw structured response events, token usage and
classifier wall time. These are classifier costs, not speculative speedups.
Test classification needs a separate capture with `--partition test`.

The [published replay methodology and results](reports/2026-09-11-public-replay/README.md)
retain the whole source cohort and disclose excluded prediction domains. In this
release telecom has only three repeated initial-request families, below the
unchanged five-family split minimum. Its descriptive actor results remain in the
report; it is excluded from fitting and prediction comparisons before scoring.

## Gates, metrics, and artifacts

- Experiment A: oracle goals lower held-out next-tool NLL by at least 10%, with
  a paired 95% improvement interval strictly above zero.
- Experiment B: inferred initial goals recover at least 25% of the oracle gain,
  again with a positive paired 95% interval.
- Only complete, non-synthetic tau3 **development** cohorts with at least four
  independently seeded trials per task, resolved endpoint labels, source/model
  provenance, and verified training-only artifacts can pass.
- Missing/duplicate pairs, unresolved calls, absent labels, missing provenance,
  and test-set gate requests remain insufficient evidence. Scored unsuccessful
  tasks stay in all denominators. Native infrastructure exclusions are exposed
  separately rather than silently filtered.

The central estimator is held-out NLL, task-equal/trial-equal within domain, then
macro-averaged across domains. Bootstrap samples keep all correlated steps and
trials of a template cluster together. Tool/argument and goal top-k diagnostics
state their separate micro weighting. Native pass^k means success in all k trials.

Artifacts include:

- `run.json`: complete or failed execution status, never a falsely complete run.
- `predictions.jsonl`: paired target/prediction records.
- `observations.jsonl`: the requested GoalSpec observation schema, with unavailable
  scheduler/LLM/tool timing fields explicitly null.
- `initial-goals.jsonl`: initial-request goal accuracy including zero-tool trials.
- `goal-backend.json`: model configuration, index vectors/hashes, and cached
  visible-input hashes/posteriors.
- `gates.json`: content-bound A/B decisions and eligibility reasons.
- `summary.json`: aggregate diagnostics, native outcomes, provenance, and hashes.

Lower softmax entropy is not evidence for the hypothesis. Structural context C
is the bounded event-signature history; oracle endpoint information can lower
uncertainty. An inferred goal derived from an already-complete context adds no
Shannon information to that context. Predictive gains measure the value of the
representation for a bounded estimator.

## Remaining gated work

After real A/B evidence passes: implement Salesforce transition/episode/confusion
memory and all required ablations; add PlanBench-XL and ToolSandbox adapters; then
build the shared read-only speculative scheduler with state freshness, strict
authoritative capacity, promotion, cancellation, and resource accounting.

Keep frozen-trace prediction, measured execution latency, and actor-visible goal
guidance separate. Add BFCL V4/GTA-2 and original PASTE benchmark-family runs after
the primary suite. The `report` command provides verified CSV/Markdown benchmarks,
paired intervals and optional standalone depth-profile plots. OpenTelemetry exporters, Langfuse/W&B wiring,
live guidance, and the full benchmark suite are not implemented in this pilot.

The gate is an integrity-checked research decision, not a cryptographic attestation
of externally supplied labels or credentials. It must not be bypassed by renaming
synthetic inputs as benchmark data.
