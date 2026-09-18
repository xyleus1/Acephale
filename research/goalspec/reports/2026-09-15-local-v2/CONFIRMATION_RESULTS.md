# Precommitted confirmation results

All **48 declared trials** completed and remain in the primary denominator: **15/16 base successes, 15/16 neutral memory prefetch successes, and 14/16 GoalSpec successes**. The cohort uses four confirmation families disjoint from the four development families, with two variants and two trials per variant and arm. No trial was replaced. The [three-stage analysis](final-three-stage-analysis/README.md) keeps both development rounds separate from this confirmation result.

Across all 48 trials, native state checks passed 46 times, communication checks passed 47 times, and all 48 had zero recorded constraint violations. Among the 45 normally completed `user_stop` trials, state matched in 45/45 and communication matched in 44/45. These are diagnostic components; the primary score remains 44/48 overall and 14/16 for GoalSpec.

| Arm | Success | Family CI | Mean native ms (n=16) | Mean total s (n=16) | Mean drain s (n=16) | Known usage USD | Unknown-cost trials |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Base | 15/16 | [0.875, 1.000] | 32,607.330956 | 32.754877 | 0.147543 | 0.834666 | 1 |
| Neutral memory prefetch | 15/16 | [0.875, 1.000] | 33,259.625106 | 33.402158 | 0.142528 | 1.108885 | 1 |
| GoalSpec | 14/16 | [0.750, 1.000] | 40,051.835606 | 40.355460 | 0.303620 | 1.284470 | 1 |

| Arm | Pass@1 | Both declared trials succeed | Same result across both trials | Observed native p95 ms (n=16) | Observed total p95 s (n=16) | Authoritative calls per success | All physical tool calls per success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Base | 0.9375 | 7/8 | 7/8 | 50,756.146 | 50.774352 | 85/15 = 5.666667 | 85/15 = 5.666667 |
| Neutral memory prefetch | 0.9375 | 7/8 | 7/8 | 51,696.509 | 51.758722 | 62/15 = 4.133333 | 146/15 = 9.733333 |
| GoalSpec | 0.8750 | 6/8 | 6/8 | 60,319.199 | 60.336241 | 77/14 = 5.500000 | 138/14 = 9.857143 |

Pass@1 is mean per-task trial success, not best-of-two. Each consistency column uses eight tasks with both declared trials; both-succeed is not pass@2. Calls per success divide calls across **all 16 trials, including failures**, by the successful-trial count. Physical tool calls include reads and writes, while the separate read table below excludes writes. Sample p95 values are interpolated observed quantiles with only 16 measurements per arm, not stable population-tail guarantees.

GoalSpec's success difference versus either baseline is **-0.0625**, with family bootstrap CI **[-0.125, 0.000]**. Its total trial time exceeds base by **7.600583 seconds** (23.204430%), CI **[4.228208, 10.972958]**, and neutral by **6.953302 seconds**, CI **[-0.463333, 14.369936]**. Neutral versus base success differs by zero, CI [-0.125, 0.125]. Duration differences here are treatment minus baseline; the machine-readable paired table reverses that sign so positive values favor the treatment. These empirical intervals use equal domain and family weights, 2,000 draws, seed 42. There are only four family clusters, and no multiple-comparison adjustment. The observed results do not establish a live GoalSpec success or latency improvement.

All worker drains succeeded. The whole service phase lasted **615.753126 seconds**, including a final service drain of **0.624720 seconds**. Native latency ends before worker drain; total time includes that drain. All recorded durations, including failed trials, remain unchanged. The first concurrent paired blocks begin at design indexes 0, 3, and 6: two GoalSpec trials and one base trial wait during service boot and ledger reconstruction. This startup imbalance limits causal interpretation of timing differences. No startup subtraction, successful-trial filtering, or alternate primary latency score was applied. Sums of concurrent trial durations are not phase wall time.

Known provider usage totals **$3.228021**, including priced responses within the three unknown-cost trials. Each arm has one unresolved full trial charge. Known partial subtotals for those trials are $0.055068 for GoalSpec, $0.055918 for neutral, and $0.023808 for base; they do not settle the unknown attempts. Usage-priced costs are not invoice reconciled. Cost contrasts use only complete pairs: 14 base-versus-neutral, 14 base-versus-GoalSpec, and 15 neutral-versus-GoalSpec pairs.

| Measured behavior | Base | Neutral | GoalSpec |
| --- | ---: | ---: | ---: |
| Physical authoritative reads | 64 | 41 | 55 |
| Physical speculative reads | 0 | 84 | 61 |
| Total physical reads | 64 | 125 | 116 |
| Exact-call useful promotions | 0 | 22 | 12 |
| Unmatched speculative calls | 0 | 62 | 49 |
| Scheduler rejections (duplicate) | 0 | 12 | 11 |
| Native freshness lease checks | 0 | 47 | 29 |
| Physical revalidation calls | 0 | 0 | 0 |
| Saved valid actor goal contexts | N/A | 128/128 | 137/137 |
| Nonunknown actor goal contexts | N/A | 0/128 | 74/137 |
| Goal model responses | 0 | 0 | 48 |
| Prediction cycles started / settled / failed | N/A | 128 / 128 / 0 | 134 / 134 / 0 |

Fifteen of 16 GoalSpec runs adopted at least one nonunknown goal. No goal or candidate contract-rejection event was recorded. Shape, probability mass, and same-frame source references all passed for saved goal contexts; this does not score semantic completeness. Predictor cycle settlement includes failed cycles by definition, so the explicit zero failure count is reported. Candidate admission rejections are distinct: neutral recorded 240 `invalid_low_confidence_or_already_observed` events plus 12 without a reason; GoalSpec recorded 162 plus 11. They are not pooled with scheduler or provider failures.

Physical read counts come from native execution counters reconciled against transcript calls and consumed leases; they exclude writes. Scheduler job-completion events are a separate denominator: neutral recorded 86 `physical_read_completed` events but 84 native speculative read executions. This difference is retained rather than treating every scheduler completion as an additional native read. Exact-call promotions remain a lower bound on useful speculation, and unmatched calls an upper bound on waste.

GoalSpec's measured exact-promotion rate is **12/61 = 19.672131%** of native speculative reads; neutral's is **22/84 = 26.190476%**. This lower-bound usefulness measure covers exact matching Python consumption. It does not count every possible influence of visible speculative evidence on the actor.

Three failures record an actor `model_attempt_failed`, generic `Error`, and native `RuntimeError`:

| Run suffix | Arm | Request state when the attempt failed |
| --- | --- | --- |
| `0000-849bf34bd540` | GoalSpec | The requested item replacement had executed; state and communication checks passed, but execution-error termination remained a primary failure |
| `0001-72495b71454d` | Neutral | The user had confirmed the item replacement; no corresponding write appeared |
| `0041-2528381936a8` | Base | Reservation and flight reads had completed; the conditional retiming remained unexecuted |

These failed attempts have null recorded HTTP status, request ID, code, and cause code. The frozen formatter's `error.name` and `request_id` fields may omit SDK subclass and camelCase request metadata. The saved data cannot establish whether the underlying failure was local, transport, or provider-side. Unknown charges remain unresolved.

The fourth failure, GoalSpec run `0042-3e700590f212`, ended normally with `user_stop`. It had **correct native state, zero constraint violations, and a failed communication-pattern check**. The user requested a flight change only if the extra fare was at most $35. The actor found a $70 increase, explained that it exceeded the limit, and said, "I will not make the change." The user then chose to keep the existing reservation. No write occurred, matching the expected state.

The frozen communication check requires all three regular expressions: `70`, `35`, and `unchanged|keep|cannot|exceed|over`. The assistant transcript matched the first two but used "more than" and "will not make the change," missing every alternative in the third pattern. This is a lexical false negative of the precommitted communication verifier. **The recorded failure and primary score remain unchanged**; no alternate success rate is substituted.

The [diagnostic evidence](confirmation-diagnosis-evidence.json) retains source hashes, all four failed-trial panels, request-failure event identities, and the exact communication-pattern results. Full native outcome panels and paired estimates are in [summary.json](final-three-stage-analysis/summary.json), with compact [arm metrics](final-three-stage-analysis/arms.csv) and [paired differences](final-three-stage-analysis/paired-differences.csv). The separate [native execution replay](native-replay-analysis/README.md) completed all 32 speculative-arm tapes with observation and final-state parity and zero provider calls. It measures fixed-tape read behavior and parity, not revised live success or model-inclusive latency.
