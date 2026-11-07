# Acephale agent guidance

## Scope

Acephale studies goal-conditioned speculative tool execution with a fixed actor.
Read `docs/METHODS.md`, `docs/STATE.md` and `docs/AI_HANDOFF.md` before research
changes; read `docs/RUNBOOK.md` before execution. Keep the repository standalone.

## Invariants

- Never write the U+2014 character. Use commas, colons, periods or plain hyphens.
- Preserve exact model/revision, source, schema, environment, authorization and
  frozen-memory identities. Never silently substitute a model or benchmark.
- Bind current tool arguments only to currently visible sources. Historical
  entity values do not authorize new invocations.
- Speculation defaults to denied. Only audited read-only tools can be admitted.
  Preserve exact invocation matching, freshness validation, cancellation drain
  and reserved authoritative capacity. Do not speculate writes or commitments.
- Keep requested goals, inferred goals, achieved outcomes and independent
  evaluator verdicts separate. Future actions and private labels never enter a
  prediction prefix or retrieval projection.
- Split by task family before annotation, mining or calibration. Freeze memory,
  calibration and task design during evaluation. Retain failed and censored rows.
- Scores for individual candidate hits are independent marginals. Do not
  normalize them as a complete action distribution or claim true entropy.
- Keep the existing external budget journal and all unresolved reservations.
  Resolve its private location through operator configuration, never a hardcoded
  workstation path. Reserve costs before paid dispatch and never reset the ledger.
- Never disclose credentials or copy secrets into source, logs or artifacts.
- Preserve immutable artifacts. Earlier artifacts stay unchanged in their
  original checkout/history and require explicit provenance/compatibility review
  before import. Renaming a hash-bound artifact is not a valid migration.
- Do not claim superiority, official benchmark coverage or live speedup from
  unit tests, replay timing or synthetic fixtures. Report native reward, logical
  calls, physical calls, latency and cost separately.

## Implementation and verification

Prefer the existing TypeScript core, Python native orchestration, `pg` research
SQL, vLLM serving and OpenTelemetry interfaces. Keep deterministic binding and
validation ahead of model heuristics. Model weights remain fixed unless a new,
explicitly scoped experiment changes that decision.

Run focused tests while editing; use `npm run check`, `npm test` and research
pytest for completion. Keep memory-heavy suites sequential. Record exact failures,
skips and external prerequisites. Do not import old test totals as current results.
Update `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md` and `docs/DECISIONS.md` when
implementation or durable research decisions change. Keep reports reproducible and
concise, with commands, immutable artifact identities and honest limitations.
