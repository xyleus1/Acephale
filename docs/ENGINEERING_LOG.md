# Acephale engineering log

## 2026-11-13: Preserve parent JSONL bytes during aggregate verification

The closed auxiliary development import retained all original public prefixes,
but memory verification rejected the parent after reserializing Python JSON
numbers through RFC8785. Filter the original UTF-8 lines by their verified cohort
owner and hash their unchanged bytes, including original line endings. The
checkpoint order, parent manifest, split, ownership and semantic checks remain.
Seven focused memory tests and TypeScript checking passed. Regression fixtures
cover Python exponent/Unicode spelling, LF/CRLF, changed values, reordered rows
and semantically equivalent reserialization. Earlier failed stage artifacts stay
unchanged; successful verification is not a new native execution or model result.

## 2026-11-13: Closed collection and declared FLA trainer

Published the actual 60-slot fixed-base collection: 57 native completions, 46
known constraint-clean completions, 326 physical calls and 32.755-second mean
live latency including drain. The staged-study record preserves denominators,
failed slots, family intervals, usage uncertainty and immutable report hashes.
These are descriptive fitting/calibration results, not a paired improvement.

The trainer now pins official FLA/core 0.6.0 and rejects silent DeltaNet fallback.
The lock adds only those packages and einops 0.8.2. Focused checks passed 98 tests
with three platform skips; the full research suite passed 549 tests with ten
platform/integration skips. An earlier worktree run failed because its Node
dependency junction and pinned subprocess PATH were absent; those environment
settings were corrected before the successful complete rerun. Actual GPU kernel
qualification and throughput remain unmeasured. The expanded public-selection
change is integrated without editing the active source-frozen GPU checkout.

## 2026-11-13: Explicit expansion of public fitting coverage

Added a versioned all-public-eligible selection receipt and offline declaration
command. The native exporter accepts it only with the original eligibility and
pilot, verifies complete selection and public prefix hashes, and retains the
original 100-case default. Verified parent lineage permits later auxiliary
development imports without changing fitting prefixes. The 24-family, four-row
minimum and 48-positive training requirements are unchanged.

The actual public-only declaration retained all 372 existing nonempty fitting
windows and the original 100-case audit pilot. Receipt hash:
`3f2c90ec877eb9c66bee2b03a3d25fe754e8f600007ff393bf997eb920448188`.
No model requests, fitting, new native trials or heldout-label inspection were
performed by this declaration. Focused selection and training runtime checks
passed 23 tests. The complete Node suite passed 265 tests with two PostgreSQL
tests skipped in the local environment. Generated contracts and TypeScript
compilation passed; changed-file ESLint had zero errors and five existing
warnings in the training exporter.

## 2026-11-13: Observed merge failure and recovery implementation

The fresh source-frozen Qwen smoke passed strict adapter reload after one actual
optimizer step, then failed merged last-token logits at unchanged tolerances.
The failed archive and GPU termination were verified. See the staged-study
report for exact counts and hashes; no main seed or trained-model improvement
is established.

Future source adds explicit unmerged-LoRA export, evaluation and smoke selection,
fit-only batch profiling, source-bound HTTP qualification and guarded v2 serving.
TypeScript and Python share artifact fixtures and canonical float hashes.
Fixed-base collection continues independently under `fe0748b`. A heartbeat
partial-record race was repaired in its private operator helper before restart;
the first failed launch remains in the original financial history.

Multi-cohort import retains original source receipts and review ancestry; a
separate auxiliary-development mode supplies validation families without reusing
paired-control trials. The v3 budget code implements the user's increased spending
authorization through a creation-only amendment on the existing journal. Current
v2 execution remains unchanged until it closes.

Integrated local checks passed 257 Node tests (two database skips), 543 research
tests (ten platform/integration skips), and 212 deployment tests plus 72 subtests
(two Linux-only skips). Enabling the installed pinned native environment passed
all seven gateway/additive-evaluator tests, including the two opt-in cases from
the research skips. Generated contracts, TypeScript and research Ruff passed;
ESLint had zero errors and 40 warnings. Actual Linux process ownership and the
tiny Torch adapter fixture were checked separately under WSL. These are software
checks, not native actor task results. The first local passes exposed a missing
worktree interpreter junction and a stale Docker-command fixture; both were
corrected before the successful complete reruns.

## 2026-11-13: Remove duplicate policy text from predictor inputs

The policy citation repair made both live and replay frames supply `policy` as
a source. Compiler v2 then repeated its full text at the top level and in the
mandatory source list. An exact served-tokenizer diagnostic on 150 preserved
public prefixes found 32 empty-candidate inputs over the 5,120-token common
window. Removing one policy copy in a diagnostic ablation reduced this to one.
The repeated text cost 1,627 retail or 1,865 airline tokens. These measurements
used no generation, labels or changed historical artifacts; the ablation is not
a measured live latency or accuracy result.

The v3 implementation preserves the full mandatory policy source and references
it from the top level. Legacy frames without that source retain policy text.
Twenty-nine focused predictor and training-runtime tests passed, including
policy-source retention after optional context omission, mismatch rejection and
rejection of invented policy citations. This revision was developed separately
from the active source-frozen GPU collection and is for the following phase.

## 2026-11-13: Reserve tax without changing the study ceiling

Both real provider cleanup canaries passed. The follow-up funding check found
that the original internal associated-cost cap was fully reserved by AWS, leaving
no explicit GPU tax allowance. A creation-only suballocation now binds the
existing v2 policy, financial plan and retained reservations, changing only the
$41/$9 internal split to $36.25/$13.75. The $50 infrastructure and $500 study
ceilings, original journal and protected $65 contingency stay unchanged. The
later lease is reduced before reservation rather than assuming zero tax.

The preceding source `f3ccec8` passed GitHub CI: 244 Node tests, 467 Python tests,
both real Docker permission cases, and 193 deployment tests plus 70 subtests.
Platform/private-environment skips are retained in the CI log; real PostgreSQL
retrieval and read-only transaction checks passed.

## 2026-11-13: Repair the goal training path and simplify shared code

The native teacher returned `goals` and `unknown_probability`, while the exporter
looked for `goalDraft` and omitted goal targets. A shared checked conversion now
feeds explicit native multitask export. It checks current public sources, policy
references and revisions; neutral and conditioned rows share their candidate
window. Frozen fitting selections and excluded rows are recorded explicitly.

Shared public-checkpoint construction and tokenizer transport replace duplicated
CLI logic. One Python recipe controls LoRA/SFT settings. The stage runner records
inputs, deadlines, output verifiers and failed attempts, and resumes only verified
successful stages. Current docs now link preserved historical notes instead of
repeating old operator states as current facts.

Final local research checks: 244 Node tests passed with two local database skips;
465 Python tests passed with seven environment/private-fixture skips. The pinned
native snapshot gateway check was then enabled explicitly: all six profile tests
passed, including the actual native read/refresh round trip with mocked models.
Types and Ruff passed; ESLint reported zero errors and 35 warnings. A separate
real CPU test passed on WSL with Torch 2.13.0+cpu, PEFT 0.21.0 and Accelerate 1.15.0,
using Python 3.12.14. It verified exact adapter reload logits under a common BF16
context. This supplementary environment is not the locked trainer image or an
actual Qwen GPU qualification. Deployment checks and execution receipts are
reported separately.

Deployment checks passed: 191 tests and 68 subtests, with two Linux process tests
skipped on Windows. All 19 operator tests also passed in Ubuntu WSL, including
those process tests. The first Windows deployment invocation could not access
pytest's default temporary directory; rerunning with an explicit new output
directory passed without a source change. Docker permissions and real Postgres
integration remain CI checks.

Fresh fixture generation verified all 88 task outcomes with the pinned native DB
evaluator and rejected all 200 missing-mutation controls before actor execution.
Windows stages now use a suspended launch inside a kill-on-close Job Object,
including an explicit inherited-handle allowlist. Tests exercise timeout, owner
exit and surviving descendants. The Linux bootstrap likewise drains complete
command groups before artifact export.

## 2026-11-10: Preserve heartbeat binding after training admission

Issuing a valid training lease added trainingWindows to the ledger and incorrectly
changed the immutable financial binding, rejecting the existing metadata amendment
on the next heartbeat. Exclude that dynamic record collection from the binding.
Twelve metadata tests and 31 controller tests passed. The new regression issues
two real local training leases under an unchanged amendment, rejects a third at
the 7,200-second cumulative ceiling without writing it, and still rejects a changed
financial limit. These tests use temporary fixtures, with no live ledger, API,
model or infrastructure mutation.

Root restored the three hardware/watchdog inputs from the exact original LF
bytes after proving normalized content identical. Scoped .gitattributes now
preserves those bytes on future Windows checkouts. The pinned hashes and the
unchanged controller implementation were verified before commit; no ledger,
amendment or research runtime file was rewritten by this checkout repair.

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
# 2026-11-11: Explicit positive-learning-rate smoke

The real one-step smoke reached global step 1 with learning rate 0.0 and nonzero
gradient norm; independently exported checkpoint bytes matched the initial
adapter and every LoRA B tensor remained zero. Pinned Transformers 5.10.1/PyTorch
2.13.0 CPU reproduction confirmed the single warmup step causes no update.
Smoke now explicitly uses zero warmup, records its effective recipe and leaves
both full fitting recipes unchanged. Failure receipts retain computed after
hashes and gradient counts without inventing unavailable hashes.

Thirty focused training, CLI-routing and container tests passed with a new local
temporary directory; Ruff passed. The initial default temporary-directory run
had 12 passes and 18 fixture setup errors from the existing inaccessible Windows
pytest directory. These checks are not a successful real-model smoke or a model
accuracy result. Frozen runtime, datasets and earlier failure artifacts remain
separate from the new trainer source.

The exact pinned trainer image also passed a CPU-only scheduler/AdamW regression:
the old one-step schedule did not change the parameter, explicit smoke used
learning rate 1e-4 and changed it, and the complete nine-step fitting learning
rates and parameter trajectory were identical. No real model or GPU was loaded
for that proof; a repaired actual CUDA smoke remains a separate required check.

## 2026-11-11: Public trainer input permissions

Two actual failures exposed preserved checkout modes: UID 1000 could not import
root-owned public source, and a later partial repair still left uv.lock unreadable.
The final integration Dockerfile now normalizes both public trees and explicit
packaging files after dependency installation, excluding .venv and private paths.
An opt-in real Docker regression applies the production permission command to
umask-027 fixtures, verifies both UID 1000 and 10001, checks that the restricted
baseline fails, and retains private sentinel modes. Local container tests passed
7 tests; the two Docker cases were skipped because Docker is unavailable locally.
Actual Linux execution is recorded separately when available. This is packaging
verification, not an optimizer, prediction-quality or native-task result.

# 2026-11-11: Preserve current pilot evidence and permission recovery

The completed R3 base cohort retained all 12 slots. Its mixed 9/12 native success
and development-only 1/4 are documented separately, with logical/physical calls,
latency, usage-derived cost and unknown constraints. Frozen predictor data and
base replay failures remain unchanged. A2 optimizer progress remains unknown;
A3's original smoke had one zero-learning-rate step without an adapter update.
Sequence02 then failed before model load because UID1000 could not read the
public dependency lockfile. Full failed-stage archives were verified locally.

The external sequence03 declaration binds the actual exact-parent image05
permission overlay, all 45 copied public byte hashes and an expanded UID1000
implementation/compiler proof. It changes no main recipe, data, seed or lease
deadline. Three optional standalone development evaluations were omitted before
dispatch; main Trainer final development evaluation remains unchanged. These
provenance checks do not establish successful training or improved accuracy.

Current overview documents now distinguish historical checkpoint statements and
explain that binary decoder probabilities are autoregressively conditional.
Integration CI at `30fffe6` passed 237 Node, 391 Python and 167 deployment tests;
the detailed report lists six platform/environment skips. Later documentation
edits have no new runtime behavior and do not relabel that CI source identity.

Sequence03 subsequently completed one actual smoke optimizer step and final
development evaluation. Its sealed optimizer receipt records one gradient check,
changed adapter hashes and identical frozen-base hashes. The following reload
parity assertion failed before merge, leaving the smoke export stage failed.
Neither main seed started; there is no qualified trained predictor or replay.
Teacher-forced smoke diagnostics are not a task-success or improvement result.

The final sequence03 archive and all 32 payload files were independently rehashed,
including adapter weights, optimizer state, tokenizer and TensorBoard; 33 cache
omissions retain individual hashes. Archive SHA-256 is
`ea939c1a0e04aeeb3e5262259c60597cd3e4e7ee3caf25a8af2e8bcd21738fde`.
The actual Linux public-permission fixture invocation failed before Docker
execution because its research environment lacked pytest. It remains unexecuted.
Full integration CI for `b7ab0fe` passed 237 Node tests (two skips), 391 Python
tests (six skips, including the two opt-in Docker cases) and 167 deployment
tests, plus Types, ESLint and Ruff. This supersedes software totals for that
revision only and does not establish successful predictor export.

## 2026-11-11: Explicit and artifact-bound verification precision

The retained real smoke completed one optimizer step with a changed adapter and
unchanged frozen-base hash, then failed adapter reload parity before merging.
Pinned-image CPU source inspection found the post-Trainer AMP wrapper differed
from the fresh export forward context. The future-only helper makes all three
probe calls explicitly consistent and records/requires the context in every
verification artifact. Old failure artifacts and tolerances remain unchanged.

Thirty-seven focused training/container/CLI/context tests passed, including the
real verify_export entry with a complete synthetic valid artifact chain, legacy
metadata rejection and rehashed context tampering. Ruff passed.
Separate existing calibration/evaluation checks passed all 32 tests.
A tiny real BF16-base/FP32-LoRA CPU roundtrip regression is included but skipped
locally
because Torch is absent; no package download or additional paid run was made.
The earlier Docker-permission fixture also could not run on the terminated host
because its research environment lacked pytest; the failure log is retained.
These checks do not establish repaired real-model reload or benchmark gains.
