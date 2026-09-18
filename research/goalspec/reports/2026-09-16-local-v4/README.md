# GoalSpec v4 local results

These are custom tau-compatible pilot results, not an official full-benchmark score. All four implementations are local arms; PASTE and Salesforce are paper-based baselines, not verified upstream reproductions.

V4 GoalSpec uses frozen workflow patterns and its current-state candidate graph. The older remote-candidate prompt containing episodic transitions and confusion records is inactive in the GoalSpec path; it remains available in the Salesforce-style control. These results do not establish a GoalSpec episodic-prompt benefit.

## development

| Arm | Task success / trials (pass1) | pass2 | Total live mean / p95 seconds (n) | Physical calls | Known usage USD |
| --- | --- | --- | --- | --- | --- |
| base | 4/4 (100.0%) | unavailable | 29.404 / 34.876 (4) | 19 (0 unmeasured trials) | 0.208 (0 unknown-charge trials) |
| paste | 4/4 (100.0%) | unavailable | 32.496 / 43.938 (4) | 22 (0 unmeasured trials) | 0.223 (0 unknown-charge trials) |
| salesforce | 4/4 (100.0%) | unavailable | 29.327 / 41.619 (4) | 21 (0 unmeasured trials) | 0.202 (0 unknown-charge trials) |
| goalspec | 4/4 (100.0%) | unavailable | 28.137 / 41.780 (4) | 23 (0 unmeasured trials) | 0.282 (0 unknown-charge trials) |

pass2 is the proportion of family/variant units that succeed in both trials 0 and 1, not squared pooled accuracy or at-least-once success. All failures remain in the task-success denominator.

Headline totalTrialSeconds includes native orchestration and per-trial service drain. Native latencyMs is separate. Shared startup, final shared drain, and independent evaluation are outside the headline. Failures with measured time remain included; missing timing is not zero.

| Paired comparison | Matched trials | Task-success difference [95% CI] | Total live seconds difference [95% CI] |
| --- | --- | --- | --- |
| paste-vs-base | 4 | 0.0% [0.0%, 0.0%] | 3.092 [-5.277, 11.461] |
| salesforce-vs-base | 4 | 0.0% [0.0%, 0.0%] | -0.077 [-5.753, 6.619] |
| goalspec-vs-base | 4 | 0.0% [0.0%, 0.0%] | -1.267 [-7.975, 7.028] |
| goalspec-vs-paste | 4 | 0.0% [0.0%, 0.0%] | -4.359 [-9.126, -1.252] |
| goalspec-vs-salesforce | 4 | 0.0% [0.0%, 0.0%] | -1.190 [-3.294, 0.441] |

Differences are treatment minus control. Pointwise intervals resample families and retain their variants, trials and paired arms. Few families limit precision; intervals do not establish improvement on every metric.

Exploratory assignment intent-to-treat, conditional on the deterministic eligible pool. First assignment per run uses inverse-propensity weighted group means and family clusters; later assignments remain logged but do not duplicate terminal outcomes. Assigned exposure may fail freshness, readiness or context limits. With only a few runs, task mix and later assignments cannot be separated reliably, and zero success differences can produce degenerate intervals. These are not isolated causal read-usefulness labels, a validated utility calibration or exposure-head training targets.

Every observed trial succeeded across 4 families. The resulting degenerate bootstrap accuracy intervals reflect the observed sample, not certainty of 100% population success or equivalence of the arms.

Exposure experiment: 8 assignments across 4 runs; 2 assigned exposure, 2 actually exposed. First-assignment groups contain 2 exposed-assigned and 2 withheld-assigned runs.

Native authoritative reads: mean 0.604 ms, p95 1.558 ms, n=57. Controller, snapshot transport, validation and asynchronous goal timings are reported separately in report.json.

Native authoritative-read timing is the measured execution work potentially avoided by exact reuse. Speculative snapshot transport and freshness validation are separate added costs; their timing cannot be substituted for saved native execution. Goal latency is asynchronous but drain-inclusive total trial latency captures unfinished work. The tiny exposure experiment cannot establish positive causal exposure benefit; recorded configured credit is not an empirical estimate.

## confirmation

| Arm | Task success / trials (pass1) | pass2 | Total live mean / p95 seconds (n) | Physical calls | Known usage USD |
| --- | --- | --- | --- | --- | --- |
| base | 15/16 (93.8%) | 87.5% | 35.370 / 55.835 (16) | 93 (0 unmeasured trials) | 0.988 (0 unknown-charge trials) |
| paste | 13/16 (81.2%) | 75.0% | 40.266 / 59.291 (16) | 99 (0 unmeasured trials) | 1.043 (2 unknown-charge trials) |
| salesforce | 12/16 (75.0%) | 50.0% | 35.050 / 52.727 (16) | 91 (0 unmeasured trials) | 0.924 (0 unknown-charge trials) |
| goalspec | 14/16 (87.5%) | 87.5% | 39.883 / 50.488 (16) | 106 (0 unmeasured trials) | 1.495 (2 unknown-charge trials) |

pass2 is the proportion of family/variant units that succeed in both trials 0 and 1, not squared pooled accuracy or at-least-once success. All failures remain in the task-success denominator.

Headline totalTrialSeconds includes native orchestration and per-trial service drain. Native latencyMs is separate. Shared startup, final shared drain, and independent evaluation are outside the headline. Failures with measured time remain included; missing timing is not zero.

| Paired comparison | Matched trials | Task-success difference [95% CI] | Total live seconds difference [95% CI] |
| --- | --- | --- | --- |
| paste-vs-base | 16 | -12.5% [-37.5%, 0.0%] | 4.896 [2.721, 7.071] |
| salesforce-vs-base | 16 | -18.8% [-25.0%, -6.2%] | -0.320 [-4.256, 3.508] |
| goalspec-vs-base | 16 | -6.2% [-18.8%, 0.0%] | 4.513 [1.726, 7.300] |
| goalspec-vs-paste | 16 | 6.2% [0.0%, 18.8%] | -0.383 [-4.440, 3.431] |
| goalspec-vs-salesforce | 16 | 12.5% [-12.5%, 25.0%] | 4.833 [-0.448, 10.114] |

Differences are treatment minus control. Pointwise intervals resample families and retain their variants, trials and paired arms. Few families limit precision; intervals do not establish improvement on every metric.

Exploratory assignment intent-to-treat, conditional on the deterministic eligible pool. First assignment per run uses inverse-propensity weighted group means and family clusters; later assignments remain logged but do not duplicate terminal outcomes. Assigned exposure may fail freshness, readiness or context limits. With only a few runs, task mix and later assignments cannot be separated reliably, and zero success differences can produce degenerate intervals. These are not isolated causal read-usefulness labels, a validated utility calibration or exposure-head training targets.

Some task-success intervals are degenerate because the observed family rates are identical. This reflects no observed cluster variation, not certainty about population performance.

Exposure experiment: 0 assignments across 0 runs; 0 assigned exposure, 0 actually exposed. First-assignment groups contain 0 exposed-assigned and 0 withheld-assigned runs.

Native authoritative reads: mean 0.371 ms, p95 1.360 ms, n=296. Controller, snapshot transport, validation and asynchronous goal timings are reported separately in report.json.

Native authoritative-read timing is the measured execution work potentially avoided by exact reuse. Speculative snapshot transport and freshness validation are separate added costs; their timing cannot be substituted for saved native execution. Goal latency is asynchronous but drain-inclusive total trial latency captures unfinished work. The tiny exposure experiment cannot establish positive causal exposure benefit; recorded configured credit is not an empirical estimate.

No arm executed speculative reads in this confirmation cohort. GoalSpec's frozen utility policy abstained; these confirmation outcomes do not measure a benefit from active prefetching or evidence exposure. Development speculative execution is reported separately above.

## Separate supporting analyses

Supporting artifacts are included under `supporting` in report.json and hashed in manifest.json. Candidate coverage and controller action matching are prediction diagnostics; they are not causal usefulness or live task accuracy. The controller's exposure head is untrained unless its own training report says otherwise. Historical v3 official-task results use a different, previously exposed cohort and are not a head-to-head comparison with v4.

Exact promotions are a lower bound on reuse. Unpromoted calls are not automatically wasted when evidence was exposed. Freshness leases and revalidation queries are counted separately. Tool non-error rate is descriptive and does not establish correct tool arguments. Request usage is not an invoice; unknown charges retain their full reservation without adding the known subtotal twice.

### Candidate graph coverage

| Pool | Exact next-read arguments present |
| --- | --- |
| v3GoalSpecSavedTop3 | 36/68 |
| v3AllEightArmsSavedUnion | 40/68 |
| v4GraphPossibleMax32 | 54/68 |
| v4GraphReadyMax32 | 53/68 |
| v3UnionPlusV4Ready | 56/68 |

The v4 pool contains up to 32 candidates while saved per-arm v3 pools contain at most three. This is a coverage diagnostic, not a controlled ranking improvement.

### CPU controller training

Selected checkpoint: `logistic`. These are historical selection-family metrics; calibration-family scores were fitted and are not fresh test results.

| Checkpoint | Next-read exact arguments | READ/NO_READ accuracy | Masked BCE |
| --- | --- | --- | --- |
| fine-low | 37/65 | 62.9% | 0.273 |
| fine-ranking | 37/65 | 62.9% | 0.273 |
| fine-regularized | 37/65 | 62.9% | 0.273 |
| greedy-soup | 37/65 | 62.9% | 0.273 |
| logistic | 37/65 | 63.6% | 0.260 |
| mlp-base | 37/65 | 62.9% | 0.273 |

Soup additions accepted: 0/3. The report does not imply that weight averaging improved performance. Causal exposure head trained: False.

### Identical-pool historical replay

| Pool / ranker | Exact arguments Top1 | Tool Top1 | READ/NO_READ NLL | Next-tool cross-entropy estimate |
| --- | --- | --- | --- | --- |
| policy-ready / best-mlp | 47.1% | 69.1% | 0.490 | 0.858 |
| policy-ready / current-prior | 39.7% | 57.4% | 7.352 | 0.888 |
| policy-ready / greedy-soup | 47.1% | 69.1% | 0.490 | 0.858 |
| policy-ready / logistic-selected | 50.0% | 75.0% | 0.434 | 0.815 |
| proposal / best-mlp | 48.5% | 69.1% | 0.490 | 0.886 |
| proposal / current-prior | 35.3% | 52.9% | 7.271 | 0.932 |
| proposal / greedy-soup | 48.5% | 69.1% | 0.490 | 0.886 |
| proposal / logistic-selected | 51.5% | 75.0% | 0.434 | 0.844 |

This replay includes development prefixes partly reused for training. Cross-entropy is a predictive loss estimate, not true conditional entropy. It does not establish live latency or task success.

### Fresh development prefixes: frozen-controller prediction

33 retained Base checkpoints. The controller is frozen; all rankers use identical candidates within each universe. Unavailable known-read predictions remain failed hits. Unknown actual actions and unmeasured losses are counted separately.

| Universe / ranker | Completed / checkpoints | Read labels / unknown actions | Exact arguments Top1 / Top3 | Tool Top1 / Top3 | READ/NO_READ NLL (n) | Next-tool cross-entropy (n) |
| --- | --- | --- | --- | --- | --- | --- |
| proposal / current-prior | 33/33 | 14 / 0 | 21.4% / 35.7% | 28.6% / 50.0% | 7.117 (33) | 3.411 (14) |
| proposal / frozen-logistic | 33/33 | 14 / 0 | 28.6% / 42.9% | 35.7% / 57.1% | 0.610 (33) | 2.963 (14) |
| policy-ready / current-prior | 33/33 | 14 / 0 | 14.3% / 28.6% | 21.4% / 42.9% | 7.117 (33) | 3.554 (14) |
| policy-ready / frozen-logistic | 33/33 | 14 / 0 | 35.7% / 35.7% | 42.9% / 50.0% | 0.610 (33) | 3.151 (14) |

| Universe / ranker | Exact Top1 after admission gates (n) | READ sensitivity (n) | NO_READ specificity (n) |
| --- | --- | --- | --- |
| proposal / current-prior | 21.4% (14) | 92.9% (14) | 15.8% (19) |
| proposal / frozen-logistic | 14.3% (14) | 71.4% (14) | 68.4% (19) |
| policy-ready / current-prior | 14.3% (14) | 92.9% (14) | 15.8% (19) |
| policy-ready / frozen-logistic | 14.3% (14) | 71.4% (14) | 68.4% (19) |

Ungated ranking and admission answer different questions. Admission requires READ classification plus learned readiness and within-two-action use thresholds. Better candidate ranking can coexist with fewer correct admitted reads when these gates suppress actual read boundaries. These action labels do not measure causal usefulness.

| Same-pool frozen logistic minus prior | Matched checkpoints | Exact arguments Top1 difference [95% CI] | Gated exact Top1 difference [95% CI] | READ/NO_READ NLL difference [95% CI] |
| --- | --- | --- | --- | --- |
| proposal | 33 | 7.1% [-33.3%, 33.3%] (n=14) | -7.1% [-37.5%, 23.1%] (n=14) | -6.507 [-7.548, -5.518] (n=33) |
| policy-ready | 33 | 21.4% [6.7%, 33.3%] (n=14) | 0.0% [-18.8%, 23.1%] (n=14) | -6.507 [-7.548, -5.518] (n=33) |

Intervals resample whole families. Negative paired loss differences favor the controller. The tool loss normalizes summed independent candidate confidences with an epsilon over the tool catalog; it is not true conditional entropy. This offline replay provides no live latency, causal usefulness or task-success estimate.

### Held-out confirmation prefixes: frozen-controller prediction

148 retained Base checkpoints. The controller is frozen; all rankers use identical candidates within each universe. Unavailable known-read predictions remain failed hits. Unknown actual actions and unmeasured losses are counted separately.

| Universe / ranker | Completed / checkpoints | Read labels / unknown actions | Exact arguments Top1 / Top3 | Tool Top1 / Top3 | READ/NO_READ NLL (n) | Next-tool cross-entropy (n) |
| --- | --- | --- | --- | --- | --- | --- |
| proposal / current-prior | 148/148 | 70 / 0 | 28.6% / 57.1% | 35.7% / 72.9% | 6.254 (148) | 1.890 (70) |
| proposal / frozen-logistic | 148/148 | 70 / 0 | 42.9% / 70.0% | 57.1% / 82.9% | 0.562 (148) | 1.681 (70) |
| policy-ready / current-prior | 148/148 | 70 / 0 | 34.3% / 57.1% | 42.9% / 72.9% | 6.348 (148) | 1.884 (70) |
| policy-ready / frozen-logistic | 148/148 | 70 / 0 | 54.3% / 67.1% | 68.6% / 80.0% | 0.562 (148) | 1.672 (70) |

| Universe / ranker | Exact Top1 after admission gates (n) | READ sensitivity (n) | NO_READ specificity (n) |
| --- | --- | --- | --- |
| proposal / current-prior | 28.6% (70) | 100.0% (70) | 14.1% (78) |
| proposal / frozen-logistic | 24.3% (70) | 77.1% (70) | 65.4% (78) |
| policy-ready / current-prior | 34.3% (70) | 98.6% (70) | 14.1% (78) |
| policy-ready / frozen-logistic | 27.1% (70) | 77.1% (70) | 65.4% (78) |

Ungated ranking and admission answer different questions. Admission requires READ classification plus learned readiness and within-two-action use thresholds. Better candidate ranking can coexist with fewer correct admitted reads when these gates suppress actual read boundaries. These action labels do not measure causal usefulness.

| Same-pool frozen logistic minus prior | Matched checkpoints | Exact arguments Top1 difference [95% CI] | Gated exact Top1 difference [95% CI] | READ/NO_READ NLL difference [95% CI] |
| --- | --- | --- | --- | --- |
| proposal | 148 | 14.3% [-1.6%, 31.6%] (n=70) | -4.3% [-23.3%, 6.5%] (n=70) | -5.692 [-6.127, -5.244] (n=148) |
| policy-ready | 148 | 20.0% [8.2%, 34.7%] (n=70) | -7.1% [-27.8%, 5.7%] (n=70) | -5.785 [-6.387, -5.244] (n=148) |

Intervals resample whole families. Negative paired loss differences favor the controller. The tool loss normalizes summed independent candidate confidences with an epsilon over the tool catalog; it is not true conditional entropy. This offline replay provides no live latency, causal usefulness or task-success estimate.

### Current frozen-reference goal agreement

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v4-goal-replay-20260916-c`.

Top1 57.1%; Top3 57.1%; 77/80 grades available. Missing grades: 3. Paired original/current grades: 77.

Agreement with frozen teacher annotations on historical checkpoints, not task success or independent goal truth. Shared revisions are scored once; overlapping family references are grouped into connected components for intervals.

Frozen original Top1 matches: 49/77; current Top1 matches: 44/77. Recovered protocol validity does not imply recovered semantic agreement.

### Preserved earlier goal-replay iterations

Earlier development iterations remain separate. Current results do not overwrite or replace these outcomes.

| Earlier source | Top1 | Top3 | Grades / revisions | Missing grades |
| --- | --- | --- | --- | --- |
| C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v4-goal-replay-20260916 | 22.1% | 27.3% | 77/80 | 3 |
| C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v4-goal-replay-20260916-b | 32.5% | 32.5% | 77/80 | 3 |

These sequential development revisions reuse the original teacher references. They are not independent held-out experiments, and the report makes no selection-adjusted significance claim.

### Historical v3 native official-task subset

| Arm | Task successes / trials | Mean total live seconds |
| --- | --- | --- |
| base | 10/16 | 47.310 |
| paste | 13/16 | 43.775 |
| salesforce | 14/16 | 42.264 |
| goalspec | 13/16 | 51.608 |

Separate previously exposed historical cohort; not an official full-benchmark score and not a matched v3-v4 experiment.

### Cumulative project accounting

Settled logical-request usage: $55.511. Spent or reserved: $130.097 of the $500.000 ceiling. Unresolved requests: 54. AWS charges: $0.000.

This cumulative ledger and the cohort known-usage subtotals have different boundaries: successful-attempt usage inside an unresolved logical request can appear in a trial subtotal before that request settles. Do not add cohort subtotals to cumulative ledger amounts or treat either as a reconciled invoice. Unresolved charges remain bounded by retained reservations.

### Post-hoc confirmation failure audit

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v4-confirmation-failure-audit-20260916\diagnostic.json`. The complete diagnostic is embedded in report.json. This is a trace inspection after outcomes closed, not a new evaluation or a causal attribution. Original scores and frozen completion checks remain unchanged.

The simulator deviated from its fixed scenario by approving a cabin-only substitution. The private predeclared scenario explicitly required no upgrade if the combined cost exceeded $80 and prohibited unrelated substitutions. Public later consent is real within the dialogue, but the fixed evaluator does not change targets with it. This limits interpretation of task success differences.

No causal attribution to GoalSpec, memory or prefetch is established by two post-hoc traces; both GoalSpec failures had zero speculative calls.

All seven readiness misses are find_user_id_by_email. Their literal current email bindings are already policy-eligible, yet learned readiness ranges about 0.095 to 0.320. This suggests a training-target or calibration mismatch worth testing on separate future development data, not a reason to bypass authorization.

No admission thresholds were changed after confirmation. This diagnostic is separate from the frozen confirmation scores.

## Reproduce this analysis without provider calls

Run from the repository root using the existing analysis environment and a new output directory:

```powershell
& research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/report_native_v4.py --plan 'C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v4-final-report-20260916.plan.json' --expected-sha256 bf04665e2f2e7276fae0cc6bb8c46695e5b1c63c77481f831c51343f088155b5 --output research/goalspec/runs/local-v4-report-reproduction
```

Artifacts contain absolute paths. On another checkout, create a new input plan with explicit mappings to repository-relative files, resolve them from the repository root, and rehash the new plan and any derived manifests. Nested frozen references must also remain resolvable and hash-verified. Preserve every original manifest and source artifact; do not rewrite original hashes to hide relocation. The command above reproduces the original analysis in its recorded workspace, not an automatically relocatable archive.
