# Goal-conditioned speculative tool execution: an exploratory study

**Draft: native evaluation is still running.** This manuscript reports the retained prediction experiments and separates the original protocol from the subsequent exploratory cloud runs. Native comparative tables will be populated from the original analysis outputs after the selected cohorts finish.

## Abstract

We investigate whether a representation of a user's requested outcome improves prediction of an agent's next read-only tool invocation. Acephale combines frozen workflow and episodic memory, source-bound argument construction, an auxiliary language-model predictor, and speculative execution during actor generation. The actor's weights, available tools and authoritative execution rules remain fixed. In the retained seed-17 fixed-panel replay, goal-conditioned scores improve equal-family binary log loss by 0.126 nats on 230 jointly scored checkpoints, with a 95% family-bootstrap interval of [0.021, 0.265]. However, 412 of 746 declared checkpoints failed in each condition. A separate distributed seed-29 replay finds a difference of −0.0129 nats on 442 jointly scored checkpoints, with an interval of [−0.0846, 0.0932]. The two opportunity profiles fail their predeclared minimum coverage requirement. Native task evaluation continues as an explicitly exploratory extension; operational wall times with invalid measurement flags are excluded from speedup claims. The evidence does not establish that adding inferred goals improves task success or end-to-end latency.

## 1. Question and scope

An agent often waits for a tool after deciding which call to make. A second model can predict a useful read during the actor's generation and start it early. The speculative result is reusable only if the actor later requests exactly the same invocation and freshness validation succeeds. This can hide latency, but a wrong prediction consumes resources, and predictor contention can slow the actor.

The question is whether goal information improves this prediction enough to justify its cost. Goal conditioning is not guaranteed to help: an inferred goal may be incorrect, the candidate pool may omit the required call, or extra inference may cost more time than the read saves.

PASTE motivates overlapping tool execution and generation, exact invocation matching, and cost-aware admission [1]. Speculate with Memory motivates reuse of trajectory experience and prediction errors [2]. Acephale studies goal conditioning within an implementation inspired by these methods. It is not a verified reproduction of their complete serving systems or reported benchmarks.

## 2. Implementation

### 2.1 Models and training

The actor is Qwen3.5-9B and the auxiliary predictor is Qwen3.5-0.8B. The actor is frozen across native arms. Serving uses the pinned vLLM 0.32.0 environment and BF16 configuration. Actor input/output budgets are 28,672/4,096 tokens; predictor budgets are 7,168/1,024. Thinking is disabled in this profile. Exact checkpoint, tokenizer, adapter and image identities are retained with the artifacts.

Only the predictor is fine-tuned. The existing recipe uses rank-16 LoRA, alpha 32, dropout 0.05, AdamW at 1e-4, weight decay 0.01, clipping at 1, effective batch size 16, and at most three epochs or 500 optimizer steps. Targets include selected text attention, feed-forward and gated-delta projections; the actor, base parameters, embeddings and language head remain frozen. Training uses completion-only cross entropy with separate goal-inference, neutral-ranking and goal-conditioned-ranking prompts.

Ranking outputs an action class and one binary hit token per candidate. Serving normalizes the logits of the 0/1 token pair, then applies the retained calibration map. Because decoding is autoregressive, later scores condition on earlier generated tokens. They are not independent marginal probabilities. A discriminative ranking head was proposed but is not an evaluated component of this frozen experiment.

### 2.2 Public context, memory and candidates

The input compiler includes the visible conversation, policy, tool contracts and current argument evidence. Future actions, hidden native state and evaluator outcomes are excluded. Families are split before annotation or memory mining. Requested-goal labels see the public checkpoint only.

Workflow patterns encode observed ordering, argument dependencies and verified endpoints. At a new checkpoint, symbolic binding resolves arguments from currently visible fields and indices. A historical entity value cannot authorize a current argument.

Frozen episodic retrieval filters for compatible model, tool, environment, policy, authorization and family scope. Lexical and exact-cosine hits are combined with reciprocal-rank fusion; the prompt admits at most four examples, including at most one negative. Retrieval failure and fallback remain recorded.

Proposals deduplicate exact invocations and construct a common, goal-neutral candidate window before conditional ranking. The proposal pool is bounded at 128, and at most three candidates are selected. A positive label means the exact invocation occurs anywhere in the immediately following authoritative batch. Multiple candidates may be positive.

### 2.3 Speculative execution

The scheduler admits audited, read-only calls with current authorization and source-bound arguments. The configured limits are two speculative reads per run, four globally, twelve starts per run, one-hop lookahead and a five-second read deadline. These are within-trial limits.

Native speculative reads use isolated Python-owned snapshots. An authoritative invocation may join matching work, but consumption requires successful freshness validation. Mutations invalidate pending evidence. Cancelled and wasted work remains counted; prefetched observations are never fabricated as tool-call results.

Calibration uses reserved families rather than held-out labels. Opportunity profiling measures actor lead time, predictor cost, scheduling overhead, tool duration, validation and contention. Its conservative admission heuristic uses lower-tail benefits and upper-tail costs. A failed opportunity profile is retained as a failed prerequisite, not replaced with a favorable subset.

## 3. Experimental design and estimands

The compositional task library contains 44 families: 24 for fitting, six for calibration, six for development and eight held out. Each family has two synthetic customer/entity variants. Operation sets differ across partitions, while primitive actions overlap. This is compositional generalization, not an unseen-intent claim.

The tasks use pinned native tools, policies and database evaluators from tau2-bench [3]. Expected database changes and omission checks are specified before actor execution. The generated cohort is a **custom tau-compatible pilot**, not an official full-benchmark score. Database reward and conversational policy compliance are separate outcomes.

The three native arms are the base actor, neutral-memory prefetch, and goal-conditioned memory prefetch. Tasks, actor weights, trial seeds, tool access and step limits are shared; arm order is randomized within each paired block. Development contains 36 arm-runs. The actual frozen held-out target is eight families, two variants, two trials and three arms: at most 96 arm-runs. The original selector determines the realized cohort.

Replay reports candidate-level binary log loss, Brier score and coverage. These quantities are not full-action cross entropy or true conditional entropy. Paired differences use the original equal-family bootstrap with 2,000 draws and seed 42. Conditional-on-observation intervals do not correct selective missing predictions.

Native reporting preserves every declared run, failures and censoring. It separates database reward, policy constraints, tool calls, speculation and revalidation, costs, and timing validity. The two predictor seeds are confounded with assigned variant/trial/time groups; they do not support a causal seed comparison.

## 4. Prediction and opportunity results

| Replay comparison | Jointly scored checkpoints / families | Neutral-minus-goal log loss, nats (95% CI) | Brier difference (95% CI) |
|---|---:|---:|---:|
| Retained seed 17 | 230 / 34 | 0.125995 [0.021043, 0.265059] | 0.017339 [0.004602, 0.034146] |
| Distributed seed 29, exploratory | 442 / 36 | −0.012936 [−0.084643, 0.093218] | 0.005168 [−0.005044, 0.022080] |

Positive values favor goal conditioning on the observed comparison panel. Seed 17 retained 334 completed predictions and 412 failures per fixed-panel condition. Seed 29 retained 582 completed predictions and 164 failures per fixed-panel condition. The standalone neutral reports use a different scored cohort and are not substitutes for the paired neutral rows.

Seed 17 shows an observed-subset improvement, but its high failure rate limits interpretation. Seed 29's intervals include zero. Neither result establishes a general goal-conditioning benefit, equivalence, or a native latency improvement. The distributed continuation also changed hardware and runtime execution placement, so it is not a clean seed replication.

The original seed-17 opportunity profile completed 8 of 20 measurements; the other 12 requested a different read from the profiled candidate. Seed 29 completed 7 of 20, with 12 measured read misses and one interruption-censored row. Both fail the unchanged minimum of ten completed measurements. Read misses are prediction failures at those prefixes, not evidence that the actor failed the customer's task.

Goal-teacher agreement is also distinct from native reward. The retained seed-17 reliability artifact reports 6 agreements among 141 graded cases and a Wilson lower bound of 0.01965. The seed-29 continuation reports 15 agreements among 141 cases and a lower bound of 0.06554. The annotation audit used zero human reviews and a separate prompt to the same teacher model; reviewer-model independence is not claimed.

## 5. Native evaluation

**Results pending completion of the selected cohorts.** The final tables will use the original native analysis, with separate development and held-out denominators, per-arm reward and policy compliance, paired family intervals, calls and cost. The source-bound interim observations are retained alongside this draft.

The cloud continuation bypassed the original opportunity prerequisite and some deployment qualification steps at the user's explicit operational direction. It is therefore reported as exploratory, not retrospectively accepted under the frozen protocol. Existing accepted components and failed qualification evidence remain unchanged.

Every currently inspected new run has invalid comparative-timing flags and no speculative execution. If that remains true in the final cohort, these runs cannot establish a prefetch speedup or isolate an effect of consumed speculative evidence. Operational elapsed time may describe how long the study took to run, but it will not be substituted for a validated arm-level latency result.

The observed native evaluator can award database reward 1.0 while reporting a policy violation. In the current runs, affected assertions require explicit user confirmation before each database mutation. Final reporting will include that disagreement rather than treating database reward as unconditional task correctness.

## 6. Limitations and interpretation

The central weakness is not solved by more GPU capacity. Candidate coverage, goal reliability and the opportunity gate limit whether speculation becomes useful. Token-level training accuracy is not a substitute for exact-call ranking quality. Missing prediction outcomes can bias an observed-subset comparison.

The current predictor jointly learns three textual tasks with a generative objective. Candidate-order dependence and annotation-to-deployment goal mismatch remain plausible explanations for poor ranking. They are hypotheses for a future experiment, not demonstrated causes or evaluated fixes. A frozen-backbone discriminative head and family-held-out probability calibration would test those hypotheses without changing the actor.

The native extension has a small synthetic task cohort, limited policy assertions and deployment deviations. No complete official tau score, SOTA claim, proof of lossless acceleration, or claim that goals can only improve performance is warranted. A useful negative result is to identify where prediction gains fail to translate into admitted, consumed reads.

## 7. Reproducibility

The release retains model and source identities, family splits, prompt and candidate manifests, original labels, prediction failures, opportunity rows, native verdicts, event logs and analysis outputs. Earlier attempts and interruptions are retained separately from unique scientific runs. Accepted evidence and exploratory continuations remain distinguishable.

The final artifact bundle will contain this editable manuscript, the rendered PDF, figures and source data, original analysis scripts, and a manifest mapping reported values to result files. Infrastructure/provider charges and hosted-model usage are reported separately. Recorded usage is not presented as a reconciled invoice.

## References

1. Sui et al. *Parallelizing Tool Execution and LLM Generation for Low-Latency Agent Serving*. arXiv:2603.18897v3, 2026. https://arxiv.org/abs/2603.18897v3
2. Li et al. *Speculate with Memory: Lossless Acceleration for LLM Agents*. arXiv:2607.12236v1, 2026. https://arxiv.org/abs/2607.12236v1
3. Sierra Research. *tau2-bench*, commit 2174a603f6d014ef94473ffa95957f6ce27100db. https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db
