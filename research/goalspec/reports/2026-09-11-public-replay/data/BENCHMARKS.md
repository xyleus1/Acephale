# GoalSpec public trajectory replay benchmarks

These are paired predictions on published real actor trajectories. Tool schemas were reconstructed from the pinned public benchmark. Endpoint labels are automatic semantic proxies requiring review. This study does not measure executed speculation or changes in actor decisions.

## Frozen corpus

The descriptive corpus contains 1500 trials across four domains. Prediction uses 1044 trials across three domains. Telecom has three independent request families, below the existing five-family split requirement, and was excluded from prediction before fitting or examining metrics.

| Domain | Tasks | Trials | Labeled tasks | Families |
| --- | --- | --- | --- | --- |
| airline | 50 | 200 | 27 | 50 |
| banking_knowledge | 97 | 388 | 95 | 93 |
| retail | 114 | 456 | 107 | 103 |
| telecom | 114 | 456 | 114 | 3 |

## Published actor outcomes

These outcomes are fixed inputs shared by every replay condition. All declared trials remain in this table; unresolved infrastructure failures count as unsuccessful. Native available-trial statistics are separately exported in actor-outcomes.csv.

| Domain | Pass1 | Pass2 | Pass4 | Tool calls | Infrastructure errors |
| --- | --- | --- | --- | --- | --- |
| airline | 83.00% | 78.33% | 72.00% | 2118 | 0 |
| banking_knowledge | 42.53% | 31.79% | 23.71% | 10098 | 41 |
| retail | 81.58% | 69.59% | 51.75% | 3571 | 0 |
| telecom | 89.69% | 82.46% | 71.93% | 3287 | 0 |

For banking_knowledge, native available-task Pass1 computed from the downloaded trace rewards is 47.05%, while the published submission metadata reports 46.91%. These aggregates have not been reconciled. The report uses the trace rewards.

## Prediction comparisons

Top-k full matches are exact tool-and-argument candidate matches, not executed speculation hit rates. NLL is held-out log loss in nats; lower is better. Aggregate accuracy is micro-averaged over steps. Paired NLL comparisons below weight domains equally, then tasks, trials and steps.

### lexical-development

| Condition | Micro NLL | Tool Top1 | Tool Top3 | Full Top1 | Full Top3 |
| --- | --- | --- | --- | --- | --- |
| goalspec | 1.8861 | 32.23% | 64.07% | 8.71% | 9.39% |
| goalspec_initial | 1.8893 | 32.23% | 64.30% | 8.71% | 9.39% |
| oracle | 1.8751 | 32.66% | 64.75% | 5.41% | 5.86% |
| paste | 1.8845 | 31.95% | 63.81% | 4.44% | 4.98% |
| shuffled | 1.8870 | 32.01% | 64.01% | 8.71% | 9.39% |
| shuffled_initial | 1.8902 | 32.26% | 64.30% | 8.71% | 9.39% |
| shuffled_oracle | 1.9627 | 29.13% | 61.85% | 4.95% | 5.46% |

| Paired comparison | NLL improvement | Relative improvement | 95% interval |
| --- | --- | --- | --- |
| paste_vs_goalspec | -0.0042 | -0.22% | [-0.0154, 0.0063] |
| paste_vs_goalspec_initial | -0.0053 | -0.28% | [-0.0175, 0.0061] |
| paste_vs_oracle | 0.0092 | 0.48% | [-0.0296, 0.0463] |
| paste_vs_shuffled | -0.0050 | -0.26% | [-0.0165, 0.0057] |
| paste_vs_shuffled_initial | -0.0061 | -0.32% | [-0.0183, 0.0054] |
| paste_vs_shuffled_oracle | -0.0784 | -4.09% | [-0.1409, -0.0187] |
| shuffled_initial_vs_goalspec_initial | 0.0007 | 0.04% | [0.0000, 0.0015] |
| shuffled_oracle_vs_oracle | 0.0877 | 4.39% | [0.0094, 0.1636] |
| shuffled_vs_goalspec | 0.0008 | 0.04% | [-0.0004, 0.0020] |

### llm-development

| Condition | Micro NLL | Tool Top1 | Tool Top3 | Full Top1 | Full Top3 |
| --- | --- | --- | --- | --- | --- |
| goalspec | 1.8615 | 33.88% | 65.38% | 6.54% | 7.45% |
| goalspec_initial | 1.8615 | 33.88% | 65.38% | 6.54% | 7.45% |
| oracle | 1.8751 | 32.66% | 64.75% | 5.41% | 5.86% |
| paste | 1.8845 | 31.95% | 63.81% | 4.44% | 4.98% |
| shuffled | 1.9363 | 29.62% | 62.22% | 6.40% | 7.57% |
| shuffled_initial | 1.9363 | 29.62% | 62.22% | 6.40% | 7.57% |
| shuffled_oracle | 1.9627 | 29.13% | 61.85% | 4.95% | 5.46% |

| Paired comparison | NLL improvement | Relative improvement | 95% interval |
| --- | --- | --- | --- |
| paste_vs_goalspec | 0.0209 | 1.09% | [-0.0309, 0.0657] |
| paste_vs_goalspec_initial | 0.0209 | 1.09% | [-0.0309, 0.0657] |
| paste_vs_oracle | 0.0092 | 0.48% | [-0.0296, 0.0463] |
| paste_vs_shuffled | -0.0411 | -2.14% | [-0.0864, 0.0029] |
| paste_vs_shuffled_initial | -0.0411 | -2.14% | [-0.0864, 0.0029] |
| paste_vs_shuffled_oracle | -0.0784 | -4.09% | [-0.1409, -0.0187] |
| shuffled_initial_vs_goalspec_initial | 0.0620 | 3.16% | [0.0003, 0.1211] |
| shuffled_oracle_vs_oracle | 0.0877 | 4.39% | [0.0094, 0.1636] |
| shuffled_vs_goalspec | 0.0620 | 3.16% | [0.0003, 0.1211] |

### lexical-test

| Condition | Micro NLL | Tool Top1 | Tool Top3 | Full Top1 | Full Top3 |
| --- | --- | --- | --- | --- | --- |
| goalspec | 1.9584 | 34.14% | 62.13% | 10.75% | 12.60% |
| goalspec_initial | 1.9581 | 32.77% | 62.09% | 10.75% | 12.60% |
| oracle | 1.9278 | 33.33% | 63.14% | 6.91% | 8.13% |
| paste | 1.9586 | 33.58% | 62.09% | 3.73% | 5.03% |
| shuffled | 1.9589 | 33.40% | 62.41% | 10.75% | 12.60% |
| shuffled_initial | 1.9586 | 32.77% | 62.09% | 10.75% | 12.60% |
| shuffled_oracle | 2.0357 | 30.89% | 58.36% | 7.05% | 7.96% |

| Paired comparison | NLL improvement | Relative improvement | 95% interval |
| --- | --- | --- | --- |
| paste_vs_goalspec | -0.0062 | -0.31% | [-0.0183, 0.0062] |
| paste_vs_goalspec_initial | -0.0061 | -0.31% | [-0.0189, 0.0070] |
| paste_vs_oracle | 0.0085 | 0.43% | [-0.0383, 0.0493] |
| paste_vs_shuffled | -0.0059 | -0.30% | [-0.0178, 0.0058] |
| paste_vs_shuffled_initial | -0.0065 | -0.33% | [-0.0193, 0.0066] |
| paste_vs_shuffled_oracle | -0.0711 | -3.62% | [-0.1151, -0.0346] |
| shuffled_initial_vs_goalspec_initial | 0.0004 | 0.02% | [-0.0001, 0.0010] |
| shuffled_oracle_vs_oracle | 0.0795 | 3.91% | [0.0195, 0.1422] |
| shuffled_vs_goalspec | -0.0002 | -0.01% | [-0.0020, 0.0017] |

### llm-test

| Condition | Micro NLL | Tool Top1 | Tool Top3 | Full Top1 | Full Top3 |
| --- | --- | --- | --- | --- | --- |
| goalspec | 1.9344 | 35.15% | 62.93% | 7.36% | 10.23% |
| goalspec_initial | 1.9344 | 35.15% | 62.93% | 7.36% | 10.23% |
| oracle | 1.9278 | 33.33% | 63.14% | 6.91% | 8.13% |
| paste | 1.9586 | 33.58% | 62.09% | 3.73% | 5.03% |
| shuffled | 2.0046 | 33.86% | 59.41% | 7.43% | 10.02% |
| shuffled_initial | 2.0046 | 33.86% | 59.41% | 7.43% | 10.02% |
| shuffled_oracle | 2.0357 | 30.89% | 58.36% | 7.05% | 7.96% |

| Paired comparison | NLL improvement | Relative improvement | 95% interval |
| --- | --- | --- | --- |
| paste_vs_goalspec | -0.0215 | -1.09% | [-0.1462, 0.0607] |
| paste_vs_goalspec_initial | -0.0215 | -1.09% | [-0.1462, 0.0607] |
| paste_vs_oracle | 0.0085 | 0.43% | [-0.0383, 0.0493] |
| paste_vs_shuffled | -0.0490 | -2.50% | [-0.0954, -0.0096] |
| paste_vs_shuffled_initial | -0.0490 | -2.50% | [-0.0954, -0.0096] |
| paste_vs_shuffled_oracle | -0.0711 | -3.62% | [-0.1151, -0.0346] |
| shuffled_initial_vs_goalspec_initial | 0.0275 | 1.37% | [-0.0722, 0.1054] |
| shuffled_oracle_vs_oracle | 0.0795 | 3.91% | [0.0195, 0.1422] |
| shuffled_vs_goalspec | 0.0275 | 1.37% | [-0.0722, 0.1054] |

## Measured and unmeasured

| Quantity | Evidence |
| --- | --- |
| Goal classification and future-tool accuracy | Measured in supplied frozen replay runs |
| Actor task success and call counts | Historical published actor outcomes; unchanged by replay |
| End-to-end scheduler latency reduction | Not measured |
| Useful/wasted executed speculation | Not measured |
| Live goal-guided task-success change | Not measured |
| Comparison with the original full PASTE system | Not established; local predictor reproduction only |
| SOTA across primary/secondary benchmark suites | Not established |

All source hashes, recorded revisions, catalog hashes, endpoint audits and run configurations are linked in provenance.json. Per-domain prediction metrics, initial-request goal accuracy, partition counts and paired estimates are also exported as CSV. Positive log-loss reduction supports improved prediction under these experimental assumptions; it does not establish causal entropy reduction or a production speedup.
