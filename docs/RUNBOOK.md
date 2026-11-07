# Acephale research runbook

Follow [methods](METHODS.md) and [current state](STATE.md) before execution. Run
Node commands at repository root. Python commands require the research package on
`PYTHONPATH`; native commands also require the separate pinned benchmark
interpreter. Uppercase paths are explicit operator inputs. All output paths must
be new. This guide does not execute paid requests or provision infrastructure.

## 1. Verify local code and deployment inputs

```text
npm ci --ignore-scripts
npm run check
npm test
```

From `research/acephale`:

```text
uv sync --python 3.12.14 --frozen --group dev --extra analysis
uv run --frozen --extra analysis pytest
uv run --frozen python -m acephale.infra_cli --help
```

Use the deployment [README](../infra/acephale-infra-v1/README.md),
[AWS readiness](../infra/acephale-infra-v1/AWS_READINESS.md),
[host inventory](../infra/acephale-infra-v1/HOST_INVENTORY.md) and
[split-host transport](acephale/INFRA_SPLIT_HOST.md) for the actual environment.
The observed manifest must describe the executing source, models/tokenizers,
hardware, serving settings and Node/Python inventories. A checked-in fixture or
successful local test is not an observed deployment. Keep health, budget,
shutdown/watchdog and artifact-export gates enabled.

The pinned native source is `sierra-research/tau2-bench`, commit
`2174a603f6d014ef94473ffa95957f6ce27100db`; install its separately locked environment
according to `research/acephale/benchmarks.lock.json`. Preserve official task bytes,
policies and evaluator behavior. Do not silently replace a missing checkout.

## 2. Keep the existing budget

Configure the private original journal location outside source control and pass
it explicitly through `budgetDirectory` or `--budget-directory`. Never initialize
a replacement. A new phase obtains a new checkpoint from that same nonempty file:

```text
node --import tsx scripts/acephale-infra-native.ts checkpoint ORIGINAL_BUDGET_DIRECTORY/budget.jsonl NEW_LEDGER_CHECKPOINT.json
```

Ledger changes invalidate older startup checkpoints. Freeze a new phase manifest
against the current checkpoint; preserve earlier artifacts. Unknown charges stay
reserved. Keep credentials in secure process configuration, not command arguments
or artifacts.

| Allocation | Gross ceiling |
| --- | ---: |
| Infrastructure | $35 |
| Generation, annotation and embeddings | $30 |
| Training collection | $60 |
| Development and calibration | $40 |
| Heldout trials | $240 |
| Prediction replay | $30 |
| Protected contingency | $65 |
| Total | $500 |

The GPU limits are $2.50/hour, 24 cumulative hours and eight hours per session,
still bounded by the $35 infrastructure allocation. Credits do not reduce gross
spend. Reservations cover all attempts/concurrency and maximum billable output.

## 3. Collect fixed-actor traces with causal shadow prediction

Create a collection plan with explicit official task IDs, family partitions,
seeds, caps and reachable endpoints. This is a shape example, not executable data:

```json
{
  "experimentId": "acephale-training-01",
  "actorBaseUrl": "http://127.0.0.1:8000",
  "predictorBaseUrl": "http://127.0.0.1:8001",
  "shadowPrediction": true,
  "seeds": [0],
  "maxSteps": 40,
  "maxErrors": 5,
  "timeoutSeconds": 600,
  "maximumLifetimeSeconds": 3600,
  "maxCostMicrodollarsPerRun": 1250000,
  "tasks": [
    {"domain": "retail", "taskId": "TRAIN_TASK", "familyId": "TRAIN_FAMILY", "split": "train"},
    {"domain": "airline", "taskId": "DEV_TASK", "familyId": "DEV_FAMILY", "split": "development"},
    {"domain": "retail", "taskId": "TEST_TASK", "familyId": "TEST_FAMILY", "split": "test"}
  ]
}
```

Families follow request structure; duplicate tasks/requests cannot cross splits.
Shadow collection dispatches only base slots from training families; development
and test declarations remain frozen but are not dispatched by that collection.
Ordinary base collection without shadow prediction can include development slots.
Optional
`memoryPath` selects frozen training memory; otherwise preparation creates and
hashes an empty shadow snapshot. Shadow prediction never admits tools.

```text
python -m acephale.infra_prepare_native --plan COLLECTION_PLAN.json --deployment OBSERVED_DEPLOYMENT.json --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT --output NEW_PREPARED
python -m acephale.infra_cli native --config NEW_PREPARED/configuration.json --tasks NEW_PREPARED/tasks.json --output NEW_COHORT --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT
python -m acephale.infra_import_fresh --cohort NEW_COHORT --output NEW_BUNDLE --pilot-count 100 --audit-count 20 --parquet
node --import tsx scripts/acephale-infra-memory.ts --fresh NEW_BUNDLE NEW_MEMORY
node --import tsx scripts/acephale-infra-memory.ts --causal NEW_MEMORY/runtime/artifact.json NEW_COHORT EVENTS_RELATIVE PUBLIC_RELATIVE NEW_CAUSAL_MEMORY.json
```

The native launcher owns the authenticated Python gateway and starts Node itself.
Configure hosted simulator/evaluator credentials and `ACEPHALE_HOST_STATUS_FILE`
securely. The journal reserves declared trial caps together. Closed cohorts retain
failed/unknown trials, raw/public records, telemetry and a hashed inventory.
`EVENTS_RELATIVE` and `PUBLIC_RELATIVE` must identify sealed members of that
inventory, not arbitrary replay files. The causal import creates a derived snapshot
with checked source lineage. Freeze its final content hash before subsequent steps.

## 4. Annotate and audit

The importer can publish a 100-row pilot; it fails rather than silently shrinking
the design when insufficient eligible checkpoints exist. Alternatively select a
dataset-bound pilot explicitly:

```text
python -m acephale.infra_cli pilot --dataset NEW_BUNDLE --output NEW_PILOT --count 100 --audit-count 20
node --import tsx scripts/acephale-infra-annotate.ts PILOT_DIRECTORY ORIGINAL_LEDGER_PATH NEW_ANNOTATIONS EXPECTED_PILOT_HASH --dataset NEW_BUNDLE
```

The teacher uses the pinned research configuration, reserves physical requests
from the original preparation allowance, disables automatic retries and retains
failures. Review at least 20 selected examples: at least 90% must be semantically
acceptable and none may contain an unsupported binding. Independent graders must
cover every declared training goal prediction with exact input, annotation and
prediction hashes. The predictor cannot grade itself.

## 5. Freeze optional hybrid retrieval

Create a dedicated research database with the pinned PostgreSQL/pgvector versions.
Apply `services/acephale-runtime/schema.sql` and
`services/acephale-runtime/migrations/002-episodic-memory.sql`; initialization mounts
apply only to fresh volumes. Configure `ACEPHALE_RESEARCH_DATABASE_URL` securely.
Choose either cached embeddings or explicitly budgeted generation:

```text
node --import tsx scripts/acephale-infra-embeddings.ts --from-cache FINAL_MEMORY.json MODEL_VERSION CACHE.json NEW_EMBEDDINGS.json
node --import tsx scripts/acephale-infra-embeddings.ts --build-paid FINAL_MEMORY.json MODEL_VERSION ORIGINAL_LEDGER_PATH LEDGER_CHECKPOINT.json NEW_EMBEDDING_DIRECTORY
node --import tsx scripts/acephale-infra-embeddings.ts --publish FINAL_MEMORY.json FROZEN_EMBEDDINGS.json
```

Supply an explicit encoder-version descriptor. The paid builder reserves its whole
plan plus individual requests in the existing preparation allocation. Do not
restart a failed parent reservation with a replacement ledger. Publication checks
immutable row identities. Real publication/retrieval needs a separate integration
check; mocks do not establish database readiness.

## 6. Replay and calibrate

An optional episodic config has `embeddingsPath`, `budgetDirectory` and
`ledgerCheckpointPath`, resolved beside the file. Query embedding costs use the
original replay allocation and one journal owner. Omit the final argument below
for lexical retrieval:

```text
node --import tsx scripts/acephale-infra-predict.ts NEW_BUNDLE FINAL_MEMORY.json NEW_SELECTED_REPLAY LOCAL_PREDICTOR_URL 100 goals selected_candidates calibration EPISODIC_CONFIG.json
python -m acephale.infra_cli fit-calibration --bundle NEW_BUNDLE --predictions NEW_SELECTED_REPLAY --condition both --output NEW_CALIBRATION
python -m acephale.infra_cli build-goal-reliability --bundle NEW_BUNDLE --predictions NEW_SELECTED_REPLAY --annotations ANNOTATIONS.jsonl --pilot PILOT.json --reviews HUMAN_REVIEWS.jsonl --grades INDEPENDENT_GRADES.jsonl --output NEW_RELIABILITY
```

Training/development checkpoints are selected by deterministic family round robin;
test labels never fit calibration. Exact source/model/memory/retrieval/compiler
identity is checked. A separate matched-panel evaluation requires every panel
candidate's marginal probability:

```text
node --import tsx scripts/acephale-infra-predict.ts NEW_BUNDLE FINAL_MEMORY.json NEW_PANEL_REPLAY LOCAL_PREDICTOR_URL 100 goals fixed_panel test EPISODIC_CONFIG.json
python -m acephale.infra_cli score-panel-replay --bundle NEW_BUNDLE --predictions NEW_PANEL_REPLAY --output NEW_PANEL_REPORT
```

The report measures panel binary log loss/Brier and coverage, not full-action
entropy. Fixed-panel calibration cannot stand in for runtime selected-candidate
calibration. Test partition membership alone is not a fresh heldout claim.

## 7. Profile the actual serving configuration

Native profile config requires `version: 1`, `datasetPath`, `cohortPath`,
`memoryPath`, `manifestPath`, `ledgerCheckpointPath`, `budgetDirectory`, actor and
predictor URLs, `limit`, a manifest `seed` and `maximumLifetimeSeconds`. `stream`
defaults to true and must match execution. Optional `episodicEmbeddingsPath`,
`splitGuardPath` and `otlpBaseUrl` bind their actual services.

Document profile config replaces `cohortPath` with `corpusPath`; optional episodic
retrieval also requires the original budget directory. Paths resolve beside config.

```text
python -m acephale.infra_native_profile --config NATIVE_PROFILE.json --output NEW_NATIVE_MEASUREMENTS --upstream-root PINNED_TAU_CHECKOUT
node --import tsx scripts/acephale-infra-profile.ts DOCUMENT_PROFILE.json NEW_DOCUMENT_MEASUREMENTS
python -m acephale.infra_cli build-opportunity --bundle NEW_BUNDLE --measurements NEW_NATIVE_MEASUREMENTS/measurements.json --output NEW_OPPORTUNITY
```

For documents, substitute its measurement file and matching dataset in the final
command. Profiles reconstruct public state privately and measure actual reads and
validation. One rank completes before goal refresh overlaps the read. All workers
and embeddings drain before journal closure. At least ten complete measured rows
are required, with failures retained. V2 profile hashes must match the later run;
neither old timings nor synthetic numbers can bypass admission.

## 8. Freeze development and heldout execution

Native comparison config binds `stage`, manifest/checkpoint, endpoint URLs,
`snapshotId`, explicit `runs`, lifetime, stream and frozen memory/calibration/
opportunity/reliability paths. Optional episodic embeddings use its existing trial
ledger. Document config additionally binds `corpusPath`, `tasksPath`,
`calibrationDatasetPath`, `schedule`, `maxSteps`, and, for hosted embeddings,
`budgetDirectory` plus `maxEmbeddingMicrodollarsPerRun`.

```text
python -m acephale.infra_cli native --config COMPARISON.json --tasks FROZEN_TASKS.json --output NEW_NATIVE_TRIALS --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT
node --import tsx scripts/acephale-infra-run.ts live DOCUMENT_COMPARISON.json NEW_DOCUMENT_TRIALS
python -m acephale.infra_cli report --design PAIRED_DESIGN.json --results PAIRED_RESULTS.jsonl --output NEW_REPORT
```

Use paired base, neutral-memory and goal-conditioned arms with identical task/seed
blocks and frozen memory. Let `b` be the next $0.25 at or above
`max(1.25, 1.25 * max(completed_development_costs), 2.50 if any run was censored)`.
With `R` equal to the original journal's remaining heldout allowance,
`N = min(16, 2 * floor(R / (24 * b)))`. `heldoutSizeFromLedger` reads that remaining
amount without double-counting nested reservations. Reserve all two variants,
two trials and three arms for every selected family before dispatch. If capacity
is zero, do not dispatch. Never replace failed or budget-terminated tasks.

Freeze new manifests and report paths, retain all declared results, verify artifact
export, then follow the guarded shutdown procedure. Report native reward, tool
prediction accuracy, logical calls, physical calls, total latency and billed cost
separately with family-clustered paired intervals. Inspect an actual trace and
metric in the observability backend; collector HTTP acceptance alone is insufficient.
