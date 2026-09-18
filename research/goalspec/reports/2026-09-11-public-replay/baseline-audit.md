# PASTE baseline audit

Audited 2026-09-11. The `paste` condition is this repository's independent predictor implementation. It is not an execution of the authors' PASTE system.

## Paper version and artifact availability

The supplied specification follows [PASTE v1](https://arxiv.org/html/2603.18897v1), which reports 48.5% task-time reduction and promises a release after review. The [current arXiv v3](https://arxiv.org/html/2603.18897v3), dated 2026-06-16, reports 43.5% and adds explicit LLM-side co-scheduling. Its implementation describes TypeScript middleware plus Python vLLM integration.

Neither inspected version links an official PASTE repository. Targeted GitHub repository searches for the paper identifier, original title, and PASTE speculative tools found no identifiable author release. This is an audit finding, not proof that no release exists. We have no official executable miner or replay adapter to run today.

## What this repository actually implements

| Component | Paper behavior | Local implementation and consequence |
| --- | --- | --- |
| Context | Recurring metadata patterns | Prefix-projected subsequences, maximum context 3 within 12 completed batches. One longest supported context is selected independently of goals and shared across conditions. These are explicit local choices. |
| Confidence | Empirical validation and thresholding | Additive smoothing 0.5 over visible tools. Binding precision separately weights executable candidates. There is no claim that this reproduces the authors' confidence calibration or threshold. |
| Arguments | Field/index mapping and string normalization | Bounded JSON references, objects, arrays and restricted repeated constants. No string synthesis or normalization. Unavailable mappings abstain. |
| Multiple matches | Candidate arbitration by scheduler | One selected structural context, then goal-mixture candidate deduplication. The full multi-pattern scheduler arbitration is absent. |
| Training | Historical trace mining | Successful training traces only; support counts independent request families. Repeated trials alone cannot establish recurrence. Split and annotation policies are local research controls. |
| Execution | Speculation, promotion and LLM pacing | Prediction replay only. No speculative calls, resource admission, result promotion, or vLLM pacing were executed. |

Paper references: [v1 mining and validation](https://arxiv.org/html/2603.18897v1#S4), [v3 analyzer and schedulers](https://arxiv.org/html/2603.18897v3#S4). Local evidence: [pattern implementation](../../src/goalspec/patterns.py), [argument binder](../../src/goalspec/binding.py), [replay boundaries](../../src/goalspec/replay.py).

## Why published percentages are not direct comparators

[PASTE v3, section 6.7](https://arxiv.org/html/2603.18897v3#S6.SS7) reports **up to** 27.8% tool Top-1, 43.9% tool Top-3, and 93.8% overall hit rate. The latter uses an adaptive number of executed candidates. Those maxima concern different benchmark families and actor workloads.

Our tool Top-k metrics rank tool names. Our full Top-k metrics require exact tool and argument equality among at most k bound candidates. Neither measures executed speculation. Comparing our percentage directly with 27.8%, 43.9%, or 93.8% would confound datasets, actors, budgets, and metric definitions. Historical PASTE latency results cannot establish any GoalSpec latency gain.

## Direct-baseline feasibility and claim boundary

The existing public trajectory projection can support an offline author-miner comparison without rerunning actors if a callable official analyzer becomes available. That integration would require pinning its code, adapting causal events and schemas, reproducing its mining/calibration settings, and recording its native candidate rankings on these identical held-out prefixes. Until then, a closer implementation from the paper would remain an independent reproduction and should be labeled accordingly.

The present paired experiment can establish improvement over **the local PASTE-style predictor under the frozen configuration**. It cannot establish superiority to traditional PASTE as a complete system. An inference of lower latency, lower resource waste, improved live task success, or SOTA performance requires its corresponding execution experiment.

A direct query-conditioned/stateless predictor and Salesforce-style episodic baseline are still needed to distinguish endpoint conditioning from generic query semantics or retrieval. The shuffled controls and oracle isolate other effects but do not replace those baselines.
