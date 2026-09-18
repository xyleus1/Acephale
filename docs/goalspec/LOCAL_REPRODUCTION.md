# GoalSpec local reproduction

## V2 results and reproduction entry points

The latest [v2 report](../../research/goalspec/reports/2026-09-15-local-v2/README.md)
contains the redesigned runtime, all 96 new native outcomes, the paired replay of
213 prior checkpoints, method manifests and reproducible analysis commands. The
v2 archive refers to the preserved v1 archive for its original training and
legacy-checkpoint dependencies; keep both packages when reproducing the analyses.

Final confirmation source is in
`research/goalspec/runs/local-v2-confirmation-source-20260915`, with source-tree
hash `93c2d973b2164ebed9e3a713541586722e4af91ef06f8b811dd8907ea1a09166`.
Use the exact capture for measured execution. Later analysis and artifact-export
overlays are identified separately in the package and source verification.

The [legacy replay analysis commands](../../research/goalspec/reports/2026-09-15-local-v2/LEGACY_REPLAY_ANALYSIS_PLAN.md)
reuse completed predictions, 109 teacher references and grades without API calls.
The report-local native execution replay uses recorded actor actions and real
isolated native reads; it makes zero model calls and does not measure live model
latency. Replay destinations must be new. Do not rerun the frozen confirmation
or replace failures as part of reproducing its reported score.

The [v2 repository export guide](../../research/goalspec/reports/2026-09-15-local-v2/REPOSITORY_EXPORT.md)
documents 22 tables and 42,707 rows, verified JSONL/Parquet roundtrips, the bounded
zero-event failure importer amendment and clean PostgreSQL shutdown. Reading the
results and running statistical analysis require no database or API credential.

All paid work is closed. Current shared accounting is $29.271244 known usage and
$86.195518 spent or reserved, including 43 unresolved requests, under the original
$500 ceiling. V2 added $7.350941 known usage. Research remains local-only. The
instructions below preserve v1 reproduction context and historical totals;
use the v2 report for current measurements and artifact paths.

## Preserved v1 reproduction guide

This guide covers the local Windows research deployment, the three native live
arms, prediction and execution replay, immutable exports, and Derya integration.
The evaluation is a **custom tau-compatible pilot**, not an official full
benchmark score. Final measurements and artifact links belong in the
[local results report](../../research/goalspec/reports/2026-09-14-local-v1/README.md).
Do not infer a performance improvement from implementation or parity tests.

The completed study contains 276 native trials, including all 192 declared
held-out trials. Final known API usage is $21.920303 and spent or reserved is
$70.291194, including 39 unresolved requests. The dedicated PostgreSQL cluster
is stopped after verified export. Reading the packaged results and repeating
offline scoring require neither a database nor an API key. GoalSpec did not
improve success or latency in this local pilot.

## Environment and existing artifacts

Run PowerShell commands from the repository root. Model credentials are inherited
from the process environment as `OPENAI_API_KEY`; do not put their values in
commands, documentation, artifacts or source control. No cloud account is needed.

```powershell
$repoRoot = (Get-Location).Path
$researchRoot = Join-Path $repoRoot 'research/goalspec'
$runsRoot = Join-Path $researchRoot 'runs'
$researchPython = Join-Path $researchRoot '.venv/Scripts/python.exe'
$nativePython = Join-Path $researchRoot '.benchmarks/tau3/.venv/Scripts/python.exe'
$budgetDirectory = Join-Path $runsRoot 'local-evaluation-20260914'
$fixturesPath = Join-Path $runsRoot 'fresh-native-v1-20260915/fresh-tasks.json'
$trainingDirectory = Join-Path $runsRoot 'local-training-v2-verdicts-20260915'
$trainingExport = Join-Path $runsRoot 'local-training-export-v1-20260915'
$libraryDirectory = Join-Path $runsRoot 'local-library-v1-20260915'
$developmentDirectory = Join-Path $runsRoot 'local-development-v1-20260915'
$heldoutDirectory = Join-Path $runsRoot 'local-heldout-v1-20260915'
$freezeDirectory = Join-Path $runsRoot 'local-freeze-v2-20260915'
$env:GOALSPEC_DATABASE_URL = 'postgresql://goalspec_owner@127.0.0.1:55440/goalspec_research'
```

The URL is a local fixture identity, not an application credential. PostgreSQL
listens only on loopback. Research storage is separate from Derya's `DATABASE_URL`.
The publication/export clients reject application database reuse and require a
database name beginning with `goalspec_`.

| Component | Pinned configuration |
| --- | --- |
| Research actor and annotation teacher | `gpt-5.4-2026-03-05`; actor reasoning `medium`, output cap 4,096 |
| Goal predictor, candidate predictor, user simulator | `gpt-4.1-mini-2025-04-14`; separate contracts, output cap 1,024 |
| Embeddings | `text-embedding-3-small`, 1,536 dimensions |
| Input compilation | Actor 32,768 tokens; each predictor 8,192 tokens |
| Native benchmark checkout | `sierra-research/tau2-bench`, commit `2174a603f6d014ef94473ffa95957f6ce27100db` |
| Local database | PostgreSQL 17 with pgvector 0.8.6 |
| Derya actor | Existing `gpt-5.6`, separate from the native evaluation |

The runtime honors these identities and rejects malformed calls. Provider failures
do not authorize model substitutions. Pinned benchmark and dataset release
metadata are in `research/goalspec/benchmarks.lock.json` and
`research/goalspec/dataset-releases.lock.json`.

For a new checkout, install dependencies before starting an experiment:

```powershell
npm ci
python -m uv sync --project research/goalspec --frozen --extra analysis --group dev
git clone https://github.com/sierra-research/tau2-bench.git research/goalspec/.benchmarks/tau3
git -C research/goalspec/.benchmarks/tau3 checkout 2174a603f6d014ef94473ffa95957f6ce27100db
python -m uv sync --project research/goalspec/.benchmarks/tau3 --frozen --extra knowledge --extra voice --python 3.12
```

Existing environments do not need cloning or rebuilding. The native environment
uses its own dependency lock and Python 3.12; the research package is installed in
its separate environment. The upstream voice extra is needed for eager imports,
although this experiment uses text interaction.

## Start and inspect the local research database

```powershell
./scripts/goalspec-local-postgres.ps1 -Action status
# Use start only when status reports that this cluster is stopped.
./scripts/goalspec-local-postgres.ps1 -Action start
node --import tsx scripts/goalspec-repository.ts inspect current
```

On a machine without this cluster, run `-Action initialize` once instead. It
requires PostgreSQL 17 development headers and Visual Studio 2019 Build Tools,
downloads the pinned official Windows SDK packages, compiles pgvector commit
`8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c`, copies a portable PostgreSQL runtime, and
creates the research and repository-test databases. It refuses an existing
cluster. It does not alter the installed application's database. The portable
runtime and cluster live under `runs/pg17-local-v1` and
`runs/pg-research-local-v1`.

The frozen native library contains **32 patterns and 32 embeddings**, supported by
46 independently successful training episodes. Its snapshot ID is
`native-training-v1-20260915` and content hash is
`90f5555ae711279cf085bde86fc3182dffdf9729ceecc99eb65bb6f4ef2bfb97`.
PostgreSQL retrieval checks that the supplied `records.json` has exactly the same
semantic records as the frozen snapshot. Vector float32 rounding is excluded from
that comparison. Frozen rows cannot be changed by evaluation writes.

The repository also retains 5,000 APIGen episodes at `source_reported` verification
and 99 validated requested-goal annotations. The one failed annotation is retained
in the source artifact and excluded from the annotation table. These records are
annotation research material, not native executable experience.

## Validation without model calls

Use new output and temporary directories for immutable test artifacts. Run these
outside timed live trials to avoid introducing local resource contention.

```powershell
npm run goalspec:check
npm run test:goalspec
npm run test:goalspec-browser
$testRun = Get-Date -Format 'yyyyMMdd-HHmmss'
& $researchPython -m pytest research/goalspec/tests --basetemp (Join-Path $runsRoot "pytest-$testRun")
& $nativePython research/goalspec/scripts/native_snapshot_parity.py
& $nativePython research/goalspec/scripts/native_service_parity.py (Join-Path $runsRoot "service-parity-$testRun")
```

The research repository integration test uses only its synthetic database:

```powershell
$env:GOALSPEC_REPOSITORY_TEST_URL = 'postgresql://goalspec_owner@127.0.0.1:55440/goalspec_repository_test'
node --import tsx --test scripts/goalspec-repository-database.test.ts
```

Derya database freshness tests (`npm run test:goalspec-db`) require a separate
disposable database initialized with the application Prisma schema. They use
`GOALSPEC_TEST_DATABASE_URL`; never point them at the research repository or live
business data. They exercise independent-connection inserts, deletes, ordering,
joined-field changes, ownership transfers and revoked access. Deterministic
browser tests do not provision the full upstream browser environment.

## Public corpus and requested-goal annotation

The acquired APIGen release is under
`runs/apigen-abc4a517d67c541f85f6470cbd8fd3186b36830e`. Its acquisition manifest
records the raw file hash, pinned revision and research-only CC BY-NC 4.0 lineage.
`scripts/acquire_apigen.py` downloads that release only and refuses an existing
destination. The existing `ingested` directory contains the 5,000 normalized
episodes and the stratified 100-record `annotation-pilot.jsonl` queue.

```powershell
$apigenDirectory = Join-Path $runsRoot 'apigen-abc4a517d67c541f85f6470cbd8fd3186b36830e'
$annotationDirectory = Join-Path $runsRoot 'apigen-annotations-20260914'
node --import tsx scripts/goalspec-repository.ts import-corpus (Join-Path $apigenDirectory 'ingested')
node --import tsx scripts/goalspec-repository.ts import-annotations (Join-Path $annotationDirectory 'records.jsonl') (Join-Path $apigenDirectory 'ingested/annotation-pilot.jsonl')
& $researchPython research/goalspec/scripts/audit_corpus.py (Join-Path $apigenDirectory 'ingested/episodes.jsonl') (Join-Path $runsRoot 'apigen-overlap-audit-reproduction')
```

The current streaming importer API is `goalspec.corpus.ingest(path, destination,
source, revision, license_text, families, dedup_database, max_records=None)`.
`source` accepts `apigen`, `toucan`, `nemotron` and `nnetnav`; `families` maps each
source ID to `(family_id, split)` and must be established before annotation.
It validates source-specific compatibility, preserves source metadata and output,
quarantines malformed records, and records cross-source duplicate links in a
shared SQLite index. The version 2 identity includes tools, policy, messages and
source output. Imported records remain nonexecutable until independent native
verification and compatible binding exist. Large corpus downloads are not required
to test the bounded streaming importer.

The existing APIGen overlap audit found two cross-split near-duplicate candidate
pairs: review identified one true requested-intent overlap and one lexical false
positive. Its provisional family split is not a certified held-out benchmark.
Keep the acquired files, original splits and teacher outputs unchanged.

To generate annotations in a separately named output directory, the paid command
is `node --import tsx scripts/goalspec-annotate.ts QUEUE_JSONL SHARED_BUDGET_DIRECTORY
NEW_OUTPUT_DIRECTORY`. It must use the same budget journal as the rest of this
experiment. Reusing the existing validated outputs makes no provider calls.

## Native training, frozen publication and paired live trials

The following is the execution sequence used for this experiment. These commands
make paid requests where indicated. Existing phase directories and reservations
are immutable; they are not restart targets. Do not rerun a completed phase into
its existing namespace. An independent experiment needs distinct trial identities
and a deliberately versioned publication, while retaining all spending within the
authorized ceiling. The library builder's snapshot ID is currently explicit in
its source, so a different library requires an explicit new snapshot version.

1. Generate fixtures and complete all reference checks before the first actor.
   The existing manifest has 92 tasks: 24 training families, six development
   families and 16 candidate held-out families, each with two variants.

   ```powershell
   & $nativePython research/goalspec/scripts/prepare_fresh_native.py (Join-Path $runsRoot 'fresh-native-v1-20260915')
   ```

2. Collect 48 base-actor training trials, with the default 40 native step limit.
   This is a paid phase.

   ```powershell
   & $nativePython research/goalspec/scripts/run_native_live.py --manifest $fixturesPath --output (Join-Path $runsRoot 'local-training-v1-20260915') --phase train --budget-directory $budgetDirectory --seed 20260915 --max-steps 40 --concurrency 3
   ```

   Historical training used the first independent verifier. A uniform version 2
   amendment corrected four false-positive consent denials, yielding **46/48**
   successes. Both genuine failures remain. The amendment reran no actors and
   replaced no tasks. Original artifacts are preserved; `amendment.json` links
   their hashes and all verdict changes. Current executions already use verifier
   v2. To reproduce that historical correction only:

   ```powershell
   & $nativePython research/goalspec/scripts/amend_native_verdicts.py --source (Join-Path $runsRoot 'local-training-v1-20260915') --fixtures $fixturesPath --output $trainingDirectory
   ```

3. Export training and build the frozen read-only library. Export and database
   import are local; the builder makes real embedding calls.

   ```powershell
   & $researchPython research/goalspec/scripts/export_native_training.py --source $trainingDirectory --fixtures $fixturesPath --output $trainingExport --phase train
   node --import tsx scripts/goalspec-repository.ts import-native (Join-Path $trainingExport 'repository-bundle.json') (Join-Path $runsRoot 'native-import.json') research/goalspec/src/goalspec/fresh_tasks.py
   node --import tsx scripts/goalspec-build-library.ts (Join-Path $trainingExport 'mining-episodes.json') (Join-Path $trainingExport 'repository-bundle.json') (Join-Path $trainingDirectory 'service-manifest.json') $budgetDirectory $libraryDirectory
   node --import tsx scripts/goalspec-repository.ts publish (Join-Path $libraryDirectory 'publication.json') (Join-Path $runsRoot 'native-publication.json')
   ```

   Publication admits only compatible independently verified training support.
   Failed branches remain recorded. Transition and symbolic binding replay error
   statistics are frozen with the snapshot; they are not estimates of held-out
   prediction errors. Support requires at least two distinct verified families.
   The **0.8** pattern admission threshold is a fixed engineering default, not a
   statistically calibrated probability.

4. Run 36 development trials across `base`, `neutral_memory_prefetch` and
   `goalspec`. Both enhanced arms expose verified prefetches; the neutral arm uses
   goal-neutral memory, while GoalSpec exposes inferred goals and matching memory.
   All arms use the same actor configuration, tasks, seeds and applicable budgets.
   Arm order is randomized within paired blocks. Concurrency is between blocks;
   arms within a block execute sequentially. This is a paid phase.

   ```powershell
   & $nativePython research/goalspec/scripts/run_native_live.py --manifest $fixturesPath --output $developmentDirectory --phase development --budget-directory $budgetDirectory --records (Join-Path $libraryDirectory 'records.json') --seed 20260915 --max-steps 40 --concurrency 3
   ```

5. Freeze source bytes, configurations, fixtures, records and development cost
   evidence before held-out execution. The freeze includes uncommitted work and a
   source archive. Its output argument is a new directory containing `manifest.json`
   and `source.zip`. Source writes must pause until freezing finishes:

   ```powershell
   & $researchPython research/goalspec/scripts/freeze_experiment_source.py freeze --output $freezeDirectory --fixtures $fixturesPath --records (Join-Path $libraryDirectory 'records.json') --development-design (Join-Path $developmentDirectory 'design.json') --development-outcomes (Join-Path $developmentDirectory 'outcomes.jsonl')
   ```

   The held-out allowance `b` is the largest of $1.25, 1.25 times the largest
   completed development cost, and $2.50 if a development run was censored,
   rounded upward to $0.25. Family count is
   `N = min(16, 2 * floor(240 / (24 * b)))`. Selection uses development costs only.
   All arms, variants and two trials per task are reserved atomically before any
   held-out dispatch. Budget terminations remain failures and are never replaced.

6. Run the frozen held-out cohort, then verify its source freeze. This live phase
   makes paid requests; source verification does not.

   ```powershell
   & $nativePython research/goalspec/scripts/run_native_live.py --manifest $fixturesPath --output $heldoutDirectory --phase heldout --budget-directory $budgetDirectory --records (Join-Path $libraryDirectory 'records.json') --development (Join-Path $developmentDirectory 'outcomes.jsonl') --seed 20260915 --max-steps 40 --concurrency 3
   & $researchPython research/goalspec/scripts/freeze_experiment_source.py verify --frozen $freezeDirectory --output (Join-Path $freezeDirectory 'verification.json')
   ```

Each completed phase writes `design.json`, `service-manifest.json`, public contexts
captured before actor execution, per-run native artifacts, `outcomes.jsonl` and
`summary.json`. The Python runner starts the authenticated local step gateway and
Node host; no gateway token needs to be copied manually. Live PostgreSQL retrieval
uses `GOALSPEC_DATABASE_URL`. Evaluation runs cannot update the frozen library.

## Telemetry, three evaluation harnesses and immutable export

After a phase completes and its host drains, import its telemetry. The importer
verifies hash-chained events, independent verdict identity and source references.
Original training lacked complete frame payloads; reconstructed native prefixes
are accepted only when they match the original logged frame hash, and are labeled
as reconstructions. Later phases record the actual execution frames.

```powershell
node --import tsx scripts/goalspec-telemetry.ts import $trainingDirectory $budgetDirectory (Join-Path $runsRoot 'training-telemetry-reproduction')
node --import tsx scripts/goalspec-telemetry.ts import $developmentDirectory $budgetDirectory (Join-Path $runsRoot 'development-telemetry-reproduction')
node --import tsx scripts/goalspec-telemetry.ts import $heldoutDirectory $budgetDirectory (Join-Path $runsRoot 'heldout-telemetry-reproduction')
& $researchPython research/goalspec/scripts/evaluate_v1.py live --results (Join-Path $heldoutDirectory 'outcomes.jsonl') --design (Join-Path $heldoutDirectory 'design.json') --output (Join-Path $runsRoot 'heldout-report-reproduction')
```

The live report computes task success, constraints, calls, latency, usage costs,
two-trial consistency and paired family-clustered intervals. Estimated usage costs
must remain distinguishable from invoice-confirmed billing.

Frozen prediction replay uses the saved trajectories. It is distinct from both
live latency and actual speculative execution:

```powershell
$heldoutExport = Join-Path $runsRoot 'heldout-export-reproduction'
& $researchPython research/goalspec/scripts/export_native_training.py --source $heldoutDirectory --fixtures $fixturesPath --output $heldoutExport --phase heldout
& $researchPython research/goalspec/scripts/evaluate_v1.py prepare-requests --training (Join-Path $trainingExport 'trajectories.jsonl') --heldout (Join-Path $heldoutExport 'trajectories.jsonl') --output (Join-Path $runsRoot 'requested-goal-queue-reproduction')
```

`scripts/goalspec-prediction-replay.ts` has paid `predict`, `annotate` and `grade`
modes. Each takes `QUEUE_JSONL SHARED_BUDGET_DIRECTORY NEW_OUTPUT_DIRECTORY`;
`grade` additionally takes the prediction and annotation directories. Prediction
uses only the visible checkpoint. Annotation and grading retain their separate
teacher contracts and lineage. Combine them with:

```text
python research/goalspec/scripts/evaluate_v1.py requested-goals --queue QUEUE_JSONL --predictions PREDICTION_DIRECTORY --annotations ANNOTATION_DIRECTORY --grades GRADE_DIRECTORY --output NEW_REQUESTED_REPORT_DIRECTORY
python research/goalspec/scripts/evaluate_v1.py prediction --training TRAIN_TRAJECTORIES_JSONL --heldout HELDOUT_TRAJECTORIES_JSONL --goal-cache FROZEN_GOALS_JSONL --requested-goal-report REQUESTED_REPORT_SUMMARY_JSON --output NEW_PREDICTION_REPORT_DIRECTORY
```

Use the research Python environment for those templates. In `requested-goals`,
`--predictions`, `--annotations` and `--grades` take directories, not individual
JSONL files. The reader appends `requested-predictions.jsonl`,
`requested-annotations.jsonl` and `requested-grades.jsonl`, respectively.
`--queue` takes the queue JSONL file. In `prediction`, `--goal-cache` takes the
`frozen-goals.jsonl` file, and `--requested-goal-report` takes the requested report's
`summary.json` file. All output directories must be new.

To repeat the completed scoring entirely from saved inputs, without provider
calls or a running database:

```powershell
$scoreStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$savedQueue = Join-Path $runsRoot 'local-requested-queue-v1-20260915/queue.jsonl'
$savedPredictions = Join-Path $runsRoot 'local-requested-predict-v1-20260915'
$savedAnnotations = Join-Path $runsRoot 'local-requested-annotate-v1-20260915'
$savedGrades = Join-Path $runsRoot 'local-requested-grade-v1-20260915'
$requestedReport = Join-Path $runsRoot "requested-report-offline-$scoreStamp"
& $researchPython research/goalspec/scripts/evaluate_v1.py requested-goals --queue $savedQueue --predictions $savedPredictions --annotations $savedAnnotations --grades $savedGrades --output $requestedReport
& $researchPython research/goalspec/scripts/evaluate_v1.py prediction --training (Join-Path $trainingExport 'trajectories.jsonl') --heldout (Join-Path $runsRoot 'local-heldout-export-v1-20260915/trajectories.jsonl') --goal-cache (Join-Path $savedPredictions 'frozen-goals.jsonl') --requested-goal-report (Join-Path $requestedReport 'summary.json') --output (Join-Path $runsRoot "prediction-report-offline-$scoreStamp")
```

These commands preserve all 212 failed goal predictions as observed misses. Do
not rerun them through a changed model or prompt and attach the resulting cache
to the original experiment. New paid research requires fresh study and request
identities plus reservations in the shared ledger. A new output directory alone
does not bypass previously recorded request IDs or unresolved spending caps.

Prediction comparisons
include stateless, local PASTE, PASTE plus memory, GoalSpec without episodic memory,
full GoalSpec, oracle goals and shuffled goals, with identical candidate pool
ranking controls. These are paper-based baselines, not verified upstream
reproductions. Action log loss and entropy-reduction estimates are cross-entropy
estimates; they do not establish true conditional entropy.

Execution replay reuses recorded candidate predictions and authoritative actions
against reset native states. It makes no provider calls and checks observation,
state and termination parity:

```powershell
$eventFiles = Get-ChildItem -LiteralPath $budgetDirectory -Filter 'events-*.jsonl' | Select-Object -ExpandProperty FullName
& $nativePython research/goalspec/scripts/native_execution_replay.py --source $heldoutDirectory --fixtures $fixturesPath --logs $eventFiles --output (Join-Path $runsRoot 'native-execution-replay-reproduction')
```

Keep replay timing separate from measured live latency. Node's `useful` event
means staged reuse; final consumed reuse comes from Python `promotion_events` with
`status: consumed`, excluding stale fallbacks. Revalidation is counted explicitly.

Export the populated research database after final telemetry import:

```powershell
$exportDirectory = Join-Path $runsRoot 'repository-final-export-reproduction'
node --import tsx scripts/goalspec-export-repository.ts $exportDirectory
& $researchPython research/goalspec/scripts/export_parquet.py $exportDirectory --budget (Join-Path $budgetDirectory 'budget.jsonl')
node --import tsx scripts/goalspec-budget-report.ts $budgetDirectory (Join-Path $runsRoot 'budget-report-reproduction.json')
& $researchPython research/goalspec/scripts/export_otel.py --events $budgetDirectory --output (Join-Path $runsRoot 'otel-reproduction.json')
```

The database exporter reads 22 allowlisted research tables in one read-only
repeatable-read transaction. It writes canonical JSONL, followed by Parquet with
lossless canonical row payloads and verified round trips. `manifest.json` and
`manifest.sha256` record file hashes, row counts and source hashes. Empty tables
remain explicit. Budget archival requires a closed journal and copies its mixed
version 1/version 2 bytes unchanged. The OTLP JSON export contains execution
metadata without model/tool payloads and needs no external collector.

## Derya application integration

Derya initializes GoalSpec lazily from its generic chat loop. Set
`GOALSPEC_DERYA_BUDGET_DIRECTORY` to an absolute local shared-budget directory to
enable that path, with the existing server `DATABASE_URL` and `OPENAI_API_KEY`
configured securely. If `GOALSPEC_BUDGET_DIRECTORY` is also set, both directory
paths must resolve to the same location. Restart the application after changing
GoalSpec configuration. A single process owns the budget journal, so drain the
native host before enabling an application instance against the same journal.

Initialization is gated on an active operator with office-wide access. Every
boundary rechecks authorization. Initial eligible reads are `search_jobs`,
`search_inquiries`, `search_companies`, `get_job` and `list_open_inquiries`.
Authorization and joined-record ownership are checked again inside separate short
read-only transactions at speculative execution and exposure/consumption. The
complete scoped projection is reread; changed observations replace old ones.
Validation SQL and latency are counted, so verified reuse is not described as
avoided database work. Mixed mutation/read batches invalidate evidence and retain
native authoritative batch behavior.

`GOALSPEC_DERYA_SNAPSHOT_FILE` is optional. Its versioned artifact must declare
`purpose: derya_business`, `source: derya_native_verified`, and a matching records
hash, schema, environment and authorization scope. Without it, the business
experience repository starts empty. Native benchmark and APIGen records are not
business memory. `GOALSPEC_DERYA_ENVIRONMENT_VERSION` defaults to
`derya-goalspec-v1`. Events are written as `derya-events-*.jsonl`.

The existing application actor remains `gpt-5.6`; its product behavior and costs
are separate from the native `gpt-5.4` trial results. The generic loop preserves
its prefetching and six-round limit, and specialized RFQ/proposal branches remain
separate. No speculative writes, messages, purchases or confirmations are admitted.

## Recovery and limits

The shared $500 ceiling keeps the original allocation caps: infrastructure $35,
preparation $30, training $60, development $40, held-out $240, replay $30 and
contingency $65. Local execution does not reallocate the protected reserves.
Provider usage estimates and unresolved request caps are reported separately.

The journal now appends version 2 `changes` records and streams recovery across
both old full snapshots and new deltas. Cohort reservation is atomic. Unknown
request outcomes retain their maximum reservations; an invalid or torn journal
blocks dispatch. A crash lock must never be reclaimed merely because it is old.
See [recovery procedures](../../services/goalspec-runtime/RECOVERY.md).

Native freshness tokens have a maximum 120-second lifetime, and refresh does not
extend the original expiry. The speculative execution deadline is five seconds.
Default limits are three ranked candidates, two speculative reads per run, four
globally, 12 starts per run, two read-only lookahead hops and two new evidence
entries per actor boundary. Windows tests establish process-restart recovery;
power-loss durability and multi-host ownership are unvalidated.

Full upstream browser reset/verifier deployment and paid browser evaluation remain
deferred. Local adapter/isolation tests cannot establish WebArena performance.
Small native cohorts, shared task primitives, fixed admission thresholds and local
machine contention limit generalization. The final report must show uncertainty,
regressions and failed trials alongside any measured gains.

The completed run also has independently recorded Windows standby and network
interruptions near clustered provider failures. Preserve those outcomes; a future
study should establish host wake/network handling before a new source freeze.
Automatic tool policy blocked deletion of the temporary DPAPI-encrypted credential
copy outside the repository. The archive excludes it and includes the cleanup
receipt; no provider process remains active.

The [package instructions](../../research/goalspec/reports/2026-09-14-local-v1/PACKAGE_BUILD.md)
describe the allowlist, frozen source, current report/export overlays, complete
raw artifacts and verification sidecars. The final package excludes dependency
caches, database storage, unrelated application data and credentials.
