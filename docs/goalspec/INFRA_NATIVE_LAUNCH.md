# Prepare and launch the fixed-Qwen native collection

The new native launcher calls `scripts/goalspec-infra-native.ts`. It does not
start the legacy hosted actor. Qwen owns actor inference; the fixed hosted user
simulator and independent judge use the original durable budget journal.

The commands below prepare and run a base-only collection. They do not fine-tune
actor weights. Follow fresh import, annotation, audit and calibration before a
separate three-arm comparison. Production activation stays off.

## Required local inputs

- A clean committed GoalSpec checkout and the exact tau checkout
  `2174a603f6d014ef94473ffa95957f6ce27100db`, with its Python environment installed.
- The existing study `budget.jsonl`, retaining all settled and unresolved entries.
  Never initialize a replacement. Checkpoint creation acquires the existing
  journal's exclusive lock and does not create new spending reservations.
- An observed deployment inventory: `version: 1`, `observed: true`, and the
  `actor`, `predictor`, `runtime`, `hardware` objects defined by
  `src/lib/goalspec/contracts/infra-manifest-v2.schema.json`. Record actual model
  file, tokenizer/template, dependency-lock and package-inventory hashes and the
  actual serving host. The schema fixture is not deployment evidence.
- A small collection plan with explicit task IDs, family/split assignments,
  seeds and endpoint. Every task comes unchanged from the pinned official files.
  Predeclare train, development and test families. Test tasks are kept in the
  frozen bundle but are never dispatched by collection.

Plan shape (replace the descriptive task IDs and family names with the reviewed
official task selections; these are not executable defaults):

```json
{
  "experimentId": "fixed-qwen-native-collection-01",
  "actorBaseUrl": "http://127.0.0.1:8000",
  "predictorBaseUrl": "http://127.0.0.1:8001",
  "seeds": [0],
  "maxSteps": 40,
  "maxErrors": 5,
  "timeoutSeconds": 600,
  "maximumLifetimeSeconds": 3600,
  "maxCostMicrodollarsPerRun": 1250000,
  "tasks": [
    {"domain": "retail", "taskId": "TRAIN_TASK_ID", "familyId": "TRAIN_FAMILY", "split": "train"},
    {"domain": "airline", "taskId": "DEV_TASK_ID", "familyId": "DEV_FAMILY", "split": "development"},
    {"domain": "retail", "taskId": "TEST_TASK_ID", "familyId": "TEST_FAMILY", "split": "test"}
  ]
}
```

Assign families by request structure, not by split or random task ID. Repeated
tasks or identical requests must not cross the split. Both model servers remain
resident even for base collection. Actual fit, tool parsing, export and both
watchdogs must pass the deployment checks before paid execution.

## Offline preparation

From the repository root, use the Python environment containing pinned tau2 and
set `PYTHONPATH` to this checkout's `research/goalspec/src` when needed. Paths
below are explicit operator inputs; output directories must not already exist.

```text
python -m goalspec.infra_prepare_native --plan collection-plan.json --deployment observed-deployment.json --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT --output NEW_PREPARED_DIRECTORY
```

This reads official task bytes and tool schemas, freezes the real source commit,
captures the original ledger checkpoint, and generates `configuration.json`,
`manifest.json`, `tasks.json` and a preparation receipt. The TypeScript runtime
validates the generated configuration. It makes zero model calls, downloads
nothing and provisions no host. It deliberately cannot invent deployment data.

Memory and calibration are absent during collection. Their manifest hashes
identify that absence explicitly; no calibration artifact is fabricated to
enable a run. Any later ledger change invalidates the checkpoint. Prepare a new
directory after reconciliation instead of editing a frozen manifest.

## Collection

Configure `OPENAI_API_KEY` securely in the process environment, a live
`GOALSPEC_HOST_STATUS_FILE` heartbeat, and the two reachable Qwen endpoints.
Reserve infrastructure separately within the unchanged total budget and retain
the provider shutdown controls.

```text
python -m goalspec.infra_native_runner --config NEW_PREPARED_DIRECTORY/configuration.json --tasks NEW_PREPARED_DIRECTORY/tasks.json --output NEW_COHORT_DIRECTORY --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT
```

The service acknowledges the exact configuration before native trial clocks
start. All declared run caps are reserved together from the existing training
allocation. Unknown charges remain reserved; credits do not change gross
limits. Startup failures, failed slots and host interruptions remain in the
cohort. A second invocation cannot overwrite the output directory. A service
timeout exits unsuccessfully and cannot produce a completed receipt.

The collection directory contains the frozen inputs, pre-execution public
contexts, outcomes, per-run raw evidence, service trace, readiness and a
SHA-256 inventory receipt. Hosted costs are separate from GPU infrastructure
costs. Successful setup tests do not establish actual Qwen performance.

## Continue with the fresh data

```text
python -m goalspec.infra_import_fresh --cohort NEW_COHORT_DIRECTORY --output NEW_BUNDLE_DIRECTORY --pilot-count 100 --audit-count 20
node --import tsx scripts/goalspec-infra-memory.ts --fresh NEW_BUNDLE_DIRECTORY NEW_MEMORY_DIRECTORY
```

The importer requires a completed closed cohort. It retains failed and unknown
outcomes; only successful independently verified training runs with zero known
constraint violations enter workflow memory. Development data stays excluded
from memory. If there are fewer than 100 eligible annotation checkpoints, the
explicit pilot size fails rather than silently shrinking the audit design.

Next generate teacher annotations, review the declared 20 examples, measure
timings, fit separate neutral and conditional calibration and freeze a new
comparison configuration. These steps require observed evidence, not fixture
values or the historical symbolic replay score.

## Cover replay labels and grade goals

Goal reliability requires teacher annotations for every declared training row in
the goal-inference replay, including failed predictions. The original random
100-row pilot and a 100-row replay need not select the same checkpoints. Before
generating or reviewing annotations, expand the teacher cohort explicitly:

```text
node --import tsx scripts/goalspec-infra-grade.ts expand-annotations DATASET ORIGINAL_PILOT GOAL_REPLAY NEW_EXPANDED_PILOT
node --import tsx scripts/goalspec-infra-annotate.ts NEW_EXPANDED_PILOT ORIGINAL_BUDGET_DIRECTORY/budget.jsonl NEW_ANNOTATIONS EXPECTED_PILOT_HASH --dataset DATASET
```

The first command is offline. It reports the added count and new pilot hash,
preserves all original pilot members and the exact human-audit IDs/reasons, and
appends missing training replay checkpoints. Added rows are restricted to training;
the original pilot membership, including any development audit rows, is preserved.
If the expanded cohort exceeds the existing five-dollar annotation
cap, it fails without dropping rows. The original 100-row limit remains unless
an explicit expanded replay cohort is supplied.

Review the original 20 audit examples against the exact resulting annotations.
If labels were already generated and reviewed, do not reuse old review hashes
after generating a new annotation file; reviews bind the exact label contents.

The independent grading command avoids asking a human to grade every training
prediction. It compares the highest-probability inferred goal against the
highest-confidence teacher goal, requiring the full objective and material
constraints. It sees public prefix sources only. Use the fixed independent
teacher model and original ledger:

```text
node --import tsx scripts/goalspec-infra-grade.ts hashes DATASET GOAL_REPLAY NEW_ANNOTATIONS/annotations.jsonl
node --import tsx scripts/goalspec-infra-grade.ts grade DATASET GOAL_REPLAY NEW_ANNOTATIONS/annotations.jsonl ORIGINAL_BUDGET_DIRECTORY/budget.jsonl NEW_GRADES EXPECTED_PREDICTION_MANIFEST_HASH EXPECTED_ANNOTATIONS_HASH
```

The `hashes` command is offline and returns the two expected hashes. Grading
reserves its complete maximum before dispatch, enforces a separate five-dollar
cap within the original preparation allocation and performs no retries. It
preserves raw model responses, request costs and one bound grade for every
training prediction. Failed predictions and grading failures count as
disagreement. Unknown-only predictions retain rows but do not estimate
conditional goal reliability. These conservative failure rules are recorded
in the grading receipt; an independent-model grade is not human validation.

Pass `NEW_GRADES/grades.jsonl` to `build-goal-reliability`, together with the
expanded pilot declaration, the exact teacher annotations and 20 human review
rows. This command never completes the human audit or enables production.
