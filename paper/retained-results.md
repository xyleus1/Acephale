### 5.1 Retained seed17 replay and calibration

The accepted seed17 analysis contains two distinct fixed-panel reports. The standalone neutral report declared 746 checkpoints, completed 745 and retained one failure; it scored 600 checkpoints. The goals-fixed report declared the same 746 checkpoints for each condition but completed 334 and retained 412 failures per condition. Its paired analysis uses 230 jointly scored checkpoints across 34 families. These coverage differences prevent treating the standalone neutral estimate and the goals-fixed estimates as one common-cohort comparison.

Within the goals-fixed report's jointly observed cohort, the original equal-family paired analysis estimates neutral minus goal-conditioned binary log loss as 0.125995 nats (95% family bootstrap interval 0.021043 to 0.265059). The corresponding Brier difference is 0.017339 (0.004602 to 0.034146). Positive values favor the goal-conditioned scores on this observed subset. Both intervals come directly from the original report's 2,000 bootstrap samples with seed 42. They do not account for the missing outcomes by inventing probabilities, and they do not establish an improvement across all declared checkpoints, fresh heldout tasks or native task execution.

| Retained report / condition | Declared checkpoints | Completed / failed | Scored checkpoints | Binary log loss (nats) | Brier |
|---|---:|---:|---:|---:|---:|
| Standalone neutral | 746 | 745 / 1 | 600 | 1.087892 | 0.111409 |
| Goals-fixed / neutral | 746 | 334 / 412 | 230 | 1.199627 | 0.107620 |
| Goals-fixed / goal-conditioned | 746 | 334 / 412 | 230 | 0.969563 | 0.077217 |

The two goals-fixed rows share the paired cohort. Their displayed checkpoint means differ from the equal-family paired estimand above. The original reports explicitly disclaim a heldout claim and are not restricted to the test partition. All conditions retain 266 eligible read checkpoints and candidate-panel any-hit coverage 0.458647; this panel-coverage denominator differs from the scored-checkpoint denominator.

The calibration receipt reports six agreements among 141 graded cases and a conservative reliability value of 0.019646160425252017, produced by its reserved-calibration full-cohort 95% Wilson lower-bound method. Separately, the annotation audit accepted 19 of 20 machine-reviewed annotations. There were zero human reviews; the reviewer used a separate request and prompt to the same model. The six-of-141 agreement count and the 19-of-20 annotation audit describe different evaluations.

Sources: accepted seed17 analysis component SHA 647f23466bed49876e0901dda865c121e62e13916d83a3792ddbeccbfd7e511f; [neutral report](sources/seed17-neutral-fixed-score-report.json), [goals-fixed report](sources/seed17-goals-fixed-score-report.json), and [goal reliability](sources/seed17-goal-reliability.json). Exact source, manifest and successful command-receipt hashes are recorded in retained-results-evidence-01.json. Seed29 and native outcomes remain pending.
