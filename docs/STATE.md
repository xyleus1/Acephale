# Current state

Updated 2026-11-13. This page distinguishes implemented software from measured results.

## Results on record

The last completed native collection retained 12 trials. Nine succeeded across
mixed partitions; development alone was 1/4. It made 77 logical and physical tool
calls, without speculation. Mean live latency including drain was 53.897 seconds.
These are custom tau-compatible pilot observations, not a held-out comparison.

The training data had 34 fitting examples and nine positive candidate bits.
Development candidate coverage was 9/19. The November 10 smoke changed the adapter
while preserving base weights, then failed adapter reload verification. A fresh
November 13 smoke passed adapter reload after the precision-context repair, but
failed the subsequent merged-weight comparison. Neither main training seed has
started. No trained-model accuracy or latency gain has been established. See the
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
amendments, reservations and $65 contingency. It is activated only after the
current v2 collection phase closes. Authorization is not a record of spending;
actual activation and resource state are recorded in private operator receipts.

The fresh compositional task bundle passed native fixture verification: 88 tasks
across 44 preassigned families, with 200 omitted-mutation checks all rejected.
The receipt is `1afeb10e51fe24594216e4abe4a378392214cb6c7ea9bceeb317be84bb5eb48f`.
These are reference executions, not actor results. No hosted model calls were
needed for that verification. The budget amendment is active on the original
journal; its original bytes and unresolved reservations were preserved.

## Remaining experiment gates

1. Source `fe0748b` passed CI, including actual PostgreSQL and Docker permissions.
   The fixed-base 60-trial collection restart uses that unchanged source. Both
   independent cleanup controllers are active for the new lease.
2. Export the closed collection, annotate 100 fitting prefixes and obtain 20
   attributed human reviews. Keep the GPU stopped during review.
3. Qualify the explicit unmerged-LoRA serving path on the actual GPU. The failed
   merged export remains failed; its tolerances and artifacts are unchanged.
4. Profile fitting throughput, freeze the common batch setting, then train seeds
   17 and 29. Collect the separately declared base development-validation cohort.
5. Recalibrate each derived predictor and run paired three-arm development and
   held-out trials, retaining every failed and censored slot.
6. Export complete results, reconcile costs and verify cleanup.

Detailed historical operator notes are preserved in the
[2026-11-11 Git checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
