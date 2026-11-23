# Acephale corrected study results

All 132 trials in the corrected native run completed: 36 development and 96
heldout. The study does **not establish a goal-conditioning or prefetching
benefit**. The scheduler executed no speculative reads. Observed differences
between nominal arms therefore cannot be attributed to an executed prefetching
mechanism. The heldout event audit records 918 prefetch checkpoints rejected
before retrieval or predictor execution; all local model dispatches were actor calls.

This is a custom tau-compatible pilot using the frozen Qwen3.5-9B actor, not an
official full-benchmark score or a comparison against other actor models.
The hosted user simulator was gpt-4.1-mini-2025-04-14; the NL-assertion
evaluator and annotation reviewer used gpt-5.4-2026-03-05.
The [paper and reproducibility package](../paper/corrective-study-20261122/README.md)
contains the original estimands, additional controls and limitations. Historical
attempts remain in the [earlier report](RESULTS-20261122.md).

## Corrected heldout cohort

Eight heldout families, two task variants, two joint actor/predictor seed settings,
and three arms produced 96 trials. Every trial completed with a valid recorded
timing and complete configured constraint audit. Database reward and
constraint-clean success are separate outcomes.

| Metric | Base actor | Neutral-memory prefetch | Goal-conditioned prefetch |
| --- | ---: | ---: | ---: |
| Trials | 32 | 32 | 32 |
| Database reward successes | 32/32 | 32/32 | 32/32 |
| Known constraint-clean successes | 25/32 | 27/32 | 23/32 |
| Known constraint-clean success rate | 78.125% | 84.375% | 71.875% |
| Trials with recorded constraint violations | 7 | 5 | 9 |
| Mean native trial latency, seconds | 207.761 | 197.239 | 192.510 |
| Median native trial latency, seconds | 196.713 | 182.825 | 182.249 |
| Observed p95 native trial latency, seconds | 322.636 | 300.247 | 271.091 |
| Logical / physical tool calls | 302 / 302 | 297 / 297 | 295 / 295 |
| Speculative executions | 0 | 0 | 0 |
| Recorded hosted user/judge usage, USD | 0.598737 | 0.567207 | 0.576918 |

Latency is derived from the original `totalTrialSeconds` field, excludes the
separately reported evaluator-inclusive interval, and has 32 valid samples per
arm. The p95 is the original linear sample quantile, not a high-confidence tail
estimate. Monetary values are recorded hosted-model usage, not reconciled
invoices or GPU/cloud costs.

The original equal-family paired bootstrap uses eight families, 32 matched
pairs, 2,000 resamples and seed 42. Treatment-minus-baseline native latency
differences, in seconds, are:

| Comparison | Mean difference | Original 95% interval |
| --- | ---: | ---: |
| Neutral minus base | -10.522 | [-20.493, 1.362] |
| Goal-conditioned minus base | -15.251 | [-31.760, -0.164] |
| Goal-conditioned minus neutral | -4.729 | [-21.988, 10.053] |

The goal-versus-base nominal latency interval excludes zero, but there was no
speculative execution in either arm. It is not evidence that goal conditioning
or speculative reuse caused a speedup. Known constraint-clean success
differences have intervals spanning zero: neutral minus base 0.0625
[-0.0625, 0.1875], goal minus base -0.0625 [-0.375, 0.21875], and goal minus
neutral -0.125 [-0.375, 0.09375].

Each arm has 16 tasks with two runs. Joint actor/predictor-seed database-reward
consistency is 1.0 in every arm; constraint-clean consistency is 0.6875, 0.75
and 0.5625, respectively. Both actor seed and predictor checkpoint change
between these runs. These are joint-seed consistency measurements, not a
fixed-predictor pass-squared estimate. The original all-success family-bootstrap
reward interval [1, 1] describes this finite sample and is not population
certainty.

The [heldout report](../paper/corrective-study-20261122/paper/corrective-results/heldout/native-report.json)
and [execution-path audit](../paper/corrective-study-20261122/paper/corrective-results/heldout/evaluated-path-and-timing.json)
retain the full values and exposure definitions. The original private native
report SHA-256 is
`0b24292a07dd3493a54e6075866af92f5dca813c7dfc2a90b8b975d642ad53a3`;
public projections are separately identified.

## Training, replay and opportunity measurements

Both original LoRA fits completed 204 optimizer updates over 1,074 examples
representing 358 independent checkpoints. These are three textual tasks per
checkpoint, not 1,074 independent agent decisions. The actor remained frozen.

Within each paired goals-fixed replay, neutral and goal-conditioned exact-call
Top-1 are equal: 20.677% for predictor seed 17 and 39.474% for seed 29. The
paired exact-call denominator is 266 eligible-read checkpoints out of 746
declared checkpoints. The separate standalone neutral reference is 44.737%;
it is a different comparison
and must not be substituted for the paired neutral arm. Replay failures,
candidate coverage and the distributed seed-29 runtime amendment remain reported.

Goal-teacher agreement is 6/141 and 15/141 retained checkpoints, respectively,
including misses and context rejections in the declared denominator. This is
distinct from teacher-forced token accuracy, the separate machine annotation
audit, and human review. No human review is claimed.

Each prospective fixed 80-row opportunity profile retained 33 valid measurement
pairs and 47 actor-read misses. The original minimum of ten valid measurements
was met without adaptive extension. The measured predictor and contention costs
were too large relative to these fast native reads for the unchanged scheduler
to admit speculation. The failed earlier 20-row profiles remain separate.

## Development and reproducibility

The corrected development cohort retained all 36 slots. Each arm had 12
database-reward successes; known constraint-clean successes were 9, 8 and 8.
No speculative read executed. Development's repeat-seed coverage differs from
the heldout design and must not be generalized to heldout consistency.

The public development and heldout analysis exports each passed one execution
of the original numerical reproduction check on AWS. The paper includes source
and artifact identities, original failure denominators, and qualified-current
deployment provenance. Current qualification does not retroactively validate
older distributed replay workers.

The [operational source archive](../infra/aws-continuation/corrective-study-20261122/README.md)
contains the continuation and verification code. Publication preserves earlier
evidence rather than rewriting it to appear successful.
