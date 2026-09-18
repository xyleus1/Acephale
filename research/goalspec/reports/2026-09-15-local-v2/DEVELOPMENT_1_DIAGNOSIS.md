# Development round 1: infrastructure-limited cohort

All **24 declared trials failed**, with **0/8 successes in each arm**. All outcomes remain in the [stage report](development-1-analysis/README.md), including the 21 trials that failed before receiving a user message. This round provides no evidence of a task-success or latency improvement.

| Arm | Success | Mean native ms (n=8) | Mean total s (n=8) | Mean drain s (n=8) | Known usage USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Base | 0/8 | 5,372.242475 | 5.401206 | 0.028960 | 0.010841 |
| Neutral memory prefetch | 0/8 | 24.332500 | 0.056446 | 0.032110 | 0.000000 |
| GoalSpec | 0/8 | 10,766.882800 | 10.798836 | 0.031950 | 0.013314 |

Native time ends before managed-worker drain. All recorded drains succeeded; total service wall time was 66.724920 seconds. The near-zero trial times reflect early infrastructure failures, so the numerical paired timing differences do not establish an arm speed advantage. All success contrasts and their empirical family bootstrap intervals equal zero because every observed outcome failed; these degenerate intervals are not evidence of general equivalence.

The first three native orchestrations also wait for the Node service to reconstruct its ledger and finish booting. This startup wait is included in their native and total trial times. The first dispatched arms in this round were two GoalSpec trials and one base trial, so startup overhead was not balanced across arms. No startup time has been subtracted or any observed timing rewritten. The separate service wall-time measurement includes the whole service phase.

The [host guard log](../../runs/local-v2-development-1-host-20260915/events.jsonl) first records `guard_error` at **2026-09-15 18:31:26.027537 UTC**. Its final record identifies `PermissionError`, child exit code 0, guard exit code 70, and released execution-state ownership. The final host status also contains `guard_closed` and `heartbeat_gap`. Recorded network-connected flags stayed true, but those flags do not verify provider endpoint reachability.

The provider event log contains **seven completed model responses and one completed embedding request**, costing **$0.024155** at configured usage prices. It contains no `model_attempt_failed` or `embedding_failed` events, no refusal, and no incomplete response. The native outcome totals and independently summed event costs agree; **zero trial costs are marked unknown**. These are usage-priced amounts, not invoice-reconciled charges.

| Provider role | Known usage USD |
| --- | ---: |
| Actor | 0.021096 |
| Simulated user | 0.000795 |
| Goal prediction | 0.002263 |
| Embedding | 0.000001 |
| Candidate prediction | 0.000000 |

Only three trials received an initial user message, and only two recorded a model-generated actor reply. All authoritative tool executions, speculative reads, exact-call promotions, scheduler rejections, and freshness checks are zero. Every native termination is `execution_error`.

Two GoalSpec prediction cycles started and settled; both recorded a generic `Error` failure after the guard degraded. The log does not retain the exception message, so it cannot identify the precise failed operation in each cycle. One cycle reached candidate compilation, then produced no candidate provider response. The second has no completed embedding event. The timing is consistent with new dispatch being blocked by the unhealthy guard while already-dispatched requests finished, but request-level cause is an inference rather than an explicit error record.

Both saved actor decision contexts are structurally valid initial unknown GoalSets; neither shows an adopted nonunknown goal. Separately, two compact goal responses were recorded without goal contract-rejection events. The first correctly reflects a vague request to modify reservation `G116192901A`; its public source did not yet specify which changes. The other response retains the concrete reservation and flight IDs, May 21 date, economy cabin, one bag, $40 Visa charge, surname correction, passenger first name and DOB, and the instruction to preserve the other reservation. This is useful protocol evidence, but no new teacher semantic score was collected, and it does not establish live benefit.

The raw host log, native records, and provider events remain unchanged. Round 1 remains consumed under the study plan. Any round 2 result must be reported separately, with the host repair disclosed.

Round 2 reuses these same four development family IDs and compositions with fresh instances and seeds. It is not a separate set of independent families, and the two rounds must not be pooled as eight family clusters. Confirmation families remain disjoint.
