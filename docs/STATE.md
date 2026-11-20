# Current state

Updated November 20, 2026 (UTC). Seed17 replay and calibration are closed. Goal
agreement is 6/141 (4.26%) with all failures retained. Seed29 replay and the paired
native evaluation remain unfinished. No held-out task-accuracy or live latency
improvement has been established.

## Closed seed17 calibration

All 141 calibration rows remain: 63 completed grades, 70 prediction misses,
four context rejections and four interrupted grading failures. Six completed
grades agreed with the teacher; the declared-cohort denominator stays 141.
The recorded 95% Wilson lower bound used for goal reliability is 0.019646
(1.96%). This is low calibration agreement, not a native task-reward score.

Annotation review used separate requests and prompts with the same
`gpt-5.4-2026-03-05` teacher model and zero human reviews. The continuation
completed 24 previously unrequested grading calls for known usage of $0.309339.
Four original interrupted calls remain unresolved and reserved. This amount is
continuation cost only, not total grading or study cost. See the
[calibration aggregate and evidence hashes](experiments/retained-seed17-calibration-2026-11-20.json).

All seven local analysis commands exited zero and drained. The first evidence
projection failed because a Windows process creation timestamp exceeded the
canonical JSON integer range. A separate deterministic reader repair preserved
the original failure and raw identities, then completed projection with an actual
zero exit and process drain. It reran no scientific command or model request.
The new index closes seed17 analysis; the complete study is still unfinished.

## Closed seed17 replay

All three conditions retained all 746 original prefixes, including failures.
These prefixes span fitting, calibration and development; the following numbers
are an operational diagnostic, not a held-out generalization estimate.
The 266 eligible prefixes have a read in the next authoritative tool batch. A hit
means the predicted tool and every argument match an invocation in that batch.

| Measurement | Neutral, fixed panel | Goals, fixed panel |
| --- | ---: | ---: |
| Completed predictions | 745/746 | 334/746 |
| Failed predictions | 1/746 | 412/746 |
| Exact tool-and-full-argument Top-1 | 119/266 (44.7%) | 55/266 (20.7%) |
| Top-3 from returned predictions | 122/266 (45.9%) | 55/266 (20.7%) |

The goal-selected condition also completed 334 records and failed 412. Each goal
condition retained 271 output-length failures, 77 invalid probability sums, 62
invisible source paths and two invisible sources. The neutral failure exceeded
the common predictor input window. No failed prediction was replaced.

Within the goal-fixed run's 230 jointly scored surviving checkpoints, the
equal-family neutral-minus-conditional binary log-loss difference is +0.125995
nats, 95% family-bootstrap interval [+0.021043, +0.265059], across 34 families
and 2,000 samples. Both rankings nevertheless have the same 55/266 Top-1 hits.
This conditional loss improvement excludes missing probabilities and does not
offset the full-run validity regression. It is neither full-action cross-entropy
nor true entropy. See [exact aggregates and scope](experiments/retained-seed17-replay-2026-11-20.json).

The original owner stopped in deterministic grading preparation after replay
export. It dispatched no grading batches. Provider removal, local process drain
and retirement of its four controller jobs are independently recorded. Recovery
retains that failure and the saved replay; it does not rerun either optimizer or
any completed prediction. No new paired native actor trial has run.

## Measured results

The unchanged scorer compared the compatible base neutral predictor with E31's
saved seed17 LoRA predictor on 136 checkpoints from six development families.
Both use the same candidate panels; 52 checkpoints have an eligible next read.

| Measurement | Base | Seed17 LoRA |
| --- | ---: | ---: |
| Completed predictions | 127/136 | 136/136 |
| Exact tool-and-full-argument Top-1 | 9/52 (17.3%) | 24/52 (46.2%) |
| Top-3 from returned predictions | 20/52 (38.5%) | 27/52 (51.9%) |
| Candidate-panel coverage | 27/52 | 27/52 |
| Binary log loss, nats | 0.454718 | 1.074204 |
| Brier score | 0.138886 | 0.098041 |
| Scored checkpoints / probabilities | 103 / 243 | 112 / 254 |
| Mean recorded replay wall time | 628.3 ms | 891.3 ms |

Across 103 jointly scored checkpoints, the equal-family paired loss difference
is +0.617391 nats, 95% family-bootstrap interval [+0.273781, +0.880101]. The paired
Brier difference is -0.029608, interval [-0.080814, +0.021547], which includes zero.
Both intervals use six families and 2,000 samples. Failures stay in the declared
denominators; missing scores receive no invented probabilities. The loss measures
autoregressive binary membership scores, not true entropy or full-action loss.

These are development prediction results without inferred goals. Historical replay
timing does not establish live latency. See the
[report and exploratory error analysis](experiments/staged-study-2026-11-13.md#retained-development-comparison-november-18)
and [aggregate evidence](experiments/retained-neutral-development-2026-11-18.json).
Fit/calibration and held-out results remain separate. The closed mixed-partition
goal-conditioned replay above is a different diagnostic population.

E31 retained all 746 neutral rows: 745 completed and one context-window failure.
The selected-goal condition stopped at its 2,400-second bound with 314 completed,
377 failed and 55 unwritten rows. Failures comprise 244 output-cap incomplete
responses, 73 invalid probability sums, 58 invisible source paths and two invisible
sources. One unwritten row has a retained response; additional in-flight work
cannot be excluded. Fixed-goal did not start. All failures remain retained.

The earlier single-base fitting/calibration collection completed 57/60 native
tasks (95.0%), with 46/60 known constraint-clean (76.7%). Its 326 calls had no
speculation; mean live latency including drain was 32.755 seconds, observed p95
53.926 seconds (n=60). This is a custom tau-compatible data collection, not an
official benchmark, held-out score or paired comparison. No paired native actor
trial has run.

## Training and numerical checks

Both saved seeds completed 204 optimizer updates and 204 gradient checks using
three epochs, effective batch 16 and rank-16 LoRA. The base remains fixed; the
predictor adapter has 10,822,656 trainable parameters and the 9B actor stays fixed.
Training contains 1,074 examples: 358 goal/neutral-ranking/conditioned-ranking
triplets from 24 families. The 14 context-rejected source checkpoints remain
recorded. No optimizer is repeated during evaluation recovery.

E31 completed strict export/evaluation for both saved predictors. Its first
seed17 serving qualification failed all three baseline requests at probability
delta 0.014324070185671056 and passed all three predictor-only `split_k=1` requests
with zero delta under the unchanged 0.01/top-token gate. This is observed numerical
compatibility, not task accuracy, general determinism or an isolated root cause.
Runtime/training source: `5a36a8b3835820fe65b3615ead31fb6fb7bc9672`.

## Retained earlier execution status

The count-capacity recovery is now active through the normal public writer and
full reader. It retains the one unused slot and adds seven; money, GPU-hour
limits, old reservations and the ledger bytes are unchanged. The exact committed
operator passed CI: 316 Node tests, 642 research tests, two Docker permission
tests and 786 infrastructure tests, with 69 total skips and 159 passing subtests.
The earlier two CI failures remain recorded. No new GPU has been requested.

The final-observation repair passed its independent source review and 29 distinct
focused/composition cases across targeted runs. The actual-size synthetic test
retains 5,458 pins and seven financial sets; its original failure and fixture
corrections remain recorded. It used 50 seconds per injected full validation.
The real count activation subsequently measured 78.172 seconds for full ledger
validation. A new 80-second composition failed during the initial launch handoff:
the prior owner reached 121.261 seconds during publication, beyond its unchanged
120-second lifetime. It made zero provider requests and released its readers and
locks. The scoped renewal repair subsequently passed seven focused cases and
separate full-size dispatch and adoption cases at the same 80-second delay.
Adoption retained only 1.941 seconds of margin, so this is conditional evidence,
not general timing assurance. Two later normal ledger reads took 38.647 and
41.953 seconds; sharing the existing pure-hash cache did not help. No cache,
caller or lifetime change was selected. Fresh source rendering is in progress;
these checks produce no benchmark score or live-readiness claim.

E45 failed before the provider launch request at 14:13 UTC on November 19. Its
three bounded final observations did not converge. The first two reached the
exact dispatch check with owner records aged 33.716 and 39.064 seconds, exceeding
the unchanged 30-second limit; the third timed out in collection. Their last
exact checks took 0.372 and 0.237 seconds. These observations locate the first two
failures before those checks, not in a slow final source traversal.

Automatic cancellation confirmed that no provider request was attempted and no
instance existed. Local work is drained and disabled, all four controller jobs
are independently confirmed completed/cancelled, and every financial hold is
retained. No GPU, model evaluation or native trial ran in E45.

The foundation and export compatibility repairs were applied before E45's
sealed launch. The next repair separates predecessor-fence collection from final
research-owner publication, removing an enrollment whose observations were then
discarded and fetched again. It retains the actual acknowledgment/API gate and
all freshness limits. The repair has not been applied or used for a live dispatch.

E44 reached an active GPU at 10:21 UTC on November 19. The root controller and
launcher both exited successfully, and the managed foundation stage was dispatched
at 10:26 UTC. Foundation then failed with `IncompletePhase` at 10:27 UTC: its host
validator still capped provider setup at one hour, while the approved lease allows
two hours. This configuration compatibility error occurred before the remote stage
receipt, not during model evaluation. The managed entry reports local ownership
drained and remote drain unconfirmed. Export verification passed, but required
stage evidence did not. No new model score, paired native result or live
performance gain is available. Saved weights and the scientific design are unchanged.

Automatic provider cleanup completed, and a later independent provider read
confirmed the exact instance absent. Both local tasks are disabled and drained;
all four controller jobs are independently confirmed completed/cancelled. The
unconfirmed remote process drain remains recorded separately from provider removal.
The host-validator repair passed 31 focused tests and independent source review.
It accepts two-hour setup only for the exact approved evaluation authority, while
retaining the legacy one-hour limit and the separate 30-minute foundation phase.
The next attempt is in source preparation; no new evaluation has started.

The final dispatch proof passed on its first attempt under unchanged freshness
bounds. Successful infrastructure dispatch does not establish foundation success.

Preparation passed 26 namespace and 29 operational-source checks. The unchanged
pool-only retry succeeded after host memory headroom recovered, followed by
controller startup, source inventory, review and sealing.

The first pool attempt raised `MemoryError` in local authority validation, before
writing a pool request or reserving new holds. Infrastructure ledger bytes were
unchanged. That failure remains retained; the successful retry did not repeat
the completed context, metadata-route or quote preparation.

### Retained E43 failure and repair

E43 stopped before the provider POST after its final acknowledgment gate passed.
The repeated checks after that gate exhausted the owner's 30-second proof bound.
The predecessor fence still had time remaining when cancellation completed; the
failure was distinct from E42's 120-second owner-renewal failure below. No GPU,
model execution or new native score resulted. Normal cleanup disabled the task,
closed owned processes and cancelled the unstarted lease. Independent GitHub
readback confirmed all four controller jobs completed/cancelled.

A prospective repair combines exact checks with the gate's final full source
guard, moves audit writes after dispatch and fixes creation-only retry filenames.
It preserves freshness limits and the single provider request. Thirty-three
focused cases and one separate test of the observed 4,452-file layout passed.
The latter charged measured filesystem work and an injected 50 seconds per full
validation, made one simulated provider request and verified cleanup. A separate
7,175-file stress fixture exhausted the owner window before the changed gate;
its dense directory-membership layout differs from the real configuration. That
failure remains recorded: 34 of 35 distinct candidate cases passed. These local
checks establish neither live success nor a benchmark gain.

### Retained E42 failure

E42 passed root handoff, adoption, budget inspection and later owner renewals,
then failed before the provider launch POST. The final fence collector repeated
a full ledger validation. Its next renewal was rejected after a confirmation GET
returned because the previous owner had reached the unchanged 120-second expiry.
The failed attempt's stage timings were not saved, so the evidence cannot separate
validation time from network time or establish which dominated.

No GPU allocation, model execution or native evaluation occurred. Normal cleanup
recorded a terminated reservation with no instance identifier and confirmed the
exact provider name absent. A separate GitHub observation confirmed four
completed/cancelled controller jobs. All financial holds remain; billed charges
are unknown. Earlier failures and scientific results remain retained.

The accepted final-fence repair reads the already validated ledger through the
existing transaction reader under the same lock and immutable input window. It
also records failed renewal diagnostics. Fifteen reader tests and 13 composed
tests passed, including the actual fence collector and one mocked provider POST.
The immutable-file guard passed 24 focused cases, and the same 13 composed cases
passed again with that guard. A successful live run remains outstanding. These
tests establish no benchmark gain; local guard timing is not live latency. Saved
weights and scientific contracts are unchanged; neither optimizer ran again.
See [ENGINEERING_LOG.md](ENGINEERING_LOG.md).

## Remaining work

1. Qualify the saved seed29 predictor and complete its three replay conditions
   and its own calibration. Keep seed17's completed analysis immutable.
   Use finite independently closed work units, retaining original rows, weights,
   journal, failed attempts and scientific settings.
2. Measure native prefetch opportunities and run the original 36 paired development
   slots across three arms. Choose whole held-out families using development costs
   alone, then run the predeclared paired schedule, up to 96 slots.
3. Publish closed results, paired family intervals, physical/logical calls, live
   latency, known/unknown costs and verified resource closure. Retain every failed
   attempt; do not select successful rows or relabel replay timing as live latency.
