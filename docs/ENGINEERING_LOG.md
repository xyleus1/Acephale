# Acephale engineering log

## Strict export and serving argument repair, 2026-11-16

E17 passed the live local-clock probe checks and completed strict export for
both saved predictor seeds. The 165-file archive and teacher-forced results are
retained. Both reference probes match exactly; numerical tolerances and weights
were unchanged.

The next local serving entry passed a module filename string to the strict
controller file hasher, which requires `Path`. It failed before any serving SSH
or model work. Cleanup and independent provider absence checks completed. E18
wraps that one argument in the already imported `Path`. Seven actual local-entry
tests pass against the retained archive, including all four occurrences and
bad-pin rejection; transport effects are intercepted. The fix has independent
review. No serving, trained replay or native comparison result is inferred.

## Remote probe clock mismatch, 2026-11-16

E16 passed setup and diagnostic execution, then failed before strict export
dispatch. Its clean remote probes were about 0.175 seconds ahead of local file
times; the original validator rejected their negative apparent age. The exact
check instant was not captured. The failed attempt and verified cleanup remain.

The private export and serving wrappers now time fresh authenticated requests
locally and preserve the raw remote evidence. Thirty-two focused cases cover
clock offsets, request limits, stale later reads, cancellation, original deadlines
and identity changes. A separate audit caught and fixed a stale serving-helper
pin and an occupied diagnostic output path. Actual serving/native entry checks
pass; these operational checks are not benchmark results.

## Infrastructure-aware evaluation accounting, 2026-11-16

Funding v5 is a prospective $100 infrastructure supplement, split into $80 compute
and $20 associated costs. The operator selected this bound under the user's
instruction to continue with necessary resources. It admits at most sixteen new
evaluation leases, each at most eight hours and $1.99 per hour, with no optimizer
work. Effective ceilings are $1,350 total, $550 infrastructure, $415 compute and
$135 associated. GPU-hour capacity v4 separately raises the engineering limit
from 168 to 200, retaining all three earlier GPU authorities and all funding parents.
Every old reservation, unresolved hold and deadline remains unchanged.

The original native financial reader has a $935 non-contingency ceiling. A
larger infrastructure sidecar alone does not make it compatible. The explicit
`acephale-infrastructure-aware-native-budget-v1` port uses Node22's synchronous
resolution hook to redirect only the two exact hash-bound runtime/analysis `durable-budget.ts`
modules to the current financial adapter. Actor, predictor, tool and scoring
modules remain frozen. The adapter validates funding v5 and its full parent
chain, retains the original API allocations and trial accounting, and denies
native infrastructure reservations. The $303 API plan and $65 contingency stay
protected. Reports must identify this operational port rather than claim that
the old financial implementation accepted the new aggregate ceiling.

The local integration test runs the actual frozen native service and hosted
workers with synthetic local observations. It checks original model identities,
output caps, zero retries, per-trial reservations, settlement and retained unknown
charges. Separate tests retain all funding/GPU parents and exercise the original
execution-lease reader. These checks establish accounting compatibility, not
benchmark performance or activated financial authority.

## Provider-response reconciliation, 2026-11-16

- Retained E15's actual uncertain POST response and exact verified cleanup. No
  low-level timeout or JSON failure is inferred from the old sanitized error.
- Added fixed safe transport categories and an optional one-POST reconciliation
  path. Real public-launch tests cover successful recovery, no retry, absent or
  duplicate instances, wrong attributes, optional-field reporting, cancellation,
  late successful responses with retained IDs, and delayed publications.
- Factored the unchanged watchdog payload serialization from its fully validated
  reader and added an optional SDK session port to the existing publisher. The
  reviewed private adapter uses exact locked-transaction bytes and real bounded
  S3 calls; independent tests execute the actual public launch and publisher.
- Actual public launch/route/control suite: 71 passed plus 15 subtests. Existing
  publisher/packaging suite: 42 passed plus 14 subtests. Independent private
  adapter integration: 13 passed. These are operational checks, not benchmark
  results or proof of a new live provider run.

## 2026-11-16: Separate dispatch count from unchanged money and GPU limits

Added a compact, creation-only count supplement for funding v4, with a finite
sixteen-lease ceiling. Tests retain original holds, deadlines and closed
identities, reject count-authority tampering and missing authority, and exercise
the actual funding/GPU reader composition and optimizer denial. Initial tests
caught current count validation being applied to an authenticated historical
GPU parent; the repaired internal funding pass-through preserves all current
entrypoint checks. Original failure evidence remains in operator artifacts.

## 2026-11-16: Derive the worker duration when it starts

E13's worker exited before its preparation log opened. Its launch configuration
contained the remaining lease duration measured earlier; the wrapper added that
duration to its later start time and rejected the resulting deadline. The original
failure and verified provider/process closure are retained. The prospective wrapper
uses the smaller of the configured duration and the time remaining until the
original deadline, rejects expired or malformed bounds, and preserves the native
publisher's absolute deadline checks. Fifteen focused Windows cases passed.

The export path also retains all three GPU-capacity receipts and both relevant
funding receipts. It checks current and historical funding separately, preserving
the existing descriptor shape and scientific formulas. Thirty-seven focused
capacity/export tests passed. These checks do not establish native benchmark
performance; serving qualification and paired trials remain required.

## 2026-11-16: Append bounded evaluation completion capacity

Added funding v4 with one eight-hour evaluation lease and a $30 infrastructure
increment, plus a parent-bound GPU-hour v3 allowance of 168 cumulative hours.
Current financial validation remains separate from authenticated historical GPU
parents. No original journal, policy, reservation, model or deadline is rewritten.
Focused Python tests cover the complete retained chain, altered parents and
holds, optimizer denial and the frozen execution reader. TypeScript tests cover
the appended contract, writer and reader; type checking passes. Real activation,
frozen API headroom and actual scheduled startup remain separate evidence gates.

Added a separate checkpoint-write option for the funding writer. Its normal
authenticated recovery still checks the existing prefix and tail, but neither
constructor nor close rewrites checkpoints. Focused tests cover valid prefix,
tail replay and corrupted checkpoints with this option. The default is unchanged.

## 2026-11-16: Measure the full heartbeat after bounded hash reuse

The unchanged controller's closed-lease heartbeat took 61.031 seconds wall time
and 40.516 seconds CPU. The repaired controller took 29.843 and 20.500 seconds,
respectively. Wrapper-equivalent preflight observations were 9.812 and 3.172
seconds; final authenticated readbacks were 6.407 and 2.297 seconds. Both used
real S3 operations and the same terminated lease, with original financial bytes
unchanged and no provider, model or reservation dispatch.

Each implementation has one such sample, under variable local load. These
measurements support proceeding to scheduled-start qualification; they do not
establish a startup bound, native task latency gain or predictor improvement.
The implementation changes only pure memo keys and the scope spanning one
heartbeat attempt. Current files, identities and deadlines are still checked.

## 2026-11-16: Retain the active-startup timeout

E11's final provider-dispatch check passed: heartbeat age 4.18 seconds, budget
inspection 6.23 seconds and 88.3 seconds left on the predecessor fence. The
scheduled heartbeat then missed its 90-second startup deadline. The retained
timeline separates 12.067 seconds before wrapper start, 17.144 seconds to its
preflight timestamp and 71.894 seconds from there to the first child timestamp.
The latter was 11.105 seconds late. There was no heartbeat stderr failure.

Automatic cleanup and independent provider absence checks completed. The local
wrapper and children exited; no foundation or scientific phase was dispatched.
All original holds and deadlines remain. Three prior closed-lease canaries had
passed, so their maximum cannot be treated as an active-startup guarantee.

Read-only profiling found repeated canonical serialization when large raw memo
keys filled the 16 MiB cap. Fixed-size content-hash keys eliminated those repeated
misses and reduced retained key bytes, but the observed paired read improvement
was only 3.5% wall time. Local memory pressure was also substantial. Complete
publication profiling remains necessary before attributing the delay or claiming
a sufficient repair. Scientific models, data and scoring are unchanged.

## 2026-11-16: Exercise the complete managed authority path

Three real scheduled startup canaries passed against a closed lease, with no
GPU allocation or financial-file changes. Their authenticated handoffs took
71.431, 50.176 and 71.521 seconds. E10 subsequently passed startup, but foundation
failed because its launcher omitted two helpers used by `Runtime.authority`.
The failed stage remains failed. Provider termination and exact absence were
verified; separate local observations found its tasks and owned processes stopped.

E11 restores the exports and tests the actual authority calls, including stale
readiness, setup deadlines and foreign instances. It removes the redundant parent
publication after `mark-ready`. The public publisher accepts only the monotonic
active readiness transition, preserving all other identity and deadline checks.
A separately reviewed count-only sidecar permits one further evaluation lease;
it preserves financial ceilings, retained holds, training denial and GPU hours.
No trained native benchmark score follows from these infrastructure checks.

## 2026-11-16: Keep publication unit tests independent of cloud packages

The state-reader tests replace S3 transport but initially still imported the
optional cloud SDK's configuration class. Two cases failed in the standard
research environment, where that SDK is absent. The tests now replace that
boundary too and assert the exact timeout/retry options. Production code and
the separately frozen operator source are unchanged.

## 2026-11-16: Reproduce the scheduled-startup failure

E9 passed the final real pre-dispatch check and allocated its exact GPU instance.
The budget inspection took 6.732 seconds; both controller states were 12.182
seconds old, with 63.288 seconds left on the unchanged predecessor fence.
The launcher then exhausted its 50-second wait for the scheduled heartbeat.
Cleanup started at 11:55:13 UTC; the wrapper reported an error at 11:55:38.
The later exception is therefore not assumed to explain the initial timeout.
Provider termination and subsequent exact absence were verified. No scientific
owner or model evaluation ran, and all original financial holds remain.

Three offline reproductions exercised the actual PowerShell wrapper and public
publisher. Native stderr under PowerShell's terminating error policy could lose
the safe diagnostic and a successful child result. The publisher's new helper
also bypassed the companion's cloned state-read override. Both defects require
repair, with full scheduled startup measured against a closed lease before
another GPU allocation. Earlier direct-loop qualification did not test that
startup path. Models, saved weights, data and scoring rules remain unchanged.

## 2026-11-16: Close the undispatched attempt and qualify publication

E8 stopped before its provider request when the published heartbeat was already
too old. Exact stopped-process, durable-state and provider-absence evidence
established that no instance had been created. Guarded cancellation closed only
that local reservation; independent verification found all 99 financial files
unchanged and reconstructed the entire prior ledger by restoring that one row.
Provider termination is explicitly false and every financial hold remains.

The repaired publisher completed three real cycles with both remote readbacks.
Observed publication intervals were 44.430 and 42.182 seconds; the watchdog
timeout remains 120 seconds. Public integration checks passed 41 tests with one
Windows symlink-permission skip. An initial local run hit a pytest temporary-
directory permission error; a new explicit test directory resolved that setup
failure. These checks do not establish trained benchmark accuracy or latency.

## 2026-11-16: Preserve evidence during repeated export verification

E7 restored each seed's recorded native cache and reproduced all 248,320 saved
logits exactly in first, repeated and repeatability checks. Both strict GPU
exports and both 112-example teacher-forced neutral-ranking evaluations completed.
No optimizer ran and original weights, probes and numerical gates stayed fixed.

Local verification then imported a retained helper and rewrote its archived
bytecode on Windows. The next hash check correctly failed. The compressed
160-file archive was intact; a fresh extraction passed the unchanged verifier
repeatedly with bytecode writes disabled. The failed owner was not relabeled.
E8 loads the checked helper source through `runpy.run_path` and also suppresses
bytecode at process startup. Actual-archive regressions cover normal and isolated
Python with bytecode otherwise enabled, repeated checks and tampered-bytecode
rejection. E8 serving and paired benchmarks remain pending. See the
[follow-up observation](experiments/native-tuning-cache-2026-11-16.md#gpu-follow-up-and-local-verification-failure).

## 2026-11-16: Keep validation work within the owner heartbeat window

Profiling the retained ledger found repeated RFC 8785 serialization dominated
validation. An operation-local memo now reuses only canonical hash results, with
type-preserving keys from the standard library. Every authority read and check
still runs; changed nested values cannot reuse a digest. An initial Python key
scanner was slower and was discarded. Matched unprofiled local observations were
8.922 seconds before and 3.688 seconds after, one observation each, with all 133
JSON reads and the same validated ledger digest. These are operator timings,
not model or benchmark latency results.

Publication now timestamps a real revalidation after all prior-controller
checks. A separate guarded cancellation module can close a never-dispatched
reservation without releasing any financial hold or claiming provider
termination. Real network publication qualification remains a separate gate.

## 2026-11-16: Chain evaluation engineering capacity without changing budgets

Added a creation-only GPU-hour capacity v2 sidecar with a 160-hour cumulative
allowance. The controller validates the original 128-hour v1 against the retained
baseline, then validates each new lease against the v2 hash. Current funding,
source, history and parent file identities are mandatory. Existing financial
holds, deadlines, unknown launches, model contracts and training windows remain.
The command inspects the original journal and never provisions a resource.
Activation and live execution are separate operator actions.

## 2026-11-16: Remove a startup-test timing assumption

The Windows research suite exposed a test that expected process construction to
finish inside its 50 ms startup allowance. The real guard correctly rejected the
expired deadline before the test's first assertion. The test now uses the existing
injectable clock and a real child that withholds READY, then advances exactly to
the deadline and verifies timeout and child drain. All 23 focused lifecycle tests
passed. Production code, timeout values and frozen execution sources are unchanged.

## 2026-11-16: Preserve kernel choices across evaluation processes

E6 passed strict input checks, then seed 17's original-reference comparison
failed after warmup: 18,971/248,320 mismatches, maximum absolute error 0.19140625.
Both current probes were bitwise identical to each other. Original weights and
probe bytes were unchanged, as were the reconstructed batch and recorded package
versions. Three kernel selections differed from successful E1 after warmup and
four after probes. This supports an autotuning-history hypothesis, not proof of
one causal kernel. The 39-file failed archive was verified and cleanup completed.

The prospective helper restores the original per-seed native cache files before
FLA/autotuner imports and verifies the installed Triton 3.7.1 reader. One shared
verifier checks exact original payloads, selected profiles, batch and probe
results for both runtime and exported evidence. Runtime verification additionally
checks the physical cache, environment and symlinks. All 41 focused CPU tests
passed; an actual installed-image check restored all 22 files without runtime
mocks. Fresh GPU recovery remains pending. Neither optimizer, threshold nor
benchmark selection changed. See the
[experiment note](experiments/native-tuning-cache-2026-11-16.md).

## 2026-11-16: Complete local evaluation readiness

The next configuration passed actual keyless validation twice and its task was
registered disabled. Verification included 36 owner cases, 36 provider cases,
18 actual source/controller integration cases, 60 export cases, eight archive
closure cases and 24 downstream/report cases. These counts describe separate
suites, not additional benchmark trials. One failed local preseal incorrectly
listed the separately pinned operator source as a private helper; its three
outputs were archived unchanged before the corrected sealer passed.

The append-only $20 funding supplement was activated without changing the
original journal, policies or retained reservations. An actual frozen-source API
reader then loaded that journal; an in-memory projection of $11.94 compute plus
$3.582 associated allowance still admitted the full $65 development and $238
held-out parent/child reservation, settlement and closure flows. This check wrote
no real reservations. The remaining launch prerequisite is an authentication
session covering the full lease. No trained benchmark result is asserted.

The [published operator patch](experiments/operator-patches/README.md) reproduces
the repaired helper's exact bytes when applied with automatic CRLF conversion
disabled.

## 2026-11-16: Bind the complete extracted dataset

E5 passed the concrete callback and entered strict export, but its input validator
rejected a missing inventory binding before any export model call. The approved
archive contains five payloads plus a 954-byte `inventory.json`; staging correctly
extracts all six. Diagnostic preparation had frozen only the payloads. All five
payload hashes matched. Cleanup and exact provider termination were verified.

The prospective producer verifies the existing approved archive and its inventory,
binds the inventory's exact remote path and hash, and requires the complete dataset
binding before writing preparation output. It does not upload or modify the data.
The strict host is unchanged. Eight independent regressions exercise the actual
retained archive, extractor and producer and the exact consumer check, including
the original failure and six tampering cases. Inventory SHA-256:
`cb3b015151bc74ac7e52a4c621d452306aa0d87ebc7e6d73c47217bb01a656cb`.
This repairs packaging provenance; it establishes no model improvement.

## 2026-11-16: Validate the concrete continuation interface

E4 completed setup and cold diagnostics, but the real wrapper omitted `preflight`
and stopped the sequence before strict export. Cleanup and provider termination
were verified. E5 imports the callback and admits only a wrapper with callable
`preflight`, `validate_configuration`, `execute_phase`, `verify_phase` and
`finalize` methods. Failure records now include bounded traceback locations
without exception text, source lines or local values.

Independent verification passed 37 owner/context cases and 24 downstream/report
cases. The concrete regression reproduces E4's failure and executes E5's wrapper
with retained sealed inputs and real local validators; external authority effects
are intercepted. A separate actual E5 configuration validation passed. The missing
retained serving inventory was restored before sealing, with exact byte parity.
These are orchestration checks, not model accuracy or latency results.

## 2026-11-16: Audit dataset units and family isolation

Read-only verification traced the original 60 episodes plus 12 development
episodes into 746 prefixes, then checked every compiled example's checkpoint and
family against the frozen partition. The importer's 30-family `train` grouping
contains separate 24-family fitting and six-family calibration subsets. Fitting,
calibration, development and held-out family sets are disjoint; memory contains
only fitting runs. The 1,074 fitting examples form 358 complete triplets. The
117 calibration and 112 development examples contain neutral-ranking targets
only. The configured teacher-forced export stage evaluates development only;
141-prefix calibration goal agreement is a separate assessment.

The reporter groups only observed task rows and the renderer iterates those
groups, so absent goal/conditional diagnostics are not assigned invented zeros.
No frozen artifact or selection rule changed. Audit receipt SHA-256:
`6a2b2bfa7aa182ab28a0823d171c0c4959aa817de7672cc2df87b74b73918421`.
The complete count table and source manifest hashes are in [methods](METHODS.md#frozen-study-dataset).

## 2026-11-16: Verify the image and repair evaluation ownership

The full local image build at execution source `4438b56c` passed with 65 exact
Git inputs, all 32 unchanged system package pins and two actual Docker permission
tests. Base packages were neither upgraded nor removed. Independent verification
of the build proof passed; its SHA-256 is
`d8a5e07eeea4720dcb2e5097803f761a634d3915ba0d4fc4908398bafe4d428f`.
CI for public commit `4f6bfd0` also passed every configured job.

E3 completed image setup on its GPU host. Its public authorization producer then
defaulted to operator source `8185b861`, while the diagnostic required execution
source `4438b56c`. Admission failed before model calls. A legacy transport import
also cached an older controller and broke the automatic cleanup path's amendment
reader. The exact host was subsequently terminated and verified using the reviewed
controller. Both failures and original deadlines remain retained.

E4 uses the existing source-probe hook with a clean-checkout, ancestry and exact
input-byte verification. All three owner entrypoints bind the reviewed controller
before importing legacy transport; an incompatible cached module fails closed.
The Windows installer now persists its creation-only registration receipt after
successful registration, disabling and XML export. Independent checks passed 45
distinct cases: 10 source-authorization, 8 real entrypoint/import-order, 10 Windows
task and 17 owner-unit tests. External effects were blocked or replaced with test
fixtures. The actual scientific sequence remains pending; no new weights, gates,
benchmark scores or claims of improvement follow from these engineering tests.

## 2026-11-15: Preserve compiler pins with signed Debian snapshots

E2 image setup failed before model execution because the live security index
no longer exposed `linux-libc-dev=6.1.190-1`. The prospective Dockerfile changes
only its APT source URLs to `20261114T000000Z` for bookworm, bookworm-updates
and bookworm-security. Source-scoped historical expiry handling leaves GPG
signature verification enabled. The existing package installation and installed
package inventory commands remain unchanged.

Local verification extracted the keyring and dpkg status from the exact pinned
Python base-image layers, verified three signed InRelease files and their
Packages hashes, and downloaded all 32 unchanged packages (50,766,168 bytes).
An isolated Ubuntu APT solver using that Debian status required 32 new packages,
zero upgrades and zero removals. This is not a completed container build. The
full local Docker build and E3 execution are pending. The verification manifest
SHA-256 is `69a9b29ae04b93d921afe31be70f6d67da06b4c858c7e8c151439f37c0b5baad`.

The prospective export helpers retain original training source `5a36a8b3`,
historical diagnostic source `8185b861` and new execution source `4438b56c`
separately. Their focused checks passed 60 distinct cases; independent reporting,
current-context and finalization review passed 19 cases. No models or providers
were called by these checks. CI for the earlier public commit `508d94c` passed
all configured jobs; that result does not validate this later Dockerfile change.
Public container regressions passed 16 tests; two opt-in Docker permission tests
were skipped in the Windows interpreter. The full Linux build is separate.

## 2026-11-15: Reproduce both saved probes with inference-only preparation

Cold diagnostics failed the unchanged gate for both seeds with exact original
parameter hashes. One reconstructed fitting-batch forward pass, without an
optimizer, restored all 248,320 original logits exactly for both seeds and both
repeat probes. CPU byte comparisons independently confirmed equality. Retained
FLA/Triton selections changed; unique kernel causality is not established.
The prospective export will apply the same preparation inside its own process
and still require the original strict gate and separate vLLM acceptance.
See [measurements and procedure](experiments/reload-preparation-2026-11-15.md).

The inference-only diagnostic is now included as `acephale.reload_warmup_diagnostic`.
Its published source differs from executed source `057bffc2` only in import
formatting; the parsed AST is identical and all five focused tests passed.
The report plotting script reads the exact completed report and finalization
receipt, copies existing confidence intervals, and labels sample sizes. It does
not run models or rescore trials; actual figure review awaits completed results.

## 2026-11-15: Continue from completed weights

Both original optimizer seeds reached all 204 declared updates and gradient
checks. Separate CPU receipt recovery verified the saved files without changing
weights or rerunning optimization. R5's strict HF reload failed; its raw evidence
and original failure remain retained. A short-path extraction independently
verified every archived member after the Windows path-length failure. The new
evaluation authorization and diagnostic preserve original training source `5a36a8b3`
and separately identify execution source `8185b861`. Native scores are pending.

The Windows process-tree timeout test now observes all three real processes
before advancing the runner's test clock past its deadline. The old one-second
startup assumption failed under load before the tree existed. Production process
ownership is unchanged; all ten Windows process tests passed with the revised
fixture against the frozen execution source.

## 2026-11-15: Diagnose retained checkpoint reload without training

Added an evaluation-only diagnostic for a completed 204-update checkpoint.
It verifies original receipt, probe and adapter files, then requires loaded base
and adapter parameter hashes to match the original training hashes. Eleven
forward comparisons retain the original full-vocabulary tolerance and test
repeatability, cache behavior, Trainer wrappers and numerical backend flags.
No optimizer is constructed and no acceptance reference is replaced.
Focused local verification: 13 passed, one PyTorch-dependent test skipped because
the local test interpreter has no PyTorch. The actual seed 17 input gate passed.
GPU results and a confirmed causal correction are pending.
Passive capture also retains selected FLA/Triton autotune configurations and
exact kernel source hashes, without clearing caches or choosing configurations.

## 2026-11-15: Admit one declared fitting window before provisioning

The fourth continuation completed foundation setup, training-image preparation
and input staging. Prepare/profile admission then failed at the exhausted
cumulative fitting allowance, before disposable profiling or main seed 29.
Managed export/drain and exact provider termination were verified. No new
optimizer or benchmark result exists from that attempt.

Added a separate capacity contract and immutable operational-history binding for
one additional four-hour fit window. Original v3 budgets, all old windows, smoke
allowance and financial reservations remain unchanged. Prelaunch and real lease
creation share the same admission function. New provenance survives checked-ledger,
provider, heartbeat and cleanup paths; the capacity contract enters the controller
source inventory. Validation passed: 335 infrastructure tests and 111 subtests
(two skips), 300 Node tests (two skips), 630 research tests (22 skips), and the
TypeScript/schema check. Skips require Linux process groups, optional GPU/Docker
dependencies, the explicit native environment or private replay fixtures.
The 21 new capacity tests include the frozen trainer's unchanged AST identity.
An independent raw-Git 5a proof verified 254 source files, unchanged native budget
readers and the actual emitted third-window receipt against isolated artifacts.
No live provider call, journal mutation or model execution was part of these tests.

## 2026-11-15: Close the interrupted continuation

The replacement host completed its disposable profile but failed its final
ownership observation before another scheduled heartbeat publication. Timing
and source review support a publication race; the precise cloud state at that
instant was not retained. The setup owner had no automatic main/evaluation
handoff. Independent controllers later terminated the idle host at its original
deadline. No main seed 29 updates occurred on that host.

Prospective private orchestration now retains phase claims before dispatch,
retries transient observations within 75 seconds, verifies existing exports
before adopting them, and executes subsequent phases synchronously. Cleanup
checks actual provider termination; a silent cleanup return is insufficient.
Independent local checks passed 34 lifecycle/recovery tests and seven downstream
context tests against the retained study inputs. These tests establish no new
model accuracy, native task score or live latency result.

## 2026-11-15: Bind the remaining stages to their actual allocations

The first $600 prospective API projection failed before creating a funding
sidecar. Existing holds already consumed part of preparation, development,
held-out and replay allocations. Revised only the prospective API plan to $303:
$45 for 36 development trials, $20 for four goal-grading batches charged to
development, and $238 held-out. No future preparation, training-library or
replay API work is needed. The observed $385.349380 retained balance, another
$20.696 GPU reservation and this plan sum to $709.045380, below the frozen $935
non-contingency limit. Prior requests, failed admission, unknown holds, base
policies and effective infrastructure ceilings remain unchanged.
The revised projection passed nine affected Node tests, 14 funding Python tests
and the TypeScript/schema check, including the exact retained-balance fixture.

## 2026-11-15: Prospective infrastructure-only funding authority

Added a creation-only supplement with original journal/slice/policy bindings,
unchanged historical holds and separate effective financial ceilings. The
infrastructure bridge opts into this authority; ordinary and frozen model/API
owners retain the base policy. Admission reserves the declared remaining API
headroom before another GPU. Provider and budget evidence distinguish both
authorities. Local tests cover journal recovery, strict native budgets, denied
overcommitment, changed identities, unknown holds and v3 training compatibility.
No live journal, provider resource, model call or immutable experiment artifact
was changed while implementing this authority.

Validation: TypeScript check passed; the full Node suite passed 299 tests with
two skips. Infrastructure pytest passed 313 tests with two skips and 111
subtests; research pytest passed 630 with 22 environment-dependent skips.
After final slice-binding and canonical-number checks, the affected eight Node
tests and 14 funding Python tests passed again. Initial local test failures were
an inaccessible default pytest temporary directory, an inherited older editable
Python package and a missing worktree virtualenv path; explicit local test paths
resolved them. No production code was changed to bypass those environment errors.

## 2026-11-13: Prospective GPU-hour engineering capacity

Added a creation-only operator sidecar for an explicitly authorized cumulative
GPU-hour reservation allowance of 128 instead of 64. The v3 financial policy and
all monetary/training/model limits remain unchanged. Reservation admission binds
the sidecar; validation retains the original operational history, including
unknown launches, costs and deadlines. Provider receipts record this separate
authorization. Tests cover unchanged monetary denial, unresolved-fence admission,
provider inventory, and compatibility with the actual unchanged 5a training-lease
reader. This is an infrastructure control change, not an experiment result.

## 2026-11-13: Serialize large training operation estimates

The real seed-17 run completed 204 updates, then failed receipt hashing because
HF's operation estimate was `7.51775264009134e16`, above the shared numeric range.
Future training receipts store `total_flos` as a round-trippable decimal string
and declare its encoding. Nonfinite/negative estimates remain invalid, and all
other metrics retain the existing shared-wire validation. The input metrics are
not mutated. Focused training/export validation passed 69 tests, including the
actual overflowing value and preservation of a large integer without rounding.
No active image, optimizer, checkpoint, historical receipt or tolerance changed.

## 2026-11-13: Record actual main training and closed baseline

Replaced the stale current-state claim that neither main seed had started.
The actual A100 observation at 17:24 UTC records 157/204 updates for seed 17;
the managed run queues the complete second seed. Current-state counts now match
the 358 accepted fitting triplets and complete 746-prefix baseline replay.
These are progress and baseline observations, with no trained-model gain claim.
The executing source and immutable artifacts remain unchanged.

## 2026-11-13: Add an explicit setup allowance

Added `setup_seconds` to reservation and preparation and `--setup-seconds` to
the controller CLI. Integer allowances from 120 to 3600 are accepted only for new
leases and clipped to the funded lifetime. Tests cover the unchanged default,
explicit persistence, short leases and rejection without a financial reservation.
No existing lease or experiment artifact is modified.

## 2026-11-13: Verify retained responses during goal grading and reliability

Two remaining readers compared replay receipts against the old five-field shape.
Reliability now calls the shared Python verifier and rechecks every retained file
after aggregation. The TypeScript grader validates the same payload declaration,
hashes, counts and ordered dispatch association before any grading request and
again at completion. Focused validation passed 42 Python and 19 TypeScript tests,
including resealed wrong-request/row evidence and changes during aggregation.
Type checking passed. Existing failure rows, model identities, training source,
audit gates and live execution are unchanged.

## 2026-11-13: Retain original FP32 DeltaNet decay values

Added a scoped Transformers strict dtype loader and exact checkpoint/loaded
parameter inventory. Training, profiling, export and evaluation carry or check
the precision policy through existing implementation and kernel receipts. The
focused Windows suite passed 73 tests, with 12 Torch-dependent and two Linux
process tests skipped. All 14 precision tests passed in Linux with actual CPU
Torch 2.13.0 and Transformers 5.10.1, including original FP32 loading, rejection
of rounded-then-upcast values, invalid tensor inventories and unchanged global
class metadata. These tests do not measure GPU serving parity or task quality.

## 2026-11-13: Read retained-response replay receipts

The full 746-case replay closed, but Python scoring rejected its additional
`responsePayloads` field. A shared receipt reader now verifies closure and the
declared response file, including hashes, counts and exact dispatch association.
Calibration uses the same reader and rechecks those files before returning.
Legacy receipts remain readable under their original undeclared-retention format.
Focused tests passed 76 cases, with one operator-held artifact test skipped;
Ruff passed. Actual validation checked all 746 prediction rows and 600 retained
responses without rewriting them. Initial local pytest setup failed because the
default temporary directory was inaccessible; a new task-owned directory resolved
that environment issue. This does not change model predictions or report a gain.

## 2026-11-13: Stop rehashing frozen inputs during every poll

The managed experiment loop now compares file identity, mode, size and nanosecond
timestamps while waiting. Full input hashes remain at admission and before/after
successful stages, alongside existing source and completed-artifact checks.
Focused Windows validation passed 17 tests with two Linux-only skips, including
an actual child drained after input mutation. Four actual Linux execution/source
tests also passed in WSL. A polling regression confirms 200
guard calls do not reread file contents, and a same-size mutation with hidden
metadata changes still fails the final cryptographic check. No active experiment
source, dataset, model or numerical acceptance gate changed.

## 2026-11-13: Reserve paired cohorts across serving switches

Added an explicit cohort reservation CLI and optional native configuration binding.
It reserves all trial roots atomically before the first predictor-weight segment;
the existing one-level trial/API reservation hierarchy is unchanged. A second
atomic write claims an entire declared segment using unique zero-cost markers.
Ordinary collection behavior remains the default. Focused tests cover retained
unknown charges, duplicate claims, persistence failures, changed schedules and
native configuration scope. These are accounting tests, not benchmark results.

## 2026-11-13: Separate complete serving prompts from reload probes

New unmerged exports first run the unchanged strict 256-token reload comparison,
then measure a complete neutral fitting prompt using the same BF16 inference
context. Probe schema2 binds deterministic fitting-only selection and exact token
IDs, retaining the artifact's existing weight identity. Python, TypeScript and
the HTTP qualification helper accept both explicit probe versions without
changing numerical thresholds. Focused validation: 39 Python tests, including
cross-language qualification fixtures, and five Node parity tests passed. These
are software checks, not a successful GPU serving qualification.

## 2026-11-13: Align goal inference with complete-outcome teacher targets

Clarified the shared predictor and supervised-goal instruction: simultaneous
requirements belong in each complete hypothesis; alternative hypotheses express
ambiguity. The instruction contributes to both predictor and candidate compiler
hashes. Existing shapes, probability checks, actor prompts, candidate binding and
the three training tasks remain unchanged. The original 372 labels, audit packet
and source-qualified bootstrap remain immutable. Corrected labels and actual
GPU/prediction results must be recorded separately when available.

## 2026-11-13: Reconstruct profiles from multiple sealed cohorts

Native profiling now verifies all original collection receipts and routes each
public checkpoint to its owning trace, task and environment. Import and profile
paths share compatibility checks. Node independently checks the source cohort and
raw-trace hashes before measurement; the original single-cohort path remains valid.

Focused validation passed 48 Python tests, including the pinned native gateway,
and nine Node tests; TypeScript checking and Ruff passed. A first pytest invocation
could not access the machine's default temporary directory; an explicit new test
directory resolved that environment failure. The new routing tests also reject
resealed source changes, reordered prefixes and rehashed ownership changes.
Actual read-only verification checked all 746 public prefixes in the 60+12 trial
aggregate and reconstructed four longest prefixes across both sources/domains,
replaying 37 already visible tool calls. No new actor proposals were executed.
These checks establish reconstruction, not task accuracy or latency improvement.

## 2026-11-13: Reuse original audits through verified parent lineage

Annotation and grading expansion now accept an original pilot against a native
aggregate only after the full parent manifest, literal public bytes, split and
checkpoint ownership pass. New expansion declarations retain that proof; existing
pilot files stay unchanged. Focused regressions cover byte reserialization, split
changes, foreign development rows and rehashed proof tampering. The actual
100-checkpoint pilot and 20 audit cases verified against the closed 72-episode
aggregate without a provider call. No labels or human-review claims were added.

## 2026-11-13: Gate replacement of an unobserved launch

Added an explicit unresolved-launch receipt validator and reservation/launch
parameters. The old lease and financial reservation remain byte-for-byte equal;
ordinary active leases, ambiguous predecessors and stale receipts still reject.
The old pair must remain scheduled and dedicated to its exact name, with a stale
owner heartbeat. New launches, including recovery canaries, require new controller
identities. Publishing a new lease cannot overwrite an unresolved prior state.
Offline tests cover receipt tampering, shared controllers, reservation totals and
late-arrival termination while leaving the replacement untouched. This does not
assert provider termination or invoice settlement for an absent instance.

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

## 2026-11-13: preserve regional launch provenance

Added a creation-only provider routing sidecar. Reservation and dispatch recheck the exact regional hardware/image, price ceiling, existing SSH public key and restricted firewall. The original financial binding and all prior leases remain unchanged. Offline routing tests cover actual launch payloads, altered prices/images/keys, wrong-region firewalls, resealed financial changes and refusal to overwrite a sidecar. No benchmark or cloud execution result follows from these tests.

## 2026-11-13: exploratory review provenance and replay diagnostics

Added explicit machine-review provenance to the manifest and reliability gate,
without changing default human-review admission. Replay persists parsed responses
and token log probabilities before output validation, binds the response-file
hash in its receipt, and retains bounded failure messages. The previous replay
only retained response hashes, so its post-response failures cannot be diagnosed
fully from those artifacts. New source requires fresh matched replay; old failures
and results remain unchanged. Validation and measured outcomes are recorded when
their actual runs complete.

## 2026-11-13: retain heartbeat failure diagnostics and retry transient requests

A local heartbeat worker stopped after an AWS SDK error during a full optimizer
run. Independent controller evidence records owner-heartbeat expiry and actual
termination. The completed first seed had already been exported; the second
partial attempt remains interrupted. This is an infrastructure failure, not a
model result. The prospective publisher retries transient connection/throttling
errors with bounded attempts, checks the original lease identity and deadline
before each attempt, and emits only allowlisted SDK diagnostic fields. It does
not print exception messages or credential/request values. Authentication
refresh failures remain explicit and do not extend watchdog grace.

Eleven focused retry, redaction, identity and deadline tests passed. Full integration
validation is recorded with the combined operator revision; these unit tests
do not establish credential lifetime or cloud recovery.


## Bounded evaluation infrastructure extension

A second append-only funding sidecar adds $15 compute and $5 associated charges.
It retains the first funding authority, all reservations and unknown outcomes,
and the frozen v3 API policy and $65 contingency. The infrastructure reader sees
$320 ($240 compute, $80 associated); the frozen API reader still sees its original
$1,000 policy and must retain the same $303 API projection. The new authority
permits one additional evaluation-only lease, at most six hours and $1.99/hour.
Optimizer authorization is rejected. An actual invoice is still required to
release prior reservations; termination alone does not reconcile money.

## 2026-11-16: Chained evaluation funding

Added a third creation-only funding sidecar with exact parent hashes and retained
lease, overhead, training-window and journal history. Python validates every
parent against the child's original baseline; TypeScript retains the same original
journal and frozen API projection. The new $420 infrastructure allocation splits
into $315 compute and $105 associated costs. Independent lifetime, cumulative
GPU-hour and API limits remain effective, and optimizer authorization remains
denied. Tests cover parent tampering, exhausted lease count, rate/lifetime limits,
frozen execution-lease validation and unchanged native budget behavior.
## 2026-11-16: preserve the heartbeat state port across delegation

A separate evaluation lease-count sidecar admits one additional lease beyond
the four existing v3 slots. It changes no monetary ceiling, GPU-hour allowance,
training permission or previous reservation. Both funding validation and new
reservation admission enforce the same effective count and prospective sidecar
binding. Canonical hashes use the existing operation-scoped pure memo; authority
files and retained history are still reread and validated.

The subsequent readiness repair accepts only the monotonic false-to-true result
of the existing server-owned readiness operation between publication reads.
It preserves every other identity, status, policy and deadline comparison.
Integration cases call the original readiness command and retain its smoke and
setup-deadline rejections; negative cases reject rollback and conflicting fields.
This is operator correctness evidence, not a scientific benchmark result.

Expose an explicit state-reader argument through `publish` and `_publish` so a
companion's bounded observation handling reaches both actual lease reads after
the pure-digest optimization. Default validation and all identity/deadline
checks remain unchanged. Focused tests cover both reads, default behavior,
`functools.partial`, changed identity, rejected observations and expiry.
Private startup qualification must include the real scheduled wrapper and
preflight; direct loop timing alone is insufficient. No scientific result or
model change follows from this operator repair.

## 2026-11-16: Preserve historical capacity validation

The count-only sidecar was created once; its first full validation then rejected
an authenticated older GPU-capacity snapshot as though it were today's ledger.
Keep that original failure and authority unchanged. Historical parent validation
now receives the monetary ceilings already validated against the complete current
ledger. Current count, retained-history, reservation and deadline checks remain
mandatory. A separate post-creation receipt must bind the original creator and
new validating source; this repair does not create another authority or host.

## 2026-11-16: Bound heartbeat digest memory per attempt

Actual startup missed its handoff deadline even though three closed-lease starts
had passed. Keep that failed attempt and all reservations. Profiling found two
large authority keys repeatedly excluded by the raw-key cache size bound. Memo
keys now retain a 32-byte SHA256 fingerprint of the same type-preserving marshal
serialization. RFC8785 remains the miss validator; all files and authorities are
still reread. One heartbeat attempt shares those pure hashes across its four
observations, then discards the scope before the next attempt or normal sleep.
The 128-entry bound, watchdog timeout, original deadlines and publication checks
are unchanged. Qualification must measure the real scheduled path again; unit
tests and operator timings establish no model, task-success or live-agent gain.

A separate parent-bound lease-count extension permits one sixth evaluation lease
when the fifth retained attempt consumes its slot. It retains the original v1
count authority and every historical row. Monetary and GPU-hour limits, frozen
API allocations and the optimizer prohibition remain independently enforced.
Creating or validating this count authority does not itself dispatch a host.

## 2026-11-16: Prepare the publisher before transferring ownership

The next real scheduled check failed despite the faster publication loop.
Its wrapper started about 67 seconds after bootstrap. Moving SDK preparation
into a resident worker lets the parent maintain genuine observations during
that delay. A nonce, source/configuration hashes, exact lease and process creation
identity bind preparation, release and acknowledgement. Preparation does not
mark the GPU ready. Cancellation is checked at the actual publication boundary.

Sixteen protocol cases and twenty actual Windows wrapper cases passed. Eleven
independent runtime/interface cases passed against the current launcher. The
versioned interface fixture corrects an older copied test that still selected
the preceding launcher. Three real scheduled checks then passed: post-release
20.233/35.701/39.342 seconds; whole preparation 101.053/111.591/119.618 seconds.
Each parent published three times before release, never after it. Every child
and task drained, financial bytes stayed identical, and no model or GPU ran.
The qualification result SHA-256 is
`43490917fc11fe7d1667dc3704cd55a6f9192e299c8cfcb366bf17ecf60e6dfd`.
