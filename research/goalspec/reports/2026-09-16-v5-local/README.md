# GoalSpec v5 results

Each study below keeps its own task population, denominator and timing scope. This synthesis copies closed report scores; it does not change grades, fit models or combine unlike benchmarks.

## Public official native subset

selected official tau3 subset

Selected v5 policy: actorContext=literal; goalConditioning=False. The goalspec arm is this selected policy, not necessarily an inferred-goal intervention.

| Arm | Task success;95% CI | Both-trial consistency | Mean live seconds;95% CI | p95 seconds | Physical tool calls | All calls/success;95% CI | Usage subtotal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | 11/12; 91.7% [75.0%, 100.0%] | 83.3% [50.0%, 100.0%] | 45.440 [35.900, 54.989] | 70.706 (n=12; missing=0; host-invalid=0; health-unrecorded=0) | 62 | 5.636 [3.833, 7.889] | $0.936639; 0 missing/uncertain trial costs |
| v4 | 12/12; 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 46.863 [30.670, 65.187] | 83.314 (n=12; missing=0; host-invalid=0; health-unrecorded=0) | 71 | 5.917 [4.000, 8.750] | $1.451171; 0 missing/uncertain trial costs |
| goalspec | 10/12; 83.3% [66.7%, 100.0%] | 66.7% [33.3%, 100.0%] | 49.140 [34.489, 65.056] | 82.898 (n=12; missing=0; host-invalid=0; health-unrecorded=0) | 59 | 5.900 [3.333, 10.625] | $1.236034; 0 missing/uncertain trial costs |

Budget terminations and execution failures remain in success denominators. pass1 is empirical per-execution success. Both-trial consistency requires both declared repetitions to succeed; it is neither at-least-once success nor squared pooled accuracy. Missing/uncertain native trial costs include absent telemetry and are not a count of unresolved provider ledger requests.

| Paired treatment minus control | Matched trials/families | Measured latency pairs | Success difference;95% CI | Live seconds difference;95% CI |
| --- | --- | --- | --- | --- |
| v4-minus-base | 12/6 | 12 | +8.3 pp [+0.0 pp, +25.0 pp] | 1.423 [-10.190, 14.861] |
| goalspec-minus-base | 12/6 | 12 | -8.3 pp [-33.3 pp, +16.7 pp] | 3.700 [-5.211, 14.055] |
| goalspec-minus-v4 | 12/6 | 12 | -16.7 pp [-33.3 pp, +0.0 pp] | 2.277 [-1.542, 6.030] |

| Domain | Arm | Successes/trials | pass1;95% CI |
| --- | --- | --- | --- |
| airline | base | 6/6 | 100.0% [100.0%, 100.0%] |
| airline | v4 | 6/6 | 100.0% [100.0%, 100.0%] |
| airline | goalspec | 6/6 | 100.0% [100.0%, 100.0%] |
| retail | base | 5/6 | 83.3% [50.0%, 100.0%] |
| retail | v4 | 6/6 | 100.0% [100.0%, 100.0%] |
| retail | goalspec | 4/6 | 66.7% [50.0%, 100.0%] |

Live interaction includes native orchestration, model/tool work, simulation serialization and acknowledged per-trial actor/user drain. It excludes source checks, environment/task/agent/user construction, artifact persistence and shared service startup/shutdown. Native judging and judge drain are measured separately. Positive paired success differences favor the treatment; positive latency differences mean slower.
Explicitly invalid host clocks are excluded from primary latency means, tails and intervals; interrupted trials still count as task failures. Source reports retain raw clocks. Timing n, missing observations and host-invalid counts remain separate; absent legacy health metadata is not evidence of valid host timing. Paired latency requires usable clocks on both members.
The v4 arm uses the frozen legacy policy inside the same current harness. It is not a pooled comparison with historical v4 runs. The native evaluator uses the pinned GPT-5.4 teacher; the upstream default GPT-4.1-2025-04-14 differs. Public-task exposure and prior diagnostic ancestry prevent a pristine-heldout claim.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-confirmation-report-20260916\report.json`; SHA256 `1dfb9ee133c05563127166b7c812dfaa40497e5884de8991c6634fe8d5d1eb3f`.

## Custom native development

custom tau-compatible pilot

| Arm | Task success;95% CI | Both-trial consistency | Mean live seconds;95% CI | p95 seconds | Physical tool calls | All calls/success;95% CI | Usage subtotal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | 1/4; 25.0% [0.0%, 75.0%] | unavailable | 42.526 [33.422, 51.630] | 50.720 (n=2; missing=2; host-invalid=2; health-unrecorded=0) | 13 known subtotal; 2 trials unmeasured | unavailable | $0.119875; 2 missing/uncertain trial costs |
| v4 | 2/4; 50.0% [0.0%, 100.0%] | unavailable | 34.819 [34.007, 35.631] | 35.550 (n=2; missing=2; host-invalid=2; health-unrecorded=0) | 13 known subtotal; 2 trials unmeasured | unavailable | $0.154259; 2 missing/uncertain trial costs |
| literal | 3/4; 75.0% [25.0%, 100.0%] | unavailable | 50.216 [43.866, 54.068] | 53.933 (n=3; missing=1; host-invalid=1; health-unrecorded=0) | 21 known subtotal; 1 trials unmeasured | unavailable | $0.259216; 1 missing/uncertain trial costs |
| hypotheses | 2/4; 50.0% [0.0%, 100.0%] | unavailable | 43.047 [36.912, 49.182] | 48.569 (n=2; missing=2; host-invalid=2; health-unrecorded=0) | 15 known subtotal; 1 trials unmeasured | unavailable | $0.218192; 1 missing/uncertain trial costs |

Budget terminations and execution failures remain in success denominators. pass1 is empirical per-execution success. Both-trial consistency requires both declared repetitions to succeed; it is neither at-least-once success nor squared pooled accuracy. Missing/uncertain native trial costs include absent telemetry and are not a count of unresolved provider ledger requests.

| Paired treatment minus control | Matched trials/families | Measured latency pairs | Success difference;95% CI | Live seconds difference;95% CI |
| --- | --- | --- | --- | --- |
| v4-minus-base | 4/4 | 2 | +25.0 pp [+0.0 pp, +75.0 pp] | -7.707 [-17.623, 2.209] |
| literal-minus-base | 4/4 | 2 | +50.0 pp [+0.0 pp, +100.0 pp] | 5.763 [1.083, 10.444] |
| hypotheses-minus-base | 4/4 | 2 | +25.0 pp [+0.0 pp, +75.0 pp] | 0.521 [-2.448, 3.490] |
| literal-minus-v4 | 4/4 | 2 | +25.0 pp [+0.0 pp, +75.0 pp] | 13.470 [8.235, 18.706] |
| hypotheses-minus-v4 | 4/4 | 2 | +0.0 pp [+0.0 pp, +0.0 pp] | 8.228 [1.282, 15.175] |
| hypotheses-minus-literal | 4/4 | 2 | -25.0 pp [-75.0 pp, +0.0 pp] | -5.242 [-6.954, -3.530] |

| Domain | Arm | Successes/trials | pass1;95% CI |
| --- | --- | --- | --- |
| airline | base | 0/2 | 0.0% [0.0%, 0.0%] |
| airline | v4 | 1/2 | 50.0% [0.0%, 100.0%] |
| airline | literal | 1/2 | 50.0% [0.0%, 100.0%] |
| airline | hypotheses | 1/2 | 50.0% [0.0%, 100.0%] |
| retail | base | 1/2 | 50.0% [0.0%, 100.0%] |
| retail | v4 | 1/2 | 50.0% [0.0%, 100.0%] |
| retail | literal | 2/2 | 100.0% [100.0%, 100.0%] |
| retail | hypotheses | 1/2 | 50.0% [0.0%, 100.0%] |

Live interaction includes native orchestration, model/tool work, simulation serialization and acknowledged per-trial actor/user drain. It excludes source checks, environment/task/agent/user construction, artifact persistence and shared service startup/shutdown. Native judging and judge drain are measured separately. Positive paired success differences favor the treatment; positive latency differences mean slower.
Explicitly invalid host clocks are excluded from primary latency means, tails and intervals; interrupted trials still count as task failures. Source reports retain raw clocks. Timing n, missing observations and host-invalid counts remain separate; absent legacy health metadata is not evidence of valid host timing. Paired latency requires usable clocks on both members.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-development-report-20260916\report.json`; SHA256 `64d07e98f8cbca185705255a1b310a0d9af1b4ff5173a5c796f7e505e5da696b`.

## Custom native training collection

custom tau-compatible pilot

| Arm | Task success;95% CI | Both-trial consistency | Mean live seconds;95% CI | p95 seconds | Physical tool calls | All calls/success;95% CI | Usage subtotal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | 36/40; 90.0% [80.0%, 97.5%] | unavailable | 30.625 [28.047, 33.560] | 43.886 (n=40; missing=0; host-invalid=0; health-unrecorded=0) | 198 | 5.500 [4.744, 6.375] | $2.016866; 0 missing/uncertain trial costs |

Budget terminations and execution failures remain in success denominators. pass1 is empirical per-execution success. Both-trial consistency requires both declared repetitions to succeed; it is neither at-least-once success nor squared pooled accuracy. Missing/uncertain native trial costs include absent telemetry and are not a count of unresolved provider ledger requests.

| Domain | Arm | Successes/trials | pass1;95% CI |
| --- | --- | --- | --- |
| airline | base | 17/20 | 85.0% [70.0%, 100.0%] |
| retail | base | 19/20 | 95.0% [85.0%, 100.0%] |

Live interaction includes native orchestration, model/tool work, simulation serialization and acknowledged per-trial actor/user drain. It excludes source checks, environment/task/agent/user construction, artifact persistence and shared service startup/shutdown. Native judging and judge drain are measured separately. Positive paired success differences favor the treatment; positive latency differences mean slower.
Explicitly invalid host clocks are excluded from primary latency means, tails and intervals; interrupted trials still count as task failures. Source reports retain raw clocks. Timing n, missing observations and host-invalid counts remain separate; absent legacy health metadata is not evidence of valid host timing. Paired latency requires usable clocks on both members.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-training-report-20260916\report.json`; SHA256 `7cc0eb113ac5d03e9abb28705b0c34dddfd1a18e8ee5c22c59f34ed45c1d0182`.

## Training annotation diagnosis

| Training stratum | Selected | Graded | Missing | Complete agreement/all | Agreement/graded |
| --- | --- | --- | --- | --- | --- |
| all | 100 | 98 | 2 | 29.0% | 29.6% |
| reliability:train | 80 | 79 | 1 | 35.0% | 35.4% |
| reliability:calibration | 20 | 19 | 1 | 5.0% | 5.3% |

| Overlapping strict-agreement failure reason | Prefixes |
| --- | --- |
| wrongOverallGoal | 50 |
| missingOrContradictedRequiredAtom | 52 |
| ambiguous | 25 |
| blindAnnotationAmbiguous | 31 |
| unsupported | 30 |
| stale | 8 |
| ambiguityOnly | 7 |

These are training labels, not held-out task accuracy. Missing grades remain primary-denominator misses and masked fitting labels. Teacher agreement measures a fallible interpretation. Atomic flags overlap and share prefixes/families.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-annotation-diagnosis-20260916.json`; SHA256 `13d0a2f72e16c246cdf2a8426311ce12b6ddd4ff8fac6d180bff82dccceaa484`.

## Frozen next-action and goal replay

Goal agreement across all 16 selected prefixes: Top1 0.0% [0.0%, 0.0%]; Top3 0.0% [0.0%, 0.0%]. Missing grades: 1.

| Same-pool ranker | n | Read/no-read/unknown | Read exact Top1;95% CI | Read tool Top1;95% CI | Read pool coverage | NO_READ specificity | Coarsened next-read log loss |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral-no-memory | 16 | 6/10/0 | 16.7% [0.0%, 60.0%] | 16.7% [0.0%, 60.0%] | 83.3% [57.1%, 100.0%] | 100.0% [100.0%, 100.0%] | 1.596 [0.723, 2.433] |
| neutral-active-memory | 16 | 6/10/0 | 50.0% [14.3%, 100.0%] | 50.0% [14.3%, 100.0%] | 83.3% [57.1%, 100.0%] | 100.0% [100.0%, 100.0%] | 1.204 [0.608, 1.875] |
| full-goal | 16 | 6/10/0 | 50.0% [14.3%, 100.0%] | 50.0% [14.3%, 100.0%] | 83.3% [57.1%, 100.0%] | 100.0% [100.0%, 100.0%] | 1.179 [0.432, 2.114] |
| teacher-goal-hint | 16 | 6/10/0 | 50.0% [14.3%, 100.0%] | 50.0% [14.3%, 100.0%] | 83.3% [57.1%, 100.0%] | 100.0% [100.0%, 100.0%] | 1.093 [0.432, 1.870] |
| shuffled-goal | 16 | 6/10/0 | 50.0% [14.3%, 100.0%] | 50.0% [14.3%, 100.0%] | 83.3% [57.1%, 100.0%] | 100.0% [100.0%, 100.0%] | 1.204 [0.608, 1.875] |

The same pool has at most128 current-source read candidates. No-memory is a ranking control on that shared pool. Tool/full-argument Top1 and coverage use only read-labeled checkpoints, including prediction failures as misses. These ungated ranking scores accept any audited read in the next actor batch; they do not predict the entire batch or exact write actions.
The reported category log loss concerns a coarsened next-read decision/set event: matching pool reads, NO_READ or READ_UNCOVERED. NO_READ combines writes, messages, stopping and other non-read behavior without identifying exact tools or arguments. READ_UNCOVERED identifies missing read coverage without predicting the missing invocation. This is not full native action tool-and-argument log loss. Log loss estimates cross-entropy, not true conditional entropy; observed-loss counts, uncovered mass and floored read exact/tool losses remain separate in the source report.
Teacher hints are fallible, not true oracle goals. Primary shuffled goals retain donor provenance and can be rejected by the normal guard. The separately reported feature-corruption sensitivity deliberately bypasses provenance outside the runtime. Rejection does not prove current-sourced semantic errors harmless. Joint READ argmax is not utility-based scheduler admission.
Primary frozen-policy controls may use different neutral and goal-active temperatures. Their probability/log-loss differences therefore combine residual and calibration effects.

Offline matched-temperature residual diagnostic, both temperatures fixed to 0.750; same frozen weights, current-goal context, memory and candidate pool:

| Full residual minus neutral | Paired family95% interval |
| --- | --- |
| Read exact Top1 | +0.0 pp [+0.0 pp, +0.0 pp] |
| Read tool Top1 | +0.0 pp [+0.0 pp, +0.0 pp] |
| Coarsened next-read log loss | 0.000 [-0.000, 0.001] |

This separately declared analysis override isolates the residual at the frozen goal-active temperature. It changes neither the primary controls nor the live runtime; negative log-loss differences favor the residual.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-prediction-replay-report-20260916.json`; SHA256 `7822481d205bb7d9d57cd6b57614a2c4067d03ee7234c519aebc52053acf0336`.

## BFCL goal-conditioning probe

| Probe arm | Official AST correct/cases | Mean synchronous milliseconds |
| --- | --- | --- |
| direct | 28/32 | 3523.154 |
| goal_context_probe | 27/32 | 4704.855 |

Paired accuracy difference: -3.1 pp [-15.6 pp, +6.2 pp]. Helped cases: 1; harmed cases: 2.
This isolated synchronous goal-conditioning probe uses original public requests/tools and the official AST checker. It does not execute the full GoalSpec runtime, memory, scheduler or task environment. Case-bootstrap intervals do not account for all shared function-family dependence. It provides no live task-success or latency-win claim.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-bfcl-v5-probe-report-20260916\report.json`; SHA256 `c90a754371f83bcadcabd4e2abc9c4264f761160bffe3a285b083af40244ee90`.

## Derya database component profile

Independent scenarios: 100; equivalence passed: True; performance gate passed: False; verified reuse enabled: False; production mode: off.

| Tool | Epoch probe p95 ms | Full reread p95 ms |
| --- | --- | --- |
| search_jobs | 9.422 | 7.925 |
| search_inquiries | 10.728 | 8.103 |
| search_companies | 9.808 | 7.325 |
| get_job | 9.440 | 14.444 |
| list_open_inquiries | 10.023 | 8.411 |

Maximum writer p95 overhead: 16.5%. A failed gate stays failed and cannot justify enabling reuse.
This local PostgreSQL fixture profile excludes actor/provider work. Repeated samples are not independent tasks, and one-column writes do not establish production workload overhead. Epoch probing without projection does not expose an observation.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-derya-profile-20260916\report.json`; SHA256 `1d4aa7845397b537ec0f4760f4fd3d4ae415e08f9644c1320de6bfab0494af10`.

## Derya synthetic live read tasks

| Derya arm | Successes/trials | Mean live seconds;95% CI | Observed p95 | Tool reads | SQL statements | Provider attempts | Usage subtotal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | 12/12 | 3.037 [2.826, 3.261] | 3.713 (n=12) | 12 | 102 | 24 | $0.056814 |
| neutral | 12/12 | 3.508 [3.115, 4.120] | 5.092 (n=12) | 12 | 102 | 24 | $0.056707 |
| goal54 | 12/12 | 3.353 [3.109, 3.620] | 4.127 (n=12) | 12 | 102 | 36 | $0.081690 |

| Paired treatment minus Base | Family pairs | Latency difference seconds;95% CI |
| --- | --- | --- |
| neutral-minus-base | 12 | 0.472 [-0.003, 1.127] |
| goal54-minus-base | 12 | 0.316 [0.021, 0.584] |

Integrity passed: True; failure: none recorded.
These are synthetic application read tasks with a cold business controller, not official native benchmark tasks. Physical tool reads, SQL statements and provider attempts are separate quantities. The clock includes per-trial connection setup, actor/tools, managed predictor drain and disconnect; shared ledger recovery and preflight are excluded. The12predeclared request families share tools and fixture state, so family intervals do not eliminate shared-tool/database correlation. Observed p95 has only12samples per arm. No task-cluster interval is inferred when the source provides none.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-derya-live-report-20260916\report.json`; SHA256 `a3da908f8e69e5f799b747c107105ab1e6c7eb16452a41b1ea3d865c2936e567`.

## Controller fitting and calibration

This reports fitting of the local prediction controller, not fine-tuning the hosted actor or teacher. Any model-soup, selected-checkpoint or calibration metrics in the source are training/selection diagnostics, not independent confirmation accuracy. Teacher reliability predicts teacher agreement, not semantic truth or causal prefetch usefulness.

| Declared metric | Value | Source JSON pointer |
| --- | --- | --- |
| Neutral weights frozen | True | /neutralWeightsFrozen |
| Completed calibration prefixes | 19 | /reliability/completedCalibrationRows |
| Strict calibration agreements | 1 | /reliability/agreementPositives |
| Smoothed teacher agreement | 9.5% | /reliability/probability |
| Reliability limitation | small pilot estimate; correlated prefixes do not establish reliable unseen-family calibration | /reliability/assessment |

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-model-pipeline-20260916\conditional\report.json`; SHA256 `526e3f352a8598dba36cd83e6b2f406b16323c59c42b471d00e56d96a2f016bf`.

## Budget accounting

Known settled request usage: $79.537568; spent or conservatively reserved: $166.891414; unresolved requests: 56; total ceiling: $500.000000; AWS charges: $0.000000.

| Allocation | Ceiling USD | Known usage USD | Spent/reserved USD | Unresolved requests |
| --- | --- | --- | --- | --- |
| infrastructure | 35.000 | 0.000000 | 0.000000 | 0 |
| preparation | 30.000 | 12.218678 | 23.815040 | 1 |
| training | 60.000 | 3.395160 | 3.395160 | 0 |
| development | 40.000 | 10.641675 | 15.256623 | 4 |
| heldout | 240.000 | 40.741368 | 111.883904 | 51 |
| replay | 30.000 | 12.540687 | 12.540687 | 0 |
| contingency | 65.000 | 0.000000 | 0.000000 | 0 |

The final budget is cumulative across historical and current work. Unknown request charges retain reservations, potentially a whole cohort parent. Response-usage subtotals, settled request costs and conservative reservations are different quantities; none is an invoice, and component subtotals are not added to the cumulative ledger again.

Source: `C:\Users\apexs\derya-crm-memory-main-20260908\research\goalspec\runs\local-v5-budget-final-20260916.json`; SHA256 `e196fa18b78d8732236438d0d94a5a4ae7eff17eef89e96fec4a3848c81f4564`.

## Interpretation

Family-clustered native/replay intervals use the source reports' declared resampling units. Small samples, overlapping metrics and zero-width intervals do not establish population certainty. BFCL uses public-case bootstrap and has a different dependence structure. No confidence interval is invented for components that provide none.
Public official tasks remain exposed research data. Custom composition families, selected official subsets, annotation agreement, BFCL AST accuracy and application microbenchmarks are distinct outcomes. Training and development selection cannot be relabeled as confirmation. Reported improvements and regressions remain visible; these results do not establish superiority on every metric or a SOTA/full-benchmark score.

Native infrastructure follows the [pinned tau2 source](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db). BFCL uses the [pinned official checker source](https://github.com/ShishirPatil/gorilla/tree/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000). Architecture comparison arms elsewhere are paper-based local baselines, not verified upstream reproductions.
