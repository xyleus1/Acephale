# Frozen v5 confirmation prediction replay

Run only after the entire declared native confirmation cohort and its event log have closed. This harness selects 16 Base public decision boundaries, eight per domain, by a fixed family-stratified hash order. Validation failures and missing checkpoints remain selected. Outcomes and subsequent actions cannot determine replacements.

Supply an explicit JSON input with these keys:

```json
{
  "runDirectory": "ABSOLUTE_CLOSED_NATIVE_DIRECTORY",
  "nativePlanPath": "ABSOLUTE_ORIGINAL_NATIVE_PLAN_JSON",
  "closedEventsPath": "ABSOLUTE_CLOSED_NATIVE_EVENTS_JSONL",
  "closedConfirmed": true,
  "controllerPath": "ABSOLUTE_FROZEN_FINAL_CONTROLLER_JSON",
  "controllerSha256": "EXACT_FILE_SHA256",
  "memoryPath": "ABSOLUTE_FROZEN_FINAL_MEMORY_JSON",
  "memorySha256": "EXACT_FILE_SHA256",
  "recordsPath": "ABSOLUTE_FROZEN_FINAL_RECORDS_JSON",
  "recordsSha256": "EXACT_FILE_SHA256"
}
```

```powershell
node --import tsx outputs/goalspec-v5-tools/prediction-replay.ts plan INPUT_JSON NEW_RUN_DIRECTORY NEW_PLAN_JSON
node --import tsx outputs/goalspec-v5-tools/prediction-replay.ts run PLAN_JSON PLAN_FILE_SHA256
research/goalspec/.venv/Scripts/python.exe -X utf8 -B outputs/goalspec-v5-tools/prediction_replay_report.py --input CLOSED_REPLAY_DIRECTORY --output NEW_REPORT_JSON
```

The paid step uses the existing shared durable ledger. Its whole-cohort maximum is $2.700096, below the authorized $7 replay ceiling: 16 mini goal predictions, 16 blind teacher annotations, and at most 16 independent teacher responses grading all emitted hypotheses. No retries or replacement cases are allowed. Input compilation retains mandatory public policy and user spans within 8,192 tokens; over-budget cases remain failures. The model snapshots remain GPT-5.4-2026-03-05 and GPT-4.1-mini-2025-04-14.

All five primary rankers share one frozen public candidate pool of at most 128 candidates: neutral without memory, neutral with active memory, inferred goals, fallible teacher goal hints, and shuffled goals. Candidate arguments come from current sources. Memory retrieval is restricted to the frozen controller's training families. Server eligibility is recorded separately from the pre-policy ranking pool. `jointReadChoice` and `jointReadExactTop1` concern the controller's joint argmax, not actual utility-based scheduler admission.

The shuffled primary control retains donor citations and revision, allowing the normal provenance guard to reject it. A separately labeled sixth sensitivity control deliberately corrupts goal features and sets residual weight to one outside the runtime. No current citations are fabricated. Guard rejection does not establish that current-sourced semantic mistakes are harmless.

Two further offline controls, `matched-temperature-neutral` and `matched-temperature-full-goal`, isolate the goal residual at the frozen artifact's goal-active temperature (0.75 for the current fitted artifact). Both neutral and goal-active temperatures are overridden in an in-memory analysis copy, with weights, current-goal context, memory and candidate pool held identical. Every row records the original and analysis artifact hashes, applied temperature, weight hash and pool/memory/workflow hashes. The file artifact and live runtime remain unchanged. The five primary controls preserve their original frozen policy, including neutral temperature1.0 versus goal-active temperature0.75 where applicable; primary log-loss differences therefore combine residual and calibration effects. The separate paired diagnostic reports residual-only differences. All eight controls retain every selected checkpoint; the additional local rankings require no provider calls.

Predictions are committed before public next-action labels are parsed. Top-1/Top-3 scores match any read in the next native actor batch, not the entire batch. Goal agreement compares each complete hypothesis separately; missing grades count as misses in the primary 16-prefix denominator and remain separately reported. Family-clustered paired intervals use 5,000 bootstrap samples. Log losses are cross-entropy estimates, not true conditional entropy. Exact/tool losses disclose the probability floor for outcomes outside the pool; the separate READ_UNCOVERED category is not an exact argument prediction. No task-success, live-latency, pristine-heldout, or causal-superiority claim follows from this replay.

Tool and full-argument Top-1/Top-3 use only checkpoints whose next batch contains an audited read. They rank the read pool independently of the joint NO_READ decision; `jointReadExactTop1` separately requires joint argmax READ. Known read-label prediction failures remain accuracy misses. Correct NO_READ decisions never add exact tool or argument accuracy credit for writes, messages, or stopping.

`categoryNllNats` is **coarsened next-read decision/set-event log loss**, not full native next-action tool-and-argument log loss. Its outcomes are read invocations in the bounded pool, NO_READ, and READ_UNCOVERED. A covered batch uses summed probability of matching reads. NO_READ aggregates all behavior without an audited read; READ_UNCOVERED aggregates absent read invocations and cannot stand in for their exact tool names or arguments. Read-specific tool/exact losses instead floor missing match mass at 1e-12. Those loss means use observed predictions and read labels only, with coverage separate from the full read-accuracy denominator. Metric formulas and all declared primary denominators remain unchanged.
