# GoalSpec local v2 study

Custom tau-compatible pilot with separate development rounds and at most one confirmation cohort.

The earlier development protocol smoke produced 12/12 valid predictions and 8/12 teacher-scored complete-request matches. That score preceded the latest identity-preservation prompt fix. No post-fix prediction score is supplied.

Every declared outcome, including failures, stays in its own stage. V1 scores are historical context, not a paired causal comparison on these new tasks. Development and confirmation stages are never pooled. No improvement claim is inferred from protocol validity.

No completed live stage was supplied to this report.

Intervals reuse evaluation_v1.py: 2,000 default percentile bootstrap draws of complete families within domains, equal domain and family weights. These exploratory 95% intervals are unadjusted for multiple comparisons; small family counts limit inference.
