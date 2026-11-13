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

## Reporting still required

Publish the actual collection denominator, native reward, constraints, logical
and physical calls, live latency and usage cost after closure. Then report
annotation acceptance, data coverage, both training seeds, goal/tool/argument
prediction quality, calibration, and the three paired live arms. Retain failed,
censored and undispatched slots. No accuracy or latency improvement is established
by the recovery code or its unit tests.
