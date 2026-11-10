# Acephale engineering log

## 2026-11-10: provide writable trainer home and caches

An actual image03 probe running as the Linux host UID observed unwritable `HOME=/`
and `/.cache`. The host launcher now creates and write-tests separate per-run
home, XDG, Hugging Face, datasets, Torch, Inductor and Triton directories beneath
`/output`. Launch receipts record the environment and launcher source hash.
The existing non-root user, network isolation and read-only input mounts remain.
Twenty-seven focused training/launcher tests pass. This is prerequisite repair,
not a successful optimizer step or a claim that a C compiler is installed.

## 2026-11-10: preserve the aborted native cohort and repair metrics publication

The first real base collection retained two successful tasks and ten execution
errors after a Windows metrics-file `EPERM` terminated its service. All 22 actor
requests that reached the model completed; nine later slots never dispatched an
actor request. The closed cohort remains ineligible for fitting and unchanged.
Hosted usage cost was $0.009232; no superiority or live speedup is established.

Atomic publication now uses uniquely owned temporary files, bounded Windows
sharing retries and a cache updated only after successful replacement. It never
deletes or truncates the live metrics file. Concurrent closure joins writers and
SDK exporters even after a local error. Fourteen focused tests passed, including
actual Windows sharing denial/recovery, concurrent updates and fatal-error drain.

Before recovery, task-source inspection found six airline tasks with eleven
configured NL assertions skipped by the ordinary reward basis; all six selected
retail tasks have empty assertions. The explicitly selected upstream audit mode
preserves reward computation and records only complete, actually evaluated
assertion coverage. Unknown constraint counts cannot create positive workflows.

## 2026-11-10: second serving qualification and transport diagnosis

Actual concurrent models, tool-call continuation, raw binary log probabilities,
PostgreSQL/pgvector, queried telemetry and observed deployment inventory passed.
The 235-file archive was independently rehashed before the lease was marked
ready. A PostgreSQL catalog check replaced an operator-side assumption that a
regclass value always prints its schema; original failed startup evidence stays
in the archive. This changed no database state or source/model identity.

Before native dispatch, repeated SSH handshakes exceeded the unchanged guard
observation deadline. Three diagnostic probes took 2,503/2,727/2,774 ms. The
guard failed closed and drained its tunnel. No native trial, hosted trial
reservation or optimizer step was produced by this attempt at collection.
The transport repair must preserve nonce freshness, identity checks and bounded
shutdown; the 12-task design and existing financial journal remain unchanged.

CI at `ae71b86` passed Node 223 without skips, Python 304 with two skips,
deployment 166, types and lint. See STATE for the exact run and artifact identity.

## 2026-11-10: qualify the actual Lambda transport

The first research lease reached its setup deadline before a valid final
deployment inventory existed. Provider-confirmed termination followed verified
artifact export. Actual concurrent model/tool/probability/telemetry checks passed;
native trials and optimizer steps remained zero. The immutable OCI image chain
revealed CUDA_VERSION=13.0.2, contradicting the earlier 13.0.3 expectation.
Record image-release identity and Torch compile identity separately; do not infer
an entire installed toolkit release from either an environment field or a Docker
source-file default.

Live qualification confirmed tool-call continuation, concurrent inference and
stored traces, then exposed missing lifecycle-log discovery. Enable the pinned
Alloy file source's built-in glob matching. The actual serving image provides
`python3`; the inventory probe now invokes that executable explicitly.

The actual Tempo 3.1.1 binary rejected the earlier v2 configuration's top-level
`ingester` and `compactor` fields. The configuration now uses the pinned v3
source's `live_store` and `backend_worker.compaction` fields with unchanged
five-minute block duration and 48-hour retention. Actual ingestion and querying
remain required; the static configuration check alone is not readiness.

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

# 2026-11-10: Actual C compiler prerequisite

The original trainer's installed TRL/Triton path reproduced `Failed to find C
compiler` in a CPU-only probe. On the exact pinned Python base, installing GCC
`4:12.2.0-3` and libc headers `2.36-9+deb12u14` added 32 packages without upgrading
any existing package, then compiled and imported a Python C extension. The full
closure is now pinned and hashed as a trainer build input. The complete image
package inventory is retained for inspection. This change adds no CUDA optimizer
evidence and does not modify model or Python package versions.

# 2026-11-10: owned guard cancellation

Added an optional stop event to `run_guard`, preserving the command-line default.
Real child-process tests cover stopping and joining the probe and its workers,
final degraded publication and cancellation before any SSH launch. Thirty-three
focused guard tests passed; Ruff passed. An initial worktree-only run lacked
`tsx` and failed two cross-language tests; installing the local dependency
junction allowed both to pass. No benchmark or model call was made by these tests.

# 2026-11-10: Native failure and OTLP diagnostics

Added sanitized guard reason/age diagnostics and allowlisted OTLP transport error
codes. Removed the final historical export-failure throw that could mask a guard
abort; SDK shutdown failures now remain explicit while local queues drain.
The export receipt distinguishes incomplete, no failures observed and no configured
exporter. Local publication still rejects closure on failure. Tests use actual
loopback HTTP rejection and connection reset, preserve native gateway exceptions
and cancellation, and verify an aborted CLI exits 1. No frozen cohort is changed
and these fixtures establish no native reward or model performance.
Typecheck and schema generation checks passed. All 31 focused Node tests passed
without skips; ESLint completed with zero errors and 35 existing warnings.

# 2026-11-10: Shared observation deadline and safe guard diagnostics

A Normal-priority read-only soak still failed on a degraded TimeoutError after
149 Node checks, 78.687 seconds into the requested 120-second consumer window.
Its largest publication gap was 1,405.5 ms; the guard drained successfully. This
does not prove which suboperation timed out because the old publication retained
only the exception type. The local HTTP requests had an undocumented 0.5-second
sublimit. Both parallel catalogs now receive the remaining overall 2.5-second
budget. The legacy serial observer also uses its remaining total budget.

Failure publications add only remote_probe/local_actor/local_predictor/overall
stage and numeric elapsed, remaining and budget fields. The consumer still
rejects observations older than 3 seconds. No retry can overlap an undrained
probe. Focused guard tests: 37 passed; Ruff passed. A real loopback HTTP test
checks two concurrent 0.6-second responses. Tests also cover shared-deadline
exhaustion, bounded failure metadata, poisoned-session rejection and managed drain.
The first run had 35 fixture setup errors from an inaccessible global pytest
temporary directory and two passes; the subsequent explicit new output directory
resolved that environment failure. These checks made no model/provider calls.

# 2026-11-10: Preserve failed fixed-panel compiler outcomes in reports

The real base replay retained 150 rows: 145 completed and five failed. Three
failures recorded a shortened common candidate window and correctly refused
dispatch because the frozen three-candidate panel could not fit. The comparison
validator incorrectly demanded a full window even for these pre-request failures.
The reporting-only correction recognizes exactly that path: failed status,
paired candidate-window tokenizer events, one terminal window, exact original
pool/prefix/suffix hashes and consistent token-budget metadata. Any later model
request, preparation, dispatch or completion event retains the strict full-panel
requirement. The original panel and failure denominator remain unchanged.

Focused fairness tests: 46 passed, including the three immutable real rows,
prefix lengths 2/0/2, and negative cases for reordered bindings, modified
arguments, hashes, omitted suffixes, request events, tokenizer model/pairing and
the exact 7,168/2,048/5,120 context policy. Review also required proof that the
full pool exceeded budget while the empty pool fit; arbitrary missing-dispatch
rows do not establish a failed compiler prefix. Ruff
passed. The real replay fixture is operator-held; its test verifies exact SHA256
e374489048f0637938895ef2ac073b03009ab05a8b98be219f8b81ebafbd10ce and skips
when ACEPHALE_FIXED_PANEL_REPLAY_FIXTURE is absent. No native trace, model request,
weight, training input or original replay artifact changed. This separate report
revision does not retroactively change the source identity of execution.
