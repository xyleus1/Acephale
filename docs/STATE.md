# Current state

Updated November 16, 2026 (UTC). Both predictor seeds completed their 204 optimizer
updates. E7 then reproduced both original probes exactly and completed strict
GPU export with unchanged weights and tolerances. Separate vLLM serving
qualification, trained replay and the paired native evaluation remain pending.
Training and reload completion are not benchmark results.

E13 failed during scheduled-worker startup, before foundation or model execution.
Its GPU termination, provider absence and local process closure were verified.
The worker had compared a duration calculated at configuration creation with its
later start time, incorrectly rejecting an otherwise valid absolute deadline.
The prospective wrapper derives its remaining duration at startup and retains
the original absolute deadline. Delayed-payload tests pass; E14's actual startup
and scientific execution remain pending. Existing failures and costs are retained.

Each seed's first probe, repeated probe and repeatability check matched all
248,320 reference logits with zero error after restoring its recorded native
Triton cache. Both teacher-forced development evaluations completed on 112
neutral-ranking examples each. These diagnostics do not measure free-running
tool accuracy, goal agreement or native task success.

The E7 local owner subsequently failed: importing an archived helper on Windows
rewrote one archived Python bytecode file, so the next integrity check rejected
the changed extraction. The original 160-file compressed archive remained intact.
A fresh CPU-only extraction passed the unchanged strict verifier repeatedly with
bytecode writing disabled; all archived files remained unchanged. The failed owner
and original extraction are preserved. E8 used checked-source loading
that does not read or write adjacent bytecode and process-startup suppression as
an additional defense. Neither optimizer will be repeated.

E8 stopped before provider dispatch because its controller publication exceeded
the heartbeat freshness window. No GPU instance was created. Its unused local
reservation is closed with explicit `cancelled_before_provider_dispatch`
evidence; no provider termination is claimed and all financial holds remain.
E9 subsequently allocated a GPU and passed the real final pre-dispatch check:
both controller states were 12.182 seconds old after a 6.732-second budget
inspection. It then timed out waiting for the scheduled heartbeat process.
Cleanup began before that process reported its own error. Exact provider
termination and subsequent absence were verified; no scientific owner, model
evaluation or paired trial ran. All financial holds remain.

The launcher allowed 50 seconds for scheduled startup, including the wrapper's
preflight. Separate offline reproductions found that PowerShell could discard
native retry diagnostics and that a publisher refactor bypassed one injected
read-retry path. Neither later error is treated as the proved initial trigger.
Three subsequent real scheduled-startup canaries against the closed lease passed
without allocating a GPU. Startup through authenticated child handoff took
71.431, 50.176 and 71.521 seconds. These are infrastructure timings, not measured
task latency. Each task drained and the financial files remained unchanged.

E10 then passed startup and handed off to its managed owner. Foundation failed
before model execution because the launcher no longer exported two heartbeat
helpers used by the downstream authority check. The owner exited with failure;
provider termination and subsequent absence were independently verified. The
failed stage's unconfirmed drain flags remain unchanged. A separate observation
confirmed that its exact local task and processes had stopped.

The E11 repair restores those exports and tests the actual managed authority
path, including the transition to ready. Publication now accepts only an active
lease becoming ready while every other authority field stays identical. The
scheduled companion remains the sole steady publisher. An additional evaluation
slot can be authorized separately without altering monetary ceilings, old holds,
GPU-hour limits, models or scoring. E11 has not yet produced scientific results.

E11 subsequently allocated its exact GPU, but the first scheduled child heartbeat
arrived 11.105 seconds after the 90-second startup limit. The launcher terminated
the instance before foundation or scientific dispatch. Independent checks confirmed
provider absence and local task/process closure; every financial hold remains.
Its three preceding closed-lease canaries passed in 80.263, 40.014 and 68.880
seconds. Those observations did not establish a bound for active startup.

Postmortem measurements found severe local memory pressure and repeated canonical
hashing after a 16 MiB cache filled with large keys. These are measured conditions,
not proof of the entire delay's cause. An offline compact-key comparison removed
the repeated misses but improved paired read time only 3.5% in that sample. The
complete SDK/publication path must be measured before another startup repair is
treated as qualified. No trained replay or paired native result followed E11.

A subsequent complete closed-lease measurement took 61.031 seconds, including
four state reads. Compact hash keys plus one pure memo scope across those reads
reduced the next observed sample to 29.843 seconds. The wrapper-equivalent
preflight took 3.172 seconds versus 9.812 previously. Every file read and authority
check remains; the cache is discarded between heartbeat attempts. These are one
operational sample per implementation under variable workstation load, not live
benchmark gains. The next run still requires actual scheduled-start qualification.

The next closed-lease startup still failed before handoff: Task Scheduler and
wrapper startup consumed about 67 seconds before the worker began its checks.
A versioned handshake now lets the parent keep publishing real observations
while the worker prepares. After a fresh publication and both readbacks, the
parent releases the prepared worker and performs no further writes. Three actual
scheduled checks passed in 20.233, 35.701 and 39.342 seconds after release. Total
preparation through verification took 101.053, 111.591 and 119.618 seconds.
All tasks and processes drained; no GPU was allocated for these checks.
The 90-second released-work limit and 120-second watchdog remain unchanged.
This establishes startup behavior under the observed conditions, not trained
replay, task accuracy or live-agent latency. The qualified files and failed
attempts remain preserved while the next execution context is prepared.

The operator repair caches only pure canonical digests within one operation;
all authority files are still read and validated. Three actual publication cycles
with both remote readbacks passed, with observed publication intervals of 44.430
and 42.182 seconds against the unchanged 120-second watchdog timeout. This is
infrastructure qualification, not benchmark latency. Provider dispatch must also
check freshness after its budget inspection.

The sixth evaluation-only attempt passed strict input admission, then failed
seed 17's inference-only warmup check: 18,971 of 248,320 original-reference
logits exceeded the unchanged tolerance, with maximum absolute error 0.19140625.
The repeated probe was identical to the first, but both differed from the saved
reference. Weights and probe bytes were unchanged. Its 39-file archive was
verified; managed drain, cleanup and provider termination completed. No trained
replay, teacher-forced development score or paired native result followed.

The repair restores the successful diagnostic's original Triton
timing files, separately for each seed, before the same warmup. All 41 focused
CPU tests passed, and the actual installed image restored all 22 native files
without runtime-boundary mocks. E7 subsequently reproduced both original probes
and passed strict export on the GPU. The earlier warmup success alone did not
establish portability. See the
[failure analysis and repair](experiments/native-tuning-cache-2026-11-16.md).

The second evaluation-only continuation failed during trainer-image setup when
Debian's live security index stopped offering the pinned
`linux-libc-dev=6.1.190-1`. No export, replay or paired native comparison ran in
that attempt. The failure is retained. Prospective execution source
`4438b56c3053f0ee4a354d0e89ad31de82a766f7` changes only the Dockerfile's APT
sources to the signed November 14 snapshot. All 32 package versions are unchanged.
The full local Docker build passed, including all 65 exact Git inputs, the 32
package versions and two actual Docker permission cases. No base package was
upgraded or removed. The third evaluation-only run completed GPU image setup,
then failed diagnostic admission because authorization named the operator checkout
instead of the execution image's source. No model or benchmark call ran there.

The fourth evaluation-only continuation completed foundation, image setup and
the cold diagnostic. It then stopped before strict export because the concrete
hook wrapper did not export the required `preflight` callback. Automatic cleanup
completed and provider termination was independently confirmed. No trained
serving, replay or paired native trial ran in that attempt.

The fifth evaluation-only continuation passed the repaired callback and reached
the strict export process. Its input check rejected an unbound `inventory.json`:
staging extracted five dataset payloads plus this inventory, while preparation
froze only the payloads. No strict model export or paired benchmark ran. The owner
drained its work, confirmed provider termination and closed the failed attempt.

The sixth attempt's producer bound the exact inventory from the approved dataset
archive. It leaves all data and the strict consumer unchanged. Eight independent
regressions use the actual archive, extractor, producer and consumer loop; they
reproduce the original failure, accept the complete six-file binding and reject
tampering. The actual strict input gate subsequently passed. Saved-weight export
subsequently passed in E7; serving qualification and paired scientific results
remain pending.
Neither trained adapter nor any scoring rule changed.

The sixth attempt used a separate $20 infrastructure supplement for one
evaluation-only lease of at most six hours. Its frozen native/API reader passed
an in-memory compatibility check reserving the full $303 development/held-out
allowance after projected infrastructure costs; no benchmark calls occurred in
that check. The exact [dataset repair patch](experiments/operator-patches/README.md)
is published with its input and output hashes.

## Training and continuation

The fifth continuation completed seed 29's 204 updates, three epochs and 204
gradient checks. Both seeds then encountered the same final metadata error:
HF's `total_flos` estimate exceeded the shared numeric range. Separate CPU
recovery verified the saved adapters, original failures, complete checkpoints,
source and data identities. Neither optimizer was repeated.

The subsequent seed 17 HF export failed its unchanged reload gate: 14,972 of
248,320 logits were outside `rtol=0.02, atol=0.03`; the maximum absolute error
was 0.1875. No trained serving qualification or paired native trial followed.
The provider instance was terminated and all evidence exported. A separate
Windows path-length error affected local extraction, not archived bytes; all
86 archive members were independently verified under a shorter directory.

The evaluation-only continuation uses the completed weights. Its authorization
allows diagnostic, export and evaluation actions and forbids optimizer work.
The cold diagnostic reproduced failures for both seeds despite exact loaded
parameter hashes. One common inference-only fitting-batch warmup then reproduced
all 248,320 original reference logits bit-for-bit for both seeds in the first
evaluation-only diagnostic, including a repeat probe. Kernel selections changed.
The sixth attempt did not reproduce that success; its selected profiles differed
despite matching reconstructed inputs and recorded package versions. Strict
export and vLLM qualification remain separate requirements. See the
[original GPU diagnostic](experiments/reload-preparation-2026-11-15.md) and the
[portability failure](experiments/native-tuning-cache-2026-11-16.md).

The fourth continuation had failed before profiling or seed 29 because the two
earlier fitting windows exhausted their cumulative allowance. A prospective
sidecar supplied the third window used by the fifth continuation. All earlier
failed attempts, reservations and unresolved holds remain retained.

The preceding replacement completed a disposable profile but failed a later
ownership observation. Main seed 29 was never dispatched there either. Its
controllers terminated it at its original deadline; the earlier unresolved
launch still retains its independent fences.

The remaining sequence is strict saved-weight reload, serving qualification,
matched replay and paired native evaluation. Bounded retries apply only to
observations. Interrupted scientific dispatches are retained, and uncertain
work is not automatically repeated. The complete real chain has not yet run.

Seed 17 completed all 204 optimizer updates and all 204 gradient checks, with
unchanged base hashes and a changed adapter hash. Its final adapter, reload probe
and checkpoint-204 are saved. Final result serialization then failed because HF's
`total_flos` estimate, `7.51775264009134e16`, exceeds the shared numeric range.
The complete failed attempt was exported and verified. Recovery retains that
failure and reconstructs a separate result record from saved evidence; it does
not rerun seed 17's optimizer. Seed 29 completed the same 204-update recipe.
Both used the same frozen data, effective
batch of 16, three epochs and rank-16 LoRA. The predictor has 10,822,656 trainable
adapter parameters; the 9B actor stays fixed. Training loss is a diagnostic,
not tool-call accuracy or native reward.

The prepared dataset contains 1,074 fitting examples, 117 calibration examples
and 112 development examples. The fitting set contains 358 complete
goal/neutral-ranking/conditioned-ranking triplets from 24 fitting families.
Deterministic context compilation rejected 14 of the original 372 checkpoints:
13 omitted a required source and one exceeded the mandatory input budget.
Rejection records remain retained; no test example enters training.

Runtime/training source is `5a36a8b3835820fe65b3615ead31fb6fb7bc9672`.
The pinned checkpoint's 18 FP32 decay vectors were verified on the actual GPU.
A separately declared warm profile established feasibility after the slow cold
profile. Disposable profiling weights are not reused. Earlier smoke and serving
failures remain failed.

## Results on record

The closed 60-trial fitting/calibration collection completed 57/60 native tasks
(95.0%); 46/60 were known constraint-clean (76.7%). It made 326 logical and
physical calls without speculation. Mean live latency including drain was
32.755 seconds; observed p95 was 53.926 seconds, n=60. This is a single-base
custom tau-compatible collection, not an official score or held-out comparison.
Its hosted user/judge subtotal is $0.673481 with one unknown charge retained;
GPU invoices are separate. Three failed slots remain in the denominator.

The original 100-case annotation pilot had 17 positive candidate windows, below
the required 48. The explicit expansion retains all 372 preexisting public-eligible
fitting windows, with 79 positives, preserving the original pilot and audit cases.
Teacher annotation and actual semantic review remain separate requirements.

The complete untrained-predictor replay retains all 746 prefixes: 705 completed,
41 failed and none undispatched. On the reserved development subset, exact next
read Top-1 was 9/52 (17.3%) over declared eligible checkpoints. This is prediction
accuracy, not native task success. Fixed-panel Top-3 is three-item panel coverage,
not a ranking gain. The matched trained-predictor replays are pending.

The exploratory machine review accepted 19/20 preselected cases, with one incorrect
annotation and zero unsupported bindings. It has zero human reviews. Teacher and
reviewer use the same pinned model in separate requests; reviewer-model independence
is not claimed.

The historical November 13 smoke passed strict adapter reload but failed its
merged-weight comparison. No trained-model accuracy or latency gain has been
established. See the
[original pilot](experiments/predictor-lora-pilot-2026-11-10.md) and
[staged-study record](experiments/staged-study-2026-11-13.md).

## Current implementation

Native training export now checks teacher annotations against their exact public
sources and emits neutral ranking, conditioned ranking and goal-inference targets.
Neutral and conditioned examples share candidate order. A single recipe controls
LoRA settings and effective batch size. The experiment runner composes existing
commands with immutable inputs, stage receipts, deadlines and verified resume.

New score metadata distinguishes autoregressive conditional token probabilities
from calibrated next-batch membership. Historical v2 artifacts remain readable;
new binary-predictor calibration uses v3. Source changes require new compiler
identities and downstream artifacts, not relabeling old results.

The user authorized additional spending on November 13. The future v3 policy
provides a $1,000 working envelope while retaining the original journal, previous
amendments, reservations and $65 contingency. It was activated after the previous
collection lease closed. Authorization is not a record of spending; actual
activation and resource state are recorded in private operator receipts.

The fresh compositional task bundle passed native fixture verification: 88 tasks
across 44 preassigned families, with 200 omitted-mutation checks all rejected.
The receipt is `1afeb10e51fe24594216e4abe4a378392214cb6c7ea9bceeb317be84bb5eb48f`.
These are reference executions, not actor results. No hosted model calls were
needed for that verification. The budget amendment is active on the original
journal; its original bytes and unresolved reservations were preserved.

## Remaining experiment gates

An explicit machine-audited exploratory protocol now permits autonomous
execution without counting any automated judgment as a human review. It uses
the same 20 selected cases and unchanged acceptance thresholds. Its actual
audit must pass before training; the original human-reviewed study remains
pending. This protocol amendment is not a measured accuracy improvement.

1. Reproduce the original probes and strictly export both completed adapters;
   do not repeat either optimizer.
2. Qualify each actual adapter in vLLM with unchanged complete-prompt numerical
   checks; run all three frozen replay conditions and fresh calibration.
3. Measure native read/prefetch opportunities and run the original 36 paired
   development slots across all three arms.
4. Select whole held-out families using development costs alone, reserve every
   selected slot and run the predeclared paired schedule, up to 96 slots.
5. Export native outcomes, runtime events and persisted telemetry; report paired
   family intervals, known and unknown costs, and verify infrastructure cleanup.

Detailed historical operator notes are preserved in the
[2026-11-11 Git checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
