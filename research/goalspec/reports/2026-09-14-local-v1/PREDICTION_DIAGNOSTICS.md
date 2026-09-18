# Frozen prediction replay: contract failures dominate

The standalone requested-goal predictor failed on **212/213 checkpoints
(99.53%)**. Each failed cache entry retains its declared `__unknown__: 1`
fallback. The sole accepted prediction missed the automated requested-goal
reference. These results describe a failed prediction pipeline with fallback
behavior; they do not measure the quality of functioning inferred-goal prediction.

The reference teacher completed 109/109 unique visible-input annotations.
All 213 checkpoints have scoring records, including deterministic misses for
the 212 failed predictions. Requested-goal Top-1 and Top-3 are both **0/213**.
Their empirical family-bootstrap intervals are [0, 0]; this degenerate sample
interval is not a guarantee of zero population accuracy. References and matching
are automated by one pinned teacher model, not human ground truth.

Prediction replay contains 213 tool decisions from 53 base trajectories and
14 families. The canonical export retains all 64 episodes and 16 families.
`airline:flight_and_baggage` and `airline:selective_cancel` contributed no tool
decisions. Every declared live trial remains in the separate 192-trial analysis.

| Condition | Tool Top-1 / 213 | Tool Top-3 / 213 | Full arguments Top-1 and Top-3 / 213 | Tool NLL | Action NLL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stateless | 36 | 70 | 0 | 2.637135 | 27.631021 |
| Local PASTE | 83 | 135 | 38 | 2.166188 | 22.962887 |
| PASTE + memory | 90 | 149 | 38 | 1.991363 | 22.914939 |
| GoalSpec without memory | 83 | 135 | 38 | 2.166188 | 22.962887 |
| GoalSpec | 84 | 145 | 38 | 2.153038 | 22.979444 |
| Oracle endpoints | 80 | 147 | 38 | 2.111705 | 22.975030 |
| Shuffled goals | 84 | 145 | 38 | 2.154547 | 22.979444 |

The identical-candidate-pool control gives every condition exactly the same bound
argument candidates. It changes stateless full-argument Top-1/Top-3 to 38/213 and
action NLL to 23.243995. Other table entries remain unchanged. Thus all seven
conditions have the same full-argument hit counts under this control. Tool scores
are distributed uniformly among same-tool bindings; this does not test a learned
within-tool argument ranker. Missing action probability uses the frozen 1e-12
loss floor.

Condition-table NLLs are decision-weighted means. Paired differences below give
equal weight to domains and families, so they need not equal the subtraction of
those table means. Positive improvement favors the named treatment over local
PASTE. The same-pool control yields the same following conclusions:

- GoalSpec tool-NLL improvement: **0.003639**, exploratory 95% interval
  **[-0.051440, 0.057372]**. Action-NLL improvement: **-0.010295**,
  interval **[-0.014312, -0.005745]**, a regression.
- PASTE + memory tool-NLL improvement: **0.119280**,
  interval **[0.068166, 0.173371]**. Action-NLL improvement: **0.028980**,
  interval **[0.015857, 0.040808]**.
- GoalSpec without memory equals local PASTE on these metrics. GoalSpec and
  shuffled goals have identical tool hit counts, full-argument hit counts and
  action NLL. These fallback-dominated comparisons do not establish a benefit
  from valid inferred goals.

Endpoint proxy accuracy is separate: 146/213 endpoint reference labels map to
`__unknown__`. GoalSpec's endpoint Top-1 is 145/213 (68.08%); all 145 correct
matches are unknown endpoints and zero are nonunknown endpoint matches.
Its endpoint Top-3 is 146/213. Neither is requested-goal
accuracy. Oracle endpoints are an offline diagnostic, not an achievable actor.

The independent [live GoalSet audit](../../runs/local-live-goal-audit-v1-20260915.json)
concerns a different runtime contract: 56/174 live goal responses avoided
rejection, and 115/378 recorded GoalSpec contexts contained positive nonunknown
hypotheses. Live source-path validation does not establish semantic accuracy.
Standalone failure records retain 102 `Error` and 110 `SyntaxError` constructors,
but omit raw outputs and detailed parse errors; their exact causes cannot be
assigned from live-runtime rejection reasons.

Sources: [requested-goal summary](../../runs/local-requested-analysis-v1-20260915/summary.json),
[frozen prediction summary](../../runs/local-prediction-analysis-v1-20260915/summary.json),
[per-condition predictions](../../runs/local-prediction-analysis-v1-20260915/predictions.jsonl).
Replay executes no speculative tools and makes no live latency or task-success
claim. Baselines are local paper-based implementations, not verified upstream
reproductions. Intervals resample complete families within domains and are not
adjusted for multiple comparisons.
