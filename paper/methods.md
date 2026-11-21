# Acephale methods

Acephale tests whether source-grounded goal information helps a PASTE-inspired
prefetcher select useful read-only tool invocations. It extracts workflow and
episodic memory from agent trajectories, binds possible future calls to current
public evidence, ranks them and executes admitted reads during actor inference.
The actor retains the same weights, prompt, available tools and step limits. A
prefetched result enters the normal tool response only after the actor requests
that exact invocation and validation succeeds.

The hypothesis is empirical. Inferred goals can be wrong, retrieval can distract
the predictor and speculation can increase backend work or contention. Transparent
prefetch does not logically imply better task reward or fewer actor tool calls.

## Models and serving

The complete source pins live in
[`versions.json`](../infra/acephale-infra-v1/versions.json). Default weights are:

| Role | Model | Exact revision |
| --- | --- | --- |
| Actor | `Qwen/Qwen3.5-9B` | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` |
| Predictor | `Qwen/Qwen3.5-0.8B` | `2fc06364715b967f1860aea9cf38778875588b17` |
| Optional capacity ablation | `Qwen/Qwen3.5-2B` | `15852e8c16360a2fea060d615a32b45270f8a8fc` |

The default models use bfloat16 with vLLM 0.32.0, a pinned image digest and PyTorch
2.13.0. The immutable image declares CUDA base release 13.0.2; PyTorch separately
reports compile CUDA 13.0. Installed toolkit/component observations are retained
without inferring an entire toolkit patch from either value. Serving uses
`qwen3_xml` tool parsing and `qwen3` reasoning parsing. Thinking
is disabled for this profile. Actor context is 32,768 tokens: 28,672 input plus
4,096 output. Predictor context is 8,192: 7,168 plus 1,024. The fixed-predictor
configuration remains an explicit baseline. The separately declared predictor
LoRA experiment below changes only the auxiliary predictor's weights.

Prospective HF predictor training retains the pinned checkpoint's 18 `A_log`
vectors, 288 parameters, in FP32; all other floating base parameters use BF16.
It uses Transformers 5.10.1's `_keep_in_fp32_modules_strict` on a scoped model
subclass and verifies original tensor bytes after loading. The precision policy
and tensor inventory enter implementation and training/kernel receipts. A
historical adapter requires its original precision policy when reloaded. This
aligns decay storage with the pinned vLLM implementation without changing the
LoRA recipe, model revision, language-head dtype or serving acceptance threshold.
See the official [Transformers dtype loader](https://github.com/huggingface/transformers/blob/v5.10.1/src/transformers/modeling_utils.py)
and [vLLM Qwen DeltaNet parameters](https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/model_executor/layers/mamba/gdn/qwen_gdn_linear_attn.py).

The official OpenAI SDK targets local compatible endpoints through
`LocalChatModelPort`. It preserves real tool-call IDs and assistant continuation,
checks parsed arguments and records usage, refusal/incomplete status, streaming
timing and input hashes. The served tokenizer controls compilation. Policy,
requirements, tool contracts and current argument-binding evidence precede optional
history/examples; omissions are recorded rather than silently truncating fields.
Compiler v3 keeps source-addressable policy text once in the mandatory sources;
`policySource` points to it. Its bytes must equal the server-owned policy. Legacy
frames without a policy source retain top-level policy text without gaining a
synthetic citation target.

## Data and causal labels

Each trajectory separates public messages/tools from future actions, hidden task
data and independent outcomes. Families are assigned to training, development and
test before annotation or mining. Requested-goal annotations see only the public
checkpoint. Native state, user simulation and reward evaluation stay in Python.

Goal probabilities describe mutually exclusive interpretations of the complete
requested outcome. Each interpretation includes all concurrent explicit user
objectives; subgoals and execution prerequisites are not competing hypotheses.
The predictor instruction and supervised goal prompt share this interpretation.
Requested outcomes persist until the user changes or withdraws them. Progress
and execution permission are separate: completed parts of a joint request remain
part of that request, and an unconfirmed operation can be desired while still
unauthorized. The executor checks current state and permission independently.
The prompt correction changes the compiler contract hash, so earlier calibration,
qualification and replay artifacts cannot be relabeled as the corrected version.

Base collection may enable shadow prediction. Shadow requests use an existing
frozen training memory or a valid empty bootstrap snapshot. They cannot admit
tools or alter actor messages. A prediction qualifies as causal only if its
recorded completion precedes `actor_generated` for the same run, checkpoint,
frame and public-input identity. Labels use the actual generated calls, before
promotion or execution. Retrospective replay errors are not causal training errors.

Verified successful training endpoints support executable workflows. Verified
failed endpoints can supply contrastive episodes. Unknown/censored/provider-failed
outcomes remain in reports but are excluded from known-outcome memory. Every
memory publication is immutable, including additions of causal misses/confusions.
Changing the snapshot requires new compatible downstream artifacts.

Native multitask export defaults to the original 100 fitting checkpoints. An
explicit versioned expansion receipt may instead select every nonempty window
from the preexisting public eligibility artifact. It binds the original dataset,
split, compiler, partitions, complete public rows and unchanged 100-case pilot.
It cannot select a subset by observed read labels. The original 20 human audit
cases remain unchanged; additional annotations need their own retained lineage.
The requirements of 24 fitting families, at least four checkpoints per family
and 48 positive-read checkpoints still apply. A new aggregate dataset can reuse
the selection only through verified original-parent provenance and exact public
prefixes. Expansion changes the training population; it does not relabel the
original pilot or certify a trained model.

Imported `eligible_reads` labels identify allowlisted native read tools. They do
not assert that the runtime's stricter identity and ownership checks admit the
invocation at that prefix. Candidate coverage diagnostics separate those policy
rejections from missing admissible argument combinations and window truncation.

## Workflow and episodic memory

Bounded pattern mining records observed ordering, argument dependencies and
verified endpoints. Deterministic binding resolves fields or indices from current
visible sources. Historical entities are examples, never authority to construct
current arguments. Unsafe or unsupported bindings abstain.

Optional episodic retrieval uses a dedicated PostgreSQL 17.11 database with
pgvector 0.8.7 through direct `pg` SQL. Frozen embeddings use
`text-embedding-3-small`, 1,536 dimensions and an explicit encoder-version
descriptor. Their public-only projection includes requirements, previous tool and
the last six prefix items, capped at 1,900 code points. The artifact binds model,
projection, memory, episode, text and vector hashes.

Full-text and exact cosine retrieval apply compatibility filters before ranking:
memory/version, authorization, tool schema, environment, policy, training families,
current-run exclusions and heldout-family exclusions. At most 32 hits per channel
feed reciprocal-rank fusion with constant 60. The prompt admits at most four
examples, including at most one negative, and 16,000 characters. The 100 ms
deadline permits lexical fallback on unavailability, while integrity failures
fail closed. Replay freezes one completed result per checkpoint for both
conditions, including fallback; late dense results cannot change the second arm.

## Candidate ranking and admission

Graph and workflow proposals deduplicate exact invocations, keep valid current
bindings and interleave sources/tools up to 128 candidates. A goal-neutral
token-budget compiler freezes the common window before goal conditioning.
`InfraSession` makes one ranking request per checkpoint and retains at most three
selected candidates. It uses source-valid ready goals when an independent audited
Wilson agreement lower bound is positive; otherwise it ranks neutrally. This is
an enable gate, not a high-confidence task-accuracy guarantee. Goal refresh is
asynchronous and lower priority; there are no sequential neutral and conditional
ranking calls on the primary runtime path.

Candidate labels indicate exact invocation occurrence anywhere in the immediately
next authoritative batch. Several may be positive, so scores need not sum to one.
The binary decoder emits tokens autoregressively; each probability conditions on
earlier emitted tokens, rather than estimating an independent marginal.
`READ`, `NO_READ` and `READ_UNCOVERED` describe prediction states without changing
which tools the actor is allowed to request.

Eligibility defaults to denied. Admitted tools must be audited reads with current
authorization and source-bound arguments. Defaults are at most two concurrent
speculative reads per run, four globally, twelve starts per run, one-hop lookahead
and a five-second deadline. Authoritative work retains priority and reserved
capacity. Exact invocations join/promote an existing managed job. Duplicates await
confirmed cancellation; mutations invalidate pending evidence; shutdown drains
work and fences late results.

Native reads run against isolated Python-owned snapshots and freshness leases.
Document reads use immutable allowlisted content and exact receipts. A successful
validation result is required for consumption. A rejection is never represented
as an authoritative observation. Every speculative, wasted and validation call
counts as physical work even when the actor's logical call count stays unchanged.

## Calibration and deployment profiles

Calibration v3 binds next-batch invocation membership, the raw score semantics,
`empirical_next_batch_membership`, `selected_candidates`, and exact
model/revision, memory, retrieval, prompt and compiler. Training labels fit separate
neutral and conditional maps using fixed deciles, forward merging of empty bins
and Laplace(1,1) smoothing. Development results are diagnostics; test labels never
fit a map. A missing or incompatible artifact fails closed.

Goal conditioning additionally requires an annotation pilot and independent
review: the declared design is 100 annotations with at least 20 human-reviewed
examples, at least 90% semantic acceptance and zero unsupported bindings.
Independently graded training predictions provide agreement evidence. Agreement
with a teacher is not the native success metric.

The separate [machine-audited exploratory protocol](experiments/machine-audited-pilot-2026-11-13.md)
retains those 20 selected IDs and acceptance thresholds with zero human reviews.
Its critic uses a separate prompt/request to the annotation teacher's same pinned
model, so reviewer-model independence is not claimed. Dataset, training,
reliability and live manifests bind the exact machine-audit receipt. The default
human-reviewed protocol rejects these artifacts; automated review never supplies
a human-review count. Reports distinguish this exploratory evidence throughout.

Opportunity v2 binds eight hashes: hardware, serving/stream/concurrency, model,
memory, compiler, retrieval, prompt and protocol. At least ten complete measured
rows are required; failed rows remain. Paired actor inputs/seeds are identical.
The concurrent arm makes one neutral rank; once it returns, background goal refresh
starts alongside the scheduler-managed read. `predictionMs` ends at rank completion.
The separate `goalRefreshSpan` is recorded and drained, while concurrent actor
duration measures observed contention. Both actor outputs must request the exact
profiled read; proposed actor actions are not executed.

Six measured components are `actorLeadMs`, `contentionMs`, `predictionMs`,
`schedulingMs`, `toolMs`, `validationMs`. Aggregation uses p10 tool/lead benefits and
p90 costs, rejects negative paired actor excess and retains raw receipts/profile
hashes. This conservative admission heuristic is not a causal speedup result.
Changed deployment, stream setting, memory or retrieval requires new measurements.

## Evaluation and reporting

The paired live arms are base actor, neutral-memory prefetch and goal-conditioned
memory prefetch. All use the same actor, tasks, trial seeds, tools, budgets and
step limits; order is randomized within paired blocks. Repository memory and
calibration stay frozen. Failures, censored runs and undispatched reserved slots
are retained according to the declared design, never replaced with easier tasks.

Separate fixed-panel replay freezes up to three common candidates before goal
inference and requests a score for every ID. Both conditions use identical panels
and any-next-batch binary labels. Closed receipts are verified before private
labels are joined. Report binary log loss, Brier score, panel coverage,
missing/failed predictions and family-clustered paired intervals. These are not
full-action cross entropy or true conditional entropy. A test partition alone
does not prove untouched preregistered heldout evaluation.

Live reporting separates native reward/pass1, constraints, two-trial consistency,
logical actor calls, physical read/prefetch/revalidation calls, total latency,
tail sample counts, model overhead and billed costs. Exact argument matches and
speculative consumption rates are prediction/execution metrics, not task success.
Native task subsets disclose their denominator and pinned environment. Generated
tasks are a custom tau-compatible pilot. Neither is an official full-suite score
unless that complete benchmark was actually run under its stated protocol.

## Predictor LoRA experiment

The 2026-11-10 extension fits only the pinned Qwen3.5-0.8B predictor. The actor,
its available tools and authoritative execution remain unchanged. Separate goal
and ranking prompts use the same predictor checkpoint. A predicted goal or score
does not authorize execution. The deterministic scheduler retains all read-only,
current-source, freshness, cancellation and exact-match rules.

The production TypeScript compiler exports the exact bounded prompts used for
training. Goal targets omit server-owned revision hashes. Next-batch labels join
only after the public candidate window is frozen; future calls and evaluation
state never enter prompts or retrieval. Ranking targets contain an action class
and one binary hit per candidate in that frozen order. Inference requests both
0 and 1 token log probabilities, normalizes each raw pair and calibrates the
result on reserved families before selecting at most three candidates. New binary
artifacts declare `autoregressive_binary_conditional`; legacy v2 records retain
their original metadata and cannot validate a new binary predictor. Each
bit describes a separate candidate-hit event, so scores are not normalized
across candidates. The decoder is autoregressive: a bit probability conditions
on the previously generated action and bits. These are not independent joint
predictions or unconditional marginals, and require free-running calibration.
The legacy numeric ranking protocol remains versioned separately.

Weight fitting, calibration/reliability, development and test use disjoint
families. Frozen memory for the trained predictor contains only weight-fitting
families. Historical requested-goal annotations may bootstrap goal supervision
after provenance and human-review checks. Source-reported APIGen trajectories
do not become verified native workflows. The known overlapping baggage families
are quarantined from that seed import. Native tool labels require actual closed
authoritative traces; illustrative test fixtures are not training results.

Training uses the separate Linux dependency lock: PyTorch 2.13.0, Transformers
5.10.1, PEFT 0.21.0, TRL 1.16.0, Accelerate 1.15.0 and Datasets 5.2.0. BF16 LoRA
has rank 16, alpha 32 and dropout 0.05, with explicit Qwen text attention,
feed-forward and gated-delta projection targets. Vision, embeddings, language
head and base parameters stay frozen. Completion-only cross entropy uses
AdamW at 1e-4, weight decay 0.01, gradient clipping 1, warmup 0.03,
effective batch size 16, checkpointing and at most 8,192 total tokens. Fit-only
profiling selects microbatch/accumulation 4/4, 2/8 or 1/16 before either main seed.
Seeds 17 and 29 each have at most three epochs or 500 optimizer steps; both
share the declared fitting allocation. V2 adds four fitting hours; the subsequently
authorized v3 adds eight more, with a separate 15-minute smoke allowance. Each
window, including profiling, must fit the actual funded provider lease. Earlier
reserved windows remain counted. The original v1 lease retains its two-hour limit.

The trainer verifies the funded lease, actual CUDA environment, pinned source
and model/tokenizer receipts. It records gradients, finite losses, changed LoRA
weights and unchanged base hashes. Merged v1 export retains its original strict
reload/merge checks. Explicit unmerged v2 export preserves the FP32 adapter bytes,
the pinned BF16 base and every trained target; it separately declares BF16 vLLM
LoRA arithmetic. Its identity binds base and adapter inventories, tokenizer,
training specification, partitions, protocol and a numerical probe. New serving
probes use schema2 and the shortest complete neutral fitting prompt ordered by
`(promptTokens, id)`. The pinned chat template supplies the full assistant prefix;
no completion, calibration or test row enters selection. Dataset/specification,
row/family, prompt and input-token hashes accompany the probe. The internal
256-token strict reload check remains separate. Historical schema1 serving
probes retain their original meaning and receipts. No file is
silently cast or relabeled to bypass the failed merged export.

The v2 server must return the exact top token and a conditional binary probability
within 0.01 of PyTorch for the same recorded input token IDs. This predeclared
one-token gate tests loading and approximate numerical compatibility, not full
logit equivalence or model quality. The receipt binds the real response and
container identity; a subsequent inventory must observe the same source,
containers, commands, images and provider before admission. Old calibration or
timing profiles cannot validate a new checkpoint. Run execution and measured
outcomes are recorded separately in [STATE](STATE.md).

## Relationship to prior methods

[PASTE](https://arxiv.org/abs/2603.18897v3) motivates overlapping tool execution
with generation, symbolic invocation prediction, exact matching and cost-aware
scheduling. [Speculate with Memory](https://arxiv.org/abs/2607.12236v1) motivates
transition, episodic and prediction-error memory. Acephale studies adding
source-grounded goal conditioning to these infrastructure ideas. It does not
claim to reproduce every author implementation, engine hook or published result.

vLLM supplies serving, the SDK supplies protocol transport, PostgreSQL/pgvector
supply storage/retrieval, and OpenTelemetry with Grafana/Prometheus/Tempo/Loki/Alloy
supplies observability. The experimental binding, admission, provenance and
evaluation contracts remain Acephale code. No vLLM engine-level co-scheduler,
observation-conditioned actor prelaunch or general tool decoder is claimed.

## Fresh compositional task library

The staged study generates 44 operation-set families across retail and airline,
with two independent synthetic customers/entity variants per family. Partition
assignment precedes task construction: 24 families fit weights, six calibrate,
six develop the runtime and eight are held out subject to the remaining budget.
The operation sets differ across partitions; their primitive actions deliberately
overlap. Report that overlap and call this compositional generalization, not
unseen-intent evaluation. Native tool implementations, policies and product/flight
catalogs remain pinned. Official task files are not edited or relabeled.

Each blueprint specifies database outcome checks before a reference execution.
The verifier compares the complete native final database with those checks and
requires omission of every requested mutation to fail. Native DB reward remains
the success basis; action-list matching is not required. Live policy assertions
cover consent and retail authentication separately. These static checks do not
claim that an actor has completed the task or followed the conversation policy.

The annotation pilot selects 100 fitting prefixes across all 24 families, with
at least four per family and 50 per domain. It reads only public prefixes and
optional source-bound candidate-window eligibility. Twenty human reviews are
selected before annotation. Training requires complete neutral/conditioned/goal
triplets and at least 48 covered positive-read prefixes. Insufficient data fails
the preparation stage; repeating rows or importing evaluation families cannot
satisfy that floor.
