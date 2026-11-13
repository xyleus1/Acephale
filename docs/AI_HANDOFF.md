# Working on Acephale

Replay scoring and calibration now accept the declared response-retention receipt
and verify its file hash, record count, response hashes and ordered checkpoint
dispatch evidence. The previous scorer rejected the added metadata by comparing
the whole receipt against its older five-field shape. Existing replay bytes stay
unchanged. This is an analysis-reader correction; deployed training and serving
sources retain their original identities.

The experiment runner verifies every input hash at admission and before/after
each successful stage. While a child runs, its 250 ms guard checks file identity,
mode, size and nanosecond modification/change times instead of rereading all
contents. Metadata is only early change detection; final hash checks still reject
changed bytes even if metadata appears unchanged. Existing process/container
drain, source, artifact, stop and deadline checks remain in force. New runs bind
the new runner hash; do not resume an old attempt under it.

Paired serving segments may consume an explicit whole-cohort reservation. Reserve
every original trial root once with `scripts/acephale-infra-cohort.ts`, under the
sole original-journal owner. Each segment supplies that immutable receipt and a
fresh ledger checkpoint. Atomic zero-cost claim markers prevent retrying a failed
or interrupted segment; future trial holds and unknown charges remain reserved.
The original and grouped schedules must contain identical slots, contiguous
three-arm blocks and unchanged randomized arm order within each block.

Prospective unmerged exports use serving-probe schema2: the shortest complete
neutral `weight_fit` prompt, ordered by `(promptTokens, id)`, with the pinned
assistant generation suffix. Dataset, row, prompt and exact token hashes are
recorded. The internal 256-token strict reload check and the serving top-token
and 0.01 binary-probability gates remain unchanged. Historical schema1 probes
remain valid only under their original identities; no failed receipt is resealed.

The prospective `machine_audited_exploratory` protocol can run with a separate,
source-bound machine critic of the same original 20 audit IDs. It must retain
zero human reviews, the exact reviewer/audit receipt and the unchanged 90%/zero
unsupported-binding thresholds. The original human-reviewed mode remains the
default. See the November 13 protocol amendment before preparing new data or
reliability artifacts. Do not relabel old annotations, reviews or replays.

Replay now retains parsed model responses before output validation, with token
probabilities, request/input hashes and bounded failure diagnostics. This changes
the compiler identity. Retain the earlier replay and run the whole frozen cohort
again for the new matched comparison; never replace individual failed rows.

The goal instruction now explicitly requires complete joint outcomes, matching
the teacher's intended alternative-hypothesis semantics. This changes predictor
and candidate compiler hashes. Prepare fresh source-qualified model inventory,
public input compilation, calibration and replay before using it. Preserve the
previous bootstrap and all old annotation artifacts. A separate AI audit found
one incomplete top goal and seven uncertain cases in the original 20-case audit;
it is not human approval. Prospective label corrections need their own lineage
and a revised review packet with the same audit checkpoint IDs.

Native opportunity profiling accepts either the original `cohortPath` or an
explicit `cohortPaths` list for a combined import. Supply all sealed originals;
each public prefix routes through its verified owner. Profiling replays only
previously visible actions and never executes newly measured actor proposals.

## Parent-aware annotation reuse

An original annotation pilot may be used with a verified multi-cohort aggregate
only through its unique original parent. Verification retains literal public
JSONL and split hashes, checkpoint ownership and the unchanged audit membership.
Expanded grading declarations record this parent proof and revalidate it. The
legacy annotation dispatch cap remains unchanged; larger calibration cohorts need
explicit bounded batches with already accepted audit labels reused, not rerun.

An unresolved provider launch remains fully reserved. Replacement admission is
explicit: pass `--unresolved-fence` to reservation and launch, with fresh receipts
for the same two old-name watchdogs. New work requires separate controllers.
Never refresh the predecessor heartbeat or overwrite its registered state.

Multi-cohort memory verification now hashes the retained raw public JSONL lines
for each parent instead of reserializing them. This fixes a Python/RFC8785 byte
mismatch without changing original prefixes, parent manifests or failed stages.
Keep any offline recovery under its own source-bound receipt and output directory.

Read [methods](METHODS.md), [state](STATE.md) and [runbook](RUNBOOK.md) first.
This repository studies goal-conditioned speculative reads with a fixed actor.

Compiler v3 removes duplicate policy text while preserving its mandatory source.
The phase-one collection closed under `fe0748b`: 57/60 native completions and
46/60 known constraint-clean completions. Public-only recompilation under
`bbd95b0` recovered postprocessing without repeating native trials. Preserve both
attempts and all earlier artifacts. The independent 12-row development-validation
cohort remains separate from the later paired comparison.

The native exporter now accepts the actual teacher contract. Use explicit v2
`native_multitask` export for neutral ranking, conditioned ranking and goal targets.
The default protocol requires 20 attributed human reviews. The separately
declared exploratory mode requires its actual machine-audit receipt instead,
with zero human reviews. The old APIGen packet cannot certify a fresh native
dataset under either protocol.

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

The user's subsequent spending authorization supports v3, a $1,000 working
envelope activated through a creation-only sidecar on the original journal after
the previous lease closed. Its parent
amendment binds v2; original reservations, GPU hours and training windows remain
counted. Policy and amendment hashes must match future execution manifests.
Never restart an old heartbeat, reuse an expired lease or create a replacement
budget. Resolve secure paths through operator configuration.

The fresh 88-task native fixture bundle and 200 omitted-mutation checks passed
before actor execution. Preserve its generator bytes and receipt. Phase one
collected 60 fitting/calibration trials with shadow prediction disabled and a
$0.40 hosted-call cap; development and test tasks were withheld. Preserve its
original task IDs and failed
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

The next trainer pins FLA/core 0.6.0 and verifies actual Qwen DeltaNet function
identities; convolution remains PyTorch, attention SDPA and packing disabled.
This changes the image and requires a fresh GPU smoke, strict reload, numerical
server qualification and measured profile. The 549-pass local research suite
does not establish throughput or serving compatibility. Expanded fitting means
1,116 multitask rows and 210 optimizer steps per seed at effective batch 16.
Do not shorten either seed to fit an obsolete runtime estimate.

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

## Explicit provider region routing

`control.py record-region-route` creates a new sidecar for capacity in another declared US region, with the same hardware, an at-most-$1.99 hourly quote, an exact regional image and a restricted regional SSH firewall. Pass it with `prepare-lease --routing-amendment`. The original financial plan, journal, access receipt and prior reservations are preserved. Routing alone never permits bypassing an unresolved lease. Actual replacement admission needs independent predecessor fencing and separate controllers.
