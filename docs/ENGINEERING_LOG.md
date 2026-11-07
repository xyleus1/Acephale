# Acephale engineering log

## 2026-11-07: standalone research separation

Established an independent goal-conditioned tool-prefetch study with a fixed actor.
Rewrote README, agent guidance, methods, execution runbook and research package
documentation around the current Node/Python research components and pinned serving
stack. Active documentation separates implementation, external readiness and
measured results; it carries no prior checkout test totals as current evidence.

Preserved the existing external budget requirement, frozen artifact lineage,
family-split controls and paper-based comparison boundaries. Historical reports
stay unmodified in the original checkout and Git history. Source dependencies now
use the standalone Node/Python package, direct `pg` SQL, scoped linting and a
Docker build-context exclusion file. CI pins Ubuntu 24.04, verified action commits
and the verified pgvector image digest instead of relying on the moving runner
alias or service tag alone.

Verification: contract/type checks passed. Full Node tests: 206 passed and two
database skips among 208; two new budget-report cases then passed separately.
Initial full research pytest: 276 passed and one failed native-fixture ESM import.
Corrected the import and reran all six native-profile tests successfully, including
the real pinned environment/gateway with mocked models. This is a focused repair
verification, not a subsequent all-passing full research run. Full deployment
unittest: 124 passed. ESLint: zero errors and 27 explicit-any warnings. Research
Ruff, CLI help and documentation entrypoint/link checks passed.

No paid model request, cloud provisioning, live benchmark result or performance
gain is reported by this entry. Remote CI and its real PostgreSQL integration
remain pending. See [STATE](STATE.md) for the exact evidence boundaries and logs.
