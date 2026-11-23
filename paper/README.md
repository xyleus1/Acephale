# Acephale study

The current paper reports goal-conditioned speculative tool execution with a
frozen Qwen3.5-9B actor and two trained Qwen3.5-0.8B predictor adapters. It includes
the corrected 36-trial development and 96-trial heldout cohorts, retained replay
results, numerical qualification, and the limitations of the measured study.

- [Paper PDF](corrective-study-20261122/acephale-study.pdf)
- [Editable manuscript, figures, results and reproduction instructions](corrective-study-20261122/README.md)
- [Current result summary](../docs/RESULTS-20261122-CORRECTIVE.md)
- [Operational source archive](../infra/aws-continuation/corrective-study-20261122/README.md)

The current package keeps the corrected cohort separate from earlier attempts.
The [earlier result package](final-study-20261122/README.md) and working-paper
sources remain historical evidence. Their incomplete or failed states are not
silently replaced or reclassified by the current report.

This is a custom tau-compatible pilot. Database reward, policy-constraint audits,
timing validity and speculative execution are distinct outcomes; completion alone
does not establish a goal-conditioning benefit or a benchmark leaderboard result.
