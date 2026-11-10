# Acephale engineering log

## 2026-11-10: qualify the actual Lambda transport

Both independent cleanup controllers completed real GPU termination canaries.
The research A100 host passed its driver and memory preflight, and both pinned
model snapshots downloaded. Serving, training and native scores still require
their own observed receipts. These infrastructure observations do not establish
model quality.

Readiness inspection found that the Python split guard supported Lambda while
the Node consumer still required AWS instance IDs. The Node guard now checks
the same API receipt, host key, machine identity and dedicated known-hosts file,
and includes them in the exact heartbeat provenance. It also fences later
known-hosts changes. Cross-language tests exercise Python publications through
the actual Node consumer for both providers.

## 2026-11-10: bounded predictor LoRA and binary ranking

Added production-compiler training export with public-prefix goal targets and
observed next-batch candidate labels. The binary runtime protocol records raw
0/1 token probabilities, calibrates candidate marginals and preserves the
existing deterministic scheduler. Added disjoint fitting/calibration family
checks to memory, calibration and reliability paths, plus immutable trained
weight identities through replay, profiling, inventory and live launchers.

Added the isolated PyTorch/Transformers/PEFT/TRL lock, explicit Qwen text-module
LoRA targets, completion-only loss, bounded GPU lease enforcement, frozen-base
and gradient checks, adapter reload and merged-logit verification. A Docker
launcher records observed image identity and keeps actor serving stopped.
Added the A100 40 GB profile and Lambda lifecycle bound to the original journal,
with two regional off-host cleanup controllers and real recovery-canary gates.

Verification: type/contracts passed; full Node 217 passed and two database tests
skipped; full Python rerun 304 passed with the pinned native environment; full
deployment suite 141 passed; lint zero errors and 33 warnings. Initial Python
failures and their resolution are retained in STATE. Goal review is pending;
no GPU weight change, live benchmark score or measured improvement is claimed
at this implementation checkpoint.

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
verification, not a subsequent all-passing full local research run. Full deployment
unittest: 124 passed. ESLint: zero errors and 27 explicit-any warnings. Research
Ruff, CLI help and documentation entrypoint/link checks passed.

The [main-branch CI run](https://github.com/xyleus1/Acephale/actions/runs/42357269977)
subsequently passed at `d510c1bbc139e09fe9e40ed1145daead87fbfb18`: all 210 Node tests
passed without skips, Python passed 275 with two skips, and deployment passed 124.
Typecheck, ESLint, Ruff and CLI help succeeded. The Node tests verified actual
disposable pgvector publication, scoped retrieval, immutable guards and
PostgreSQL read-only transactions/bound values. The Python CI skips were the
external pinned native environment and the Windows-only sharing case; both had
been covered by the local runs described above.

No paid model request, cloud provisioning, live benchmark result or performance
gain is reported by this entry. Production database publication and live serving
remain outstanding. See [STATE](STATE.md) for exact evidence boundaries and logs.
