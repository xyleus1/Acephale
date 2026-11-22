# Copied accepted report values

Working incomplete report. Values below are transcribed from accepted report documents. No new estimates, intervals, contrasts, or pooled results are calculated. Prediction completion and scored-checkpoint denominators are separate.

## seed17/analysis

### neutral-fixed-score-prediction-report.json

Source SHA-256: d0eb584b34f682d47538780307c221ed9f376cec0a87323e7fc78447e3f35ab6

| Condition | Declared checkpoints | Prediction completed | Failed | Scored checkpoints | Binary log loss (nats) | Brier |
| --- | --- | --- | --- | --- | --- | --- |
| neutral | 746 | 745 | 1 | 600 | 1.0878923123635513 | 0.11140888665430268 |

Checkpoint-mean binary log loss for membership anywhere in the next authoritative batch, not full-action cross-entropy or true conditional entropy

Original report limitations:
- At most three preselected candidates; panel coverage is reported separately
- Partition labels alone do not verify fresh held-out tasks or a preregistered freeze
- Missing predictions remain declared failures without invented probabilities
- Paired loss differences use jointly scored checkpoints only
- Task success, physical execution work and prediction hit rate are separate outcomes

### goals-fixed-score-prediction-report.json

Source SHA-256: 8909cf9306588359116befe9f810f3fdc8a2596b766691f65fde27800cc14687

| Condition | Declared checkpoints | Prediction completed | Failed | Scored checkpoints | Binary log loss (nats) | Brier |
| --- | --- | --- | --- | --- | --- | --- |
| conditional | 746 | 334 | 412 | 230 | 0.9695626391977786 | 0.07721693001813149 |
| neutral | 746 | 334 | 412 | 230 | 1.1996269298337412 | 0.10761977550400385 |

Checkpoint-mean binary log loss for membership anywhere in the next authoritative batch, not full-action cross-entropy or true conditional entropy

Original report limitations:
- At most three preselected candidates; panel coverage is reported separately
- Partition labels alone do not verify fresh held-out tasks or a preregistered freeze
- Missing predictions remain declared failures without invented probabilities
- Paired loss differences use jointly scored checkpoints only
- Task success, physical execution work and prediction hit rate are separate outcomes

Recorded paired comparisons (jointly scored rows only; original family weighting and CI):
```json
[
  {
    "baseline": "conditional",
    "metrics": {
      "binary_log_loss_nats_difference": {
        "bootstrap_samples": 2000,
        "bootstrap_seed": 42,
        "ci95": [
          0.021042875518726176,
          0.2650588958706717
        ],
        "estimate": 0.12599514734228773,
        "families": 34,
        "paired_trials": 230,
        "weighting": "equal_family_mean_of_paired_trial_differences"
      },
      "brier_difference": {
        "bootstrap_samples": 2000,
        "bootstrap_seed": 42,
        "ci95": [
          0.004601930967932061,
          0.03414550745771094
        ],
        "estimate": 0.017338784360018303,
        "families": 34,
        "paired_trials": 230,
        "weighting": "equal_family_mean_of_paired_trial_differences"
      }
    },
    "treatment": "neutral"
  }
]
```

## seed17/replay

No held-out score or full-study completion is asserted. Other source JSON documents, including reliability and hardware provenance, are retained separately without reinterpretation.
