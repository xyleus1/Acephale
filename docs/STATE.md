# Current state

Updated 2026-11-13. This page distinguishes implemented software from measured results.

## Results on record

The last completed native collection retained 12 trials. Nine succeeded across
mixed partitions; development alone was 1/4. It made 77 logical and physical tool
calls, without speculation. Mean live latency including drain was 53.897 seconds.
These are custom tau-compatible pilot observations, not a held-out comparison.

The training data had 34 fitting examples and nine positive candidate bits.
Development candidate coverage was 9/19. One smoke optimizer step changed the
adapter while preserving base weights, then failed adapter reload verification.
Neither main training seed started. No trained-model accuracy or latency gain has
been established. See the [immutable pilot report](experiments/predictor-lora-pilot-2026-11-10.md).

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

The approved budget amendment preserves the original journal and all unresolved
charges. It changes future allocations within the same $500 ceiling, retains the
$65 contingency, and adds four fitting hours plus a 15-minute smoke allowance.
Actual activation and infrastructure state are recorded in private operator
receipts, not inferred from this file.

The fresh compositional task bundle passed native fixture verification: 88 tasks
across 44 preassigned families, with 200 omitted-mutation checks all rejected.
The receipt is `1afeb10e51fe24594216e4abe4a378392214cb6c7ea9bceeb317be84bb5eb48f`.
These are reference executions, not actor results. No hosted model calls were
needed for that verification. The budget amendment is active on the original
journal; its original bytes and unresolved reservations were preserved.

## Remaining experiment gates

1. Complete final regression checks and real Docker permissions in CI. A tiny
   CPU adapter round trip passed, without establishing actual Qwen GPU behavior.
2. Freeze the verified task bundle and committed source before actor runs.
3. Pass an actual Qwen smoke reload, merge and serving check under the new source.
4. Collect fresh native traces, annotate 100 examples and obtain 20 human reviews.
5. Profile throughput, freeze fitting examples, then train both seeds, 17 and 29.
6. Recalibrate each derived model and run paired three-arm development and held-out trials.
7. Export complete results, reconcile costs and verify cleanup.

Detailed historical operator notes are preserved in the
[2026-11-11 Git checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
