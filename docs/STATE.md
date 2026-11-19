# Current state

Updated November 19, 2026 (UTC). The saved predictor improved exact Top-1 hits on
the development replay, but binary log loss worsened. Complete goal-conditioned
replay and paired native evaluation are unfinished; no held-out task-accuracy or
live latency improvement has been established.

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
Fit/calibration and held-out results remain separate; no paired goal-conditioned
result is available.

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

## Latest execution status

E44 reached an active GPU at 10:21 UTC on November 19. The root controller and
launcher both exited successfully, and the managed foundation stage was dispatched
at 10:26 UTC. Foundation then failed with `IncompletePhase` at 10:27 UTC. Its
managed entry reports repair pending and local ownership drained; remote drain
is not yet confirmed. Export verification passed, but required stage evidence
did not. No new model score, paired native result or live performance gain is
available. Saved weights and the scientific design remain unchanged.

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

1. Validate the repaired live launch and managed heartbeat handoff. Preserve original
   freshness, ownership, deadlines and fail-closed cleanup.
2. Qualify both saved predictors, complete all 746 prefixes in all three replay
   conditions for each seed, and fit fresh calibration and audited reliability.
3. Measure native prefetch opportunities and run the original 36 paired development
   slots across three arms. Choose whole held-out families using development costs
   alone, then run the predeclared paired schedule, up to 96 slots.
4. Publish closed results, paired family intervals, physical/logical calls, live
   latency, known/unknown costs and verified resource closure. Retain every failed
   attempt; do not select successful rows or relabel replay timing as live latency.
