# Working on Acephale

Read [methods](METHODS.md), [state](STATE.md) and [runbook](RUNBOOK.md) first.
This repository studies goal-conditioned speculative reads with a fixed actor.

Compiler v3 removes duplicate policy text while preserving its mandatory source.
The active phase-one collection remains on `fe0748b`; this compiler revision is
for the next phase. Preserve collection provenance and recompile new training,
calibration and evaluation inputs. Never relabel the earlier artifacts.

The native exporter now accepts the actual teacher contract. Use explicit v2
`native_multitask` export for neutral ranking, conditioned ranking and goal targets.
Goal-labelled dataset preparation still requires 20 attributed human reviews.
The old APIGen packet cannot certify a fresh native dataset.

Optional expanded fitting selection uses `scripts/acephale-native-selection.ts`
to retain every preexisting public-eligible checkpoint. Pass its receipt,
`originalPublicEligibility` and the unchanged `originalPilot` JSON together in
the v2 export configuration. Without these fields, the exact 100-case default
is unchanged. The receipt may transfer into an auxiliary-development aggregate
only through verified parent-dataset lineage. Keep the original human audit,
additional annotation lineage and all fitting coverage requirements intact.

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

The active collection uses the v2 budget. The user's subsequent spending
authorization supports v3, a $1,000 working envelope with a creation-only sidecar
on the original journal. Activate it after the active phase closes. Its parent
amendment binds v2; original reservations, GPU hours and training windows remain
counted. Policy and amendment hashes must match future execution manifests.
Never restart an old heartbeat, reuse an expired lease or create a replacement
budget. Resolve secure paths through operator configuration.

The fresh 88-task native fixture bundle and 200 omitted-mutation checks passed
before actor execution. Preserve its generator bytes and receipt. Phase one
collects 60 fitting/calibration trials with shadow prediction disabled and a
$0.40 hosted-call cap; development and test tasks remain withheld. The current
restart has a two-hour provider lease. Preserve its original task IDs and failed
slots. Unknown provider tax has a 30% reservation allowance, not an asserted tax
rate. Keep the prior internal infrastructure split as historical evidence; after
v3 activation the infrastructure/compute/associated limits are $200/$150/$50.

The November 13 actual Qwen smoke passed strict adapter reload, then failed the
merged-weight logit comparison. The new v2 predictor artifact preserves the exact
FP32 adapter with its BF16 base instead of merging. vLLM runtime LoRA arithmetic
is explicitly BF16. Export verification alone does not admit this artifact: the
observed server must pass a fixed one-token numerical probe, followed by a fresh
inventory of the same processes. Native and prediction guards require that proof.
This is a loading sanity check, not full model equivalence or task accuracy.

Use `training_cli profile` before fitting. It tries microbatch/accumulation 4/4,
2/8, then 1/16 on the 16 longest distinct fitting rows. Only CUDA OOM permits a
fallback. One disposable optimizer step must produce finite nonzero gradients,
changed adapter weights and unchanged base weights; it produces no fitted model.
Freeze the selected setting for both main seeds and start them independently.

Multi-cohort import preserves original receipts and disjoint task/domain/seed
identities. Collect 12 separate base development-validation trials before model
calibration; these are not the paired comparison's base arm. Original annotation
reviews transfer only through verified ancestor receipt, prefix and label hashes.
No main seed or paired live improvement is verified at this checkpoint.

Use `npm run check`, `npm test`, research pytest and deployment tests. Run the
real Docker permission fixture in CI, and report unavailable integrations as
skipped. Update STATE and the experiment report with exact new receipts after
execution. Preserve the old pilot report and its artifacts.

Prior operator history remains in the
[2026-11-11 checkpoint](https://github.com/xyleus1/Acephale/blob/ab9d26fedcc698898f2935ac1127835d7fbda4c9/docs/AI_HANDOFF.md).
