# GoalSpec infrastructure methods v2

Implementation record and execution runbook, 2026-11-06. This supersedes the
ranking, retrieval, calibration and profiling descriptions in the v1 notes.
Existing experiment reports remain immutable. No new live improvement is claimed.

## What runs

The actor receives its original messages and tool catalog. GoalSpec separately
reads the same public checkpoint, retrieves frozen training experience, binds
candidate arguments to current evidence, predicts useful reads and executes
admitted reads during actor inference. An identical authoritative invocation can
join the speculative job and consume its validated observation. Native writes,
messages, reservations and commitments are never speculative candidates.

This experiment changes tool execution infrastructure, not model weights. There
is no LoRA, Soup or actor fine-tuning step. Goal conditioning changes predictor
ranking and physical read scheduling; it does not remove tools from the actor.
Transparent prefetch alone cannot promise better native task reward or fewer
logical actor calls. Those are measured separately from physical backend calls.

The source pins are authoritative in
[`versions.json`](../../infra/goalspec-infra-v1/versions.json):

| Role | Repository and exact revision |
| --- | --- |
| Actor | `Qwen/Qwen3.5-9B`, `c202236235762e1c871ad0ccb60c8ee5ba337b9a` |
| Predictor | `Qwen/Qwen3.5-0.8B`, `2fc06364715b967f1860aea9cf38778875588b17` |
| Optional capacity ablation | `Qwen/Qwen3.5-2B`, `15852e8c16360a2fea060d615a32b45270f8a8fc` |

Both default models use bfloat16. Serving is vLLM 0.32.0, image digest
`sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34`,
PyTorch 2.13.0/CUDA 13.0.3, `qwen3_xml` tool parsing and `qwen3` reasoning
parsing. Thinking is disabled in these requests. Actor context is 32,768 tokens
(28,672 input plus 4,096 output); predictor context is 8,192 (7,168 plus 1,024).
`LocalChatModelPort` uses the official OpenAI SDK against the local compatible
endpoint, the served tokenizer, strict argument validation, real call IDs and
recorded usage/stream timing. Local endpoint use does not imply hosted inference.
Pinned dependencies include OpenAI SDK 6.34.0, OpenTelemetry API 1.10.0,
trace/metrics SDKs 3.1.0, OTLP HTTP exporters 0.301.0 and the maintained
`@prometheus-io/client` 0.16.1. `package-lock.json` records the exact dependency tree.
Each telemetry owner uses explicit providers and its own monotonic clock identity;
collector partial rejection remains an export failure. Container build performs
Prisma generation using only disposable localhost fixture URLs.

## 1. Collect causal training traces

Run Node commands at the repository root. Run Python commands with the installed
research environment and `research/goalspec/src` on `PYTHONPATH`; native execution
also needs the pinned tau environment. Uppercase paths below are operator inputs.
Every output path must be new. Credentials remain in secure process configuration.
Before a phase that requires a current ledger checkpoint, export one from the
same nonempty original journal:

```text
node --import tsx scripts/goalspec-infra-native.ts checkpoint ORIGINAL_BUDGET_DIRECTORY/budget.jsonl NEW_LEDGER_CHECKPOINT.json
```

Spending changes invalidate older startup checkpoints. Freeze a new phase manifest
against the current checkpoint; never edit a closed experiment or reset its ledger.

Use the collection plan described in [native launch](INFRA_NATIVE_LAUNCH.md), with
`shadowPrediction: true` and `predictorBaseUrl` set. It permits only collection
stage and base-arm slots. `memoryPath` may select a frozen training snapshot;
otherwise preparation writes a valid empty `shadow-memory.json` and binds its
actual hash. The actor configuration, messages, tools and seeds stay fixed.

```text
python -m goalspec.infra_prepare_native --plan COLLECTION_PLAN.json --deployment OBSERVED_DEPLOYMENT.json --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT --output NEW_PREPARED
python -m goalspec.infra_cli native --config NEW_PREPARED/configuration.json --tasks NEW_PREPARED/tasks.json --output NEW_COHORT --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT
python -m goalspec.infra_import_fresh --cohort NEW_COHORT --output NEW_BUNDLE --pilot-count 100 --audit-count 20 --parquet
node --import tsx scripts/goalspec-infra-memory.ts --fresh NEW_BUNDLE NEW_MEMORY
node --import tsx scripts/goalspec-infra-memory.ts --causal NEW_MEMORY/runtime/artifact.json NEW_COHORT service/events.jsonl service/public-boundaries.jsonl NEW_CAUSAL_MEMORY.json
```

The native collector runs one Node service for the entire cohort. The final
command imports that service's event/public JSONL pair from the closed cohort's
hashed inventory, covering every training slot. It rejects arbitrary replay
files. A derived snapshot is checked against the exact dataset hashes, both sealed
source hashes and its derived snapshot digest before replay or profiling.
`actor_generated` records the actual
response before tool promotion/execution. Only predictions recorded before that
response, joined by run/checkpoint/frame/input identity, become causal prediction
errors. Late predictions, retrospective labels and cached observations cannot
stand in for generated actor calls. Shadow prediction never admits a read.

Split request families before annotation or mining. Verified successful training
endpoints support workflows. Independently verified unsuccessful training runs
remain contrastive examples; unknown, censored and provider-failed outcomes do not
become known-outcome memory. Development/test episodes stay out. Causal imports
produce a new snapshot rather than modifying the source artifact; every later
manifest and calibration must bind the final validated snapshot and content hash.

## 2. Freeze and optionally publish episodic retrieval

The embedding model is `text-embedding-3-small`, 1,536 dimensions. Record an
explicit `MODEL_VERSION` descriptor. Embedded text contains only requirements,
previous tool and the last six public-prefix items, capped at 1,900 code points.
Future actions and outcomes are excluded from that projection. Frozen artifacts
bind memory, model version, projection, episode, text and vector hashes.

```text
node --import tsx scripts/goalspec-infra-embeddings.ts --from-cache FINAL_MEMORY.json MODEL_VERSION CACHE.json NEW_EMBEDDINGS.json
node --import tsx scripts/goalspec-infra-embeddings.ts --build-paid FINAL_MEMORY.json MODEL_VERSION ORIGINAL_LEDGER_PATH LEDGER_CHECKPOINT.json NEW_EMBEDDING_DIRECTORY
node --import tsx scripts/goalspec-infra-embeddings.ts --publish FINAL_MEMORY.json FROZEN_EMBEDDINGS.json
```

Choose either cache import or paid building. The paid command uses the original
nonempty journal and checkpoint, reserves the complete plan under preparation,
reserves each request, disables automatic retries and retains uncertain charges.
Do not restart it with a replacement ledger. Publication uses
`GOALSPEC_RESEARCH_DATABASE_URL`; application `DATABASE_URL` is checked for database
separation. Fresh research volumes initialize `schema.sql` and
`migrations/002-episodic-memory.sql`; existing research databases need that migration
applied explicitly. Publication is immutable and verifies existing rows exactly.

Hybrid retrieval uses PostgreSQL full-text search and exact pgvector cosine
search, at most 32 results per channel, reciprocal rank fusion with constant 60,
at most four examples including one negative, and a 16,000-character cap.
Compatibility filters apply before vector ranking: frozen memory, encoder/version,
projection, policy, authorization/tool/environment scope and allowed training
families; current runs and excluded families cannot be retrieved. Deadline is
100 ms. Unavailability/deadline permits lexical fallback; integrity failure fails
closed. `createInfraMemoryServices` binds the actual retrieval profile, accounts
for query embeddings in the original ledger, and drains before budget closure.

## 3. Rank once, calibrate independent marginals

Native graph/workflow candidates deduplicate exact invocations, preserve current
graph bindings and interleave sources/tools fairly up to 128. A deterministic,
goal-neutral token-budget compiler freezes the common window before conditioning.
The runtime makes one ranking request per checkpoint and selects at most three
candidates. Source-valid ready goals with a positive independently audited Wilson
agreement bound enable conditional ranking; absent, invalid or zero-bound goals
use the neutral fallback. This enable gate is not a high-confidence accuracy
guarantee. There is no
sequential neutral-plus-conditional request or probability-mixture latency tax.
Background goal refresh has lower priority than ranking.

Scores mean independent probabilities that each exact invocation appears anywhere
in the immediate next authoritative batch. Several candidates may be positive;
their scores need not sum to one. `NO_READ` and `READ_UNCOVERED` remain explicit
prediction states. Actor tools remain unchanged. Initial scheduler bounds remain
two speculative reads per run, four globally, twelve starts per run, one-hop
lookahead and a five-second deadline. Exact match promotion, cancellation drain,
mutation invalidation and freshness checks remain required.

```text
node --import tsx scripts/goalspec-infra-predict.ts NEW_BUNDLE FINAL_MEMORY.json NEW_SELECTED_REPLAY LOCAL_PREDICTOR_URL 100 goals selected_candidates calibration EPISODIC_CONFIG.json
python -m goalspec.infra_cli fit-calibration --bundle NEW_BUNDLE --predictions NEW_SELECTED_REPLAY --condition both --output NEW_CALIBRATION
```

Omit the last optional argument for lexical retrieval. Episodic replay JSON has
`embeddingsPath`, `budgetDirectory` and `ledgerCheckpointPath`, resolved beside
that file, plus the secure database environment variable. The single journal owner
charges query embeddings to replay. One completed retrieval result is frozen per
checkpoint for both conditions, including any timeout fallback; a later dense
result cannot change the second condition's evidence.

Calibration v2 binds `independent_next_batch_hit`, `selected_candidates`, exact
model, memory, retrieval, prompt and compiler identities. It fits separate neutral
and conditional maps using training outcomes only: fixed deciles, forward merging
of empty bins, Laplace(1,1) smoothing. Development results are diagnostics. Missing
or stale artifacts fail closed. Goal reliability additionally requires the
100-record annotation pilot, at least 20 independent human reviews with at least
90% semantic acceptance and zero unsupported bindings, and independent training
goal-agreement grades. See [artifact commands](INFRA_ADMISSION.md).

## 4. Compare a fixed scoring panel

```text
node --import tsx scripts/goalspec-infra-predict.ts NEW_BUNDLE FINAL_MEMORY.json NEW_PANEL_REPLAY LOCAL_PREDICTOR_URL 100 goals fixed_panel test EPISODIC_CONFIG.json
python -m goalspec.infra_cli score-panel-replay --bundle NEW_BUNDLE --predictions NEW_PANEL_REPLAY --output NEW_PANEL_REPORT
```

This separate replay freezes at most three compiler candidates before goal
inference and requires an explicit probability for every panel ID, including low
scores and abstentions. Both conditions have identical panels and next-batch
labels. The scorer verifies closed receipts and hashes before joining private
labels. Report panel binary log loss, Brier score, coverage, missing/failed rows
and family-clustered paired differences. These are not full-action cross entropy
or true conditional entropy. A `test` partition alone does not establish fresh,
preregistered heldout evaluation; the report leaves that claim false. Fixed-panel
calibration is not a substitute for runtime selected-candidate calibration.

## 5. Measure admission costs for this exact deployment

```text
python -m goalspec.infra_native_profile --config NATIVE_PROFILE.json --output NEW_NATIVE_MEASUREMENTS --upstream-root PINNED_TAU_CHECKOUT
node --import tsx scripts/goalspec-infra-profile.ts DOCUMENT_PROFILE.json NEW_DOCUMENT_MEASUREMENTS
python -m goalspec.infra_cli build-opportunity --bundle NEW_BUNDLE --measurements NEW_NATIVE_MEASUREMENTS/measurements.json --output NEW_OPPORTUNITY
```

Use the config shapes in [native profiling](INFRA_NATIVE_PROFILE.md) and
[document profiling](INFRA_ADMISSION.md). Optional `episodicEmbeddingsPath` selects
the frozen corpus; `budgetDirectory` and the original checkpoint are required for
its hosted query embeddings. Native `stream` defaults to true and must equal the
live configuration. Profiler and runtime derive retrieval identity from the
actual service, not a caller-supplied hash.

The paired protocol uses identical seeded actor input alone and concurrently with
one neutral rank. When rank returns, prediction timing ends and a background goal
refresh starts concurrently with the scheduler-managed read. Its separate
`goalRefreshSpan` is recorded and drained; it is not added to the six admission
spans. Concurrent actor duration includes observed contention. Both actor outputs
must request the exact profiled read. No proposed actor action is executed.

Opportunity v2 binds hardware, serving/stream/concurrency, model, memory, compiler,
retrieval, prompt and protocol hashes. Each completed row and raw receipt bind the
same profile hash. It requires at least ten complete rows, preserves all failures,
uses p10 tool/lead benefits and p90 costs, and rejects negative paired actor excess.
The six components are `actorLeadMs`, `contentionMs`, `predictionMs`, `schedulingMs`,
`toolMs`, `validationMs`. This is an admission heuristic, not causal speedup proof.
Changed profiles require new measurements; v1 artifacts cannot bypass the gate.

## 6. Launch paired trials from the remaining original budget

Native configurations use `stage`, `manifestPath`, `ledgerCheckpointPath`, actor
and predictor URLs, `snapshotId`, explicit `runs`, `maximumLifetimeSeconds`,
`stream`, and frozen memory/calibration/opportunity/reliability paths. Optional
`episodicEmbeddingsPath` uses the runner's existing trial ledger. The Python native
launcher retains environment state, user simulation, evaluation and isolated
snapshot freshness leases. Its authenticated Node gateway preserves native batches.

Document configurations additionally need `corpusPath`, `tasksPath`,
`calibrationDatasetPath`, `schedule`, `maxSteps`; episodic retrieval also needs
`budgetDirectory` and `maxEmbeddingMicrodollarsPerRun`. Paths resolve beside config.

```text
python -m goalspec.infra_cli native --config COMPARISON.json --tasks FROZEN_TASKS.json --output NEW_NATIVE_TRIALS --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT
node --import tsx scripts/goalspec-infra-run.ts live DOCUMENT_COMPARISON.json NEW_DOCUMENT_TRIALS
python -m goalspec.infra_cli report --design PAIRED_DESIGN.json --results PAIRED_RESULTS.jsonl --output NEW_REPORT
```

Keep base, neutral-memory-prefetch and goal-conditioned-prefetch arms paired on
task, seed, actor configuration and step limits; freeze memory/calibration during
evaluation. Use original allocation ceilings: infrastructure $35, preparation $30,
training $60, development $40, heldout $240, replay $30, contingency $65, total $500.
GPU ceiling is $2.50/hour, 24 cumulative GPU hours and eight hours per session;
the $35 infrastructure slice is still binding. Credits do not reduce gross spend.

For completed development costs, set `b` to the next $0.25 at or above
`max(1.25, 1.25 * max(completed_costs), 2.50 if any development run was censored)`.
Then `N = min(16, 2 * floor(R / (24 * b)))`, where `R` is the original ledger's
remaining heldout allowance, not a fresh $240. `heldoutSizeFromLedger` reads that
remaining amount without double-counting nested reservations. Reserve the entire
selected grid before dispatch: two variants, two trials and three arms per family.
Zero remaining capacity means no heldout dispatch. Failed/budget-terminated tasks
remain failures and are never replaced.

Report native reward/pass1, two-trial consistency, constraints, logical actor
calls, physical backend/prefetch/revalidation calls, total wall latency including
prediction, sample-counted tails, billed costs and family-clustered paired
intervals separately. Custom generated tasks are a custom tau-compatible pilot,
not an official full-benchmark score. Execution replay is not live timing evidence.

## Verification and readiness

Local verification recorded on 2026-11-06:

| Check | Result |
| --- | --- |
| Research `.venv/Scripts/python.exe -m pytest -q --tb=short` | 604 passed, 6 skipped |
| Pinned native snapshot/lease round trip plus budget-design checks | 3 passed; native models mocked |
| `python -m unittest discover -s infra/goalspec-infra-v1 -p 'test_*.py' -v` | 123 passed |
| Final infrastructure Node suite | 154 passed, 2 skipped |
| Existing application/GoalSpec Node suite | 281 passed, 2 skipped |
| v5 regression suite | 49 passed |
| Browser integration | 2 passed |
| Independent Derya database integration | 10 passed |
| Generated contracts and scoped TypeScript (`goalspec:check`) | Passed |
| Changed-file Python Ruff | Passed |
| Changed-file ESLint compared with original HEAD | No introduced errors; 18 pre-existing errors remain |

The research run's skips were two unavailable historical-artifact fixtures, three
optional PyTorch tests and one native fixture. The separate pinned native run
resolved that fixture using tau commit `2174a603f6d014ef94473ffa95957f6ce27100db`.
Full logs are under `C:/Users/apexs/outputs/` as
`goalspec-implementation-python-final-20261106.txt`,
`goalspec-implementation-native-parity-final-20261106.txt` and
`goalspec-implementation-deployment-final-20261106.txt`. These checks make no paid
model calls. Mocked native parity is not a tau task-accuracy result.
Suite counts are reported separately because tests can overlap. The legacy, v5,
browser and database logs use the same prefix with suffixes
`legacy-final-20261106.txt`, `v5-final-20261106.txt`,
`browser-final-20261106.txt` and `db-checks-20261106.txt`.
The final infrastructure and schema logs use `node-final-20261106.txt` and
`typecheck-final-20261106.txt`. The exact lint comparison is retained in
`goalspec-implementation-lint-comparison-20261106.json`; blanket lint is not clean.
The infrastructure suite skips real pgvector and Derya DB tests without a database
URL; the latter passed in the separate real-DB run. The legacy suite skips one
database fixture and one unavailable historical training artifact.

Last observed AWS G/VT on-demand GPU quota was zero; the selected host needs eight
vCPUs. Quota approval, observed serving inventory, actual model/parser smoke tests
and the independent watchdog/export gates remain prerequisites. Real pgvector
publication/retrieval integration was unavailable locally; SQL/unit fixtures do
not establish that integration. Fresh collection, teacher audit, compatible v2
calibration/opportunity artifacts, paired development and heldout trials have not
yet demonstrated any new accuracy or latency improvement.

The method boundaries are [PASTE v3](https://arxiv.org/abs/2603.18897v3), which
speculates concrete invocations while generation runs, and
[Salesforce Speculate with Memory](https://arxiv.org/abs/2607.12236v1), which uses
transition, episodic and confusion memory. These are paper-based comparators, not
verified upstream reproductions. The [earlier source audit](V3_SOURCE_AUDIT.md)
remains a historical record. Standard serving, SDK, PostgreSQL, pgvector and
OpenTelemetry components supply their respective infrastructure; source binding,
scheduling, provenance and evaluation remain GoalSpec code. No vLLM engine-level
co-scheduler or ToolSpec decoder integration is claimed. Historical reports are
evidence of their original configurations only.
