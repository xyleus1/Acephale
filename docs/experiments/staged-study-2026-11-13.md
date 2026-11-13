# Staged study, November 13, 2026

This record separates actual GPU observations from software validation. The
experiment is a custom tau-compatible pilot, not an official full benchmark.

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

## Reporting still required

Report semantic annotation acceptance, both full training seeds, goal/tool/argument
prediction, calibration, and the three paired live arms after their actual runs.
Retain failed, censored and undispatched slots. The next trainer declares an
[FLA kernel profile](training-kernels-2026-11-13.md), whose actual GPU throughput
and numerical qualification have not yet been measured. No accuracy or latency
improvement is established by these implementation changes.
