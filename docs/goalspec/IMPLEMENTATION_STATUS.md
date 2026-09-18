# GoalSpec local implementation and evaluation

## Latest measured version: v2

The shared runtime now uses compact structured predictions with server-owned
contracts, concurrent goal/read prediction, nonblocking actor boundaries, stale
result fencing, bounded admission and managed shutdown. Immutable Windows host
heartbeats avoid replacing files held by readers. The production scheduler's
general limits remain; v2 session admission ranks at most two candidates and
uses a 0.75 engineering confidence threshold, not a calibrated probability claim.

The same 213 earlier checkpoints improved from 1 to 213 valid predictions and
from 0 to 171 teacher-scored complete-request matches (80.28%, Top-1 and Top-3).
They are development evidence for v2. The single fresh native confirmation scored
15/16 base, 15/16 neutral and 14/16 GoalSpec, with mean total seconds 32.755,
33.402 and 40.355. This does not establish a live success or latency advantage.
The rigid wording-check false negative remains a primary GoalSpec failure.

All 96 new trials are retained separately across two development rounds and one
confirmation. The final export contains 372 total runs, 22 tables and 42,707 rows.
The frozen 32-pattern library and eleven memory-table hashes are unchanged.
The dedicated research PostgreSQL cluster is stopped. Shared known API usage is
$29.271244; spent or reserved is $86.195518, including 43 unresolved requests.
No AWS resources or additional paid dispatch remain active. Usage estimates are
not invoice reconciled.

Core and full application TypeScript checks passed, along with native and browser
integration, host stress and the scoped regression suites. The
[v2 report](../../research/goalspec/reports/2026-09-15-local-v2/README.md) records
exact validation counts, replay results, uncertainty, final source and artifacts.
The [v2 design record](V2_ITERATION.md) explains the architecture changes.

## Preserved v1 completion record

The following sections describe the earlier v1 study. Its measured artifacts and
archive remain unchanged; the v2 section above supersedes its current operational
status and cumulative accounting.

The shared runtime, local evaluation, prediction analysis and accounting are complete. All 276 native trials, including 192 held-out trials, are preserved. GoalSpec did not improve success or latency in this custom tau-compatible pilot. The previous Python pilot and its reports remain intact. See the [final report and verified package](../../research/goalspec/reports/2026-09-14-local-v1/README.md).

## Implemented runtime

- One TypeScript core serves Derya and the research service. Versioned JSON Schema, generated types and shared Python fixtures cover goals, frames, workflows, candidates, evidence, outcomes and manifests. Requested objectives, inferred goals, achieved endpoints and independent verdicts remain separate.
- The runtime infers source-grounded goals, retrieves compatible workflows, binds current arguments, predicts additional reads, executes admitted jobs, and exposes verified evidence. Current server policy is a named source. Unrelated observations do not refresh goals; identical embedding queries are memoized.
- Actor input is bounded at 32,768 tokens and predictors at 8,192. Compiler records preserve required context and record selected evidence, omissions and hashes. Invalid prediction contracts are rejected without admitting their reads. Provider and budget failures remain recorded failures.
- The scheduler limits ranked candidates to three, speculative concurrency to two per run and four globally, starts to twelve per run, lookahead to two hops, and exposed evidence to two entries per boundary. Tool deadlines are five seconds. Exact calls join existing work; cancellation requires physical completion. Mixed mutation/read batches invalidate evidence and preserve authoritative execution.
- The model port honors requested identities, preserves real call IDs and continuation items, rejects malformed calls, and records usage, timing, refusals and incomplete responses. Prefetched observations appear as context, never fabricated function results.
- Derya's generic loop invokes trusted lazy server composition when its durable budget directory is configured. Its existing gpt-5.6 actor, prefetching, six-round limit and specialized branches remain. Five audited reads require current office-wide operator access and full scoped rereads in separate read-only transactions. Every validation SQL query is counted; no avoided-database-work claim follows from reuse.
- Python owns native orchestration, simulation, state and independent checks. The authenticated step gateway provides correlated boundaries and isolated snapshots. Freshness leases last at most 120 seconds, while physical speculative reads retain their five-second deadline. Python revalidates exact actor calls at consumption.

## Data and local infrastructure

- The user's latest instruction replaces AWS with local execution. No AWS resources were created. A dedicated PostgreSQL 17 database with pgvector 0.8.6 used loopback port 55440, separate from application data. It is stopped after verified export.
- Immutable datasets, episodes, annotations, verifications, workflows, embeddings, transition/error statistics, snapshots, frames, goals, evidence, candidates, events and verdicts are populated. Publication and retrieval enforce native verification, training membership and compatible scope/schema/environment. Evaluation cannot mutate the frozen prediction repository.
- All 5,000 pinned APIGen records retain source-reported, research-only lineage. The stratified teacher pilot completed 100 requests: 99 validated annotations and one retained failure. No source record was upgraded to an executable native pattern. The overlap audit found one genuine cross-split request overlap and one lexical false positive, so this provisional source split remains annotation-only.
- Streaming Toucan, Nemotron and NNetNav importers preserve metadata and protocol/output lineage, quarantine incompatible records and retain cross-source duplicate links. Full downloads of these larger corpora were not performed.
- JSONL and Parquet exports include row counts and SHA-256 manifests. Parquet payloads reconstruct their source JSONL exactly. OTLP JSON exports preserve timing without copying request payloads.
- One durable ledger enforces the $500 ceiling and protected allocations. Complete paired cohorts are reserved atomically. Version 2 appends changed reservations and streams mixed-version recovery; historical snapshot records remain unchanged. Unknown provider charges retain maximum reservations.

## Controlled evaluation

| Stage | Completed | Result | Known usage-priced cost |
| --- | ---: | --- | ---: |
| Native training | 48 trials | 46 independently verified successes | $1.378294 |
| Native development | 36 trials | 27 successes | $2.348912 |
| Native held-out | 192 trials | 143 successes; 39 trials flag unresolved provider charges | $12.181323 in known request usage |

The held-out cost above is not a complete total. The completed billing audit includes $0.379109 in known request usage inside seven trials with unknown total charges. The durable ledger retains all 39 uncertain parent caps, yielding $60.552214 held-out spent-or-reserved commitment. Costs use provider-reported usage and pinned standard prices; they are not reconciled to an invoice. The failure logger omitted HTTP status and caught transport-error details, so the exact external causes remain unknown.

Training's uniform verifier amendment corrected four false refusals caused by phrases such as 'no longer needed'. Original executions and verdicts remain archived. No actor was rerun and no failed task was replaced. Two genuine training failures remain.

The frozen library contains 32 eligible read workflows from verified native training episodes. Snapshot `native-training-v1-20260915` has PostgreSQL content hash `90f5555ae711279cf085bde86fc3182dffdf9729ceecc99eb65bb6f4ef2bfb97`.

Development's largest completed cost was $0.120782, with no censored runs. The specified rule fixed allowance $1.25 and sixteen held-out families: two variants, two trials and three paired arms, totaling 192. Actual source bytes and input hashes are frozen in `runs/local-freeze-v2-20260915`, with 478-file source-tree hash `7d3c48a015bd8f7ced8759d8d08e125830428e65591146661a227270b9e65156`. An earlier archive rejected a concurrent documentation update before any held-out dispatch.

Separate native execution replay reproduced every observation and final state in 24 development traces across 153 boundaries. Python counted 78 speculative reads, 25 exact-call consumptions and 91 lease checks, with zero provider calls. Replay timing is separate from live latency. Exact-call reuse is a lower bound on broader usefulness; unmatched executions are an upper bound on waste because exposed evidence may inform the actor.

Held-out success was 52/64 (81.25%) for base, 47/64 (73.44%) for neutral memory plus prefetch, and 44/64 (68.75%) for GoalSpec. Mean native interaction latency was 20.60, 87.47 and 88.06 seconds respectively, including prediction and in-trial validation waits. The GoalSpec-minus-base success difference was -12.50 percentage points, exploratory family-clustered 95% interval [-21.88, -4.69]. Windows power logs confirm host standby and network interruptions near clustered execution failures. These confound interpretation; failed trials remain in the cohort and exact API failure causes remain unknown.

All seven frozen prediction comparisons and seven identical-candidate-pool controls completed on 213 base-arm tool checkpoints from 14 families. Requested-goal annotation covered 109 unique visible inputs, with all 213 checkpoints graded. The predictor produced only one valid contract and 212 failures; requested-goal Top-1 and Top-3 were both 0/213. This is a pipeline reliability failure, not a successful measurement of semantic inference. Separately, the live GoalSpec arm accepted 56/174 goal responses. Invalid predictions fell back to unknown and did not authorize their reads.

Relative to local PASTE, GoalSpec's family-weighted tool cross-entropy improvement was 0.003639 nats, interval [-0.051440, 0.057372], and action improvement was -0.010295, interval [-0.014312, -0.005745]. Identical candidate pools remove the apparent stateless argument-match deficit: all conditions reach 38/213. All 145 correct GoalSpec endpoint Top-1 proxy matches were unknown endpoints. These results do not establish a goal benefit or true conditional entropy reduction. Paper-based baselines are not verified upstream reproductions.

## Final artifacts and accounting

The final 47-file database export contains 22 tables and 31,395 rows, with verified JSONL/Parquet round trips. Three empty tables are explicitly explained in the report. All eleven frozen memory-table hashes remain unchanged. The closed journal records $21.920303 known provider usage and $70.291194 spent or reserved, including 39 unresolved requests. These estimates are not invoice-reconciled. The $500 ceiling and protected allocations remain intact. Final native-service OTLP export contains 18,473 spans; paid replay and annotation events remain separate JSONL artifacts.

No further paid dispatch is active. Automatic tool policy blocked deletion of the temporary DPAPI-encrypted key copy, returning only `blocked by policy`; the copy remains outside the repository and is excluded from the deliverable. The cleanup receipt records this limitation. Protected held-out execution code was not changed after the freeze. Final analysis, telemetry export repairs and documentation are disclosed overlays.

## Verification and limitations

Before held-out execution: 242 Python tests passed and Ruff passed. The TypeScript suite passed 41 tests with its optional database case skipped; that case passed in a separate three-test Derya PostgreSQL run. Both real-browser and Node/Python browser-provider tests passed. Core and full application TypeScript checks passed; full checking used an 8 GB Node heap. Scripted native service parity passed retail and airline with actual lease consumption.

The 0.8 pattern score threshold is an engineering default, not statistically fitted probability calibration. Families test new compositions of known operations. Provider sampling is stochastic despite paired native seeds. Simulator termination and invented facts can cause failures; development included an incompletely specified informational request. Held-out user scenarios were audited before execution and remained unchanged. Automated state, consent and factual checks are narrower than human evaluation.

Derya's business-snapshot path and empty-library prediction fallback are integration-tested, but native results do not measure a live Derya gpt-5.6 cohort. Application credentials and production data were not changed.

Local WebArena deployment definitions, snapshot provider, reset/verifier bridge and isolation tests are implemented. Full upstream containers and paid browser evaluation remain deferred. Safe backend fingerprints and state cloning are deployment prerequisites; unsupported isolation fails closed.

Windows process-restart recovery is tested. Power-loss durability and multi-host budget ownership are unvalidated. The earlier unrelated model-source scan still misclassifies a vehicle fixture as an AI model. No superiority over PASTE or state of the art is established.

Post-execution verification also passed three targeted telemetry-export tests and core type checking, numerical equivalence checks for report corrections, and seven package-helper tests. The package verifies every member hash and discloses allowed post-freeze changes.

See [local reproduction](LOCAL_REPRODUCTION.md), [operation and recovery](../../services/goalspec-runtime/RECOVERY.md), and the [final local report](../../research/goalspec/reports/2026-09-14-local-v1/README.md).
