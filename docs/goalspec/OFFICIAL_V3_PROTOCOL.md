# Official-task v3 protocol

The v3 study uses unchanged retail and airline tasks from the pinned Sierra tau2-bench repository, revision `2174a603f6d014ef94473ffa95957f6ce27100db`. These are new live executions of published official tasks with configured research models. The result is an official-task subset score, not a full official leaderboard reproduction.

All 164 official task IDs were previously present in this project's historical public replay. The study records that exposure explicitly. ID selection uses a fixed hash of study ID, seed, domain, upstream split and task ID, without consulting historical outcomes. Confirmation is disjoint from v3 development, not unseen across project history. The frozen v3 memory contains only 48 custom v1 training runs and 48 custom v2 development runs; its 110 provenance files are verified and historical public benchmark traces are excluded.

The immutable study is [study.json](../../research/goalspec/runs/local-study-v3-20260915/study.json), hash `4cdb59547656e64a81760ef2f3233e90aedf8f7fba2e1889ed0c9b3f0e50bc77`. Development uses retail IDs 95 and 13 and airline IDs 15 and 39 for at most three rounds, with fresh matched seeds each round. Four arms run on each task and seed: base, PASTE, Salesforce-style speculation and GoalSpec. Architecture fidelity is documented separately from benchmark fidelity.

Each development round declares 16 trials at $1.25 per trial. One final confirmation cohort has two trials per task and four arms. Its balanced size, at most 16 tasks and 128 trials, depends only on completed development cost and the remaining heldout allocation. Any unknown or budget-censored development cost raises the minimum allowance to $2.50; with the current allocation this permits at most eight tasks and 64 trials. A consumed stage cannot be retried. Every declared failure remains in the denominator. The existing global $500 ledger and model identities remain authoritative.

The upstream task JSON, domain policies, initial databases, orchestrator, user prompt, role flipping, STOP behavior, evaluator bytecode, parsing and reward combination remain unchanged. `EvaluationType.ALL` runs with strict replay and each task's original reward basis. Retail normally combines database and natural-language assertions; airline combines database and communication assertions. The natural-language assertion evaluator runs the original prompt and parser through a separately budgeted teacher worker configured as `gpt-5.4-2026-03-05`, replacing the upstream default judge `gpt-4.1-2025-04-14`. This model difference is reported with the scores.

The common actor adapter replaces only the upstream instruction demanding a JSON-only response with the transport-appropriate instruction to use native API function calls and plain text for user-facing messages. The same actor model, reasoning setting, limits and transport apply to all four arms. This protocol correction does not change the domain policy or supply task-specific hints. Max steps is 200, max errors is 10, and timeout is 600 seconds for every arm.

Only public policy, tool schemas and public conversation messages enter the actor gateway. Full tasks, private user instructions, gold actions, assertions and reward information remain in the native Python user/evaluator lanes and local result artifacts. User and evaluator workers have no tools. Their model-port substitution preserves the upstream method bytecode, state transitions and parsing.

The Node service must acknowledge the exact immutable manifest hash after workers and cohort reservations are ready. Trial clocks start afterward. Trials run one at a time, with randomized balanced arm positions within matched task/seed blocks. Service startup is recorded separately. `latencyMs` measures native orchestration; `totalTrialSeconds` includes actor/user managed-work drain. The official evaluator runs afterward, with `evaluationSeconds` and evaluator usage reported separately. Native tool timings use `perf_counter`; actual speculative tool time is distinct from snapshot/gateway overhead. No observed time is subtracted after measurement.

Primary task success requires the original upstream reward to equal one and successful native/evaluator/drain completion. `officialReward` preserves the raw reward separately. Failed natural-language assertions are counted as `constraintViolations`; this is not an exhaustive policy-violation audit. `judgeAssertionCoverage` checks returned assertion coverage without changing the upstream verdict. The tool execution success rate counts non-error native tool responses; it is not policy compliance or precision against a single gold path. Exact gold-action recall is a separate diagnostic.

Every stage first archives runtime source bytes, study, memory, frozen records, configuration and pinned native inputs using `freeze_official_source_v3.py`. The resulting `source.zip` is compatible with the existing source verifier, while `inputs.zip` preserves the immutable inputs. The matching stage/configuration freeze is checked before the claim and again before dispatch. The legacy v1/v2 calibration parser is unchanged.

Run the source capture with the research interpreter:

```powershell
research/goalspec/.venv/Scripts/python.exe -X utf8 research/goalspec/scripts/freeze_official_source_v3.py --study research/goalspec/runs/local-study-v3-20260915 --stage development-1 --runtime-config CONFIG_JSON --output NEW_SOURCE_DIRECTORY
```

The paid stage command is run only by the authorized coordinator under the host guard, using the pinned native interpreter and shared ledger directory:

```powershell
research/goalspec/.benchmarks/tau3/.venv/Scripts/python.exe -X utf8 research/goalspec/scripts/run_official_native_v3.py --study research/goalspec/runs/local-study-v3-20260915 --stage development-1 --runtime-freeze NEW_SOURCE_DIRECTORY --runtime-config CONFIG_JSON --output NEW_STAGE_DIRECTORY --budget-directory EXISTING_SHARED_LEDGER_DIRECTORY --budget-report FRESH_BUDGET_REPORT_JSON
```

Pre-dispatch validation: 21 study/readiness/freezer/retained-failure tests pass; four checks against the actual pinned native methods pass, including user prompt/state parity, assertion evaluator prompt/parser parity, common actor transport instruction and retained service-spawn failures. Runtime/Python manifest canonicalization was checked with numeric and Unicode values. No provider calls are made by these checks.
