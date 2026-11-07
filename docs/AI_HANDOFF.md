# Acephale handoff

Updated 2026-11-07. Work only in this standalone research checkout. Read
[methods](METHODS.md), [runbook](RUNBOOK.md), [state](STATE.md) and
[decisions](DECISIONS.md) before continuing.

The active question is whether source-grounded goals improve a PASTE-inspired
read prefetcher over an otherwise identical neutral-memory prefetcher. Actor
weights, messages, tools and task limits stay fixed. This is infrastructure
research; no live performance advantage has been established.

The TypeScript core and service live under `src/lib/acephale` and
`services/acephale-runtime`; Python/native evaluation is `research/acephale`.
Serving and research database definitions are `infra/acephale-infra-v1`.
Entrypoints are `npm run check`, `npm test`, `acephale:infra`,
`acephale:infra-native`, `acephale:infra-predict` and `acephale:infra-annotate`.

Standalone contract/type checks passed. The full Node run passed 206 tests with
two real-database skips; two newly added budget-report tests passed separately.
The initial research run passed 276 and failed one ESM fixture import; after its
fix, all six native-profile tests passed, including that case. The full deployment
suite passed 124. ESLint has no errors and 27 explicit-any warnings; Ruff and CLI
help passed. See STATE for exact coverage and retained logs. Remote CI and its
real PostgreSQL tests are still pending.

Preserve the external original budget journal and credentials in secure operator
configuration. No paid execution or provisioning follows automatically from local
checks. The remaining sequence is actual serving/database readiness, fresh shadow
collection, annotation audit, frozen memory/calibration/profiling, paired
development and budgeted heldout trials. Consult STATE for evidence limits.

Historical artifact bytes and reports remain in the original checkout/history.
Do not rename/reseal them as current data or import them without provenance review.
