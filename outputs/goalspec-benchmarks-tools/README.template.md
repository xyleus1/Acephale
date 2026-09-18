# GoalSpec v4 benchmark results

These measurements cover different capabilities and are not combined into one score. Official task success is the primary live result; BFCL tests actor tool-call generation, APIGen tests frozen controller transfer, and CPU timing measures the local controller component. Improvements in one do not establish superiority in the others.

## Official tau task subset

All 112 declared trials are retained: 14 official test tasks, seven retail and seven airline, two trials per task, four arms, 28 trials per arm. The actor is `gpt-5.4-2026-03-05`, medium reasoning, maximum output 4,096 tokens; the native user simulator is `gpt-4.1-mini-2025-04-14`. The native evaluator's model-based judge also uses the configured annotation-teacher snapshot `gpt-5.4-2026-03-05`; this differs from the pinned upstream default judge, `gpt-4.1-2025-04-14`. PASTE and Salesforce are local paper-based controls, not verified reproductions of upstream systems.

$native_table

Pass1 is successful native executions divided by every declared trial. Two-trial consistency is the fraction of tasks whose two executions both succeeded, not success at least once or squared pass1. Success requires native reward 1 and valid native termination. Failures, budget stops and incomplete runs retain their original grades. Intervals are pointwise 95% task-cluster bootstrap intervals, resampling both trials together. They are not adjusted for multiple comparisons. With only 14 task clusters overall and seven per domain, intervals are limited by the observed sample; a uniform sample can produce a zero-width bootstrap interval without establishing population certainty.

$domains

GoalSpec paired differences use the same task instances and trial seeds; latency differences below are in seconds and accuracy differences are percentage points (pp). A positive GoalSpec-minus-control latency difference means GoalSpec is slower. A positive success difference means GoalSpec succeeds more often.

$paired_table

## Live latency and physical work

$timing_table

Live latency includes prediction, actor orchestration, tools and acknowledged per-trial actor/user drain. Service startup and the final shared service shutdown are outside each trial clock. Native judge time is reported separately and is not counted as live latency. The p95 is the observed tail over the displayed number of measured trials; it is not a population-tail guarantee. Missing timing is never replaced with zero.

$calls_table

Physical attempts count authoritative and speculative native tool executions, including executions in failed trials. All attempts per successful task uses the complete cohort numerator divided by successful executions. Requested authoritative calls can be satisfied by promotion; they are not a substitute for measured physical executions. Nested snapshot wrappers are excluded. Lease checks are added validation work, separate from physical tool executions. Consumed promotions are a lower bound on useful speculation; exposed evidence can change subsequent behavior, so every unpromoted call is not automatically waste. Unavailable totals remain unavailable when telemetry is incomplete.

$native_diagnostics

Tool non-error rate is not task success, policy compliance or next-tool accuracy. Reference recalls compare one upstream annotated action sequence and do not establish that other valid paths are incorrect. Assertion coverage is relevant only where the native reward basis requires assertions. Complete reward, coverage, failed-assertion, termination and speculation diagnostics remain in `report.json` and the native source report.

## BFCL actor component

$bfcl_table

This is the pinned BFCL multiple/irrelevance subset, 32 cases per category, evaluated with the official AST checker. There are $bfcl_failed failed predictions and they remain incorrect in the denominator. It uses the same research actor configuration, but no GoalSpec goals, memory, scheduler or native tool execution. It is neither an overall BFCL score nor a comparison between GoalSpec, PASTE and Salesforce.

$bfcl_error_audit

## APIGen frozen-controller transfer

The full source corpus contributes $apigen_checkpoints public-prefix checkpoints; $apigen_unknown have unknown labels after source catalog or argument validation and remain disclosed in coverage. Label-dependent read metrics use known read actions; NO_READ specificity uses known non-read actions. Both rankers receive the identical candidate pool.

$apigen_table

$apigen_change_text

Ungated top-k measures ranking. Gated exact Top-1 additionally requires the frozen READ, useful-within-two and learned readiness gates. These imitation gates do not establish authorization or causal usefulness. Formatting splits in source tapes can change NO_READ frequency. Candidate coverage limits what any ranker can recover; this is not native task success, an APIGen actor evaluation or proof of executed-tool correctness.

The complete report retains domain results, catalog-clean sensitivity, duplicate counts, 95% provisional action-family intervals and cross-entropy estimates. Those intervals do not certify independent held-out task families. Normalized candidate-score cross-entropy is an estimate, not true conditional entropy. Research-only CC BY-NC 4.0 lineage and source-reported verification remain separate from independent replay verification.

## CPU component timing

$cpu_table

Both runs are retained. The first ran alongside other analysis; the isolated rerun followed a fixed protocol of five full warmup passes and five measured passes over 643 states, retaining all 3,215 measured samples. It was not the best pass selected after measurement. These samples time `LocalController.decide`, including validation, features, dense scores, calibrated gates and ranking. They exclude frame/candidate construction, retrieval, actor, tools, environment and network. Repeated states are timing samples, not independent tasks. Component speed does not imply the same end-to-end latency gain.

## Selection, exposure and reproducibility

The tau data and native evaluator come from pinned tau3 revision `$upstream_revision`, version 1.0.1, with this project's frozen agent scaffold. This is a selected test subset, not a full leaderboard reproduction or the original 2024 tau-bench version. Selected task IDs: `$selected_ids`.

Selection used deterministic ID-only SHA ordering before loading private answers. Twelve IDs used directly in prior live trials or controller training, selection and calibration were excluded. Existing normalized-request groups excluded known template relatives; these proxies are not official genealogy. All 164 official base-task IDs had previously appeared in public replay artifacts, including all selected tasks. The cohort is held out from direct controller fitting and prior live execution, but is not pristine project-wide held-out data. No claim is made that every selected task is semantically independent of all custom training tasks.

The controller, policy, memory, goal protocol and runtime remained frozen for this cohort. No fitting or threshold tuning is performed by this report generator. The embedded selection audit documents source hashes, ancestry limitations, prior exposure, native versions and model identities.

Primary sources: [pinned tau source](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db), [pinned BFCL source](https://github.com/ShishirPatil/gorilla/tree/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000), and [APIGen dataset card](https://huggingface.co/datasets/Salesforce/APIGen-MT-5k/blob/main/README.md).

## Cost and retained uncertainty

Across the full local project ledger, settled logical-request usage is USD $known_cost. Conservative spent or reserved accounting is USD $reserved_cost against the original USD 500 ceiling, with $unresolved unresolved requests retaining their allowances. These estimates are not an invoice reconciliation. Reserved maxima already include known child usage and must not be added to the known subtotal again. The project total also includes earlier development and failed iterations.

The official cohort's observed response-usage subtotal is USD $cohort_observed_usage, including known successful responses within unresolved logical requests. The subtotal for fully settled trials is USD $cohort_settled_trials, with $cohort_unknown_trials trials carrying unknown charges. These have different accounting boundaries from the cumulative ledger: a successful retry can contribute observed response usage while an earlier failed attempt keeps its logical request unresolved and absent from the settled ledger subtotal. Do not add cohort response usage, settled-trial subtotals and cumulative ledger totals together or call any of them reconciled invoice charges.

$allocation_table

## Source artifacts

`report.json` preserves detailed metrics and methods; `metrics.csv` exposes numeric values; `manifest.json` binds output and input hashes. The generator makes no provider calls and changes no scores.

$source_table
