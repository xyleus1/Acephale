# GoalSpec v4 benchmark results

These measurements cover different capabilities and are not combined into one score. Official task success is the primary live result; BFCL tests actor tool-call generation, APIGen tests frozen controller transfer, and CPU timing measures the local controller component. Improvements in one do not establish superiority in the others.

## Official tau task subset

All 112 declared trials are retained: 14 official test tasks, seven retail and seven airline, two trials per task, four arms, 28 trials per arm. The actor is `gpt-5.4-2026-03-05`, medium reasoning, maximum output 4,096 tokens; the native user simulator is `gpt-4.1-mini-2025-04-14`. The native evaluator's model-based judge also uses the configured annotation-teacher snapshot `gpt-5.4-2026-03-05`; this differs from the pinned upstream default judge, `gpt-4.1-2025-04-14`. PASTE and Salesforce are local paper-based controls, not verified reproductions of upstream systems.

| Arm | Successes / trials | Pass1 [95% CI] | Both trials / tasks | Two-trial rate [95% CI] |
| --- | --- | --- | --- | --- |
| base | 20/28 | 71.4% [50.0%, 92.9%] | 9/14 | 64.3% [35.7%, 85.7%] |
| paste | 20/28 | 71.4% [50.0%, 89.3%] | 8/14 | 57.1% [28.6%, 85.7%] |
| salesforce | 24/28 | 85.7% [64.3%, 100.0%] | 12/14 | 85.7% [64.3%, 100.0%] |
| goalspec | 21/28 | 75.0% [53.6%, 92.9%] | 9/14 | 64.3% [35.7%, 85.7%] |

Pass1 is successful native executions divided by every declared trial. Two-trial consistency is the fraction of tasks whose two executions both succeeded, not success at least once or squared pass1. Success requires native reward 1 and valid native termination. Failures, budget stops and incomplete runs retain their original grades. Intervals are pointwise 95% task-cluster bootstrap intervals, resampling both trials together. They are not adjusted for multiple comparisons. With only 14 task clusters overall and seven per domain, intervals are limited by the observed sample; a uniform sample can produce a zero-width bootstrap interval without establishing population certainty.

Airline (seven tasks, 14 trials per arm):

| Arm | Successes / trials | Pass1 [95% CI] | Both trials / tasks | Two-trial rate [95% CI] |
| --- | --- | --- | --- | --- |
| base | 8/14 | 57.1% [14.3%, 85.7%] | 4/7 | 57.1% [14.3%, 85.7%] |
| paste | 9/14 | 64.3% [28.6%, 92.9%] | 4/7 | 57.1% [14.3%, 85.7%] |
| salesforce | 10/14 | 71.4% [42.5%, 100.0%] | 5/7 | 71.4% [42.5%, 100.0%] |
| goalspec | 9/14 | 64.3% [28.6%, 92.9%] | 4/7 | 57.1% [14.3%, 85.7%] |

Retail (seven tasks, 14 trials per arm):

| Arm | Successes / trials | Pass1 [95% CI] | Both trials / tasks | Two-trial rate [95% CI] |
| --- | --- | --- | --- | --- |
| base | 12/14 | 85.7% [71.4%, 100.0%] | 5/7 | 71.4% [42.9%, 100.0%] |
| paste | 11/14 | 78.6% [64.3%, 92.9%] | 4/7 | 57.1% [28.6%, 85.7%] |
| salesforce | 14/14 | 100.0% [100.0%, 100.0%] | 7/7 | 100.0% [100.0%, 100.0%] |
| goalspec | 12/14 | 85.7% [64.3%, 100.0%] | 5/7 | 71.4% [28.6%, 100.0%] |

GoalSpec paired differences use the same task instances and trial seeds; latency differences below are in seconds and accuracy differences are percentage points (pp). A positive GoalSpec-minus-control latency difference means GoalSpec is slower. A positive success difference means GoalSpec succeeds more often.

| GoalSpec minus | Metric | Difference [95% CI] | Tasks | Matched trials |
| --- | --- | --- | --- | --- |
| base | successRate | 3.6 pp [-7.1 pp, 14.3 pp] | 14 | 28 |
| base | bothTrialsSuccessRate | 0.0 pp [-21.4 pp, 21.4 pp] | 14 | 28 |
| base | liveTotalMeanSeconds | 6.020 s [-0.839 s, 15.000 s] | 14 | 28 |
| paste | successRate | 3.6 pp [-7.1 pp, 14.3 pp] | 14 | 28 |
| paste | bothTrialsSuccessRate | 7.1 pp [-14.3 pp, 28.6 pp] | 14 | 28 |
| paste | liveTotalMeanSeconds | 3.161 s [-0.531 s, 6.898 s] | 14 | 28 |
| salesforce | successRate | -10.7 pp [-21.4 pp, 0.0 pp] | 14 | 28 |
| salesforce | bothTrialsSuccessRate | -21.4 pp [-42.9 pp, 0.0 pp] | 14 | 28 |
| salesforce | liveTotalMeanSeconds | 1.848 s [-3.211 s, 7.380 s] | 14 | 28 |

## Live latency and physical work

| Arm | Timed live trials | Live mean s | Live p95 s | Mean drain s | Mean judge s | Timed judge trials |
| --- | --- | --- | --- | --- | --- | --- |
| base | 28 (0 missing) | 44.876 | 91.584 | 0.005 | 0.563 | 28 (0 missing) |
| paste | 28 (0 missing) | 47.734 | 85.341 | 0.005 | 0.655 | 28 (0 missing) |
| salesforce | 28 (0 missing) | 49.048 | 75.850 | 0.005 | 0.673 | 28 (0 missing) |
| goalspec | 28 (0 missing) | 50.896 | 101.388 | 0.390 | 0.641 | 28 (0 missing) |

Live latency includes prediction, actor orchestration, tools and acknowledged per-trial actor/user drain. Service startup and the final shared service shutdown are outside each trial clock. Native judge time is reported separately and is not counted as live latency. The p95 is the observed tail over the displayed number of measured trials; it is not a population-tail guarantee. Missing timing is never replaced with zero.

| Arm | All physical attempts | Measured trials | All attempts / success | Authoritative requested | Speculative calls | Consumed promotions | Refresh / consume lease checks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | 184 | 28/28 | 9.200 | 184 | 0 | 0 | 0 / 0 |
| paste | 197 | 28/28 | 9.850 | 197 | 0 | 0 | 0 / 0 |
| salesforce | 194 | 28/28 | 8.083 | 194 | 0 | 0 | 0 / 0 |
| goalspec | 185 | 28/28 | 8.810 | 185 | 0 | 0 | 0 / 0 |

Physical attempts count authoritative and speculative native tool executions, including executions in failed trials. All attempts per successful task uses the complete cohort numerator divided by successful executions. Requested authoritative calls can be satisfied by promotion; they are not a substitute for measured physical executions. Nested snapshot wrappers are excluded. Lease checks are added validation work, separate from physical tool executions. Consumed promotions are a lower bound on useful speculation; exposed evidence can change subsequent behavior, so every unpromoted call is not automatically waste. Unavailable totals remain unavailable when telemetry is incomplete.

| Arm | Tool non-error rate | Reference tool recall | Reference full-argument recall | Required assertion trials | Missing required assertions | Observed response usage USD |
| --- | --- | --- | --- | --- | --- | --- |
| base | 100.0% [100.0%, 100.0%] | 74.4% [62.5%, 89.7%] | 71.9% [60.7%, 86.5%] | 2 | 0 | 2.417682 |
| paste | 99.0% [97.3%, 100.0%] | 78.1% [69.7%, 89.2%] | 74.4% [65.8%, 86.1%] | 2 | 0 | 2.521391 |
| salesforce | 100.0% [100.0%, 100.0%] | 78.1% [68.2%, 91.1%] | 76.9% [67.3%, 89.6%] | 2 | 0 | 2.630483 |
| goalspec | 99.5% [98.0%, 100.0%] | 79.4% [70.1%, 89.4%] | 75.0% [67.2%, 84.7%] | 2 | 0 | 3.917820 |

Tool non-error rate is not task success, policy compliance or next-tool accuracy. Reference recalls compare one upstream annotated action sequence and do not establish that other valid paths are incorrect. Assertion coverage is relevant only where the native reward basis requires assertions. Complete reward, coverage, failed-assertion, termination and speculation diagnostics remain in `report.json` and the native source report.

## BFCL actor component

| Category | Correct / cases | AST accuracy |
| --- | --- | --- |
| multiple | 28/32 | 87.5% |
| irrelevance | 27/32 | 84.4% |
| Combined selected subset | 55/64 | 85.9% |

This is the pinned BFCL multiple/irrelevance subset, 32 cases per category, evaluated with the official AST checker. There are 0 failed predictions and they remain incorrect in the denominator. It uses the same research actor configuration, but no GoalSpec goals, memory, scheduler or native tool execution. It is neither an overall BFCL score nor a comparison between GoalSpec, PASTE and Salesforce.

The post-hoc audit retains all 9 official misses: 7 abstention errors (5 unnecessary calls and 2 missing calls), 1 argument-value errors, and 1 function-selection/cardinality errors. The extra-call failure does not establish a wrong function name. This is diagnostic classification after scoring, with no changed official grades or causal GoalSpec claim.

## APIGen frozen-controller transfer

The full source corpus contributes 46127 public-prefix checkpoints; 525 have unknown labels after source catalog or argument validation and remain disclosed in coverage. Label-dependent read metrics use known read actions; NO_READ specificity uses known non-read actions. Both rankers receive the identical candidate pool.

| Metric | Same-pool prior | Frozen logistic | Logistic minus prior [95% CI] |
| --- | --- | --- | --- |
| toolTop1 | 8055/15009 (53.7%) | 7767/15009 (51.7%) | -1.9 pp [-3.7 pp, 4.7 pp] |
| toolTop3 | 10764/15009 (71.7%) | 10869/15009 (72.4%) | 0.7 pp [-0.2 pp, 3.2 pp] |
| exactTop1 | 5890/15009 (39.2%) | 6431/15009 (42.8%) | 3.6 pp [2.0 pp, 9.2 pp] |
| exactTop3 | 8883/15009 (59.2%) | 9340/15009 (62.2%) | 3.0 pp [1.4 pp, 8.3 pp] |
| gatedExactTop1 | 5890/15009 (39.2%) | 2788/15009 (18.6%) | -20.7 pp [-23.4 pp, -11.6 pp] |
| poolCoverage | 10810/15009 (72.0%) | 10810/15009 (72.0%) | 0.0 pp [0.0 pp, 0.0 pp] |
| readSensitivity | 14232/15009 (94.8%) | 10371/15009 (69.1%) | -25.7 pp [-35.1 pp, -22.3 pp] |
| noReadSpecificity | 5322/30593 (17.4%) | 21613/30593 (70.6%) | 53.3 pp [49.8 pp, 58.1 pp] |

toolTop1 fell 1.92 percentage points; exactTop1 rose 3.60 percentage points; gatedExactTop1 fell 20.67 percentage points; noReadSpecificity rose 53.25 percentage points. These are observed estimates, not claims that every paired interval excludes zero.

Ungated top-k measures ranking. Gated exact Top-1 additionally requires the frozen READ, useful-within-two and learned readiness gates. These imitation gates do not establish authorization or causal usefulness. Formatting splits in source tapes can change NO_READ frequency. Candidate coverage limits what any ranker can recover; this is not native task success, an APIGen actor evaluation or proof of executed-tool correctness.

The complete report retains domain results, catalog-clean sensitivity, duplicate counts, 95% provisional action-family intervals and cross-entropy estimates. Those intervals do not certify independent held-out task families. Normalized candidate-score cross-entropy is an estimate, not true conditional entropy. Research-only CC BY-NC 4.0 lineage and source-reported verification remain separate from independent replay verification.

## CPU component timing

| Run | Samples | Mean ms | p50 ms | p95 ms | Max ms | p95 target met |
| --- | --- | --- | --- | --- | --- | --- |
| initial concurrent analysis | 643 | 3.032 | 0.901 | 11.521 | 52.977 | False |
| isolated fixed protocol | 3215 | 0.537 | 0.188 | 2.047 | 5.165 | True |

Both runs are retained. The first ran alongside other analysis; the isolated rerun followed a fixed protocol of five full warmup passes and five measured passes over 643 states, retaining all 3,215 measured samples. It was not the best pass selected after measurement. These samples time `LocalController.decide`, including validation, features, dense scores, calibrated gates and ranking. They exclude frame/candidate construction, retrieval, actor, tools, environment and network. Repeated states are timing samples, not independent tasks. Component speed does not imply the same end-to-end latency gain.

## Selection, exposure and reproducibility

The tau data and native evaluator come from pinned tau3 revision `2174a603f6d014ef94473ffa95957f6ce27100db`, version 1.0.1, with this project's frozen agent scaffold. This is a selected test subset, not a full leaderboard reproduction or the original 2024 tau-bench version. Selected task IDs: `{"airline": ["2", "29", "37", "48", "22", "30", "44"], "retail": ["26", "33", "27", "45", "17", "56", "9"]}`.

Selection used deterministic ID-only SHA ordering before loading private answers. Twelve IDs used directly in prior live trials or controller training, selection and calibration were excluded. Existing normalized-request groups excluded known template relatives; these proxies are not official genealogy. All 164 official base-task IDs had previously appeared in public replay artifacts, including all selected tasks. The cohort is held out from direct controller fitting and prior live execution, but is not pristine project-wide held-out data. No claim is made that every selected task is semantically independent of all custom training tasks.

The controller, policy, memory, goal protocol and runtime remained frozen for this cohort. No fitting or threshold tuning is performed by this report generator. The embedded selection audit documents source hashes, ancestry limitations, prior exposure, native versions and model identities.

Primary sources: [pinned tau source](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db), [pinned BFCL source](https://github.com/ShishirPatil/gorilla/tree/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000), and [APIGen dataset card](https://huggingface.co/datasets/Salesforce/APIGen-MT-5k/blob/main/README.md).

## Cost and retained uncertainty

Across the full local project ledger, settled logical-request usage is USD 67.244078. Conservative spent or reserved accounting is USD 143.001562 against the original USD 500 ceiling, with 55 unresolved requests retaining their allowances. These estimates are not an invoice reconciliation. Reserved maxima already include known child usage and must not be added to the known subtotal again. The project total also includes earlier development and failed iterations.

The official cohort's observed response-usage subtotal is USD 11.487376, including known successful responses within unresolved logical requests. The subtotal for fully settled trials is USD 11.405553, with 1 trials carrying unknown charges. These have different accounting boundaries from the cumulative ledger: a successful retry can contribute observed response usage while an earlier failed attempt keeps its logical request unresolved and absent from the settled ledger subtotal. Do not add cohort response usage, settled-trial subtotals and cumulative ledger totals together or call any of them reconciled invoice charges.

| Allocation | Ceiling USD | Known usage USD | Spent or reserved USD | Unresolved requests |
| --- | --- | --- | --- | --- |
| infrastructure | 35.000 | 0.000 | 0.000 | 0 |
| preparation | 30.000 | 7.930 | 7.930 | 0 |
| training | 60.000 | 1.378 | 1.378 | 0 |
| development | 40.000 | 9.890 | 14.505 | 4 |
| heldout | 240.000 | 36.922 | 108.065 | 51 |
| replay | 30.000 | 11.123 | 11.123 | 0 |
| contingency | 65.000 | 0.000 | 0.000 | 0 |

## Source artifacts

`report.json` preserves detailed metrics and methods; `metrics.csv` exposes numeric values; `manifest.json` binds output and input hashes. The generator makes no provider calls and changes no scores.

| Input | SHA256 | Path |
| --- | --- | --- |
| tau | `a94d0ad6cbba4281e24dab7fc28893d1a338c9e780ea4984ea7c9c8c80d38dd0` | [report.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-official-v4-analysis-20260916/report.json) |
| bfcl | `7e4cebc42f2736dcab6fa213b6c8b157cb689ec50b2d366a70d8a1034ec8e57b` | [report.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-bfcl-v4-analysis-20260916/report.json) |
| apigen | `c268b17d8d2b0d7fbc428edfe74cd47c4f9eeb3ada7001828a011818713e8a25` | [report.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-apigen-controller-replay-20260916/report.json) |
| cpu_initial | `bd1491996dce639c80c781a1ec739f19cfd74d8a1cb8f20795729cae1a3395da` | [latency.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-component-benchmark-20260916/latency.json) |
| cpu_isolated | `80a9e10364a03d1bbd9176438d983f806bd2225616cf84ec6644759745737b55` | [report.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-component-isolated-20260916/report.json) |
| budget | `89f908527c3ffcaab2d60740776a838daee45e6d1061c63a350564106fcf2133` | [local-benchmarks-v4-budget-final-20260916.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-benchmarks-v4-budget-final-20260916.json) |
| tau_manifest | `1fb56f2d59b5602cf6d63ffb8d08283ff5301570b3315c69e4ad15624f381f2e` | [manifest.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-official-v4-analysis-20260916/manifest.json) |
| apigen_manifest | `ad05f90b849d7676e1d9e2696f887214d31c83f9bb0d35f45b0d79e98766be60` | [manifest.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-apigen-controller-replay-20260916/manifest.json) |
| cpu_initial_context | `b1b1765c8cc0fa1de18cdb44480b2fcfae790704fa873334cfa6e3d84588fd89` | [context.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-component-benchmark-20260916/context.json) |
| bfcl_integrity_receipt | `4d9bdbbc45f9004a6c03a775450d163414dbd216ec234fb1fbf5225fac75a245` | [integrity-receipt.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-bfcl-v4-analysis-20260916/integrity-receipt.json) |
| cpu_isolated_samples | `26e94107c8f5c034e695ef3d57d2154f88588e8c21e5810b5410eac0888fe55b` | [samples.jsonl](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-v4-component-isolated-20260916/samples.jsonl) |
| bfcl_error_audit | `9c7b5573a997d99c6e196c0aa4d01a879719b770c2032f576461b520d0422e9e` | [error-audit.json](C:/Users/apexs/derya-crm-memory-main-20260908/research/goalspec/runs/local-bfcl-v4-analysis-20260916/error-audit.json) |
| generator | `8a914a23dd82594de6f1b03cdcebb41a432d66a613dcdafe8104f998359295cc` | [final_report.py](C:/Users/apexs/derya-crm-memory-main-20260908/outputs/goalspec-benchmarks-tools/final_report.py) |
| readme_template | `7a91a545aabbc68eb0b08775ef0dd1452ab4a7c5c2b011abd242ff354aa8e44b` | [README.template.md](C:/Users/apexs/derya-crm-memory-main-20260908/outputs/goalspec-benchmarks-tools/README.template.md) |
