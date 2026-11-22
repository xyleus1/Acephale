# Acephale research paper and reproducible results

**Exploratory / UNVALIDATED. The frozen study's qualification requirements were not met.**

Read the reviewed [20-page paper](acephale-study.pdf), [editable manuscript](paper/manuscript.md), and [complete contents](CONTENTS.md). The PDF is copied byte-for-byte from the final reviewed revision. The evidence includes 36 development arm-runs and all 96 selected held-out slots: **84 database-reward successes, 11 execution/evaluation errors, and one max_steps censor**. Accounted slots are not 96 fully executed evaluations.

All 809 held-out prefetch checkpoints rejected before retrieval, goal inference or ranking. The nominal native arms therefore do not test an auxiliary-predictor benefit. All native comparative timings are invalid; no native speedup is supported. The original seed-17 opportunity profile (8 completed of 20) and seed-29 profile (7 completed, 12 read misses, 1 censor) fail the unchanged minimum of ten. Read misses are not customer-task failures. Prior errors, missing audits, unknown costs and censoring remain retained.

## Reproduce reported arithmetic

The [development](reproduction/development/README.md) and [held-out](reproduction/heldout/README.md) packs each contain nine files: safe sufficient rows/design, five copied original numerical sections, original estimator bodies, a portable driver, requirements and source hashes. Follow each README using Python 3.12 in an isolated environment. These commands require no model/provider calls or private cloud access. All estimates were copied unchanged. A separate one-time AWS check ran the unchanged original numerical functions on the held-out public projection and matched all five original numerical sections; the development projection had already passed its own parity check. No new estimates or model calls were introduced. See the [held-out parity receipt](provenance/heldout-reproduction-check.json).

[Replay and teacher evidence](paper/seed29-unvalidated/README.md), [development figure inputs](paper/development-analysis/README.md), [training counts](paper/training/completed-counts.json), and [numerical qualification evidence](paper/qualification/numerical-comparison.json) are retained. Replay intervals condition on jointly scored rows; they are not native task accuracy or clean cross-seed replication. The copied replay/teacher files and plot scripts reproduce figures from already-computed values, not raw-prediction scoring or teacher requests.

## Editable sources and figures

The matching manuscript, methods, related work, formal references and retained analysis plan are under [paper/](paper/README.md). Figure scripts/data and the original rendered SVG/PDF/PNG files are included. [Rendering instructions](paper/rendering/README.md) describe rebuilding a separate PDF without modifying this reviewed artifact. The PDF renders the main manuscript, related work, formal references and methods appendix; the retained analysis plan is a separate editable supplement.

The older per-stage READMEs and receipts are preserved byte-for-byte and describe their original dated scope. Their statements that they supply no native results apply to those replay/figure subpackages; the final native results are in this paper and the two reproduction packs. Existing output directories are archived evidence: use fresh scratch copies when rerunning plotters that require a new output directory.

## Interpretation and provenance

See the [terminal failure-cause record](paper/sources/heldout-terminal-failure-cause.json), [copied original metrics](paper/sources/heldout-copied-original-metrics.json), and [final evaluated-path evidence](paper/sources/final-native-evaluated-path-public.json). Service-lifetime attribution is supported by executed source and timing; no timer-specific reason code was recorded. The nine error rows without actor/provider dispatch were entered by the executor and remain failed records, not relabeled untouched.

The held-out actor/predictor seeds change together, with assigned trial/time groups; joint consistency is not a causal predictor-seed effect. Recorded hosted model usage is not an invoice or confirmed cash debit; GPU charges are separate. Three prior accepted components remain distinct from this direct unvalidated extension.

[manifest.json](manifest.json) records every payload file's SHA-256, byte count and Git blob SHA-1. [provenance/package-provenance.json](provenance/package-provenance.json) binds the original numerical reports and final visual review. No credentials, private infrastructure paths, raw customer/task text or prompts are included. This package makes no canonical scientific-acceptance or full-study-completion assertion.
