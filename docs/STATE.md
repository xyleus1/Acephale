# Current state

Updated November 13, 2026, 17:24 UTC. This page distinguishes implemented software
from measured results. Full training is now running on the A100.

## Active training

Seed 17 has reached 157 of 204 optimizer updates. Seed 29 follows automatically
with its own full 204-update recipe. Both use the same frozen data, effective
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

1. Complete and export both full training seeds, strict reloads and diagnostics.
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
