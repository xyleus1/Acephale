# GoalSpec v5 implementation and evaluation

## Final closed results, 2026-09-17 UTC

All declared paid cohorts are closed. V5 remains experimental and opt-in. The implemented changes did not establish an improvement across task accuracy, physical work and latency. The selected confirmation policy used `actorContext=literal` and `goalConditioning=false`, so its result is not evidence of a live inferred-goal benefit. Derya verified reuse remains off after the failed performance gate.

The six-task public official native subset ran two trials in each of three arms. Base passed 11/12, frozen legacy v4 passed 12/12, and selected literal-context v5 passed 10/12. Mean live interaction was 45.440, 46.863 and 49.140 seconds; physical tool calls were 62, 71 and 59. All 36 clocks were valid and no arm started speculative reads. V5-minus-Base success was -8.33 percentage points, with a family-clustered 95% interval [-33.33, +16.67]; latency was +3.700 seconds [-5.211, +14.055]. Fewer total calls did not improve calls per successful task: Base 5.636 versus v5 5.900. Small public exposed task samples, model-generated user variation and the custom pinned judge preclude full-benchmark, pristine-heldout, causal or SOTA claims.

The final frozen prediction replay retained all 16 prefixes, including one missing independent annotation, and all 128 ranker rows. On six read opportunities, active memory improved same-pool exact Top-1 from 1/6 to 3/6; inferred goals remained 3/6, with exact Top-3 4/6. Five of six exact invocations were in the shared pool. All controls selected NO_READ correctly on 10/10 non-read opportunities. Strict complete-atom goal Top-1 and Top-3 were 0/16; every predictor emitted one grounded goal. An independent audit found no parsing or scoring defect: 15 graded rows covered 79/119 required atoms, and all missed at least one. Ambiguous teacher annotations and the strict completeness rule mean this is not zero recognition of the main intent. Training agreement of 29/100 uses a different cohort and must not be treated as a paired change.

At matched temperature 0.75, the goal residual changed no accuracy and increased coarsened next-read log loss by 0.000222 nats, 95% interval [-0.000156, +0.000666]. The primary composite comparison's -0.024607 nats mixes residual and temperature effects. The loss predicts read candidates, NO_READ and READ_UNCOVERED, not exact native writes or true conditional entropy. Provenance rejection of shuffled goals is a separate guard check, not proof that plausible but wrong current goals are harmless.

Derya's 36 synthetic read trials were all correct, 12/12 in every arm, with 12 tool reads and 102 SQL statements per arm. Base, neutral and goal-context mean times were 3.037, 3.508 and 3.353 seconds. Goal context added 12 provider attempts and was +0.316 seconds slower than Base, 95% paired interval [+0.021, +0.584]. Shared tools and fixture state limit that 12-family interval. The separate BFCL conditioning probe scored 28/32 direct versus 27/32 with goals, with mean times 3.523 versus 4.705 seconds; the paired accuracy difference was -3.125 percentage points [-15.625, +6.250]. Neither probe establishes full-runtime or production performance.

All prior interrupted attempts and original grades remain intact. Development retained 16 slots, seven host failures and nine valid clocks; its unequal coverage weakened literal-policy selection. The final native failure audit describes simulator-target/refund differences and an overly broad modification-policy interpretation without rescoring or attributing causality to the ledger. Native clocks include actor/user interaction and acknowledged per-trial drain, but exclude setup, source checks, artifacts and shared startup/shutdown; judge time is separate.

Cumulative accounting is USD 79.537568 known settled request usage and USD 166.891414 spent or conservatively reserved, with 56 unresolved requests, against the original USD 500 ceiling. The v5 incremental known usage is USD 12.293490 relative to the prior closed cumulative ledger. These are not invoice charges; native missing telemetry, response usage and outstanding reservations are distinct. No AWS resources were used.

Final results and source hashes: `research/goalspec/reports/2026-09-16-v5-local/`. Detailed, separately hash-bound interpretation and component/interruption/failure/replay audits: `research/goalspec/runs/local-v5-final-interpretation-20260916/`. Final reporting verification passed 15 focused Python tests; the previously closed six Node replay tests cover shared pools and actual matched temperatures. Source/grid/event checks are recorded in each report manifest. No additional provider call or grade change was made for synthesis. The checkpoints below are preserved historical records.

V5 keeps the actor fixed and changes prediction, memory, actor context and read validation. It runs locally. No AWS resource or executor fine-tuning job is required. Experimental research arms are compositions of one runtime, not user-facing application modes.

Status at the closed training/calibration checkpoint on 2026-09-16: the 40 Base training trials, 100-prefix annotation pilot, local controller fitting and 40-pattern repository publication are complete. Development and confirmation results are pending. None of the training or component numbers below establishes a live GoalSpec improvement. Earlier v3/v4 results and archives remain unchanged.

Subsequent checkpoint, after development closure: all 16 development slots are retained, including seven host-interrupted failures; nine trials have valid clocks. The declared selection rule chose the literal-context v5 arm, with `actorContext=literal` and `goalConditioning=false`. Confirmation is active on six official tasks, two trials and three arms, 36 trials total. No confirmation result or performance conclusion is available yet. The development interruption and unequal completed coverage qualify the selection, as detailed below.

## Prediction and memory

`session-v5.ts` uses a bounded 128-candidate pool, then ranks at most three reads. A joint distribution includes two separate alternatives: `NO_READ` and `READ_UNCOVERED`. Deterministic eligibility and expected cost/latency checks remain outside the learned ranker. The former learned readiness and usefulness gates are not multiplied together.

The controller score is a neutral score plus a goal correction multiplied by calibrated goal reliability. Unsupported references, stale requirement revisions and unavailable calibration force reliability to zero. A literal-request proxy is labeled as a proxy and cannot establish teacher agreement. Goal dropout, shuffled goals and identical-pool controls remain explicit diagnostics.

The v5 memory profile admits verified historical training episodes and failures, complete public observations, transitions and recurring confusions. It excludes development, confirmation and current-family traces. Compatibility includes tenant, principal, authorization, environment and tool-schema scope. Historical entity values never establish a current argument binding.

## Actor context

The actor retains original user messages, real tool-call IDs, actual observations and required opaque continuation items. Only historical derived GoalSpec notes are removed. A current literal obligation ledger can be supplied separately. Inferred hypotheses are explicitly experimental and never establish authorization, a successful mutation or task completion.

The obligation ledger records current and earlier user statements, literal qualifiers, source revisions, reported tool receipts and unresolved interpretation separately. Affirmative or negative language is observed text, not server authorization. Changing a requirement invalidates stale derived context while preserving original messages. The existing v4 actor compiler remains explicitly selectable as `legacy`; v5 uses `current-only`. The native simulator's stop sentinel and termination rules are unchanged. A ledger cannot guarantee correct intent interpretation or prevent a simulator from stopping after consent.

Derya retains its GPT-5.6 actor, generic six-round loop and specialized branches. Trusted server configuration can select the v5 implementation through `GOALSPEC_DERYA_V5_CONFIGURATION_FILE`. That JSON names a validated controller artifact, optional compatible business memory, actor-context policy and complete measured utility estimates. Native benchmark weights have not been calibrated for business tasks.

## Audited reads

The authoritative and speculative wrappers share projection and authorization code for `search_jobs`, `search_inquiries`, `search_companies`, `get_job` and `list_open_inquiries`. Results have deterministic ordering. A denied freshness validation is terminal and cannot fall back to a read using stale authorization. Mixed mutation batches continue to invalidate speculative evidence.

The epoch experiment covers nine dependency tables and checks trigger definitions, table topology, role privileges, transactional counters, database identity and restart incarnation. Verified reuse requires a pinned correctness/performance receipt for each permitted tool. The default remains full reread validation.

The first isolated local profile passed 100 independent scenario equivalence checks. Across 200 paired samples per tool, `get_job` validation p95 fell from 14.44 to 9.44 ms, but all four search validations became slower. The largest measured writer p95 overhead was 16.55%, above the predeclared 5% gate. No production reuse receipt was issued. These component timings do not establish an end-to-end latency gain.

The closed receipt is `research/goalspec/runs/local-v5-derya-profile-20260916/report.json`: `verifiedReuseEnabled=false`, `productionMode=off`. Business-read live trials remain a separate synthetic application study, not a native benchmark or validation of native-trained weights for Derya.

## Closed training and annotation findings

The custom native training cohort retained all 40 Base episodes across 20 composition families and two variants. Base completed 36/40 tasks, with a family-clustered 95% interval of [80%, 97.5%]: retail 19/20 and airline 17/20. Mean live interaction was 30.625 seconds [28.047, 33.560], with p95 43.886 seconds over all 40 trials. It used 198 physical tool calls and USD 2.016866 recorded request usage. There were no unknown trial charges, host interruptions or invalid timing samples. These are collection diagnostics from the Base actor, not a GoalSpec treatment score. Source: [closed training report](../../research/goalspec/runs/local-v5-training-report-20260916/README.md).

The predeclared learning split assigns 12 fresh families to fitting, four to selection and four to calibration. Only the 24 episodes from the 12 fitting families can enter fresh memory or positive pattern mining; the other 16 remain outside the runtime library. The publication contains 40 patterns supported by 21 successful verified fitting episodes. All 40 collected episodes, including the four failures, remain in the original training artifacts. Publication and import receipts are in `research/goalspec/runs/local-v5-library-publication-20260916/`; the source/mining summary is `research/goalspec/runs/local-v5-library-20260916/summary.json`. The new research snapshot is `native-training-v5-20260916`, separate from application data and prior frozen snapshots. Embeddings remain `text-embedding-3-small`, 1,536 dimensions.

The annotation pilot retained its original 100 train-only public prefixes and family assignments. It produced 98 completed independent grades and two missing grades: strict complete agreement was 29/100 selected prefixes, while overall-goal agreement was 48/98 graded prefixes. Required identity atoms were covered in 71/119 instances. Overlapping diagnostics recorded 52 missing/contradicted required-atom cases, 30 unsupported predictions, eight stale predictions and 25 ambiguous predictions. These flags are fallible teacher judgments, not independent task verdicts. Missing labels remain masked for fitting. See `research/goalspec/runs/local-v5-annotation-diagnosis-20260916.json`.

Host-interrupted annotation attempts were preserved. Continuations could fill only original slots with no physical provider attempt across the entire prior chain; they never replaced an attempted incomplete response or selected a new prefix. The final canonical cohort is `research/goalspec/runs/local-v5-annotations-continuation-c-20260916/`. The original runs, intermediate continuations, unknown-charge reservations and source archives remain available.

The final conditional controller freezes the refitted neutral weights and learns only the goal residual. Its prespecified reliability bin contains one strict agreement among 19 completed calibration prefixes, giving a Laplace-smoothed reliability of 2/21, approximately 0.09524. Those correlated prefixes come from two families; they do not establish reliable unseen-family semantic calibration. Neutral temperature is 1.0 and goal-active temperature is 0.75. Consequently a full-policy versus neutral cross-entropy comparison can include calibration-temperature effects, even when both use the same artifact. A pure residual interpretation requires an explicitly matched-temperature diagnostic. Source and partition identities are bound by `research/goalspec/runs/local-v5-model-pipeline-20260916/lineage-receipt.json`; calibration details are in its sibling `conditional/report.json`. Local controller fitting is not fine-tuning the hosted actor or teacher, and the earlier model-soup experiments did not establish a soup benefit.

## Current native component calibration

The old utility timing constants were checked against the actual v5 projection-snapshot path. The isolated zero-provider profile selected the first three distinct audited reads before any mutation in variant zero of each of the 12 fresh fitting families. It retained 31 cases and two measured repetitions each, with one warmup per case/path. All 62 native observation, call-ID and authoritative-state parity checks passed. The real Node policy rejected six of the 62 gateway samples before dispatch because speculative prerequisites were not yet satisfied; no case was replaced. See `research/goalspec/runs/local-v5-native-component-profile-20260916-c/report.json` and its raw sample files. Earlier diagnostic attempts remain preserved in the unsuffixed and `-b` directories.

| Measured component | Mean milliseconds | Sample count |
| --- | ---: | ---: |
| Direct authoritative native read | 0.1656 | 62 |
| Projection snapshot read | 0.7315 | 62 |
| Projection lease refresh | 0.1086 | 62 |
| Projection local consumption | 0.1650 | 62 |
| Full-fixture snapshot read | 1.5604 | 62 |
| Node gateway read with policy | 8.4124 | 56 |
| Node gateway refresh with policy | 5.9305 | 56 |
| Scheduler overhead beyond read/refresh | 0.9839 | 56 |
| Current graph plus local controller | 3.4609 | 56 |
| Literal ledger/context construction | 0.9942 | 56 |

Using paired eligible reads gives `toolMs=0.166104`, `validationMs=6.100609` (gateway refresh plus local native consumption), `schedulingMs=0.983930`, `predictionMs=3.460948` and `contextMs=0.994243`. Zero contention is an explicitly optimistic lower bound, not a measured loaded-host estimate. Exposure benefit remains zero because no causal benefit was measured. Even at candidate probability one, this component-only calculation gives a saving of -11.373627 ms. It supports abstention for this workload; it does not prove early evidence can never avoid an actor round. Common actor compilation was separately measured at 35.107 ms mean and 57.057 ms p95; the utility context term covers literal-ledger CPU only, not added provider tokens or network time.

These repeated component samples use small generated training databases and their actual candidate pools. They do not establish timing on the larger official environment, causal exposure benefit, loaded contention or end-to-end speedup. Memory retrieval and remote prediction are not included in the graph/controller component measurement. The profile changes no runtime source, authorization rule, model weight or original score.

## Frozen studies and budget

The new study uses 40 Base training episodes from 20 predeclared composition families, with four families reserved for calibration, followed by four distinct development families. Development compares Base, the prior v4 policy, literal v5 context and experimental v5 hypotheses. Confirmation compares Base, v4 and the once-selected v5 policy on up to 12 balanced official retail/airline tasks, with two trials per arm. Native simulator stop rules and independent evaluation remain unchanged.

Research actor and annotation teacher remain `gpt-5.4-2026-03-05`; actor reasoning is `medium` with a 4,096-output-token cap. Goal prediction and native user simulation remain `gpt-4.1-mini-2025-04-14`, capped at 1,024 output tokens. Native judging uses the pinned teacher and therefore differs from the upstream default judge. The v4 comparison is its frozen legacy policy executed within the common v5 harness, not pooled historical outcomes or a new upstream PASTE/Salesforce reproduction.

Every cohort reserves its complete paired design before dispatch. The confirmation size uses development costs only; failures are retained and never replaced. Sources, inputs, actor configuration, memory and controller are frozen. Official task subsets are historically public-exposed and do not constitute a full official leaderboard reproduction. Fresh generated compositions are a custom tau-compatible pilot.

Host health is recorded at native execution, actor/user drain and trial closure. Host-interrupted trials remain failures in task denominators. Their raw clocks are preserved while explicitly invalid timings are excluded from primary latency means, tails and paired intervals, with measured/missing counts shown. Live interaction includes native execution, serialization and acknowledged per-trial actor/user drain; source checks, task/environment/agent construction, artifact persistence and shared startup/shutdown remain outside that clock. Judge execution and drain are reported separately.

The final 16-prefix replay is prepared but has not run. Tool/full-argument Top-1 and Top-3 concern audited reads only, on identical candidate pools. Its category loss is a coarsened next-read decision/set-event loss over pool reads, `NO_READ` and `READ_UNCOVERED`, not full native next-action log loss over writes. Correct `NO_READ` or `READ_UNCOVERED` decisions do not earn exact write or uncovered-argument credit. Teacher hints are fallible; shuffled provenance rejection and separate feature-corruption sensitivity have distinct meanings. Two additional local sensitivity controls set both neutral and goal-active temperatures to the frozen goal temperature0.75, with identical weights, current-goal context, memory and candidate pool. Their paired comparison isolates the residual at that temperature; the five primary frozen-policy controls remain unchanged. The diagnostic override is recorded and never enters live runtime. Six focused Node tests and 14 Python report/replay tests passed after development closed, including applied-temperature probability checks and unchanged input/weight assertions. The BFCL direct-versus-goal-context probe is likewise pending and is an isolated synchronous conditioning diagnostic, not a full GoalSpec runtime benchmark.

## Development interruption and active confirmation

The closed development cohort retains Base 1/4, legacy v4 2/4, literal v5 3/4 and hypotheses v5 2/4 successes. It was not repeated. Windows Modern Standby records show a laptop-lid entry at 2026-09-16 23:08:14.945 UTC and lid wake at 2026-09-17 00:27:12.212 UTC. The guard recorded a 5,500 ms degraded heartbeat gap beginning at 23:08:21.691705 UTC, with a later maximum gap of 4,726,953 ms. This is documented host suspension, not evidence that concurrent analysis caused the interruption. The independent receipt and Windows event export are in `research/goalspec/runs/local-v5-development-interruption-20260916/`.

| Development arm | Successes / all slots | Host-interrupted failures | Valid live timing n | Mean valid live seconds |
| --- | ---: | ---: | ---: | ---: |
| Base | 1/4 | 2 | 2 | 42.526 |
| Legacy v4 policy | 2/4 | 2 | 2 | 34.819 |
| Literal-context v5 | 3/4 | 1 | 3 | 50.216 |
| Hypotheses-context v5 | 2/4 | 2 | 2 | 43.047 |

All seven interrupted slots remain task failures. Their raw clocks are preserved, but only the nine valid samples enter primary latency statistics. These means have unequal and very small completed coverage; they are not evidence of a reliable literal-context win. The literal arm was selected once under the declared rule, with the interruption explicitly retained as a limitation. The fixed 16-slot report, intervals and source/event integrity checks are at `research/goalspec/runs/local-v5-development-report-20260916/`.

Recorded known response/request usage totals USD 0.751542. Six unstarted rows have null native trial-cost and physical-call telemetry. The generic report's `unknownChargeTrials` field conservatively includes those missing native costs; it must not be read as six newly unresolved provider requests. The shared ledger recorded no new unresolved requests from development, with 56 historical unresolved requests unchanged. Provider ledger reservations and native missing telemetry are separate accounting facts.

Because development was censored, the frozen confirmation allowance is USD 2.50 per trial. The active cohort reserves all 36 trials across six tasks, balanced between retail and airline, two repetitions and three arms, for a USD 90 maximum. Its selected v5 arm uses literal obligations and neutral ranking with `goalConditioning=false`; inferred goals are not exposed as the selected intervention. A result from this cohort must be labeled a comparison of that selected literal-context policy, not evidence that inferred goal conditioning improved live task performance. Original native stop/evaluation behavior, source/input freezing, complete failure retention and public-task exposure caveats remain in force. Confirmation results and the final conclusion await whole-cohort closure.

The additional ceilings are preparation $18, training $50, development $25, confirmation $90, business-read trials $30 and replay $15: at most $228, within the original $500 ledger and protected infrastructure/contingency allowances. Existing uncertain charges remain reserved. A failed annotation startup was retained with zero provider dispatches after a host heartbeat interruption; it is not a model-accuracy result.

## Architectural lineage

The referenced systems remain [PASTE, revision 3](https://arxiv.org/abs/2603.18897v3) and Salesforce's [Speculate with Memory](https://arxiv.org/abs/2607.12236v1). APIGen is a separate dataset. Hosted model APIs do not expose PASTE's GPU scheduling controls, and these local implementations are not verified author reproductions. See [the source audit](V3_SOURCE_AUDIT.md) for the component comparison. Goal conditioning is an experimentally tested correction, not a guarantee of higher accuracy or lower latency.

The final measured study report will distinguish training diagnostics, prediction replay, real database component timing, live native performance and BFCL goal-context probes.
