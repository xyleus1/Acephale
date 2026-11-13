# Acephale decisions

## 2026-11-13: Bound prospective setup windows

Allow an explicit setup interval up to 3600 seconds when reserving a new GPU
lease. Downloading pinned images, building the trainer and measuring a real
training batch must fit their declared stage bounds. Retain the 1800-second
default, the funded hard deadline, independent watchdogs and all existing lease
deadlines. This changes infrastructure admission only, not the training recipe,
model, data or evaluation protocol.

## 2026-11-13: Apply replay closure checks to semantic grading

Goal reliability and blind goal grading must consume the same verified replay
closure as scoring and calibration. Accept declared retained responses only with
their exact bytes and ordered checkpoint/request audit links. Recheck the files
after aggregation or grading. This is an analysis-reader correction, with no
change to the original executions, prediction selection or audit thresholds.

## 2026-11-13: Preserve checkpoint decay precision before main training

The pinned predictor checkpoint stores 18 DeltaNet `A_log` vectors in FP32.
The previous BF16 Transformers load rounded them, while pinned vLLM constructs
these parameters in FP32. Use the official Transformers strict dtype mechanism
on a local subclass, without changing its global class or forward code. Verify
all 288 values byte-for-byte against the pinned checkpoint and retain BF16 for
other floating base parameters. Bind the policy to new training specifications
and reject historical adapter reloads under a mismatched policy. This corrects
an observed implementation mismatch; it does not waive the serving threshold or
establish that the remaining numerical disagreement is resolved.

## 2026-11-13: Validate additive replay evidence when reading it

Accept the declared version of retained provider-response metadata rather than
stripping it to satisfy the old scorer. Verify complete cohort accounting, the
sidecar bytes and their ordered association with recorded dispatches. Missing,
corrupt or mismatched evidence fails validation. Preserve the source identity of
the original execution separately from the corrected offline analysis reader.

## 2026-11-13: Keep full input hashing outside the child polling loop

Repeatedly hashing the entire input inventory every 250 ms consumed substantial
local CPU during a bounded tokenizer export. Retain full cryptographic validation
at admission and both successful-stage boundaries; use regular-file metadata
snapshots for early changes while the child runs. Capture metadata before and
after hashing so a racing write cannot establish a new accepted baseline.
Metadata monitoring is not continuous content verification. A successful receipt
still requires every original hash, and any detected mutation drains owned work.
This is runner overhead reduction, not evidence of model or task latency gains.

## 2026-11-13: Preserve whole-cohort funding across weight segments

The original paired schedule stays frozen before execution. A prospective serving
schedule may regroup complete blocks by their preassigned predictor weight, while
retaining every original run, actor seed, family and randomized within-block arm
order. All selected trials are reserved before any segment executes. Segment
claims persist in the original journal, so a process failure cannot silently
replace a trial. Each later segment still needs a fresh budget checkpoint and its
own qualified predictor, calibration, goal reliability and opportunity artifacts.
Group time and predictor seed remain confounded and must be reported explicitly.

## 2026-11-13: Qualify serving with a complete fitting prompt

The retained 256-token serving probe ends inside a candidate identifier in an
unfinished user message. It tests identifier continuation, not the intended
assistant response. Future unmerged exports therefore select the shortest complete
neutral fitting prompt by `(promptTokens, id)`, without examining completions or
evaluation rows. Probe schema2 records its dataset, training specification, row,
family, prompt and exact input-token identities. Keep the separate internal reload
probe and both numerical acceptance thresholds unchanged. The old failed probe
and qualification remain immutable; the new probe requires a new real serving run.

## 2026-11-13: Make joint-outcome hypothesis semantics explicit

Teacher instructions already require alternative complete goal hypotheses with
total probability one. A separate AI semantic audit found a training example
that divided three concurrent requirements into competing partial objectives.
The runtime used weaker wording, although conditioning consumes all hypotheses;
blind goal grading selects the highest-probability one. Clarify the shared runtime
and training prompt before fitting or replay. Keep the JSON shape and probability
validation, but require the new compiler hash and fresh downstream artifacts.
Structural multi-goal label review is a prospective consistency correction, not
evidence that every multi-goal label is wrong or that human review is complete.

## 2026-11-13: Route aggregate profiles through their original collections

An aggregate import does not replace its original execution receipts. Native
profiling verifies every source, applies the importer's shared compatibility
checks and reconstructs each public prefix from its original task and trace.
Source cohort and raw-trace hashes accompany the Python gateway proof and are
checked by Node before model or read dispatch. One-cohort configuration remains
supported. This permits combined calibration data without merging native state
or changing the evaluation split.

## 2026-11-13: Preserve the original audit when aggregating native cohorts

A multi-cohort dataset does not create a new human audit. Reuse the original pilot
only when its complete parent provenance and exact public prefix identities are
verified. Record the original-parent proof in downstream annotation expansions.
Keep calibration-family labels separate from fitting labels and preserve the
original dispatcher budget cap; additional annotation requires its own declared
bounded batches and retained provider lineage.

## 2026-11-13: Preserve uncertain launches behind dedicated cleanup controllers

An empty running-instance listing cannot establish that an uncertain launch was
never created or billed. Keep its status, full reservation and original cleanup
controllers. Explicit replacement admission requires two fresh, independently
hosted old-name fence observations, enabled schedules, exact function permissions
and an expired owner heartbeat. Both replacement controllers must be distinct.
Revalidate before launch; never turn absence into a termination or zero-cost claim.

## 2026-11-13: Verify imported parent prefixes as original bytes

Use literal JSONL source lines for parent-file SHA-256 verification. Parsing is
required for cohort ownership and semantic checks, but reserialization cannot
establish original byte identity across Python and JavaScript. Preserve all
existing parent manifests and failed import-stage receipts.

## 2026-11-13: Use the official FLA integration before sizing full fitting

Pin `flash-linear-attention[cuda]` and `fla-core` at 0.6.0 without changing the
existing Torch, Transformers, PEFT or TRL versions. Validate the actual chunk,
recurrent and fused-normalization implementation on each Qwen DeltaNet layer.
Keep PyTorch convolution, SDPA full attention and unpacked examples. Record the
observed kernel profile in both training and throughput artifacts.

The old PyTorch fallback step took 125.55 seconds. It is not a reason to reduce
the declared three-epoch, two-seed recipe. A fresh numerical qualification and
measured profile must determine the full run's allocation. No speedup is claimed
until that measurement exists. See the [kernel declaration](experiments/training-kernels-2026-11-13.md).

## 2026-11-13: Expand fitting coverage without selecting positive outcomes

The original 100-case public pilot had 17 exact positive-read windows, below the
unchanged requirement of 48. An offline audit reconstructed every pool and window
from its frozen public eligibility artifact before joining fitting labels. All
372 preexisting nonempty windows contain 79 positives. The new optional receipt
therefore selects that complete existing set, retaining failures and NO_READ
examples, rather than choosing positive checkpoints or lowering the gate.

This is an explicit training-design change after a failed data gate. Preserve
the original pilot, its 20 audit cases, annotation attempts and earlier report.
Additional goal annotations require separate provenance. Calibration and heldout
families remain excluded from weight fitting. Most allowlisted-read misses are
runtime authorization rejections, so those policy checks are unchanged.

The new receipt binds source, split, partitions, original eligibility/compiler,
original pilot, exact ordered checkpoint IDs and complete public-row hashes.
Export records its identity in each compiled row. Current and historical
100-case exports retain their previous default selection behavior.

## 2026-11-13: Keep one source-addressable policy in predictor context

Predictor compiler v3 includes the full policy once in the mandatory source
records and uses `policySource` to identify it. The equality check against the
server-owned policy and source-reference validation remain required. Frames
without a policy source retain their top-level policy text and gain no invented
citable source. Neither input limits nor evidence priority change.

This changes compiler and prompt identities. Apply it to a new training/export
phase after the active collection closes; retain that collection's original
source and every earlier artifact. Recompile training and recalibrate before
deployment. A token-count diagnostic is not evidence of live task improvement.

## 2026-11-13: Native goal supervision and staged training

Keep the Qwen actor frozen and fit only the auxiliary predictor. Export matched
neutral/conditioned ranking examples and goal targets from the teacher's actual
source-bound annotation contract. Preserve policy citations only when they match
the current policy. Record raw autoregressive bit probabilities separately from
calibrated next-batch membership; historical v2 artifacts are not rewritten.

The fresh task design holds out combinations of five primitive operations per
domain. Its 24 fitting, six calibration, six development and eight test families
have two generated entity variants each. Primitive intents and native product/
flight catalogs are shared deliberately. This tests compositional generalization,
not unseen intents or an official benchmark score. Verify each reference outcome
and missing-mutation negative control before actor execution. Live consent and
authentication assertions remain separate measured constraints.

The user approved a rebalance within the original $500 ceiling: infrastructure
50, preparation 45, training collection 30, development/calibration 40, held-out
240, replay 30 and protected contingency 65. A versioned sidecar retains every
old reservation and adds four fitting hours plus a 15-minute smoke allowance.
A separate access amendment may replace deleted temporary provider access, while
preserving the original financial plan. No paid lease extends beyond its deadline.

Collect 60 fitting/calibration base trials with a $0.40 hosted-call cap, reserving
$24 against the remaining training allocation. Development uses three paired arms
with a $0.50 cap per trial. These are ceilings, not expected costs. Main training
may have no development loss dataset; calibration and development evaluations
remain subsequent stages, and both predeclared seeds are retained.

The initial 2.5-hour collection/smoke and 7.25-hour fitting/evaluation estimate
excluded unknown provider tax. Reserve a conservative 30% tax allowance instead
of assuming zero. An append-only infrastructure suballocation changes the
compute/associated split from $41/$9 to $36.25/$13.75, keeping the same $50 total,
original journal and $65 contingency. The $4 AWS allowance and two termination
canaries remain counted. This leaves a later GPU target of at most five hours,
subject to actual remaining funds and measured fitting speed. The phases are
separated by human label review with no idle GPU. The eight fresh test families
provide at most 96 held-out slots, further limited by development-based cost
sizing. These bounds do not promise that every stage will fit.

## 2026-11-10: Training windows are operational ledger records

Exclude trainingWindows from the immutable versions-amendment financial binding,
as already done for leases and overheads. The controller appends these windows
only after its active-lease, idle-GPU, deadline and cumulative 7,200-second checks.
All original plan and financial limits remain bound. No ledger or amendment is
rewritten, and this controller-only repair does not change the frozen research
runtime, models, predictor recipe or provider deadline.

## 2026-11-10: Preserve pinned controller input bytes on checkout

Set LF checkout attributes only for hardware-profiles.json, lambda_gpu_watchdog.py
and lambda_watchdog_deploy.py. Existing receipts bind their LF bytes, already
present in Git objects. Windows autocrlf conversion is not a new hardware profile
or watchdog release and must not require rewriting immutable ledger bindings.

## 2026-11-10: retain writable trainer caches per run

Set the trainer's home and library-cache environment explicitly to directories
inside its existing writable output mount. Create and verify them as the actual
host UID, record the environment and launcher hash, and preserve caches with run
artifacts. Do not change image/model pins, use root, enable network access or
write into immutable model/data mounts to solve the observed unwritable home.

## 2026-11-10: recover a full training cohort without erasing failed slots

Preserve the first aborted 12-slot cohort and its two observed successes. After
the concrete telemetry repair, declare a new complete cohort with the same task
variants, order, seed and actor under a new experiment ID. Do not selectively
replace failures, merge partial receipts or label the first cohort completed.
Both attempts remain in reporting and all dispatch costs use the original journal.

Permit explicit upstream `ALL_WITH_NL_ASSERTIONS` for declared constraint audits.
It retains each task's original reward basis and pinned budgeted teacher. Known
constraint counts require nonempty actual results and complete multiset coverage;
absent or incomplete assertions remain unknown. This measures the configured
assertions, not comprehensive policy compliance, and supplies no goal supervision.

## 2026-11-10: preserve freshness while removing repeated SSH setup

Actual fresh SSH probes exceeded the 2.5-second observation deadline before
native dispatch. Reuse a bounded authenticated SSH session for fresh correlated
probes and owned forwarding. Never reuse a previous observation as a fresh one,
extend the three-second status lifetime, or admit work during connection setup.
Preserve failed startup evidence and bind the repaired source to new deployment
and preparation artifacts. The original task design, models and budgets remain.

Untrained and trained binary predictors must share the same reviewed calibration
families, candidate order and compiled prompts. Compare raw fixed-panel scores
separately from full-window selection; a three-candidate panel's top-three hit
rate is coverage, not proof of improved ranking. Report both training seeds.

## 2026-11-10: correct CUDA metadata without replacing the serving image

The raw pinned OCI index, linux/amd64 manifest and config establish an image
CUDA_VERSION of 13.0.2. The upstream Dockerfile's 13.0.3 default did not describe
this built image. Keep the exact image digest, actor/predictor revisions,
hardware settings and budgets. Record `servingCuda=13.0.2`,
`servingCudaSource=immutable_image_cuda_version` and `servingTorchCuda=13.0`.
Collect actual toolkit/component metadata separately; neither value establishes
an entire installed toolkit patch.

The original financial slice retains its original versions hash. A creation-only
sidecar permits exactly these three metadata corrections after verifying the
complete raw OCI digest chain and unchanged financial/model/hardware identities.
It cannot authorize a different image, model, budget or hardware profile.

## 2026-11-10: preserve provider identity across both runtime guards

Lambda execution uses its actual API association, pinned SSH host key and local
machine-id hash. Python and Node must verify the same receipt and compute the
same heartbeat provenance; a permissive instance-ID regex alone is insufficient.
AWS's existing identity path remains separately validated. An observed host key
is operator-pinned trust, not provider attestation.

## 2026-11-10: train the small predictor, retain the fixed actor

Implement an explicitly scoped LoRA experiment on the pinned Qwen3.5-0.8B
auxiliary predictor. This extends the earlier fixed-weight decision without
changing Qwen3.5-9B actor weights, prompt, tool catalog or native limits. Goal
conditioning guides speculative read selection; the scheduler remains the
authorization and execution boundary. No actor fine-tuning, model soup or RL
is part of this experiment.

Use production-compiled prompts, completion-only supervised loss, the separate
locked PyTorch/Transformers/PEFT/TRL environment and immutable adapter/merged
artifacts. Replace uncalibrated numeric score generation in the trained path
with a versioned binary-hit protocol using both raw token log probabilities.
Keep the existing predictor protocol as an explicit baseline.

Reserve disjoint weight-fitting, calibration/reliability, development and test
families. Memory for trained predictors excludes every non-fitting family.
Existing APIGen labels need source checks and the declared 20-example human
review before goal supervision. Preserve the research-only license and do not
represent source-reported trajectories as independent native replay.

Use the explicitly qualified A100 40 GB profile if current Lambda capacity,
price and serving/training checks pass. Stop actor serving during training.
Cap two seeds together at two GPU hours, retain the $500 original journal,
$35 infrastructure ceiling, protected contingency and unresolved reservations.
Provider credits do not create a new allowance. Bind provider leases to that
same original ledger, independent cleanup controllers and verified exports.

No benchmark gain follows from these implementation choices. Select the
checkpoint with development evidence, freeze it, and measure matched replay
and paired native trials before asserting accuracy or latency improvement.

## 2026-11-07: standalone fixed-actor infrastructure study

Acephale contains only the research runtime, tools, data preparation, evaluation,
deployment and observability needed for goal-conditioned speculative reads. The
actor is pinned Qwen3.5-9B and the default predictor is pinned Qwen3.5-0.8B. Actor
weights and available tools remain fixed across primary arms. Capacity changes
or weight training require separately declared experiments.

Compare base actor, neutral-memory prefetch and goal-conditioned memory prefetch
on the same tasks/seeds. Use one ranking request per checkpoint, source-grounded
arguments, independent next-batch hit marginals and exact-invocation promotion.
Only audited reads may execute speculatively. Goals are predictor context, not
permission to alter actor tools or authorize side effects.

Use the standard serving/SDK, direct PostgreSQL/pgvector SQL and OpenTelemetry
stack. Python retains native environments and private evaluation. Freeze family
splits, memory, calibration and deployment profiles before scoring. Keep native
reward, logical calls, physical calls, wall latency and costs separate. Do not
equate matched-panel binary log loss with full-action entropy.

Preserve the original external $500 journal and unresolved reservations through
the repository split. The filesystem location is private operator configuration.
Historical reports and hash-bound artifacts remain unchanged in the original
checkout and history; they are not implicitly eligible training or evaluation
data for Acephale. New claims require new compatible artifacts and measured trials.

## 2026-11-07: verification and CI identity

Local/CI unit tests use Python 3.12.14; the independently observed live deployment
still requires its pinned Python 3.12.16. This is an explicit test-environment
choice, not a silent serving-model or production-runtime substitution.

Pin the CI runner to Ubuntu 24.04, setup actions to verified commits and the
pgvector service to its verified image digest. GitHub's
[runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
announces an Ubuntu-latest transition this month, so the moving alias would weaken
reproducibility. CI installs locked dependencies, applies direct research SQL and
runs real disposable-database integration. Record remote results only after
execution. The [completed main-branch run](https://github.com/xyleus1/Acephale/actions/runs/42357269977)
at `d510c1bbc139e09fe9e40ed1145daead87fbfb18` now establishes CI integration for
the research PostgreSQL/pgvector code. It does not establish production publication
or native task accuracy.

Keep initial failures, targeted repairs and full-suite runs distinguishable in
verification records. Never transform a fixed single test into an invented fresh
all-passing full-suite result, and never count overlapping reruns twice.

# 2026-11-10: Pin the trainer's required C toolchain

Actual installed TRL 1.16 source invokes its fused LM head independently of the
`torch_compile` and Liger flags. Triton's driver build failed in the original
trainer image because no C compiler existed. Add only the observed GCC and libc
development-header closure: 32 exact Debian package versions, included in the
image-input hash and retained installed-package inventory. A CPU-only probe on
the pinned Python base compiled and imported a C extension. Keep model, Python,
training recipe and network-isolated runtime behavior unchanged; require a fresh
image receipt and actual CUDA smoke before claiming readiness.

# Guard lifetime belongs to the native supervisor

The guard's optional thread stop event permits a daemon-independent Windows
supervisor to stop it normally after its native child ends. It retains the same
freshness checks, bounded probe, SSH ownership and final degraded publication.
The event does not authorize restarting trials or releasing unknown charges.

# 2026-11-10: Preserve native failures separately from remote observability

Classify runtime split-guard failures as stale, degraded or identity, with only
finite age and effective freshness limit in diagnostics. Do not expose status
payloads or filesystem errors. Preserve every guard predicate and its deadline.
Failed OTLP requests and SDK shutdown failures make observability incomplete;
they cannot overwrite the original execution error or abort. Local recording,
queue and publication failures remain fatal. Request counters do not prove
backend durability, and a post-run export cannot relabel an earlier rejection.
This follows the OpenTelemetry
[runtime error contract](https://opentelemetry.io/docs/specs/otel/error-handling/).

# One observation budget for remote and local identity checks

Use the same 2.5-second deadline for the fresh SSH observation and parallel local
model catalogs. Remove the separate 0.5-second HTTP cap; do not increase the total
deadline or the 3-second consumer freshness limit. Publish fixed diagnostic stage
names and numeric timings only. Exceptions still poison the current session and
replacement requires confirmed drain. A failed soak remains failed; this change
requires a fresh compatible inventory and read-only soak before native dispatch.

# Failed panel compilation remains a declared comparison outcome

A fixed-panel predictor must refuse to silently shorten its panel to fit context.
Reporting may recognize the resulting failed ordered-prefix compilation only
with complete pre-request evidence. Keep the original full panel identity and
failed row, and do not invent a dispatched prompt or score. Completed or
dispatched predictions still require exact full-panel agreement. Pin this
reporting-only correction separately from previously frozen execution source;
never modify or reseal its immutable inputs.
# 2026-11-11: Give the explicit one-step smoke a positive learning rate

Select smoke mode explicitly from the smoke CLI, require exactly one optimizer
step and set its effective warmup ratio to zero. Record that ratio and mode in
the immutable training specification. Preserve the declared fitting recipe,
including 0.03 warmup for both seeds, and do not infer smoke mode from max-steps
alone. The pinned scheduler rounds the original smoke warmup to one step; the
actual first step then applies learning rate zero. Keep all gradient, adapter
change, frozen-base, lease and reload/merge checks. Preserve failed attempts and
use a separate source-bound recovery declaration for the trainer change.

## Normalize public trainer COPY permissions within future builds

Docker COPY preserves restrictive checkout modes. Normalize explicit public
source/contracts directories, packaging files and required parents after uv sync,
so both the image user and host-UID launcher can read implementation and lock
hashes. Do not recursively chmod /app, .venv or any mounted data. Preserve the
failed images and external permission-only recovery receipts as their own actual
provenance; this final integration fix requires a newly built source-bound image.

# 2026-11-11: Scope permission recovery and report the actual denominator

An exact-parent trainer image may correct public-file read permissions only after
verifying its parent layers, configuration delta, copied byte hashes and actual
unprivileged implementation probe. Preserve the failed attempt and bind a new
recovery declaration. This does not authorize dependency/model substitution,
checkpoint resume, a new training window or selective seed retry. Optional
standalone evaluations may be explicitly omitted before dispatch; retain the
main training/evaluation recipe and describe the resulting measurement gap.

Report mixed fitting/calibration/development native success separately from
development-only success. Candidate-pool coverage is not ranking accuracy, and
autoregressive binary probabilities are not independent marginals or full-action
entropy. Keep absent results and unknown outcomes explicit.

## Match precision context across training verification probes

Pinned Accelerate 1.15.0 prepares native-AMP models by wrapping forward with
autocast and FP32 output conversion. PEFT 0.21.0 defaults to promoting low-precision
adapter weights to FP32. The former saved probe inherited that wrapper while a
fresh export forward lacked an explicit equivalent context. Use the same explicit
BF16 autocast/inference/eval helper at all three probe sites and bind its versioned
context to immutable artifacts. Reject legacy probes instead of resealing them.
Keep existing reload/merge tolerances and full-vocabulary/top-token checks. This
method inconsistency is established; attributing every observed Qwen logit error
to it still requires a new authorized actual-model experiment.

## 2026-11-13: Separate fixed-base collection from trained-serving recovery

The fresh actual smoke passed adapter reload but failed the unchanged merged
comparison. Fixed-base native collection has no dependency on that export and
continues on its original source and task slots. Preserve both failed GPU
attempts and every unresolved charge. Do not let future-source code changes
silently change a running collection's model, compiler or data identity.

Declare a separate unmerged-LoRA artifact rather than widening merge tolerances.
Preserve exact FP32 adapter bytes and all trained targets, bind the pinned BF16
base, and explicitly declare vLLM's BF16 LoRA arithmetic. Require strict PyTorch
reload, a predeclared real HTTP numerical sanity probe and a fresh subsequent
process inventory. This gate is not a model-quality or full-equivalence claim.

Profile one disposable fitting-only optimizer step before either main seed.
Choose the largest fitting microbatch from 4/4, 2/8 and 1/16; fallback only on CUDA
OOM. No profiling weights enter main fitting, evaluation or served artifacts.

The user's additional spending authorization removes the former $500 ceiling.
Use a $1,000 working policy with an append-only amendment chained to v2, while
retaining every historical reservation and the $65 contingency. Apply only after
the active v2 phase closes. No billing observation alone clears unresolved costs.

Use separate base development-validation trials to supply the declared validation
families. Preserve all parent receipts in aggregate imports and keep those trials
distinct from paired live controls. Annotation reviews may transfer only when
their exact source, checkpoint and label ancestry is verified.

## 2026-11-13: regional capacity is an explicit operator amendment

A capacity-driven region change must be recorded separately from the original financial plan. It cannot silently change hardware, model recipes or hourly allowance. Region-specific image and firewall identities are verified again before dispatch. An unresolved prior launch retains its reservation and status; a route sidecar by itself is insufficient authority for another launch.

## 2026-11-13: explicit exploratory annotation review

Allow a separately declared machine-audited exploratory protocol while the
original human review remains pending. Preserve the same 20 cases, 90% acceptance
and zero unsupported bindings. Record the critic's actual pinned model, separate
prompt/request and shared-teacher limitation. Human counts remain zero; default
human-reviewed admission rejects machine artifacts. Retain pre-amendment results
and run a complete matched baseline under the new compiler identity.
