# Acephale: goal-conditioned speculative tool execution

**Corrective study results with retained protocol and deployment limitations.** The original 36-development/96-heldout design is the primary native analysis below. Earlier attempts and all recorded failures remain separately available. Conclusions are limited to the custom tau-compatible task cohort and recorded treatment exposure.

## Abstract

We study whether source-grounded goal information improves prediction of an agent's next read-only tool call. A frozen Qwen3.5-9B actor is paired with a Qwen3.5-0.8B LoRA predictor and speculative execution guarded by exact invocation matching and freshness checks. The corrective development report retains all 36 declared slots (base: 12 completed; neutral memory prefetch: 12 completed; goal-conditioned prefetch: 12 completed). Database-reward successes are base 12/12; neutral memory prefetch 12/12; goal-conditioned prefetch 12/12. Distinct known constraint-clean trial rates are base 75.0%; neutral memory prefetch 66.7%; goal-conditioned prefetch 66.7% (audits available: base 12/12, neutral memory prefetch 12/12, goal-conditioned prefetch 12/12). Original valid live-latency samples are base 12/12, neutral memory prefetch 12/12, goal-conditioned prefetch 12/12. The corrective heldout report retains all 96 declared slots (base: 32 completed; neutral memory prefetch: 32 completed; goal-conditioned prefetch: 32 completed). Database-reward successes are base 32/32; neutral memory prefetch 32/32; goal-conditioned prefetch 32/32. Distinct known constraint-clean trial rates are base 78.1%; neutral memory prefetch 84.4%; goal-conditioned prefetch 71.9% (audits available: base 32/32, neutral memory prefetch 32/32, goal-conditioned prefetch 32/32). Original valid live-latency samples are base 32/32, neutral memory prefetch 32/32, goal-conditioned prefetch 32/32. In retained fixed-panel replay, seed 17 improves equal-family binary log loss by 0.126 nats (95% family-bootstrap interval [0.021, 0.265]) on 230 jointly scored checkpoints, but 412 of 746 predictions fail in each condition. An exploratory distributed seed-29 continuation gives -0.0129 nats [-0.0846, 0.0932] on 442 checkpoints. Goal conditioning does not improve exact-call Top-1 hit rates within either seed. A separate development-only comparison of the two trained predictors and an untrained control shows a tradeoff between probability loss and exact-call hit rate, rather than a uniform training benefit. No speculative read started in any corrective arm. These results characterize the deployed admission policy and do not estimate the efficacy of executed speculative reads or establish a native goal-conditioning speedup. Earlier exploratory attempts, including their failed prerequisites and service interruptions, are retained separately. This is a custom tau-compatible study, not a full official benchmark score.

## 1. Question and scope

An agent often waits for a tool after deciding which call to make. A second model can predict a useful read during the actor's generation and start it early. The speculative result is reusable only if the actor later requests exactly the same invocation and freshness validation succeeds. This can hide latency, but a wrong prediction consumes resources, and predictor contention can slow the actor.

The question is whether goal information improves this prediction enough to justify its cost. Goal conditioning is not guaranteed to help: an inferred goal may be incorrect, the candidate pool may omit the required call, or extra inference may cost more time than the read saves.

PASTE motivates overlapping tool execution and generation, exact invocation matching, and confidence- and latency-benefit-based admission [1]. Speculate with Memory motivates reuse of trajectory experience and prediction errors [2]. Acephale studies goal conditioning within an implementation inspired by these methods. It is not a verified reproduction of their complete serving systems or reported benchmarks.

## 2. Implementation

### 2.1 Models and training

The actor is Qwen3.5-9B [5] and the auxiliary predictor is Qwen3.5-0.8B [6]. The hosted user simulator was gpt-4.1-mini-2025-04-14; the NL-assertion evaluator and annotation reviewer used gpt-5.4-2026-03-05, with separate-prompt, same-model review and zero human reviews. The actor is frozen across native arms. Serving uses the pinned vLLM 0.32.0 environment [7] and BF16 configuration. The retained training environment pins PyTorch, Transformers and the PEFT/TRL stack [8] [9] [10] [11] [12] [13]. Actor input/output budgets are 28,672/4,096 tokens; predictor budgets are 7,168/1,024. Thinking is disabled in this profile. Exact checkpoint, tokenizer, adapter and image identities are retained with the artifacts.

Only the predictor is fine-tuned. The existing recipe uses rank-16 LoRA, alpha 32, dropout 0.05, AdamW at 1e-4, weight decay 0.01, clipping at 1, effective batch size 16, and at most three epochs or 500 optimizer steps. Targets include selected text attention, feed-forward and gated-delta projections; the actor, base parameters, embeddings and language head remain frozen. Training uses completion-only cross entropy with separate goal-inference, neutral-ranking and goal-conditioned-ranking prompts.

Ranking outputs an action class and one binary hit token per candidate. Serving normalizes the logits of the 0/1 token pair, then applies the retained calibration map. Because decoding is autoregressive, later scores condition on earlier generated tokens. They are not independent marginal probabilities. A discriminative ranking head was proposed but is not an evaluated or required component of this frozen experiment; its absence is not an unfinished LoRA fit.

The actual fitting manifest contains 1,074 supervised examples from 358 complete checkpoints across 24 families; 79 checkpoints contain a positive read. Each checkpoint contributes goal inference, neutral ranking and goal-conditioned ranking supervision. Both seed receipts record 204 completed optimizer steps. Three epochs was the configured recipe; completed epochs, training duration and final loss are not independently supplied by the recovered receipts. Each unmerged adapter has 10,822,656 trainable parameters in 372 tensors across 186 modules, stored in FP32 and served with BF16 LoRA. The base recipe retains 18 A_log tensors in FP32.

### 2.2 Public context, memory and candidates

The input compiler includes the visible conversation, policy, tool contracts and current argument evidence. Future actions, hidden native state and evaluator outcomes are excluded. Families are split before annotation or memory mining. Requested-goal labels see the public checkpoint only.

Workflow patterns encode observed ordering, argument dependencies and verified endpoints. At a new checkpoint, symbolic binding resolves arguments from currently visible fields and indices. A historical entity value cannot authorize a current argument.

The implementation supports filtered episodic retrieval for compatible model, tool, environment, policy, authorization and family scope. The optional embedding/exact-cosine and reciprocal-rank-fusion route is a capability, not an evaluated native path in these runs. All retained development and retained held-out native configurations omit episodicEmbeddingsPath. Without a retrieval port, the configured fallback uses lexical token-set cosine with at most four episodes, a 16,000-character limit and strict-policy, verified and family filters.

Even this lexical fallback was not reached at the retained exploratory native prefetch checkpoints: the earlier perfect-predictor opportunity bound returned before retrieval, inferGoals or rank. The historical development audit is reported in Section 7.1; the corrective evaluated path is reported in Section 5. Fixed-panel predictor replay remains a separate experiment and must not be conflated with the native execution path.

When admitted past the opportunity bound, the proposal implementation deduplicates exact invocations and constructs a common, goal-neutral candidate window before conditional ranking. The proposal pool is bounded at 128, and at most three candidates are selected. A positive label means the exact invocation occurs anywhere in the immediately following authoritative batch. Multiple candidates may be positive.

### 2.3 Speculative execution

The scheduler admits audited, read-only calls with current authorization and source-bound arguments. The configured limits are two speculative reads per run, four globally, twelve starts per run, one-hop lookahead and a five-second read deadline. These are within-trial limits.

Native speculative reads use isolated Python-owned snapshots. An authoritative invocation may join matching work, but consumption requires successful freshness validation. Mutations invalidate pending evidence. Cancelled and wasted work remains counted; prefetched observations are never fabricated as tool-call results.

Calibration uses reserved families rather than held-out labels. Opportunity profiling measures actor lead time, predictor cost, scheduling overhead, tool duration, validation and contention. Its conservative admission heuristic uses lower-tail benefits and upper-tail costs. A failed opportunity profile is retained as a failed prerequisite, not replaced with a favorable subset.

## 3. Experimental design and estimands

The compositional task library contains 44 families: 24 for fitting, six for calibration, six for development and eight held out. Each family has two synthetic customer/entity variants. Operation sets differ across partitions, while primitive actions overlap. This is compositional generalization, not an unseen-intent claim.

The tasks use pinned native tools, policies and database evaluators from tau2-bench [3]. Expected database changes and omission checks are specified before actor execution. The generated cohort is a **custom tau-compatible pilot**, not an official full-benchmark score. Database reward and conversational policy compliance are separate outcomes.

The three native arms are the base actor, neutral-memory prefetch, and goal-conditioned memory prefetch. Tasks, actor weights, trial seeds, tool access and step limits are shared; arm order is randomized within each paired block. Development contains 36 arm-runs. The actual frozen held-out target is eight families, two variants, two trials and three arms: 96 selected arm-runs. The original selector selected all eight families before execution.

Replay reports candidate-level binary log loss, Brier score and coverage. These quantities are not full-action cross entropy or true conditional entropy. Paired differences use the original equal-family bootstrap with 2,000 draws and seed 42. Conditional-on-observation intervals do not correct selective missing predictions.

Native reporting preserves every declared run, failures and censoring. It separates database reward, policy constraints, tool calls, speculation and revalidation, costs, and timing validity. The two predictor seeds are confounded with assigned variant/trial/time groups; they do not support a causal seed comparison.

### 3.1 Corrective execution amendment and reporting boundaries

The corrective attempt preserves the frozen models, weights, task identities, arms, decoding, per-trial seeds, run order, 600-second trial limit and 40-step limit. It uses separate attempt ownership and financial reservations; it does not replace, erase or relabel earlier outcomes. The corrective execution comprises two completed 18-run development segments and two completed 48-run held-out segments, one per predictor seed in each stage. Independent seed segments overlap on two qualified L40S hosts; original within-segment run order and cache behavior are preserved. Segment identities and claim-order requirements do not imply serial wall-clock execution across the two hosts. The held-out 96 selected IDs are frozen from the existing selection; corrective development outcomes do not trigger a new task selection.

Each segment retains its actual worker, runtime, model and source identities. Python and Node native processes, model endpoints, tool/database state and host observation remain on that qualified worker. The budget client communicates with the sole existing ledger owner through the shared filesystem queue. Within-segment order and cache behavior are preserved; workers are not treated as interchangeable latency samples. Financial namespace and checkpoint-continuation repairs preserve old charges and unknown holds without changing scientific run IDs.

Opportunity profiling is a separate prospective amendment: 80 fixed eligible non-held-out prefixes per predictor seed, selected before new measurement outcomes from original selection positions 20 through 99 and excluding the original 20. The declared sample is not extended until a gate passes; failed or censored measured rows are retained, and earlier measurements are not pooled into the new profile. The original profiler, candidate logic, p10-benefit/p90-cost aggregation and minimum of ten completed measurements remain unchanged. Both completed fixed80 profiles passed the unchanged minimum10 aggregation requirement, retaining 33 valid pairs and 47 measured actor-read misses per seed. Failed profile rows remain in the declared coverage denominator; the scheduler estimates are conditional on the valid pairs.

Corrective native admission requires the actual qualifying profile and original guard checks. Required host-health observations must be fresh and source-bound; a missing-observation waiver cannot make timing valid. Operational service lifetime is aligned with the finite host lease and drain window rather than the earlier 5,400-second cutoff, while per-trial limits remain unchanged. Neither this correction nor a passing numerical fixture establishes task accuracy, useful speculation or a speedup. The final reporting uses observed timing-validity flags and reason codes, recorded model events, actual telemetry-closure dispositions and the unchanged original estimators.

## 4. Prediction and opportunity results

| Replay comparison | Jointly scored checkpoints / families | Neutral-minus-goal log loss, nats (95% CI) | Brier difference (95% CI) |
|---|---:|---:|---:|
| Retained seed 17 | 230 / 34 | 0.125995 [0.021043, 0.265059] | 0.017339 [0.004602, 0.034146] |
| Distributed seed 29, exploratory | 442 / 36 | -0.012936 [-0.084643, 0.093218] | 0.005168 [-0.005044, 0.022080] |

Positive values favor goal conditioning on the observed comparison panel. Seed 17 retained 334 completed predictions and 412 failures per fixed-panel condition. Seed 29 retained 582 completed predictions and 164 failures per fixed-panel condition. The standalone neutral reports use a different scored cohort and are not substitutes for the paired neutral rows.

Seed 17 shows an observed-subset improvement, but its high failure rate limits interpretation. Seed 29's intervals include zero. Neither result establishes a general goal-conditioning benefit, equivalence, or a native latency improvement. The distributed continuation also changed hardware and runtime execution placement, so it is not a clean seed replication.

The fixed-panel exact-invocation hit rates do not improve with goal conditioning. Both reports declare 266 checkpoints whose next authoritative batch contains an eligible read, out of 746 total checkpoints; the other 480 are no-read checkpoints.

| Replay / condition | Exact-call Top-1 hit rate | Exact-call Top-3 hit rate | Candidate-panel any-hit coverage |
|---|---:|---:|---:|
| Seed 17, neutral | 20.68% | 20.68% | 45.86% |
| Seed 17, goal-conditioned | 20.68% | 20.68% | 45.86% |
| Seed 29, neutral | 39.47% | 40.23% | 45.86% |
| Seed 29, goal-conditioned | 39.47% | 40.23% | 45.86% |

Each rate uses the declared 266 eligible-read checkpoints, including missing predictions rather than conditioning on successfully decoded outputs. A hit requires the tool and full arguments to match an invocation in the next authoritative batch. At most three preselected candidates are ranked. These are exact-invocation hit rates, not tool-name-only accuracy. The equal rates show that seed 17's probability-loss improvement did not change these top-ranked-hit outcomes. Different missing-prediction rates prevent treating the two seed rows as a clean causal seed comparison.

The original seed-17 opportunity profile completed 8 of 20 measurements; the other 12 requested a different read from the profiled candidate. Seed 29 completed 7 of 20, with 12 measured read misses and one interruption-censored row. Both fail the unchanged minimum of ten completed measurements. Read misses are prediction failures at those prefixes, not evidence that the actor failed the customer's task.

Goal-teacher agreement is also distinct from native reward. The retained seed-17 reliability artifact reports 6 agreements among 141 graded cases and a Wilson lower bound of 0.01965. The seed-29 continuation reports 15 agreements among 141 cases and a lower bound of 0.06554. The annotation audit used zero human reviews and a separate prompt to the same teacher model; reviewer-model independence is not claimed.

![Retained seed17 replay evidence](figures/seed17-retained-evidence.png)

Figure 1. Retained seed-17 prediction evidence. Positive neutral-minus-goal differences favor goal conditioning on the jointly observed subset; missing predictions remain reported.

![Unvalidated paired seed29 differences](figures/seed29-paired-differences.png)

Figure 2. Exploratory seed-29 paired replay differences. Both intervals include zero, and this distributed continuation is not a clean seed replication.

### 4.1 Development-only predictor-weight comparison

The unchanged original comparison also evaluated the retained neutral-ranking outputs of both trained predictors and an untrained control on the same 136 declared development checkpoints across six families. There are 52 eligible-read and 84 no-read checkpoints, with 24 empty panels. The original comparison verifies common checkpoint identities and candidate panels. Missing predictions remain failures; no probability is imputed.

| Predictor | Completed / failed predictions | Scored checkpoints | Checkpoint-mean binary log loss | Brier score | Exact-call Top-1 / Top-3, denominator 52 |
|---|---:|---:|---:|---:|---:|
| Trained seed 17 | 136 / 0 | 112 | 1.074948 | 0.098043 | 0.4615 / 0.5192 |
| Trained seed 29 | 136 / 0 | 112 | 0.992701 | 0.129018 | 0.4615 / 0.5192 |
| Untrained control | 127 / 9 | 103 | 0.454718 | 0.138886 | 0.1731 / 0.3846 |

The trained conditions score 254 candidate observations each; the untrained control scores 243. Candidate-panel any-hit coverage is 0.5192 over the 52 declared eligible-read checkpoints in every condition. Top-3 hit rate with at most three candidates describes panel coverage as well as decoding availability; it is not an independent ranking-quality metric.

| Paired treatment minus baseline | Jointly scored checkpoints / families | Binary log-loss difference (95% CI) | Brier difference (95% CI) |
|---|---:|---:|---:|
| Trained seed 29 minus Trained seed 17 | 112 / 6 | -0.035289 [-0.382841, 0.419134] | 0.035334 [-0.010374, 0.091725] |
| Untrained control minus Trained seed 17 | 103 / 6 | -0.618377 [-0.879690, -0.274970] | 0.029606 [-0.021551, 0.080814] |
| Untrained control minus Trained seed 29 | 103 / 6 | -0.625429 [-0.937796, -0.306808] | -0.015726 [-0.096138, 0.066611] |

These are copied original equal-family means of paired checkpoint differences, with 2,000 bootstrap draws and seed 42; they are not differences of the standalone row means above. Negative differences favor the treatment on a loss metric. The untrained control has lower observed log loss but lower exact-call hit rates; Brier intervals for these paired contrasts include zero. The evidence therefore does not support a uniform training benefit. The seed-29 distributed runtime and scheduling amendment, selective missingness and six-family development scope also prevent a weights-only causal or held-out generalization claim. This is a completed original CPU comparison of retained outputs, not another model run or retrospective qualification.

## 5. Corrective native evaluation

<!-- CORRECTIVE_NATIVE_RESULTS_BEGIN -->
#### Corrective prospective opportunity measurements

| Predictor seed | Declared | Completed | Recorded profile failures | Original aggregate sampleCount |
|---|---:|---:|---:|---:|
| 17 | 80 | 33 | 47 | 33 |
| 29 | 80 | 33 | 47 | 33 |

The original minimum10 gate passed for these separate fixed80 profiles on the qualified deployments. Each profile retained 33 valid pairs and 47 measured actor-read misses among all 80 declared rows. The estimates below are conditional on those 33 valid pairs per predictor seed. Old20 profiles and pre-measurement setup failures are not pooled or relabeled. This is prefix-profile coverage, not task success.

The original conservative estimator (lower benefits p10, upper costs p90) supplied the following scheduler inputs. These are copied profile-derived estimates, not new native latency or speedup estimates.

| Predictor seed | Actor lead (ms) | Prediction (ms) | Contention (ms) | Scheduling (ms) | Tool (ms) | Validation (ms) |
|---|---:|---:|---:|---:|---:|---:|
| 17 | 997.224 | 1055.364 | 1925.554 | 4.590 | 14.113 | 10.513 |
| 29 | 994.980 | 1006.534 | 1413.169 | 4.795 | 12.967 | 7.881 |

The estimated tool benefit is approximately 13 to 14 ms, prediction is about 1 s, and the contention estimate is larger still. The admission rule and thresholds remain unchanged. Final treatment exposure is reported from all retained native runtime events; an unexposed treatment arm does not establish the efficacy of executed speculative reads.

Source-bound evidence: [original profile and observed-runtime proof bindings](corrective-results/scheduler-inputs-binding.json).

#### Corrective development

The following table copies the original statistical report for the separate corrective attempt. It retains all declared slots and does not replace the earlier exploratory results. Report generation alone does not assert scientific acceptance.

**Corrective development results; custom tau-compatible pilot.** 36 declared original slots. Original report status: closed. The original status field is preserved, not reclassified. Numerical serving qualification and archived host-telemetry closure are separate source-bound evidence reported below. This is not a complete official benchmark score.

| Recorded metric | Base | Neutral memory prefetch | Acephale |
| --- | --- | --- | --- |
| Scheduled trials | 12 | 12 | 12 |
| Status counts | completed=12 | completed=12 | completed=12 |
| DB reward successes | 12 | 12 | 12 |
| DB reward pass1 (trial rate) | 1.0000 | 1.0000 | 1.0000 |
| DB reward family estimate / CI | 1.0000 [95% CI [1.0000, 1.0000]]; n=12, families=6 | 1.0000 [95% CI [1.0000, 1.0000]]; n=12, families=6 | 1.0000 [95% CI [1.0000, 1.0000]]; n=12, families=6 |
| Known constraint-clean pass1 | 0.7500 | 0.6667 | 0.6667 |
| Constraint audit complete / scheduled | 12 / 12 | 12 / 12 | 12 / 12 |
| Constraint violations (missing trials) | 3 (missing 0) | 4 (missing 0) | 4 (missing 0) |
| Logical tool calls | 77 (missing 0) | 76 (missing 0) | 73 (missing 0) |
| Physical tool calls | 77 (missing 0) | 76 (missing 0) | 73 (missing 0) |
| Physical calls / success | 6.4167 | 6.3333 | 6.0833 |
| Speculative starts | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Useful speculations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Wasted speculations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Rejected speculation requests | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Cancellation requests | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Confirmed cancellations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Completed revalidations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Revalidation calls | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Unpromoted physical calls | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Hosted known usage (USD) | 0.150927 | 0.143530 | 0.140916 |
| Hosted missing-subtotal trials / unknown charges | 0 / 0 | 0 / 0 | 0 / 0 |
| Unknown-cost trials | 0 | 0 | 0 |
| Valid live-latency samples | 12 | 12 | 12 |
| Live latency mean / median / p95 (ms) | 99432.1675 / 99181.0396 / 130331.1427 | 93312.6945 / 97590.0988 / 124475.6353 | 95599.9411 / 87313.7568 / 137853.9552 |
| Joint actor/predictor-seed consistency (paired-task n) | NA (n=0) | NA (n=0) | NA (n=0) |
| Known constraint-clean joint consistency (paired-task n) | NA (n=0) | NA (n=0) | NA (n=0) |

Counts include all recorded statuses. Parenthesized missing counts are retained, not imputed. The DB reward trial rate and equal-family estimate are distinct stored fields. If all observed family outcomes succeed, an original bootstrap interval of [1, 1] reflects resampling this finite cohort; it does not establish population certainty or zero failure risk. Constraint-clean results cover the configured assertion audit, not complete policy compliance. NA denotes a null or absent report value; zero valid latency samples do not imply zero latency. Joint seed consistency is not fixed-checkpoint pass².

| Original paired estimate / 95% CI | Neutral memory prefetch − Base | Acephale − Base | Acephale − Neutral memory prefetch |
| --- | --- | --- | --- |
| DB reward difference | 0.0000 [95% CI [0.0000, 0.0000]]; n=12, families=6 | 0.0000 [95% CI [0.0000, 0.0000]]; n=12, families=6 | 0.0000 [95% CI [0.0000, 0.0000]]; n=12, families=6 |
| Known constraint-clean difference | -0.0833 [95% CI [-0.2500, 0.0000]]; n=12, families=6 | -0.0833 [95% CI [-0.3333, 0.1667]]; n=12, families=6 | 0.0000 [95% CI [-0.3333, 0.4167]]; n=12, families=6 |
| Logical tool-call difference | -0.0833 [95% CI [-0.4167, 0.4167]]; n=12, families=6 | -0.3333 [95% CI [-0.8333, 0.0000]]; n=12, families=6 | -0.2500 [95% CI [-0.7500, 0.1667]]; n=12, families=6 |
| Physical tool-call difference | -0.0833 [95% CI [-0.4167, 0.4167]]; n=12, families=6 | -0.3333 [95% CI [-0.8333, 0.0000]]; n=12, families=6 | -0.2500 [95% CI [-0.7500, 0.1667]]; n=12, families=6 |
| Valid live-latency difference (ms) | -6119.4730 [95% CI [-9865.1823, -3059.2218]]; n=12, families=6 | -3832.2264 [95% CI [-13386.0357, 4994.6377]]; n=12, families=6 | 2287.2466 [95% CI [-4989.3927, 8604.4058]]; n=12, families=6 |

Paired differences are treatment minus baseline, copied with their original family-weighted confidence intervals and per-metric denominators; no statistics were recomputed.

Hosted usage scope: hosted_user_and_judge_only. These are recorded provider-usage/ledger values, not reconciled invoices or confirmed cash debits; GPU charges are separate.

Seed-design limitation: Development variantv0 uses predictor17 and variantv1 predictor29, actor17 in both; between-weight comparison is confounded by task variant.


Recorded event totals: model_dispatch=363, model_completed=363, infra_checkpoint=238, infra_opportunity_rejected=238. Request-type suffix counts are {"model_completed:actor": 363, "model_dispatch:actor": 363}. Valid timing rows by arm: {"acephale": 12, "base": 12, "neutral_memory_prefetch": 12}. Recorded host-health reason counts: {"unspecified": 108}. These are direct log/row counts, not a new statistical estimator. Configuration alone does not establish retrieval or auxiliary prediction. Actual seed identities and raw per-segment hardware/runtime provenance are retained in the companion evidence. All arms recorded zero speculative starts in the original report. These results do not estimate the efficacy of executed speculative tool reads. Nominal treatment assignment alone does not establish retrieval or auxiliary-predictor execution. Arm contrasts describe the deployed admission policy under the observed workload; claims about the efficacy of executed speculation require corresponding observed exposure. No superiority claim is inferred from an unexposed treatment label.

![Corrective development stored trial rates](figures/corrective-development/rates.png)

Figure 3. Corrective development original stored reward and known constraint-clean trial rates. Failed/censored slots and unknown audits retain their original denominators; this figure adds no confidence interval or equivalence claim.

#### Corrective heldout

The following table copies the original statistical report for the separate corrective attempt. It retains all declared slots and does not replace the earlier exploratory results. Report generation alone does not assert scientific acceptance.

**Corrective heldout results; custom tau-compatible pilot.** 96 declared original slots. Original report status: closed. The original status field is preserved, not reclassified. Numerical serving qualification and archived host-telemetry closure are separate source-bound evidence reported below. This is not a complete official benchmark score.

| Recorded metric | Base | Neutral memory prefetch | Acephale |
| --- | --- | --- | --- |
| Scheduled trials | 32 | 32 | 32 |
| Status counts | completed=32 | completed=32 | completed=32 |
| DB reward successes | 32 | 32 | 32 |
| DB reward pass1 (trial rate) | 1.0000 | 1.0000 | 1.0000 |
| DB reward family estimate / CI | 1.0000 [95% CI [1.0000, 1.0000]]; n=32, families=8 | 1.0000 [95% CI [1.0000, 1.0000]]; n=32, families=8 | 1.0000 [95% CI [1.0000, 1.0000]]; n=32, families=8 |
| Known constraint-clean pass1 | 0.7812 | 0.8438 | 0.7188 |
| Constraint audit complete / scheduled | 32 / 32 | 32 / 32 | 32 / 32 |
| Constraint violations (missing trials) | 7 (missing 0) | 5 (missing 0) | 9 (missing 0) |
| Logical tool calls | 302 (missing 0) | 297 (missing 0) | 295 (missing 0) |
| Physical tool calls | 302 (missing 0) | 297 (missing 0) | 295 (missing 0) |
| Physical calls / success | 9.4375 | 9.2812 | 9.2188 |
| Speculative starts | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Useful speculations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Wasted speculations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Rejected speculation requests | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Cancellation requests | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Confirmed cancellations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Completed revalidations | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Revalidation calls | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Unpromoted physical calls | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Hosted known usage (USD) | 0.598737 | 0.567207 | 0.576918 |
| Hosted missing-subtotal trials / unknown charges | 0 / 0 | 0 / 0 | 0 / 0 |
| Unknown-cost trials | 0 | 0 | 0 |
| Valid live-latency samples | 32 | 32 | 32 |
| Live latency mean / median / p95 (ms) | 207760.6047 / 196712.9578 / 322635.5486 | 197238.6265 / 182825.1457 / 300246.9401 | 192509.6560 / 182249.2995 / 271091.1486 |
| Joint actor/predictor-seed consistency (paired-task n) | 1.0000 (n=16) | 1.0000 (n=16) | 1.0000 (n=16) |
| Known constraint-clean joint consistency (paired-task n) | 0.6875 (n=16) | 0.7500 (n=16) | 0.5625 (n=16) |

Counts include all recorded statuses. Parenthesized missing counts are retained, not imputed. The DB reward trial rate and equal-family estimate are distinct stored fields. If all observed family outcomes succeed, an original bootstrap interval of [1, 1] reflects resampling this finite cohort; it does not establish population certainty or zero failure risk. Constraint-clean results cover the configured assertion audit, not complete policy compliance. NA denotes a null or absent report value; zero valid latency samples do not imply zero latency. Joint seed consistency is not fixed-checkpoint pass².

| Original paired estimate / 95% CI | Neutral memory prefetch − Base | Acephale − Base | Acephale − Neutral memory prefetch |
| --- | --- | --- | --- |
| DB reward difference | 0.0000 [95% CI [0.0000, 0.0000]]; n=32, families=8 | 0.0000 [95% CI [0.0000, 0.0000]]; n=32, families=8 | 0.0000 [95% CI [0.0000, 0.0000]]; n=32, families=8 |
| Known constraint-clean difference | 0.0625 [95% CI [-0.0625, 0.1875]]; n=32, families=8 | -0.0625 [95% CI [-0.3750, 0.2188]]; n=32, families=8 | -0.1250 [95% CI [-0.3750, 0.0938]]; n=32, families=8 |
| Logical tool-call difference | -0.1562 [95% CI [-0.3125, 0.0000]]; n=32, families=8 | -0.2188 [95% CI [-0.5625, 0.0312]]; n=32, families=8 | -0.0625 [95% CI [-0.3438, 0.1562]]; n=32, families=8 |
| Physical tool-call difference | -0.1562 [95% CI [-0.3125, 0.0000]]; n=32, families=8 | -0.2188 [95% CI [-0.5625, 0.0312]]; n=32, families=8 | -0.0625 [95% CI [-0.3438, 0.1562]]; n=32, families=8 |
| Valid live-latency difference (ms) | -10521.9782 [95% CI [-20493.4099, 1362.1038]]; n=32, families=8 | -15250.9487 [95% CI [-31760.3891, -164.2758]]; n=32, families=8 | -4728.9705 [95% CI [-21987.6902, 10052.5456]]; n=32, families=8 |

Paired differences are treatment minus baseline, copied with their original family-weighted confidence intervals and per-metric denominators; no statistics were recomputed.

Hosted usage scope: hosted_user_and_judge_only. These are recorded provider-usage/ledger values, not reconciled invoices or confirmed cash debits; GPU charges are separate.

Seed-design limitation: Heldout trial0 uses actor17/predictor17 and trial1 actor29/predictor29; consistency changes both seeds.


Recorded event totals: model_dispatch=1393, model_completed=1393, infra_checkpoint=918, infra_opportunity_rejected=918. Request-type suffix counts are {"model_completed:actor": 1393, "model_dispatch:actor": 1393}. Valid timing rows by arm: {"acephale": 32, "base": 32, "neutral_memory_prefetch": 32}. Recorded host-health reason counts: {"unspecified": 288}. These are direct log/row counts, not a new statistical estimator. Configuration alone does not establish retrieval or auxiliary prediction. Actual seed identities and raw per-segment hardware/runtime provenance are retained in the companion evidence. All arms recorded zero speculative starts in the original report. These results do not estimate the efficacy of executed speculative tool reads. Nominal treatment assignment alone does not establish retrieval or auxiliary-predictor execution. Arm contrasts describe the deployed admission policy under the observed workload; claims about the efficacy of executed speculation require corresponding observed exposure. No superiority claim is inferred from an unexposed treatment label.

![Corrective heldout stored trial rates](figures/corrective-heldout/rates.png)

Figure 4. Corrective heldout original stored reward and known constraint-clean trial rates. Failed/censored slots and unknown audits retain their original denominators; this figure adds no confidence interval or equivalence claim.

Predictor-seed 17 host telemetry archive passed the original archive/member verification and selected-trace coverage checks (16 selected traces; 16 recorded native trace evidence items). Predictor-seed 29 host telemetry archive passed the original archive/member verification and selected-trace coverage checks (16 selected traces; 16 recorded native trace evidence items). These late read-only observations follow both original cohorts on each host. They do not change recorded measuredTimingValid flags, native outcomes, latency inclusion, or the original statistical results. Recorded hosted usage remains distinct from invoice reconciliation. Telemetry verification alone does not establish benchmark validity or speculative efficacy.
<!-- CORRECTIVE_NATIVE_RESULTS_END -->

## 6. Qualification corrections and limitations

Earlier seed-29 serving probes failed the numerical criterion: the reference conditional probability was 0.23370635691404026, while a retained configured response was 0.21206880435710532, an absolute difference of 0.021637552556934947 against the unchanged maximum of 0.01. Three retained requests on each of L40S and RTX PRO 6000 Blackwell shared that probability, which does not establish a hardware-specific cause. Those failed records remain unchanged.

The subsequent seven-file runtime correction and fresh full qualification now have separate successful receipts. The following values are copied from the actual original qualification artifacts; the maximum probability difference remains 0.01 and the required top token is 4754.

| Corrective predictor | Observed conditional probability | Recorded absolute reference difference | Original numerical gate | Full qualification receipt |
|---|---:|---:|---|---|
| Seed 17 | 0.3629692055196168 | 0 | Passed | Passed |
| Seed 29 | 0.22815650216092537 | 0.005549854753114897 | Passed | Passed |

A passing fixture establishes the specified loading and numerical-compatibility checks, not full-vocabulary equivalence, task quality or the causal effect of any single source patch. Model weights, decoding and acceptance tolerance were not changed to obtain these passes. The retained source audit also matches the seven corrected files on the distributed replay workers that it covers, with native components unchanged; it explicitly records no full qualification receipt for those historical workers. Source agreement alone does not retroactively qualify their replay or erase its scheduling amendment.

The correction account distinguishes numerical runtime work from operational preparation. Isolated-interpreter dependency-path repair and mapping of frozen collection paths to their byte-identical AWS copies address prefix reconstruction before model dispatch; they do not translate task entities, change tools or replace measured outcomes. Financial namespace/RPC routing repairs preserve the sole budget owner and old financial holds. These changes are recorded with source identities; they are not reported as accuracy improvements.

Under the historical failed-profile opportunity estimates, faster prediction alone cannot make that historical configured admission bound positive. Its overlap term is capped by tool duration (9.076 and 11.965 ms), while the corresponding contention estimates alone are 813.436 and 1,219.885 ms. Even a zero-latency predictor with probability one would therefore be rejected under these same inputs. This is an algebraic consequence of the recorded heuristic, not a new oracle experiment or a measured limit on attainable speedup; both opportunity profiles failed their minimum-coverage requirement. The separate fixed80 cohorts were measured on the qualified deployments, retaining 33 valid pairs and 47 measured actor-read misses per predictor seed. Their conservative scheduler inputs are reported in Section 5 conditional on the 33 valid pairs. The failed historical profiles are not pooled with them, and the historical bound is not an estimate of the corrective deployment.

The central weakness is not solved by more GPU capacity. Candidate coverage, goal reliability and the opportunity gate limit whether speculation becomes useful. Token-level training accuracy is not a substitute for exact-call ranking quality. Missing prediction outcomes can bias an observed-subset comparison.

The current predictor jointly learns three textual tasks with a generative objective. Candidate-order dependence and annotation-to-deployment goal mismatch remain plausible explanations for poor ranking. They are hypotheses for a future experiment, not demonstrated causes or evaluated fixes. A frozen-backbone discriminative head and family-held-out probability calibration would test those hypotheses without changing the actor.

The native extension has a small synthetic task cohort, limited policy assertions and deployment deviations. No complete official tau score, SOTA claim, proof of lossless acceleration, or claim that goals can only improve performance is warranted. A useful negative result is to identify where prediction gains fail to translate into admitted, consumed reads.

## 7. Historical exploratory native evaluation

### 7.1 Retained development cohort

All 36 declared development arm-runs in the earlier exploratory attempt completed: six families, two task variants and three arms. The original native estimators were applied to the saved evaluator outputs. The following results are exploratory; none is a held-out result.

| Metric | Base actor | Neutral-memory prefetch | Goal-conditioned prefetch |
|---|---:|---:|---:|
| Completed / declared arm-runs | 12 / 12 | 12 / 12 | 12 / 12 |
| Database reward 1.0 | 12 / 12 | 12 / 12 | 12 / 12 |
| Reward 1.0 with no recorded policy violation | 8 / 12 | 9 / 12 | 9 / 12 |
| Runs with a recorded policy violation | 4 | 3 | 3 |
| Logical / physical tool calls, total | 77 / 77 | 77 / 77 | 76 / 76 |
| Speculative reads / revalidation calls | 0 / 0 | 0 / 0 | 0 / 0 |
| Valid comparative latency samples | 0 | 0 | 0 |
| Recorded hosted user/judge usage, USD | 0.153230 | 0.146678 | 0.152834 |

Database reward and policy compliance differ because the database evaluator can find the expected final state while a separate assertion flags missing explicit confirmation before a mutation. The recorded policy verdict is retained; database reward alone is not unconditional task correctness.

The equal-family paired difference in constraint-clean success is +0.0833 for either prefetch arm relative to the base actor, with the original 95% family-bootstrap interval [0, 0.25]. Goal-conditioned minus neutral prefetch is 0 with interval [-0.25, 0.25]. Goal-conditioned minus base logical tool calls is -0.0833 per run, with interval [-0.3333, 0.1667]. These estimates use six families and 12 paired trials, with 2,000 resamples and seed 42. They compare nominal configurations whose auxiliary prediction paths were never entered, so their differences cannot be attributed to inferred goals, retrieval or trained-predictor efficacy.

All arms have empirical database-reward estimates and bootstrap intervals of 1.0 [1.0, 1.0]; all paired reward differences are 0 [0, 0]. These degenerate empirical intervals reflect the uniformly successful observed sample. They do not establish population-perfect performance, equivalence or a ceiling on future failures.

The completed raw event logs record 370 local model dispatches and 370 completions, all Qwen3.5-9B actor requests; no auxiliary goal-inference or candidate-ranking request occurs. Every one of the 247 prefetch-arm checkpoints is rejected by the unchanged perfect-predictor opportunity bound before retrieval, inferGoals or rank. The two retained opportunity estimates have predictionMs greater than actorLeadMs (541.052832 versus 479.775439, and 1673.486294 versus 890.310045). The original overlap formula is therefore zero even at probability one, while validation, scheduling and contention overheads make the bound nonpositive.

The nominal native arms collapsed to demand-only execution under these exploratory opportunity inputs. Neither configured lexical fallback nor optional vector/RRF retrieval was exercised at these checkpoints. This is fail-closed abstention, not a measured predictor-accuracy failure, and it does not prove that the tasks lacked useful speculative reads. No speculative read was executed or consumed. Every comparative-timing validity flag is false, and the original report has null latency estimates and intervals. Operational elapsed time is excluded from speedup comparisons. Hosted usage is recorded user-simulator/judge usage, separate from GPU charges and any reconciled invoice.

The retained exploratory held-out logs contain 1,213 actor dispatches and 1,212 completions; one dispatch lacks a completion before service closure. All 809 observed prefetch checkpoints are rejected before retrieval, goal inference or ranking. There are no auxiliary-predictor dispatches. These complete log counts replace the earlier partial snapshot; the retained development and held-out source identities remain separate.

![Development reward and constraint audit](figures/development-reward-constraint-counts.png)

Figure 5. Historical development database reward and constraint-clean outcomes for nominal arms, copied from the original native analysis. Each arm has 12 runs across six families. The opportunity bound prevents auxiliary prediction and speculation; these are not live goal-predictor efficacy estimates. All comparative timings are invalid.

### 7.2 Deployment and reporting amendments

The exploratory cloud continuation proceeded despite failed opportunity and deployment-qualification prerequisites. It remains UNVALIDATED under the original protocol. Existing accepted components and failed qualification evidence are preserved.

Development ran as 12 intact three-arm blocks. Eleven blocks used L40S hardware and one used RTX PRO 6000 Blackwell; notebook and EC2 runtime images also differed. Each paired block retained one execution environment across its arms. All 12 original scope records remain available. The reporting adapter compares scope within blocks, retains domain-specific tool schemas and hardware strata, and verifies unchanged model configuration, data, protocol, source commit and task bundle. The statistical estimators are unchanged.

A collection record omitted the tools field for 18 seed-17 rows. Reporting restored that metadata from the exact executed configurations, after verifying all frozen run IDs, task/family identities, arms, trial and predictor seeds, ordering and step limits. No tool schema or scientific output was modified.

The development actor seed is 17 in both predictor-training-seed groups. Task variant and predictor training seed are confounded. There is no repeated same-task trial pair, so two-trial consistency is undefined for development.

### 7.3 Retained held-out evaluation

All 96 scheduled held-out slots remain in the original denominator: 84 completed with database reward 1.0, 11 failed with execution/evaluation errors and one was censored at the native step limit. The executed local-service configuration imposed a 5,400-second lifetime, and the source scheduled a stop at that limit. Both services closed with aborted=true after approximately 90 minutes plus teardown, before the 5,520-second owner limit. This is an attribution supported by source and timing; the logs contain no timer-specific reason code. The closing service caused the evaluator's retained Gateway closed exception. Two error rows had actual model calls; the other nine were entered by the executor but contain no actor or hosted-provider dispatch. They remain failed rows rather than being relabeled not started. The original no-retry launcher and closed accounting sessions were preserved. These operational failures limit the scheduled-slot completion rates and cannot be attributed to goal conditioning.

**Heldout native results — UNVALIDATED.** Custom tau-compatible execution; 96 declared original slots. This is not a qualified or full-benchmark score.

| Recorded metric | Base | Neutral memory prefetch | Acephale |
| --- | --- | --- | --- |
| Scheduled trials | 32 | 32 | 32 |
| Status counts | completed=28; failed=4 | censored=1; completed=27; failed=4 | completed=29; failed=3 |
| DB reward successes | 28 | 27 | 29 |
| DB reward pass1 (trial rate) | 0.8750 | 0.8438 | 0.9062 |
| DB reward family estimate / CI | 0.8750 [95% CI [0.7812, 0.9688]]; n=32, families=8 | 0.8438 [95% CI [0.7188, 0.9688]]; n=32, families=8 | 0.9062 [95% CI [0.8125, 0.9688]]; n=32, families=8 |
| Known constraint-clean pass1 | 0.6562 | 0.6562 | 0.6562 |
| Constraint audit complete / scheduled | 28 / 32 | 27 / 32 | 29 / 32 |
| Constraint violations (missing trials) | 7 (missing 4) | 6 (missing 5) | 8 (missing 3) |
| Logical tool calls | 262 (missing 0) | 262 (missing 0) | 268 (missing 0) |
| Physical tool calls | 262 (missing 0) | 262 (missing 0) | 268 (missing 0) |
| Physical calls / success | 9.3571 | 9.7037 | 9.2414 |
| Revalidation calls | 0 (missing 0) | 0 (missing 0) | 0 (missing 0) |
| Hosted known usage (USD) | 0.490408 | 0.469485 | 0.514073 |
| Unknown-cost trials | 4 | 4 | 3 |
| Valid live-latency samples | 0 | 0 | 0 |
| Live latency mean / median / p95 (ms) | NA / NA / NA | NA / NA / NA | NA / NA / NA |
| Joint actor/predictor-seed consistency (paired-task n) | 0.7500 (n=16) | 0.6875 (n=16) | 0.8125 (n=16) |
| Known constraint-clean joint consistency (paired-task n) | 0.4375 (n=16) | 0.3750 (n=16) | 0.5000 (n=16) |

Counts include all recorded statuses. Parenthesized missing counts are retained, not imputed. The DB reward trial rate and equal-family estimate are distinct stored fields. Constraint-clean results cover the configured assertion audit, not complete policy compliance. NA denotes a null or absent report value; zero valid latency samples do not imply zero latency. Joint seed consistency is not fixed-checkpoint pass².

| Original paired estimate / 95% CI | Neutral memory prefetch − Base | Acephale − Base | Acephale − Neutral memory prefetch |
| --- | --- | --- | --- |
| DB reward difference | -0.0312 [95% CI [-0.0938, 0.0000]]; n=32, families=8 | 0.0312 [95% CI [0.0000, 0.0938]]; n=32, families=8 | 0.0625 [95% CI [0.0000, 0.1875]]; n=32, families=8 |
| Known constraint-clean difference | 0.0000 [95% CI [-0.1562, 0.1562]]; n=32, families=8 | 0.0000 [95% CI [-0.2188, 0.2188]]; n=32, families=8 | 0.0000 [95% CI [-0.2812, 0.2500]]; n=32, families=8 |
| Logical tool-call difference | 0.0000 [95% CI [-0.2812, 0.2812]]; n=32, families=8 | 0.1875 [95% CI [-0.4688, 1.0312]]; n=32, families=8 | 0.1875 [95% CI [-0.3438, 0.9375]]; n=32, families=8 |
| Physical tool-call difference | 0.0000 [95% CI [-0.2812, 0.2812]]; n=32, families=8 | 0.1875 [95% CI [-0.4688, 1.0312]]; n=32, families=8 | 0.1875 [95% CI [-0.3438, 0.9375]]; n=32, families=8 |

Paired differences are treatment minus baseline, copied with their original family-weighted confidence intervals and per-metric denominators; no statistics were recomputed.

Hosted usage scope: hosted_user_and_judge_only. These are recorded provider-usage/ledger values, not reconciled invoices or confirmed cash debits; GPU charges are separate.

Seed-design limitation: Heldout trial0 uses actor17/predictor17 and trial1 actor29/predictor29; consistency changes both seeds.

The original scheduler summary has 32 missing records per arm for starts, usefulness, waste, rejections and cancellations. Its known totals of zero are not complete zero-count observations. Independent source-bound event logs instead establish that every observed held-out prefetch checkpoint returned before prediction or admission. All 96 timing flags are false: the retained samples record host_guard_not_configured, hostGuardConfigured=false, hostHealthStatus=unobserved and the missing-guard-only waiver. No comparative speedup can be estimated from these runs.


### 7.4 Coverage and evidence limits

All 36 development and 96 selected held-out IDs from the earlier exploratory attempt are represented, with no missing or duplicate IDs. This coverage does not mean all scheduled evaluations completed successfully. The original opportunity and numerical qualification failures remain unchanged. Later passing qualification receipts belong to the separate corrective deployments and do not change acceptance of these historical results.

The original statistics retain 84 completed, 11 failed and one censored held-out outcome. The nine error rows without actor or provider dispatch are retained as failed executor entries, not relabeled as untouched tasks. Unknown policy audits and usage charges remain unknown. The nominal-arm completion differences are affected by service closure and cannot be attributed to goal conditioning.

The original numerical report, final terminal-cause evidence, safe reproduction rows and unchanged estimators accompany the editable source. The displayed scheduler counters retain their missing-data limits. Recorded hosted usage excludes GPU charges and is not a verified invoice.

## 8. Reproducibility

The retained evidence includes model and source identities, family splits, prompt and candidate manifests, original labels, prediction failures, opportunity rows, native verdicts, event logs and analysis outputs. Earlier attempts and interruptions are retained separately from unique scientific runs. Accepted evidence and exploratory continuations remain distinguishable.

The reproducibility record retains the frozen models and family splits, exact run IDs and ordering, original analysis inputs and outputs, profile measurements, source identities, runtime events, archived telemetry proofs and failed prior attempts. The tables and figures in this report copy the completed original analyses; editorial assembly introduces no new estimates. Infrastructure/provider charges and hosted-model usage remain separate. Recorded usage is not presented as a reconciled invoice.

