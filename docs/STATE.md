# Current state

Updated November 18, 2026 (UTC). Acephale has two trained predictor adapters and
measured development prediction results. The complete goal-conditioned replay
and paired native evaluation are unfinished; no held-out task-accuracy or live
latency improvement has been established.

## Measured results

E31's closed neutral replay uses the trained seed17 predictor without inferred
goals. On the original six-family development partition:

- 136 checkpoints completed; 52 had an eligible next read.
- Exact tool-and-full-argument Top-1: 24/52 (46.15%). Top-3: 27/52 (51.92%).
- Raw binary log loss: 1.074203530495743 nats. Brier: 0.09804148606291671.
- Losses average within each of 112 nonempty scored panels, then across panels;
  these contain 254 candidate probabilities. The other 24 panels are empty.

These are development prediction metrics, not held-out or native task accuracy.
The probabilities are autoregressive binary conditionals, not a complete action
distribution; the loss is not true entropy. Fit and calibration scores remain
separate. No paired goal-conditioned result is available.

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

E32 failed registration before dispatch. E33's separate full replay was
predeclared at 06:54:10 UTC, but launch exited 1 at 07:26:55 UTC before a provider
launch request, GPU allocation or model execution. Its three bounded initial
admission attempts did not converge. A secondary cleanup check failed because
no instance identifier existed. Independent closure subsequently confirmed the
exact provider name absent, local task disabled with no owner, and both jobs in
the main workflow completed/cancelled. Original errors and undispatched holds
remain retained; this is absence verification, not a claim of GPU termination or
cleanup of every historical resource. The static controller remains retained.

The original sealer exit 1 and separate fresh CLI/registrar successes are recorded
in [ENGINEERING_LOG.md](ENGINEERING_LOG.md). Neither E32 nor E33 produced prediction
or native results. The reviewed parallel wrapper and phase parser repair are
[documented separately](experiments/operator-patches/README.md); offline tests
establish no model gains. Earlier operational evidence remains in the
[prior state](https://github.com/xyleus1/Acephale/blob/c3c7509c21aadd2e8d866e88ab84c539604ce64a/docs/STATE.md).

## Remaining work

1. Resolve the prelaunch admission timing failure before a new declared attempt.
2. Qualify both saved predictors, complete all 746 prefixes in all three replay
   conditions for each seed, and fit fresh calibration and audited reliability.
3. Measure native prefetch opportunities and run the original 36 paired development
   slots across three arms. Choose whole held-out families using development costs
   alone, then run the predeclared paired schedule, up to 96 slots.
4. Publish closed results, paired family intervals, physical/logical calls, live
   latency, known/unknown costs and verified resource closure. Retain every failed
   attempt; do not select successful rows or relabel replay timing as live latency.
