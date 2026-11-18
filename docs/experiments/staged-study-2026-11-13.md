# Staged study, November 13-18, 2026

This record separates actual GPU observations from software validation. The
experiment is a custom tau-compatible pilot, not an official full benchmark.

## Retained development comparison, November 18

Latest closed result: development ranking improved, binary log loss worsened.
The [aggregate JSON](retained-neutral-development-2026-11-18.json) retains exact
scores, denominators, intervals and source hashes. Earlier stages below remain
historical observations, with their original failures intact.

This comparison evaluates the neutral tool-candidate predictor, using the base
Qwen/Qwen3.5-0.8B model and its saved seed17 LoRA adapter. It uses 136 development
checkpoints from six families, with 52 checkpoints eligible for a next read. The
unchanged C8 scorer verified the same declared checkpoints, candidate panels and
comparable compiled inputs. These are retained prediction replays, not live agent
tasks, held-out results, or a test of goal conditioning.

| Metric | Base predictor | Seed17 LoRA |
|---|---:|---:|
| Completed prediction records | 127/136 | 136/136 |
| Exact tool-and-arguments Top-1 hit | 9/52 (17.3%) | 24/52 (46.2%) |
| Top-3 hit from returned predictions | 20/52 (38.5%) | 27/52 (51.9%) |
| Candidate-panel hit coverage | 27/52 (51.9%) | 27/52 (51.9%) |
| Binary log loss, nats, lower is better | 0.454718 | 1.074204 |
| Brier score, lower is better | 0.138886 | 0.098041 |
| Checkpoints / candidate probabilities scored | 103 / 243 | 112 / 254 |
| Mean recorded replay wall time | 628.3 ms | 891.3 ms |

Top-1 hit rate increased by 28.8 percentage points on this development set. The
underlying candidate-panel coverage was unchanged; the Top-3 result also reflects
whether predictions completed. Completion counts do not measure task success.
Missing predictions remain failures, without invented probabilities.

On the 103 jointly scored checkpoints, the equal-family mean paired log-loss
difference was **+0.617391 nats**, with a 95% family-bootstrap interval of
**[+0.273781, +0.880101]**. The paired Brier difference was **-0.029608**, with
interval **[-0.080814, +0.021547]**. Both use six families, 2,000 bootstrap samples
and seed 42. The Brier interval includes zero. The condition means above use their
own scored denominators; they are not substitutes for the paired estimates.

The loss is checkpoint-mean binary membership loss: whether each candidate's exact
invocation occurs anywhere in the next authoritative batch. Decoder probabilities
condition on preceding emitted tokens. This is neither full-action cross-entropy
nor true conditional entropy. Replay wall time increased here, but historical
replay measurements do not establish a controlled difference in live task latency.

The result is mixed: improved development ranking and completion, worse binary log
loss, and no demonstrated live speedup. It does not establish improvement over
PASTE, Salesforce Speculate with Memory, or native tau-bench task accuracy. E31's
partial goal-condition failure remains a separate reported attempt. Full paired
goal-conditioned replay and native evaluation remain required.

Exploratory diagnostic, raw uncalibrated development scores only: on the 103
jointly scored checkpoints (243 candidates), score orientation around 0.5 yielded
fewer false positives (15 to 5) and false negatives (19 to 15), but trained errors
had much more extreme wrong-label scores: medians 0.99937367 and 0.99999774,
respectively. The ten largest weighted candidate contributions accounted for
68.8% of trained loss; loss worsened in five of six families, with no contributions
clipped at the existing loss floor. Across all 52 eligible checkpoints, the net
15 extra Top-1 hits comprise seven recovered missing/failed predictions plus
11 ranking improvements minus three regressions. This post hoc decomposition
does not change the primary results or failure denominators. No calibration was
fit on development data and no runtime threshold was changed.

Provenance: model revision `2fc06364715b967f1860aea9cf38778875588b17`;
analysis source `c8a662c97c5daae33d4868d7e50494d8355fbc2c`; closed
`prediction-report.json` SHA-256
`527e5fa2854f6d7ba7c0ca923a16ba73874cbbadee72799a992c237a49d9904f`.

Exploratory diagnostic SHA-256: `c8c34b5f1721303b9e19653cf0de60e62269e83f914aa51ff083aa94183db342`.

## Observed smoke result

The source-frozen `fe0748b` smoke ran the pinned Qwen3.5-0.8B predictor on an A100
40 GB. One optimizer step changed 10,822,656 LoRA parameters while preserving the
frozen-base hash. The adapter contains 372 FP32 tensors across 186 target modules.
Strict adapter reload passed with the explicit BF16 inference context.

The subsequent merged-weight comparison failed at its unchanged tolerances:
205 of 248,320 last-token logits differed outside `rtol=0.03, atol=0.06`; maximum
absolute difference was 0.10546875. No merged predictor was published, no trained
server was qualified, and neither main seed started. BF16 merge rounding is a
plausible explanation, not a demonstrated cause for every mismatching logit.

The measured optimizer step took 125.55 seconds; the complete training function
took 229.865 seconds. Peak allocated GPU memory was 4,979,086,336 bytes. These
include the actual fallback kernel configuration and do not predict steady-state
main-training throughput. Teacher-forced smoke diagnostics are not task accuracy.

The failed run was exported and terminated. Its archive SHA-256 is
`258e726877622ca134a34c1a61180a968bb6952e4aa3fbb547079b88bcdae82e`.
The retained adapter file SHA-256 is
`386df0ace66182a6a4be8adde998f0852b3b96d83edd29f216b4576b33687925`.
Provider usage displayed $0.88 for this instance; that display is not a final
invoice, and unresolved reservations have not been released on its authority.

## Recovery design

The fixed-base collection is independent of trained export. It uses 60 original
fitting/calibration slots, the unchanged actor and predictor pins, and the
unchanged `fe0748b` source. Shadow prediction is disabled. A first collection
launch stopped before native dispatch because the heartbeat reader observed a
partially written JSONL row. Its replacement accepts only complete records and
checks both actual watchdog states. The failed launch remains in cost records.
The next two-hour GPU lease passed live model, tool-continuation, database and
telemetry checks. Its 220 bootstrap files were individually verified after
export. A completed cohort and its metrics must be recorded separately once
exported.

Future source introduces explicit unmerged LoRA serving. It keeps the base and
adapter files separate, preserves all target modules and requires strict PyTorch
reload plus a separately bound vLLM loading/numerical probe. Neither the original
merge tolerance nor the failed artifact changes. Both main seeds still require
fresh calibration and paired live evaluation before any improvement claim.

The prompt compiler removes duplicated policy text while retaining one mandatory,
source-addressable copy. A diagnostic on 150 historical public prefixes measured
1,627 redundant retail tokens and 1,865 airline tokens. Empty-candidate mandatory
context overflows fell from 32/150 to 1/150 in that diagnostic. This is a prompt
measurement, not fresh-cohort coverage, model accuracy or live speedup.

Training additionally profiles one disposable step on the longest fitting rows,
with CUDA-OOM-only batch fallback. Development-validation data is collected as a
separate declared base cohort, not reused as the paired comparison's base arm.
Multi-cohort import preserves original receipts and annotation-review ancestry.

## Closed fixed-base collection

All 60 declared fitting/calibration slots closed and were exported. This is a
single-base data collection, not the held-out or three-arm comparison.

| Measurement | Observed result |
| --- | ---: |
| Native completion | 57/60 (95.0%) |
| Known constraint-clean completion | 46/60 (76.7%) |
| Logical / physical tool calls | 326 / 326 |
| Speculative / validation calls | 0 / 0 |
| Mean live latency, including drain | 32.755 seconds |
| Observed live p95, n=60 | 53.926 seconds |
| Mean evaluator-inclusive latency | 38.755 seconds |
| Observed evaluator-inclusive p95, n=60 | 61.145 seconds |
| Known hosted user/judge subtotal | $0.673481 |

The family-bootstrap 95% intervals are [88.3%, 100.0%] for native completion
and [66.7%, 86.7%] for known constraint-clean completion, with 2,000 samples,
seed 42, and 30 family clusters. These describe the custom collection. Retail
completed 27/30 and airline 30/30; their known constraint-clean counts were
26/30 and 20/30. There were 59 complete constraint audits, 11 known violations
and one unevaluated trial. The three failed slots include two native outcome
failures and one execution error. No slot was budget-terminated or replaced.

One hosted charge remains unknown and reserved. GPU charges and final invoices
are separate from the usage-derived hosted subtotal. Two entity variants per
family are not two independent trials of the same task; two-trial consistency
and goal/tool prediction accuracy were not measured by this collection.

The immutable report content hash is
`34708d1561442c3deda85748d8c1ff48f16bb385963e2c41ffa46c2f0ab234ae`.
Its native archive SHA-256 is
`d2dad443830ed822e77fbd88810c910a5045cb9e5e194730b47d1e9188e46681`.
The original collection's postprocessing timed out; the successful public-only
recompilation used source `bbd95b0` without repeating native trials or rewriting
the failed attempt.

## Annotation and fitting coverage

Public recompilation retained 372 nonempty fitting windows. The original
100-case pilot had only 17 exact positive windows, below the required 48.
An explicit expanded selection uses all 372 preexisting public-eligible rows,
which contain 79 exact positive windows. It does not select only positive rows.
Original pilot identities and its 20 preselected audit cases remain unchanged.

Of 155 next-batch allowlisted-read checkpoints, 68 failed the actual current
authorization policy. Among the remaining 87 admissible targets, 79 were covered
by the frozen window (90.8%). Six admissible misses involved date binding and
two were present in the full pool but outside the window. Authorization failures
are not evidence that the policy should be relaxed.

The initial 100 teacher requests produced 37 valid annotations. An explicit
repair produced another 62, leaving one probability-mass failure. Failed drafts
remain retained. Schema validity alone is not semantic acceptance: the actual
20-case human audit and expanded annotation provenance are still required.

## Main training started

The subsequent actual run uses source `5a36a8b3835820fe65b3615ead31fb6fb7bc9672`
and trainer image
`sha256:717c7a2b841602e2b5416f4c938b3c5077d6adaaf3f19f6e31062dea67ce84a2`.
At 17:24 UTC seed 17 had completed 157/204 updates. The same managed run then
trains seed 29 for its complete 204 updates. Earlier failures above remain
historical observations, not claims about the status of this new run.

The prepared fitting dataset hash is
`b0f1480a9b64a32c0570af15f50e70aa4b39a55e0b52a979a12d2d574fa39d81`.
It contains 358 accepted checkpoint triplets, or 1,074 fitting examples. All 372
original eligible checkpoints were attempted; deterministic context compilation
rejected 14, retaining their reasons. The separate machine review accepted 19/20
preselected cases with zero unsupported bindings and zero human reviews. It is
the explicitly declared exploratory protocol, not the original human review.

Actual GPU profiling verified the FP32 decay inventory and selected microbatch
4 with accumulation 4. A warm measurement was recorded after the cold profile
showed substantial initialization overhead. No profiling weights enter training;
the recipe, source and setting remain common to both independent main seeds.
Actual trained serving qualification, paired comparisons and final artifacts
are still pending.

## Completed first seed, failed result publication

Seed 17 completed 204 updates, 204 finite nonzero-gradient checks and epoch 3.
Its failure record preserves matching frozen-base before/after hashes and a
changed adapter hash. The final adapter, reload probe and checkpoint-204 were
saved before receipt hashing rejected `total_flos = 7.51775264009134e16`.
The shared numeric profile permits magnitudes only through `2^53 - 1`.

The failed stage remains failed. Its complete 294,421,841-byte archive was
downloaded and 93 files individually verified; archive SHA-256:
`911df173104cb2e83298b7c781e9d921ee32d0cc8534796bfe52a828f2757e70`.
Recovery must verify the saved weights and original evidence in a new artifact,
retain unknown metrics as unknown, and perform the normal strict reload and
serving checks. There is no reason to repeat these completed optimizer updates.
The independent seed 29 keeps its original source, image and complete recipe.

## Reporting still required

Report semantic annotation acceptance, both full training seeds, goal/tool/argument
prediction, calibration, and the three paired live arms after their actual runs.
Retain failed, censored and undispatched slots. The actual main run uses the
declared [FLA kernel profile](training-kernels-2026-11-13.md); trained serving
qualification is still required. No accuracy or latency improvement is established
by implementation checks or training diagnostics.
