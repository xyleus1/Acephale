# Current state

Updated 2026-11-13. This page distinguishes implemented software from measured results.

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

The November 13 smoke passed strict adapter reload but failed the subsequent
merged-weight comparison. Neither main training seed has started. No trained-model
accuracy or latency gain has been established. See the
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

1. Preserve the exported `fe0748b` 60-trial collection and its public-only
   recompilation under `bbd95b0`. Collect the separate 12 base development-validation
   trials; these do not replace paired comparison trials.
2. Complete the 372-row annotation expansion and obtain the original 20 attributed
   human reviews. Do not keep a GPU idle solely while awaiting review.
3. Qualify the explicit unmerged-LoRA serving path and declared FLA trainer on the
   actual GPU. The failed
   merged export remains failed; its tolerances and artifacts are unchanged.
4. Profile fitting throughput, freeze the common batch setting, then train seeds
   17 and 29. Preserve all 1,116 multitask rows and full three-epoch recipes.
5. Recalibrate each derived predictor and run paired three-arm development and
   held-out trials, retaining every failed and censored slot.
6. Export complete results, reconcile costs and verify cleanup.

Detailed historical operator notes are preserved in the
[2026-11-11 Git checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
