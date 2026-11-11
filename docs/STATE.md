# Acephale state

Updated 2026-11-11. This records the standalone research checkout and the retained
execution history. Current results are summarized first; dated historical
checkpoints below do not describe the current optimizer or cohort state.

## Current verified checkpoint

The completed R3 base cohort retained all 12 trials: nine mixed-partition native
successes, one evaluated failure and two incomplete actor responses with unknown
native reward. Development alone is 1/4, not 9/12. It made 77 logical and physical
tool calls with no speculation. Mean live latency including drain is 53.897 s;
including evaluation it is 56.874 s. These are custom tau-compatible pilot
observations, not an official full benchmark or a paired improvement result.

Frozen data contains 150 public checkpoints and 120 compiled examples: 34 fitting,
46 calibration and 40 development. Fitting has nine positive candidate bits;
development pool coverage is 9/19. The base fixed-panel replay completed 145/150
rows and retains five failures. No trained-weight comparison is yet verified.

A2 optimizer progress remains unknown after infrastructure termination. A3's
first smoke recorded one zero-learning-rate step with unchanged adapter bytes;
the next recovery failed before model loading on lockfile permissions. Both full
failed outcomes are preserved. Sequence03 explicitly binds trainer `83bddc7` and
a permission-only image05, unchanged seeds/main recipe and the original training
deadline. Sequence03 then completed one smoke optimizer step and development
evaluation, recording changed adapter and unchanged frozen-base hashes, but
failed adapter reload parity before merge. Neither main seed started and no
trained predictor was qualified for replay. Optional standalone teacher-forced
evaluations were omitted; main Trainer development evaluation was unchanged.
The reload mismatch requires diagnosis before another bounded experiment.
Do not infer current resource status from this document.

See the [detailed pilot report](experiments/predictor-lora-pilot-2026-11-10.md)
for immutable source/data identities, failure counts and reproduction commands.
The frozen serving/compiler remains `2d89765`; controller `98fcb938` and reporter
`f862525` are separately pinned. Integration CI for `b7ab0fe` passed 237 Node,
391 Python and 167 deployment tests, with eight documented platform/environment
and opt-in Docker skips across Node/Python. The full failed sequence03 archive
and all 32 payload files were independently verified; 33 cache omissions retain
hashes. No performance claim follows from software tests or smoke diagnostics.

## Historical first native collection: retained infrastructure failure

The first 12-slot base collection closed with two successful tasks and ten
execution errors, retaining every declared slot. A Windows `EPERM` replacing
`metrics.prom` poisoned telemetry and terminated the service. All 22 recorded
actor requests completed; the ten errors are infrastructure-censored failures,
not ten independently evaluated actor failures. Only two actual native rewards
exist, both 1.0. Study pass1 is 2/12; this aborted cohort is ineligible for fitting.

Stage wall time was 159.240 seconds. Successful-task time with actor/user drain
had mean/median 32.576 seconds and observed p90 35.591 seconds, with only two
samples. The shorter elapsed times of aborted slots are not a latency improvement.
Hosted simulator/judge usage cost was $0.009232 with no unknown provider charges;
GPU reservation and invoice reconciliation remain separate.

The metrics writer now preserves atomic replacement, retries transient Windows
sharing failures, skips unchanged snapshots and drains SDK exporters on failure.
Fourteen focused tests passed, including actual Windows locked-file reproduction,
old-snapshot preservation and successful replacement after unlock.

A separate full recovery cohort is predeclared; the original failed cohort is
never replaced or relabelled. The optional upstream assertion-audit mode preserves
the official reward basis. Six selected airline tasks have eleven configured NL
assertions; the six retail tasks have none. Missing or incomplete checks stay
unknown, and constraint scope is limited to those declared assertions.

The locked trainer image has built successfully, but no optimizer step or trained
predictor result exists at this checkpoint. Native SDK traces and two span metrics
reach the remote observability stack; full native metrics and redacted lifecycle
logs remain local Windows artifacts until separately verified publication.

## Actual second deployment and pre-dispatch transport check

The second A100 lease passed actual serving, database, tool-call continuation,
binary-logprob, telemetry and deployment-inventory checks at source
`ae71b861e3aca8919c66073bc37fbc5d6c2e53da`. Independent local verification
rehashed all 235 exported files. Archive SHA-256 is
`5458afcfc315612a8df23695e897621403313fa484a842a69ac1b2d0a8c1d358`.
The lease was marked ready before its setup deadline; both cleanup controllers
received that state. This qualification contains no native score or optimizer step.

The 12-task base-only collection was prepared but not dispatched. Its initial
split-host guard failed closed: three diagnostic SSH probes alone took 2,503,
2,727 and 2,774 ms, exceeding the 2,500 ms observation budget before local
endpoint checks. The guard and its owned tunnel were drained. A persistent
authenticated probe transport must pass before dispatch; increasing the
freshness allowance is not the remedy. Original preparation and failed health
observations remain immutable, with zero hosted trial calls at this checkpoint.

The completed [CI run for this source](https://github.com/xyleus1/Acephale/actions/runs/42895723953)
passed 223 Node tests with no skips, 304 Python tests with two platform/environment
skips and 166 deployment tests. Types, ESLint and Ruff passed. These counts
supersede earlier software totals only for this exact revision.

A deeper public-prefix APIGen review grouped all 17 overlapping calibration
records with their fitting comparators. Conservative exclusion against the
frozen native objectives left five candidate records in two families, none
approved for fitting. More family diversity and a relevant human review are
needed; reshuffling these rows cannot produce four independent partitions.

## Actual GPU qualification, first attempt

Both independent cleanup controllers passed real termination canaries. A leased
A100 40 GB then ran the exact actor and predictor concurrently, using 31,741 MiB.
Observed checks passed for an actual tool call and its continuation ID, structured
binary output with raw token probabilities, and retrieval from Tempo, Prometheus,
Loki and Grafana. This was an infrastructure fixture, not a native task score.
The raw evidence was exported and its archive SHA-256 independently verified.

The final deployment inventory did not pass before the 30-minute setup deadline.
The host was terminated and provider absence was verified. No optimizer step or
native trial ran; the compute reservation remains until billing reconciliation.
The immutable serving image declares CUDA base release 13.0.2, whereas the earlier
manifest incorrectly expected 13.0.3. PyTorch separately reports compile CUDA
13.0. Correcting these metadata meanings must preserve the original image/model
identities and financial binding, with observed package details retained.

Actual startup also identified and repaired Tempo 3 configuration, Alloy file
discovery, the inventory Python executable and Node/Python Lambda guard parity.
Starting the predictor to health before the actor avoided the initial concurrent
memory-profiling failure without changing the model or GPU-memory settings.

## Predictor training implementation

The scoped Qwen3.5-0.8B LoRA experiment now has a separate locked training
environment, production prompt export, partition/provenance checks, a bounded
CUDA trainer, adapter reload/merge verification and immutable derived-model
identities. Runtime ranking can use binary token probabilities with separate
calibration. The actor remains fixed. The Lambda A100 profile, original-journal
binding and two independent cleanup-controller implementation are included.

Current local verification on 2026-11-10:

| Check | Observed result |
| --- | --- |
| Generated contracts and TypeScript | Passed |
| Full Node suite | 217 passed, two PostgreSQL-dependent tests skipped |
| Full Python research rerun with the pinned native environment | 304 passed, no skips |
| Full deployment unittest suite | 141 passed |
| ESLint | Zero errors, 33 explicit-any warnings |

The initial Python run had 300 passes, one native-environment skip and two
failures: an exact console-entrypoint expectation needed the new training CLI,
and a Node subprocess timed out. The entrypoint check was corrected. The
original 30-second subprocess limit passed in focused verification and the
subsequent full run; it was not relaxed. The full rerun above enabled the
installed native environment. These are software tests, not GPU training or
live benchmark scores.

The historical seed import identified 99 valid requested-goal annotations;
three in previously flagged overlapping families were quarantined. A 20-case
human review packet was prepared from the remaining 96. Review remains pending
at this implementation checkpoint. No goal-labelled training, actual weight
change or native performance gain is established by this entry.

Read-only provider verification found the selected A100 40 GB profile available
at $1.99/hour. A public SSH key and restricted access rules were configured;
no paid GPU had launched at this checkpoint. Real watchdog recovery, CUDA
qualification, training and paired evaluation remain separate execution stages.
See the [training guide](../research/acephale/training/README.md) and
[Lambda runbook](../infra/acephale-infra-v1/LAMBDA_CONTROL.md).

The [predictor-branch CI run](https://github.com/xyleus1/Acephale/actions/runs/42885472272)
passed for `3f23ae0c55a6d3fab0973e70b8bc097aebb90260`: 220 Node tests passed
without skips, Python had 302 passes and two environment/platform skips, and
141 deployment tests passed. Real disposable PostgreSQL/pgvector integration
ran in CI. The final local training/entrypoint focused check passed 25 tests
after the trained-model evaluation mount adjustment; Ruff also passed.

The source-only native cohort audit is explicitly provisional. Its keyword
taxonomy can split equivalent cancellation/refund requests into different
families. Proposed IDs must receive semantic overlap review before collection
or evaluation; the original 24-family target is not established by this audit.
Neither a lack of lexical matches nor a task-count target proves independence.

A subsequent source-design review defines a smaller candidate-only pilot with
two semantic families per partition, two task variants per family. It excludes
all APIGen examples from its weights and memory. The source review is an
assistant's task-design review, not the required human annotation-quality audit.
The `--fresh-fit` memory builder now filters to weight-fitting families before
episode extraction, binds the reviewed partition chain and preserves original
source files. Its focused tests passed 14 cases and TypeScript validation passed.
The original APIGen seed split remains ineligible pending semantic regrouping.

Two AWS cleanup controllers have now been deployed within the existing overhead
reservation. The account's observed concurrency limit of ten required
conditional S3 locking instead of reserved Lambda concurrency. The first real
GPU recovery canary completed with provider-confirmed termination. Further
canary, serving and training status is retained in private operator receipts;
this is still not a trained-model or native benchmark result.

## Implemented scope

- Shared TypeScript contracts, current-source binding, workflow/episodic memory,
  single-call conditional ranking and managed read-only speculative scheduling.
- Pinned Qwen actor/predictor serving interfaces with unchanged actor weights and
  tool catalog, authenticated native Python gateway and document adapter.
- Causal shadow trace collection, independently verified outcome handling,
  frozen embeddings/retrieval, calibration v2 and deployment-bound opportunity v2.
- Matched candidate-panel evaluation, paired native trial reporting, original
  budget accounting and OpenTelemetry/Prometheus observability.
- Standalone Node/Python project layout and direct research SQL integration.

## Standalone verification

The following local checks ran against this standalone source on 2026-11-07.
These are software checks, not live model evaluation:

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed generated-contract checks and TypeScript compilation |
| Full local `npm test` | 208 tests: 206 passed, 2 skipped; both skips require a real local PostgreSQL database |
| Subsequently added budget-report tests | 2 passed in a focused run; 210 distinct Node tests are covered across these local runs, not one full local 210-test run |
| Initial full local research pytest, fresh Python 3.12.14 environment | 276 passed, 1 failed because a native fixture imported an ESM default export that does not exist |
| Native-profile file rerun after correcting the import | 6 passed, including the previously failing pinned native snapshot/gateway test; the entire research suite was not rerun locally after that fix |
| Full deployment unittest suite | 124 passed |
| ESLint | 0 errors, 27 `no-explicit-any` warnings |
| Research Ruff and `acephale --help` | Passed |
| Documentation audit | Local links, documented Node/Python entrypoints and npm script names resolve |

The native test uses actual pinned environment/snapshot/gateway code with mocked
model responses, not paid model calls. The successful focused rerun resolves the
initial failure without relabeling the earlier full pytest run as all-passing.
Do not sum overlapping focused tests as independent coverage. The two later
budget-report tests are additional, distinct cases.

Retained operator-side logs include `acephale-check-final-20261107.txt`,
`acephale-node-tests-20261107.txt`, `acephale-python-tests-20261107.txt`,
`acephale-python-native-final-20261107.txt`, `acephale-deploy-tests-20261107.txt`
and `acephale-lint-final-20261107.txt`. Their private directory is not a repository path.
No paid request, cloud provisioning or live benchmark was performed for these checks.

Local/CI Python unit validation uses 3.12.14, which is installed; 3.12.16 was not
available as a local interpreter during this separation. The live deployment
target remains pinned to Python 3.12.16 and must pass its own observed inventory
checks. Unit-test interpreter selection is not authorization to substitute a
different production runtime.

The [main-branch CI run](https://github.com/xyleus1/Acephale/actions/runs/42357269977)
passed for source commit `d510c1bbc139e09fe9e40ed1145daead87fbfb18`:

| CI check | Observed result |
| --- | --- |
| Full Node suite | 210 passed, 0 skipped |
| Full research pytest | 275 passed, 2 skipped |
| Full deployment unittest | 124 passed |
| Typecheck, ESLint, research Ruff and CLI help | Passed |

The Node suite exercised real pgvector publication, scoped retrieval, immutable
SQL guards, read-only PostgreSQL transactions and bound query values. CI used
Ubuntu 24.04, commit-pinned setup actions, frozen dependency locks and the verified
`pgvector/pgvector:0.8.7-pg17` image digest with a disposable database.

The two Python CI skips were the pinned native environment test, whose external
checkout was not installed on CI, and the Windows-specific sharing test on Linux.
Both were exercised locally: the former passed in the six-test native-profile
rerun; the latter was among the initial 276 passing tests. These complementary
runs are not represented as one homogeneous zero-skip Python execution. CI verifies
the database integration code, not production database publication or live serving.

## External execution gates

1. Recheck current provider quota, price and available capacity. The last recorded
   GPU quota observation was zero on 2026-11-06; that is historical status, not a
   current API check. The proposed GPU configuration requires eight vCPUs.
2. Validate actual serving fit, exact model/tokenizer identities and tool parsing
   on the guarded host. Regenerate observed deployment inventory after source or
   environment changes; an example manifest is not evidence.
3. Prepare and verify the actual research database and publish its reviewed frozen
   artifacts. Publication/retrieval code passed against disposable PostgreSQL/
   pgvector in CI; production database readiness and publication remain outstanding.
4. Resolve the original budget journal through private operator configuration and
   reconcile outstanding reservations. Preserve the $500 total and its protected
   allocations; do not reset the experiment's allowance during separation.
5. Collect fresh fixed-actor shadow traces, audit teacher annotations, freeze
   training memory, fit compatible calibration and measure admission components.
6. Run paired development, select heldout size from development costs and remaining
   budget, freeze all arms, then execute/report every declared slot.

## Evidence limits

There is no new live task-accuracy or latency-improvement claim for this standalone
checkout. Mocked native gateway parity is not a tau score. Replay timing is not
live latency. Prediction hit rate is not task reward. Transparent prefetch may
increase physical work while leaving logical calls unchanged, and erroneous goal
conditioning can hurt ranking. Report those effects rather than assuming gains.

Historical reports and hash-bound artifacts remain unmodified in the original
checkout and Git history. They were not copied into the active research tree.
Any later import requires explicit source/license, family-split, authorization,
schema, model and memory-identity review. A renamed artifact is not fresh evidence.
