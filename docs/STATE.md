# Acephale state

Updated 2026-11-07. This records the standalone research checkout, not historical
benchmark results.

## Implemented scope

- Shared TypeScript contracts, current-source binding, workflow/episodic memory,
  single-call conditional ranking and managed read-only speculative scheduling.
- Pinned Qwen actor/predictor serving interfaces with unchanged actor weights and
  tool catalog, authenticated native Python gateway and document adapter.
- Causal shadow trace collection, independently verified outcome handling,
  frozen embeddings/retrieval, calibration v2 and deployment-bound opportunity v2.
- Matched candidate-panel evaluation, paired native trial reporting, original
  budget accounting and OpenTelemetry/Prometheus observability.
- Standalone Node/Python project layout and direct research SQL integration.

## Standalone verification

The following checks ran against this standalone source on 2026-11-07. These are
software checks, not live model evaluation:

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed generated-contract checks and TypeScript compilation |
| Full `npm test` | 208 tests: 206 passed, 2 skipped; both skips require a real local PostgreSQL database |
| Subsequently added budget-report tests | 2 passed in a focused run; 210 distinct Node tests are covered across these runs, not one full 210-test run |
| Full research pytest, fresh Python 3.12.14 environment | Initially 276 passed, 1 failed because a native fixture imported an ESM default export that does not exist |
| Native-profile file rerun after correcting the import | 6 passed, including the previously failing pinned native snapshot/gateway test; the entire research suite was not rerun after that fix |
| Full deployment unittest suite | 124 passed |
| ESLint | 0 errors, 27 `no-explicit-any` warnings |
| Research Ruff and `acephale --help` | Passed |
| Documentation audit | Local links, documented Node/Python entrypoints and npm script names resolve |

The native test uses actual pinned environment/snapshot/gateway code with mocked
model responses, not paid model calls. The successful focused rerun resolves the
initial failure without relabeling the earlier full pytest run as all-passing.
Do not sum overlapping focused tests as independent coverage. The two later
budget-report tests are additional, distinct cases.

Retained operator-side logs include `acephale-check-final-20261107.txt`,
`acephale-node-tests-20261107.txt`, `acephale-python-tests-20261107.txt`,
`acephale-python-native-final-20261107.txt`, `acephale-deploy-tests-20261107.txt`
and `acephale-source-lint.txt`. Their private directory is not a repository path.
No paid request, cloud provisioning or live benchmark was performed for these checks.

Local/CI Python unit validation uses 3.12.14, which is installed; 3.12.16 was not
available as a local interpreter during this separation. The live deployment
target remains pinned to Python 3.12.16 and must pass its own observed inventory
checks. Unit-test interpreter selection is not authorization to substitute a
different production runtime.

CI uses Ubuntu 24.04, commit-pinned setup actions, frozen dependency locks and the
verified `pgvector/pgvector:0.8.7-pg17` image digest. It applies the research schema
and runs the database tests against a disposable service. That remote CI run and
its real-database result remain pending; local skipped tests are not converted
into passes because the workflow exists.

## External execution gates

1. Recheck current provider quota, price and available capacity. The last recorded
   GPU quota observation was zero on 2026-11-06; that is historical status, not a
   current API check. The proposed GPU configuration requires eight vCPUs.
2. Validate actual serving fit, exact model/tokenizer identities and tool parsing
   on the guarded host. Regenerate observed deployment inventory after source or
   environment changes; an example manifest is not evidence.
3. Complete real research PostgreSQL/pgvector publication and retrieval tests.
   Local SQL/mocked fixtures do not establish that integration.
4. Resolve the original budget journal through private operator configuration and
   reconcile outstanding reservations. Preserve the $500 total and its protected
   allocations; do not reset the experiment's allowance during separation.
5. Collect fresh fixed-actor shadow traces, audit teacher annotations, freeze
   training memory, fit compatible calibration and measure admission components.
6. Run paired development, select heldout size from development costs and remaining
   budget, freeze all arms, then execute/report every declared slot.

## Evidence limits

There is no new live task-accuracy or latency-improvement claim for this standalone
checkout. Mocked native gateway parity is not a tau score. Replay timing is not
live latency. Prediction hit rate is not task reward. Transparent prefetch may
increase physical work while leaving logical calls unchanged, and erroneous goal
conditioning can hurt ranking. Report those effects rather than assuming gains.

Historical reports and hash-bound artifacts remain unmodified in the original
checkout and Git history. They were not copied into the active research tree.
Any later import requires explicit source/license, family-split, authorization,
schema, model and memory-identity review. A renamed artifact is not fresh evidence.
