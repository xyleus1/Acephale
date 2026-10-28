# Frozen GoalSpec prediction replay

paper-based local baselines, not verified reproductions of upstream systems.

This replay measures prediction on recorded held-out actor decisions. No speculative tool executions or live task-success changes are measured. Loss is predictive cross-entropy in nats, including model error. Its reduction is an estimated predictive improvement, not measurement of true conditional entropy.

Goal predictor: gpt-4.1-mini-2025-04-14. Memory: train_only_tfidf_top8_tool_distribution_mixture_weight_0.35.

| Condition | Steps | Tool Top-1 | Full arguments Top-1 | Tool loss | Action loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| stateless | 213 | 0.169 | 0.000 | 2.6371 | 27.6310 |
| local_paste | 213 | 0.390 | 0.178 | 2.1662 | 22.9629 |
| paste_memory | 213 | 0.423 | 0.178 | 1.9914 | 22.9149 |
| goalspec_no_memory | 213 | 0.371 | 0.178 | 2.1481 | 22.9634 |
| goalspec | 213 | 0.427 | 0.178 | 2.0404 | 22.9593 |
| oracle_goals | 213 | 0.376 | 0.178 | 2.1117 | 22.9750 |
| shuffled_goals | 213 | 0.394 | 0.178 | 2.1569 | 22.9673 |
| stateless__same_pool | 213 | 0.169 | 0.178 | 2.6371 | 23.2440 |
| local_paste__same_pool | 213 | 0.390 | 0.178 | 2.1662 | 22.9629 |
| paste_memory__same_pool | 213 | 0.423 | 0.178 | 1.9914 | 22.9149 |
| goalspec_no_memory__same_pool | 213 | 0.371 | 0.178 | 2.1481 | 22.9634 |
| goalspec__same_pool | 213 | 0.427 | 0.178 | 2.0404 | 22.9593 |
| oracle_goals__same_pool | 213 | 0.376 | 0.178 | 2.1117 | 22.9750 |
| shuffled_goals__same_pool | 213 | 0.394 | 0.178 | 2.1569 | 22.9673 |

Independent requested-goal reference assessment

Goal Top-1: 0.8028169014084507; Goal Top-3: 0.8028169014084507. Scored 213/213 causal checkpoints. References and semantic matching use the pinned teacher and only visible user messages and policy. This is automated reference assessment, not human ground truth. Failures, source hashes and clustered intervals are included separately under requestedGoalAccuracy in summary.json.

Conditions suffixed same_pool share exactly the same current-source-bound argument candidates, formed from every compatible training goal branch before the target is scored. Their tool scores are split uniformly across same-tool bindings. This control removes the prior binding-pool confound, but does not evaluate a learned within-tool argument ranker. Missing bindings count as misses and unassigned action probability remains unresolved. Candidate matches are not speculation hits.

Family-clustered paired estimates and complete endpoint-goal Top-1/Top-3, tool Top-3 and argument Top-3 denominators are recorded in summary.json. Goal labels here describe independent endpoints. They do not establish requested-goal annotation accuracy; oracle_goals is an oracle-endpoint diagnostic. Intervals are exploratory and unadjusted for multiple comparisons.
