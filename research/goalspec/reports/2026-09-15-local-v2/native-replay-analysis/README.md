# Native execution replay

All 32 recorded speculative-arm tapes (16 neutral and 16 GoalSpec) replayed against fresh native states with identical tool observations and final database states. All 48 original confirmation rows are retained in coverage; 16 base-arm rows have no candidate session and are explicitly excluded from this replay. Original success and termination values remain unchanged. No provider calls or paid inference occurred.

The source audit verified 572 candidate events: 147 originally admitted and replayable, and 425 excluded admissions (402 invalid/low-confidence/already-observed, 23 original scheduler rejections). The replay scheduler received 147 candidates across 263 actor boundaries, admitted 125 and rejected 22. Thirty of 32 tapes had at least one admitted candidate. Every event chain, service-manifest ownership, source binding, immutable design, fixture and final runtime hash check passed.

| Native physical behavior | Neutral (16 tapes) | GoalSpec (16 tapes) |
| --- | ---: | ---: |
| Authoritative tool calls, including writes | 58 | 79 |
| Physical authoritative reads | 37 | 57 |
| Physical speculative reads | 65 | 45 |
| Total physical reads | 102 | 102 |
| Exact native lease consumptions | 26 | 10 |
| Unmatched speculative reads | 39 | 35 |
| Native freshness lease checks | 85 | 57 |
| Physical revalidation calls | 0 | 0 |

Native speculative executions total 110, while scheduler `physical_read_completed` events total 125. They retain separate denominators; scheduler job completion is not automatically a native read execution. Exact consumption is a lower bound on broader evidence usefulness, and unmatched speculation an upper bound on waste.

| Local replay duration | Neutral (n=16) | GoalSpec (n=16) |
| --- | ---: | ---: |
| Mean ms | 241.298481 | 457.790231 |
| Median ms | 238.776300 | 246.257100 |
| Observed p95 ms | 327.146225 | 1243.516625 |
| Maximum ms | 355.070000 | 3766.816700 |

These are local fixed-tape timings, with no model work. The first GoalSpec tape includes service startup (3,766.816700 ms), retained without correction. They are neither original live timing nor evidence of a comparative live speed improvement. Sample quantiles have only 16 observations per arm.

The corrected report-local adapter admits only candidates with original `admission === true`; rejected predictions never become counterfactual accepted inputs. It schedules those candidates at their numbered boundaries. Asynchronous source events do not prove their availability before the original actor decision. The reused frozen `report.json` contains legacy wording that says otherwise; `method-report.json` explicitly qualifies that inherited label. No canonical runtime, predictor, native fixture, verifier or original outcome was edited.

The replay establishes observation/state parity and measured physical reuse on fixed action tapes. It does not generate new actor decisions, evaluate the 213 legacy goals in native execution, or replace the primary confirmation result.

Detailed source-event IDs, exclusions, scope checks and coverage are in [method-report.json](../../../runs/local-v2-confirmation-native-replay-20260915/method-report.json), with the [input manifest](../../../runs/local-v2-confirmation-native-replay-20260915/replay-method-manifest.json).
