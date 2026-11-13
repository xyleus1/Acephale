# Working on Acephale

Read [methods](METHODS.md), [state](STATE.md) and [runbook](RUNBOOK.md) first.
This repository studies goal-conditioned speculative reads with a fixed actor.

The native exporter now accepts the actual teacher contract. Use explicit v2
`native_multitask` export for neutral ranking, conditioned ranking and goal targets.
Goal-labelled dataset preparation still requires 20 attributed human reviews.
The old APIGen packet cannot certify a fresh native dataset.

Run stages with `python -m acephale.experiment_runner`. The manifest binds source,
inputs, commands, deadlines and required successful output fields. Resume only
verified completed stages. Retain any failed or interrupted attempt and declare a
new recovery manifest; do not silently rerun individual failed trials.
The runner owns Linux process groups or Windows kill-on-close Job Objects.
GPU fitting still runs inside the qualified Linux container.

The single training recipe accepts microbatch/accumulation 1/16, 2/8 or 4/4.
Profile fitting data before choosing one, then freeze it for both seeds. The
actor and base predictor remain exact repository pins. A trained checkpoint needs
new calibration, goal-reliability and opportunity measurements before live use.

The v2 budget policy changes future allocation ceilings through a creation-only
sidecar on the original journal. Its hash and amendment hash must match execution
manifests. Original reservations, GPU hours and training windows remain counted.
Never restart an old heartbeat, reuse an expired lease or create a replacement
budget. Resolve secure paths through operator configuration.

The fresh 88-task native fixture bundle and 200 omitted-mutation checks passed
before actor execution. Preserve its generator bytes and receipt. Phase one
collects 60 fitting/calibration trials with a $0.40 hosted-call cap; development
and test tasks remain withheld. The 2.5-hour collection lease and later 7.25-hour
fitting/evaluation lease share the same reserved infrastructure budget, with
human review between them and no idle paid GPU during review.

The previous smoke failed reload verification after one real optimizer step.
The explicit precision-context repair still needs an actual Qwen GPU test.
Neither historical test totals nor a tiny CPU test establish trained performance.
No main seed or paired live improvement is verified at this checkpoint.

Use `npm run check`, `npm test`, research pytest and deployment tests. Run the
real Docker permission fixture in CI, and report unavailable integrations as
skipped. Update STATE and the experiment report with exact new receipts after
execution. Preserve the old pilot report and its artifacts.

Prior operator history remains in the
[2026-11-11 checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
