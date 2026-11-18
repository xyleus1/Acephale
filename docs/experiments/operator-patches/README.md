# Evaluation operator repairs

## Replay phase limits, 2026-11-18

E32 failed configuration validation during task registration: its two initial seed
phases specified 14,400 seconds, above the supervisor's 10,800-second maximum.
No task, provider lease or model dispatch followed. Its sealed inputs and failure
remain retained. E33 uses a fresh declaration and output namespace.

The [parser patch](20261118-replay-phase-limits.patch) allows 14,400 seconds only
for `seed17_01` and `seed29_01`. Other phases keep 10,800 seconds; exact integer
validation, source checks, execution clipping and the hard deadline are unchanged.
The [redacted manifest](20261118-replay-phase-limits.json) records 14 passing
offline cases and independent review, including the original rejection and the
candidate consumer's acceptance of the actual complete retained configuration.
This counterfactual configuration check establishes no E33 execution or benchmark
result. Source tests were not repeated for publication. Forward/reverse patch
application was verified against the manifest's exact source hashes. Apply with
`git -c core.autocrlf=false apply --unidiff-zero` to that private baseline.

## Parallel prediction replay, 2026-11-18

E31's first trained replay closed its neutral condition, then stopped at the
2,400-second selected-goal condition bound. It retained 745 completed neutral
predictions out of 746, and 314 completed plus 377 failed selected-goal predictions
out of 691 written rows. The separate output-format and grounding failures remain
research outcomes. No paired native actor trial ran. E33 is a prospectively
designated full replay attempt, with all original rows and both saved predictors;
E31's outputs and E32's undispatched registration failure remain retained.
E33 subsequently stopped at initial admission before GPU allocation or model
dispatch, so this wrapper has no E33 replay performance result.

The [wrapper patch](20261118-parallel-prediction-replay.patch) starts the three
condition containers after one successful precheck. Each condition keeps its
sequential row loop, separate output, full declared cohort and independent closure.
The wrapper runs three concurrent conditions. The prospective configuration
supplies a 7,200-second bound for each.
It waits for all workers, retains failed exports, and drains owned work on
cancellation. The frozen TypeScript predictor, prompts, model weights and numerical
gates are unchanged. Concurrent inference changes batching and may affect outputs
or replay timing; this is not a native latency or accuracy improvement claim.

The [redacted verification manifest](20261118-parallel-prediction-replay.json)
records original/candidate source hashes, nine passing offline cases, independent
review, and verified forward/reverse patch application. It contains no operator
paths or credentials. Tests were not rerun for publication. Apply the zero-context
patch with `git -c core.autocrlf=false apply --unidiff-zero` to the exact private
baseline files named in that manifest. The patch does not reconstruct the full
operator or authorize dispatch on its own.

## Read-only SSH connection attempts, 2026-11-18

E29 uploaded all 19 inputs, then stopped before evaluation dispatch when the
read-only remote input-verification SSH connection timed out. No evaluation log
was created. A later missing-export exception obscured the original transport
failure; it was not a numerical-admission failure. The retained observation has
SHA-256 `3af9f744ca1d7352cf2e6012257ae203c3040fd2f231aca857c3a68812614f5e`.

The [two-hunk patch](20261118-export-ssh-connection.patch) sets OpenSSH
[`ConnectionAttempts=3`](https://man.openbsd.org/ssh_config#ConnectionAttempts)
only on that existing read-only verification invocation. The ten-second connect
timeout, absolute ninety-second command bound, cancellation, authentication and
host-key checks remain unchanged. Evaluation dispatch, uploads, directory
creation and cleanup transfers receive no retry. The second change preserves
an earlier operation exception as primary when export verification also fails,
while retaining the latter as its explicit cause. `verify_transport`, including
archive integrity and completion qualification, is unchanged.

The [byte verification manifest](20261118-export-ssh-connection.json) records
exact before/after hashes and successful forward/reverse patch application.
Seven isolated author tests exercised the actual execution function and exact
SSH/SCP argument shapes. The initial fixture omitted SSH's `-T` option; the
corrected seven-case fixture and earlier fixture are retained. A separate actual
OpenSSH configuration-parser check confirmed three connection attempts and the
unchanged options without opening a network connection. These checks establish
neither the underlying timeout cause nor real connection recovery or benchmark
performance. No tests or parser calls were repeated for publication.

Apply with `git -c core.autocrlf=false apply --unidiff-zero` to the exact private
baseline named and hashed in the manifest. Canonical relative headers and zero
context omit unrelated private paths. This patch does not reconstruct the full
operator, runtime configuration or credentials from the public checkout alone.

## External controller start block, 2026-11-17

E28's two GitHub Actions controller checks completed with failure on November 17
at 14:44:38 and 14:44:39 UTC, before any job step or GPU dispatch. Both annotations
identify failed account payments or a spending-limit restriction. The retained
evidence does not establish which condition applies. Repository/account URLs,
job identifiers and raw API responses are omitted from this public summary.

The retained read-only check observation has SHA-256
`6daec55b7e992da6c3a4d915276c73d14b3a63dc90218ba339f2896c7b10b7d7`.
This is an external operational block, not an authority-fix or numerical-model
outcome. The authority patch and its verification manifest below are unchanged.
Final trained-replay and native benchmark results remain unavailable.

## Authority observation preparation, 2026-11-17

E27 completed foundation execution and export but did not admit the phase:
post-operation authority observations took 88.5591347 and 78.2148187 seconds,
exceeding the original 75-second repair window. Cleanup followed before main
evaluation, the numerical diagnostic, replay or native trials. No timeout is
extended by this correction.

Source inspection found repeated full local financial-chain validation. A
subsequent closed-state profile measured one full call at 11.8743202 seconds,
including 272 JSON reads, 532 canonical-digest calls and 104 file hashes. Earlier
network-component timing was unavailable. This sample establishes avoidable
local work, not the complete cause of the 78-89 second observations or a measured
live speedup.

The adapter fully validates one local baseline per actual owner/phase observer,
then reuses it only with current authority file-set/byte checks and a fresh
whole-ledger comparison. Only the existing typed readiness and cleanup
transitions may differ. It never silently rebaselines changed financial, source,
lease or unrelated-row state. Every observation still reads the exact provider,
signed owner, both controller acknowledgements and workflow run/jobs. Network
transports stay sequential, with unchanged timeout/retry behavior and final
freshness checks. The 75-second observation, 60-second signed-evidence and
120-second owner-heartbeat bounds remain unchanged.

Preparation runs inside the scheduled owner's existing locks and cleanup path,
before its first observation. Each phase child prepares after identity/deadline
validation and rechecks its original bound before dispatch. Preparation still
consumes the original lease and phase lifetimes. Direct unprepared observations
retain that work inside their existing interval; cleanup-only entry does not
require an active baseline. Safe monotonic stage timings retain failures without
API bodies, credentials or exception text.

Twenty-three focused cases passed for the reader, live-read composition,
mutation rejection, readiness/cleanup and timing boundaries. An entry audit then
found that scheduled study and phase subprocesses bypass standalone sequence
main. Five additional actual-function cases passed after those routes were
corrected. The 28 cases use isolated clocks, transport and temporary financial
ports; earlier fixture failures and the narrower original entry coverage remain
recorded. They establish neither live timing nor scientific success.

The [patch](20261117-authority-observation.patch) and
[byte verification manifest](20261117-authority-observation.json) cover six
behavior files and their required dependency-pin updates. Apply with
`git -c core.autocrlf=false apply --unidiff-zero` to the exact retained private
baselines named and hashed in the manifest. Applying and reversing the patch
reproduced both sets of bytes. The public checkout alone does not reconstruct
the full operator, private runtime configuration or credentials.

## Predictor numerical diagnostic, 2026-11-17

E20 passed the one-token serving gate. E26 completed strict export, then failed
that gate before trained replay or native trials. The retained adapter, probe,
2,630 input IDs, top token, predictor image, command and precision environment
match across those two attempts.

| Observation | Conditional probability of token 1 | Absolute reference difference |
| --- | ---: | ---: |
| Retained HF reference | 0.3629692055196168 | 0 |
| E20 vLLM response | 0.3629692055196168 | 0 |
| E26 vLLM response | 0.34864513533394575 | 0.014324070185671056 |

The tolerance remains 0.01. E26's binary log-probability difference changed from
-0.5625 to -0.625, consistent with a BF16-scale rounding change but not proof of
its cause. The HF reference uses the pinned BF16 base, preserved FP32 decay
parameters, an unmerged FP32-stored adapter and BF16 autocast. Serving declares
BF16 base and LoRA arithmetic. Weights, references and token IDs stay unchanged.

The prospective diagnostic uses standard `VLLM_TUNED_CONFIG_FOLDER` only for the
predictor. A GPU-specific `SHRINK.json` retains existing configuration fields with
only `split_k=1` changed. The pinned upstream
[resolver](https://github.com/vllm-project/vllm/blob/5df63a7203cdb9328d824a27b682e77c7b9928be/vllm/lora/ops/triton_ops/utils.py)
supports this override; its
[kernel](https://github.com/vllm-project/vllm/blob/5df63a7203cdb9328d824a27b682e77c7b9928be/vllm/lora/ops/triton_ops/kernel_utils.py)
uses a store instead of atomic addition for one split. This is a numerical
hypothesis, not an established E26 explanation or a determinism guarantee.
It enables neither global batch invariance nor an engine-code modification.

Each serving occurrence has two arms, each with exactly three predeclared
requests: new salt A, repeated salt A, then new salt B. The standard
[`cache_salt` field](https://github.com/vllm-project/vllm/blob/5df63a7203cdb9328d824a27b682e77c7b9928be/vllm/entrypoints/openai/completion/protocol.py)
changes cache domains without changing prompt IDs. These are cold-requested,
warm-requested and cold-requested conditions; cache reuse is verified only when
response evidence supports it. All baseline outcomes are retained. After a
predictor restart, all three configured responses must pass the unchanged gate.
Index zero is fixed for the ordinary proof; later successes cannot replace it.

Retain the exact container, environment, read-only mount and configuration hash,
and check the installed upstream resolver's selection. That check is not an
engine kernel trace. Actual configured qualification, trained replay and paired
native results remain pending; this note reports none.

The [producer patch](20261117-serving-numerical-configuration.patch) contains the
configuration, fixed diagnostic and host/transport changes. The
[companion patch](20261117-serving-numerical-companions.patch) binds that policy
to the actual container and downstream replay, calibration and native artifacts;
it also updates the native owner's direct helper pin. Frozen scientific schemas
and scoring formulas remain unchanged. The focused author suites passed 18
JavaScript, 12 Python producer and 21 companion cases with external effects
isolated. The first JavaScript run retained one production proof-timing consumer
failure; its correction passed all 18 cases. These are implementation checks,
not GPU numerical or benchmark outcomes.

The [producer manifest](20261117-serving-numerical-configuration.json) and
[combined byte verification](20261117-serving-numerical-companions.json) identify
every before/after file. Applying both patches reproduced all nine current
files byte for byte. The second uses `git -c core.autocrlf=false apply
--unidiff-zero` so unrelated private path context is omitted. Application
requires the retained private baseline files named and hashed in the manifest;
the public checkout alone does not reconstruct the full operator or its run
configuration. Runtime credentials and private evidence are not included.

## Prepared S3 transport retries

[`20261116-heartbeat-sdk-retry.patch`](20261116-heartbeat-sdk-retry.patch) changes
one Config call to [standard SDK retries](https://docs.aws.amazon.com/boto3/latest/guide/retries.html)
with three total attempts. Connect/read timeouts remain three seconds. The public
publisher, outer retry policy, ownership checks and watchdog are unchanged.

Thirteen cases use the actual owner SDK, signing and transport-retry code with
intercepted HTTP responses. They cover both controllers, GET recovery, identical
PUT bodies after uncertain commits, exhaustion, authentication errors and
authority/deadline rejection. These tests do not claim live retry execution or
repair of every streaming-body failure. The
[byte verification manifest](20261116-sdk-retry.json) records the original and
repaired helper hashes; applying the patch reproduced the reviewed bytes exactly.

## Serving file argument and heartbeat acknowledgement

[`20261116-serving-path.patch`](20261116-serving-path.patch) converts the module
filename to `Path` before passing it to the existing strict file hasher. The
original code failed before serving SSH or model execution. Seven local cases
exercise the actual preparer and transport entry against the retained export,
with remote effects intercepted.

[`20261116-heartbeat-ack.patch`](20261116-heartbeat-ack.patch) separates a timely
child heartbeat's arrival from its subsequent verification. Arrival remains
bounded by the original 90 seconds. Both parent and child derive acknowledgement
expiry from the child's heartbeat plus 60 seconds, clamped to original host
deadlines. The patch retains actual two-controller readbacks and all record,
ownership and cancellation checks. Seventeen cases pass; operation timing is
simulated from the retained arrival/cancellation scenario, not measured S3 latency.

The [verification manifest](20261116-repairs.json) records original and repaired
file hashes. Both patches were applied to fresh copies with
`git -c core.autocrlf=false apply`; every resulting byte hash matches the reviewed
file. These operational fixes do not change model weights, scoring or numerical
tolerances, and their tests are not benchmark results.

## Dataset envelope

[`20261116-dataset-envelope.patch`](20261116-dataset-envelope.patch) is the exact
change to the study's `prepare_evaluated_main_v2.py` helper. It is published as an
operator patch because the surrounding run configuration contains private local
paths and credential-loader locations. The patch contains no credential values.

The extractor retains `inventory.json` beside five dataset payloads. The old
producer froze only the payloads, so the strict export host rejected the sixth
file before model execution. The repair verifies the previously approved archive,
binds its exact inventory hash and requires complete six-file coverage. It neither
uploads a replacement inventory nor relaxes the consumer's integrity checks.

| File identity | SHA-256 |
| --- | --- |
| Original helper | `5a925da4a4a39462d7f94f77288f2c3313030b68acacdb22ea4c9fadc0817c71` |
| Repaired helper | `70dbbdd8a3607c674bf92220d949db8eddc4edfeaa24d038b0162fe90e5cb7d8` |
| Approved dataset inventory | `cb3b015151bc74ac7e52a4c621d452306aa0d87ebc7e6d73c47217bb01a656cb` |

Applying the patch with `git -c core.autocrlf=false apply` to the original helper
reproduced the repaired bytes exactly; automatic CRLF conversion must be disabled
when checking these byte identities.
Eight independent regressions used the real retained archive, extractor and
producer with the exact strict-host completeness loop: the original defect was
reproduced, the repaired binding passed, and six tampering cases were rejected.
The existing 60 export tests also passed. Historical authorization times are
explicit test fixtures, not evidence of current cloud authority.

This is a packaging repair. GPU export, vLLM qualification and benchmark results
remain separate gates; these tests establish no accuracy or latency improvement.
