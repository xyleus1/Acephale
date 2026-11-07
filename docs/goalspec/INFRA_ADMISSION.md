# Infrastructure data, calibration and admission artifacts

The [v2 methods runbook](INFRA_METHODS_V2.md) specifies the current probability
semantics, compatible artifact identities and complete execution sequence.

These commands prepare fixed-model inference experiments. They do not update Qwen
weights. Source collections, predictor replay, teacher annotations, human reviews
and live timing measurements remain distinct evidence. Synthetic test outputs must
never become execution artifacts.

Run the Node commands from the repository root and the Python commands from
`research/goalspec` with the frozen development and analysis environment installed.
Every output directory must be new. Preserve failed and undispatched rows.

## Native and document replay

Import a closed fresh native collection with `goalspec.infra_import_fresh`, then
build its runtime memory with `scripts/goalspec-infra-memory.ts --fresh`. The
native launch/import documentation describes the original-ledger requirements.

For documents, first run the existing `goalspec-infra-run.ts live CONFIG OUTPUT`
command with `stage: "collection"` and base-only slots. Collection can contain
predeclared training and development families. It cannot contain test slots.
The launcher retains task/corpus copies and writes `collection-receipt.json`
only after all declared trial results exist and telemetry has drained.

```sh
node --import tsx scripts/goalspec-infra-document-data.ts CLOSED_COLLECTION NEW_DOCUMENT_DATASET
node --import tsx scripts/goalspec-infra-predict.ts NEW_DOCUMENT_DATASET NEW_DOCUMENT_DATASET/runtime-memory.json NEW_PREDICTIONS http://127.0.0.1:8001 100 goals
```

The same prediction command accepts a native dataset and its runtime artifact.
It selects both training and development families, excludes test families, and
uses the corresponding native or document candidate compiler. Source identity,
exact tool scope and the complete declared prediction cohort are retained.

Document export validates captured public boundaries against the actual
transcript, verifies fetched content hashes and independently recomputes the
document/answer check. All trial outcomes are retained; only successful training
trials enter `runtime-memory.json`. Private task answer keys do not enter public
prediction or teacher inputs. A checkpoint with no returned actor action has an
unknown next-action label and is excluded from calibration rather than counted as
a negative read. The result remains a custom document pilot, not an official
benchmark.

## Teacher pilot and independent review

```sh
python -m goalspec.infra_cli pilot --dataset DATASET --output NEW_PILOT --count 100 --audit-count 20
```

The teacher command accepts the separate pilot and dataset directories. See
`goalspec-infra-annotate.ts` CLI help for the original ledger and pilot hash
arguments. Every annotation remains bound to its exact public input. Review at
least 20 selected annotations. Review rows require `checkpoint_id`, the canonical
`annotationHash`, `reviewer`, `rubric_version`, Boolean `semantics_acceptable` and
Boolean `unsupported_binding`. At least 90 percent must be acceptable and no
unsupported binding is permitted. A source-valid annotation is not automatically
a semantically correct annotation.

Independently grade every declared training goal prediction against its teacher
annotation. Grade rows require `checkpoint_id`, `input_hash`, `annotationHash`,
`predictionGoalHash`, `reviewer`, `rubric_version`, `grading_kind` (`human` or
`independent_model`) and Boolean `agreed`. Failed predictions use a null goal hash
and cannot agree. The predictor cannot grade itself. Unknown-only successful
predictions are reported separately from the nonempty-goal reliability estimate.

## Fit and freeze admission artifacts

The document component profiler runs on a host where the pinned actor and predictor
are already serving under the rental budget/watchdogs. It makes real inference
requests and HTTP document reads; it never changes model weights or executes the
actor's proposed tool calls. Its JSON configuration needs `version: 1`,
`datasetPath`, `memoryPath`, `corpusPath`, `manifestPath`, `ledgerCheckpointPath`,
`actorBaseUrl`, `predictorBaseUrl`, `limit` (1 to 100), a manifest `seed`, and
`maximumLifetimeSeconds` (1 to 28,800). Paths resolve beside the config. The new
profile manifest must bind the exported runtime memory hash and the same task and
corpus hashes. Do not edit the original collection manifest.

```sh
node --import tsx scripts/goalspec-infra-profile.ts PROFILE_CONFIG.json NEW_MEASUREMENTS
```

For each selected train/development prefix with an eligible visible read, the
profiler runs the same seeded actor input alone and concurrently with one neutral
ranking request. When ranking returns, background goal refresh and one
scheduler-managed immutable read start concurrently. Pair order alternates by
predeclared ordinal. It measures scheduler admission,
the read and freshness validation with one process monotonic clock. `actorLeadMs`
ends when the baseline actor decision returns and a proposed tool request becomes
available, not when the actor request is initially sent. `predictionMs` ends when
the single rank returns. Goal refresh has a separate retained `goalRefreshSpan`,
is fully drained, and is not added to the six admission spans. Concurrent actor
duration measures observed contention during the overlapping work.

Both actor decisions must actually request the profiled exact read; otherwise the
row is retained as failed with no admission estimate. Contention uses
`method: "paired_difference"` with separately retained `baseline`
and `concurrent` spans. Their duration difference is a noisy estimate, not a literal
clock interval or causal attribution. Negative excess, missing components, failed
reads and timeouts remain failed rows with raw receipts. They never receive a zero
fallback. At least ten complete observations are still required by aggregation;
the failure count remains visible and rejecting negative excess can make cost
estimates more conservative. The profile is not a task-success or speedup result.

Native component profiling uses the separate
[native gateway profiling command](INFRA_NATIVE_PROFILE.md). It reconstructs
verified public prefixes in ephemeral pinned tau environments, measures actual
snapshot reads and freshness-lease refreshes, and retains the same paired actor
and predictor evidence. Closed-trace durations cannot substitute for those
measurements. The document profiler continues to refuse native inputs.

```sh
python -m goalspec.infra_cli fit-calibration --bundle DATASET --predictions PREDICTIONS --condition both --output NEW_CALIBRATION
python -m goalspec.infra_cli build-opportunity --bundle DATASET --measurements MEASUREMENTS.json --output NEW_OPPORTUNITY
python -m goalspec.infra_cli build-goal-reliability --bundle DATASET --predictions PREDICTIONS --annotations ANNOTATIONS.jsonl --pilot PILOT.json --reviews HUMAN_REVIEWS.jsonl --grades INDEPENDENT_GRADES.jsonl --output NEW_RELIABILITY
```

Calibration uses training outcomes to fit separate neutral and goal-conditioned
probability maps. Development outcomes are diagnostics only. Both maps live under
one `calibration.json` hash; goal-conditioned execution rejects a missing or stale
conditional map. Goal reliability uses the Wilson lower bound over independently
graded training predictions, including failed predictions. This is label agreement,
not task-success probability; family dependence limits its interpretation. It
enables conditional ranking rather than mixing two separately generated rankings.
Calibration v2 records `independent_next_batch_hit` and `selected_candidates`;
each exact invocation can independently be present in the next authoritative
batch, so scores need not sum to one. It also binds the actual retrieval profile.

Opportunity aggregation requires at least ten complete measured checkpoints and
retains failed measurement rows. Its input has `version: 2`,
`kind: "measured_infra_opportunity"`, `sourceDatasetHash`, a written `protocol`,
ordered `rowIds`, `rows`, a canonical `contentHash`, and `profile`. The profile
binds hardware, serving/stream/concurrency, model, memory, compiler, retrieval,
prompt and protocol hashes. Each completed row and retained raw evidence carry
that profile's `profileHash`. Runtime admission rejects a changed or v1 profile.
Each row binds
`checkpoint_id`, `input_hash`, `family_id` and `split` to the dataset. A completed
row has all six `spans`: `actorLeadMs`, `contentionMs`, `predictionMs`,
`schedulingMs`, `toolMs`, `validationMs`. An ordinary span has a monotonic `clockId`,
`startMs` and `endMs`; subtraction never crosses clocks. A measured zero must be
an explicitly recorded zero-length interval. No missing cost receives a default.
The row's `evidence` identifies a relative local path and SHA-256 of the retained
raw JSON (`kind: "observed_infra_timing"`, matching checkpoint and spans).
Failed rows require `status: "failed"` and `errorType`.
The profiler's contention comparison instead has `method: "paired_difference"`,
`baseline` and `concurrent`, each containing an ordinary span on the same clock.

The builder uses lower p10 tool/lead benefits and upper p90 costs. Those marginal
quantiles are an admission heuristic, not a confidence interval or a demonstrated
live speedup. The builder validates retained evidence; it does not replace the
live profiler or establish that manually supplied intervals were measured.

Document live configuration additionally requires `calibrationDatasetPath` pointing
to the exported document dataset. The task-list hash remains in
`manifest.data.datasetHash`; the calibration, opportunity and reliability artifacts
bind the dataset bundle hash. Startup checks the dataset's task/corpus lineage,
family partitions, frozen memory, model revision, prompt and candidate compiler
before dispatch. Keep the original budget, runtime/model pins and independent GPU
watchdogs in force.

Optional profiler `episodicEmbeddingsPath` and `budgetDirectory` enable frozen
hybrid retrieval through the dedicated `GOALSPEC_RESEARCH_DATABASE_URL`. Query
embeddings use the original journal's development allowance. Replay accepts a
separate optional episodic configuration and freezes one completed retrieval
result per checkpoint for both conditions. See the v2 runbook for exact commands
and fixed-panel binary log-loss/Brier evaluation; neither metric is full-action
entropy.
