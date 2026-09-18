# GoalSpec v2 local architecture and evaluation

The bounded native evaluation is complete: 24 trials in each development round
and 48 in the single confirmation cohort. Confirmation success was base 15/16,
neutral memory plus prefetch 15/16, and GoalSpec 14/16. Mean total trial time,
including managed drain, was 32.755, 33.402 and 40.355 seconds respectively.
GoalSpec has not established a live success or latency advantage. The full
[v2 results report](../../research/goalspec/reports/2026-09-15-local-v2/README.md)
keeps all failures, phase-specific uncertainty and source artifacts.

One GoalSpec confirmation failure passed state and constraint checks but missed
a rigid communication regex despite explaining the fare limit correctly. Its
primary failure remains recorded. Three other trials, one per arm, have an
unresolved actor-request failure. Startup waiting is retained in trial timing;
the first concurrent blocks assign that overhead unevenly across arms.

The final protected execution source was frozen before confirmation with hash
`93c2d973b2164ebed9e3a713541586722e4af91ef06f8b811dd8907ea1a09166`.
Post-run analysis, artifact export and documentation are disclosed separately.
The original v1 source and results are preserved. The following protocol records
the design and development decisions that produced the completed cohort.

The user authorized rearchitecture and retesting after the completed negative v1
pilot. V1's source ZIP, measured artifacts, report and final archive remain intact.
The working source now advances to v2; v1 observations are development evidence.
No AWS resources are used. All new provider calls share the existing $500 ledger,
including the 39 unresolved v1 requests. Protected allocations are unchanged.

## Changes being evaluated

- Replace model-written canonical envelopes with compact structured outputs.
  The model supplies objectives, constraints, current source IDs and confidence
  weights. Code creates hashes, paths, scopes, IDs and normalized probabilities.
  Goal and candidate predictors remain separate and use the pinned mini snapshot.
- Run one managed prediction pipeline alongside each actor. Actor boundaries use
  completed current goals and verified evidence without awaiting prediction.
  Within that pipeline, goal inference and read prediction proceed concurrently;
  a read uses a completed current goal when available and otherwise uses current
  evidence with an unknown goal. Both tasks must drain before the cycle closes.
  Updated frames coalesce; policy, source, scope, snapshot and scheduler generation
  checks fence outdated candidates. Shutdown drains all provider and tool work.
- Compact historical hints, reject already observed reads and low-confidence
  proposals, and share tokenizer tables. No speculative writes or commitments.
  Evidence exposure still requires current validation, whose latency is counted.
- Record safe provider status/error/request identifiers without sensitive bodies.
  Use a local Windows execution-state hold and latched host health heartbeat.
  No global power settings change; explicit lid/suspend actions remain possible
  and block subsequent dispatch when detected.
  Heartbeats publish as immutable, numbered files. Readers choose the newest
  completed publication and fail closed if it is malformed, stale or degraded.
  This avoids replacing a file held by a Windows reader. Incomplete temporary
  writes are ignored; published files remain available throughout the run.
- Add per-run service close acknowledgments and report native orchestration,
  background drain and total trial time separately. Background work is not free.

Structured output support was checked in the official
[Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
and [GPT-4.1 mini model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Model identities, actor reasoning, output caps and native step limits are unchanged.

## Bounded evaluation protocol

First run protocol development smoke on twelve previously observed v1 checkpoints,
chosen as the first checkpoint from the first six sorted families per domain.
Reuse their independent teacher references; use fresh prediction and grading IDs.
These results are development diagnostics, never new held-out evidence.

Predeclare at most two native development rounds, 24 trials each across all three
arms. Use the second round only if needed and if the shared development allocation
has reconciled headroom for its complete $30 cohort reservation. A failed trial is
never replaced. Select the implementation on development evidence, then freeze
source and run one fresh confirmation cohort only. Repeated confirmation until a
positive result is not allowed. Report regression or inconclusive evidence if that
is what the new experiment produces.

Candidate confirmation size is eight fresh compositional families, two variants,
two trials and three arms, up to 96 trials. At $1.25 per trial this reserves $120.
Increase allowance and reduce balanced family count using development costs only
if the predeclared calibration rule requires it. The initial held-out allocation
headroom is $179.447786 and development headroom $37.651088. No protected reserve
is reallocated. Actual dispatch remains enforced by the durable shared ledger.

Primary outcome is independent native task success. Report paired family intervals,
total latency including drain, costs, goal contract and semantic accuracy, physical
reads and consumed evidence. Keep endpoint catalog matches separate from complete
requested-goal accuracy. These are synthetic compositional native tasks with shared
primitives, not an official benchmark score or proof of broad superiority.

## Development infrastructure findings

The first 24-trial native cohort completed with 24 recorded execution failures
after the Windows heartbeat publisher raised `PermissionError`. No native reads
ran, no new provider charges were unresolved, and known usage was $0.024155.
This cohort cannot establish an arm success or latency advantage. Its results,
source snapshot and host evidence remain preserved.

A no-provider stress test then reproduced sustained reader/replace collisions:
bounded retries recovered 57 conflicts before failing closed. The subsequent
immutable publication design removes the shared replacement destination. The
second native development cohort uses new predeclared instances and seeds from
the same four development families. The stages are reported separately; they are
not eight independent families or replacements for the first cohort's failures.
Confirmation families are disjoint and confirmation remains a single cohort.

The immutable-publication stress test passed 15,180 real provider readiness checks
over 65 seconds with 1,014 intentional Windows reader holds and zero errors. The
second native cohort then completed all 24 trials with no host degradation or
drain failures. One API failure retained an unknown charge, activating the $2.50
minimum confirmation allowance and the corresponding smaller balanced cohort.

Development round two exposed two final engineering issues. Goal inference still
delayed read prediction, so the two tasks now run concurrently within the managed
cycle. Also, six normal task failures ended when the simulated user supplied its
native stop token while confirming an action, before the actor could execute it.
The v2 user-only policy now explicitly distinguishes confirmation from completion
for every arm. Native stop handling and independent evaluation are unchanged;
all earlier failures remain recorded. The final candidate therefore differs from
the development-round-two source and receives one fresh confirmation evaluation.

New outcome records preserve observed usage subtotals even when an additional
provider charge is unknown. Summary totals remain unknown in that case; observed
subtotals are reported separately. Earlier raw records are not rewritten.
