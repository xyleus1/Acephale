# GoalSpec v3 source and architecture audit

Audited 2026-09-15 before v3 changes. This is a source and implementation audit,
not a benchmark result. V1 and v2 outcomes remain unchanged.

## Correct source identities

**PASTE** is *Parallelizing Tool Execution and LLM Generation for Low-Latency
Agent Serving*, [arXiv 2603.18897v3](https://arxiv.org/abs/2603.18897v3), revised
2026-06-16. The earlier v1 title is *Act While Thinking*. V3 describes three
components: a pattern analyzer, a tool speculation scheduler, and an LLM/tool
co-scheduler. Patterns separate stable event signatures from current payloads;
symbolic mappings produce concrete arguments. Empirical validation precedes
admission. Scheduling considers expected exposed-tool-time savings and resource
cost, reserves authoritative capacity, and reuses only exact invocations.
Unconfirmed results stay outside actor history. The serving prototype uses
TypeScript middleware and a Python vLLM hook with queue, decode and KV-pressure
signals. Its evaluated workload families are DeepResearchBench, SWE-bench and
ScholarQA, with locally served Qwen models. A hosted OpenAI API integration cannot
claim to reproduce its in-engine control. [PASTE design and implementation](https://arxiv.org/html/2603.18897v3#S4).

**Salesforce** means *Speculate with Memory: Lossless Acceleration for LLM Agents*,
[arXiv 2607.12236v1](https://arxiv.org/abs/2607.12236v1), 2026-07-14. Its speculator
uses action-pair success/failure counts, full contextual episodes with argument
provenance and lessons, prediction-miss episodes, and recurring confusion pairs
surfaced after three observations. Memory updates are deterministic and occur
between completed tasks. It distinguishes action, observation and chained
prediction. The tau2 experiment predicts an observation and then the next action;
164 retail/airline tasks are replayed, excluding turn zero. Its 12.7% stateless
and 19.9% full-memory figures are exact read-action prediction accuracies, not
task-success scores. Live timing validation concerns ALFWorld and HotpotQA.
The actor context remains unchanged; predicted work is accepted only after exact
verification. [Salesforce method and evaluation](https://arxiv.org/html/2607.12236v1#S2).

**APIGen-MT** is a separate Salesforce data-generation/dataset contribution. Its
5,000 records can supply research examples with retained license and verification
lineage. Ingesting them does not implement the memory architecture above.
[Official APIGen dataset card](https://huggingface.co/datasets/Salesforce/APIGen-MT-5k/blob/main/README.md).

Neither inspected paper links an executable author implementation. Exact-title,
arXiv-ID and author/org-targeted GitHub searches did not identify an official
release on this audit date. Search results include independent inspired projects;
these are not substitutes for author code. This is an availability finding, not
proof that no unpublished or unindexed release exists. All local comparison arms
must remain labeled **paper-based implementations**, not verified upstream
reproductions.

## What v2 actually supplies

These findings refer to source before v3 edits:

| Local component | Observed behavior | Consequence |
| --- | --- | --- |
| `src/lib/goalspec/patterns.ts`, `miner.ts` | Bounded PrefixSpan contexts, field/index binding, restricted constants; successful endpoints seed mining | Useful structural foundation, but not the entire PASTE system. No string normalization or general dependency-graph executor. |
| `scripts/goalspec-build-library.ts` | Publishes 32 workflow records; transition/error keys are pattern IDs; calibration says `engineering_defaults_unfitted` | Pattern statistics are not action-pair contrastive memory. Fitted binding precision is not independent calibration. |
| `src/lib/goalspec/repository.ts` | `Experience` contains a workflow, summary text and embedding | The type has no full episode, observation, argument-source, outcome, lesson or miss-record fields. |
| `src/lib/goalspec/postgres-store.ts` | Retrieves compatible frozen workflows with vector/lexical rank plus scalar pattern-level priors | Database telemetry storage does not imply that predictor prompts receive episodic or confusion memory. |
| `src/lib/goalspec/compact-candidates.ts` | Each of three optional examples becomes only `{nextRead, after}` | Valuable contextual examples and exact argument relationships are discarded before inference. |
| `src/lib/goalspec/session.ts` | Retrieval query is `requestedObjective`, cached by requirement revision/scope/snapshot | New intermediate observations do not update the retrieval query. Contextual branches can receive the same early-task examples. |
| `session.ts`, `scheduler.ts` | Fixed confidence thresholds, ranked top two, bounded concurrency | No measured latency-benefit admission or candidate utility/resource ordering. Fast native reads can incur more prediction overhead than work saved. |
| `services/goalspec-runtime/actor.ts` | Goals and unrequested verified prefetch evidence are inserted into actor instructions | This is a behavior-changing GoalSpec intervention, not an actor-identical lossless baseline. |
| `research-bootstrap.ts` | Fixed three service workers and hosted OpenAI calls | No vLLM pressure telemetry or engine scheduling hook exists. |

## Changes justified by this audit

1. Keep deterministic late binding in the critical read path. Build a current
   source/value index once per boundary; cache schema validators. Never obtain
   current entity arguments by copying a historical example.
2. Add a separate, frozen speculation-memory artifact containing public episode
   segments and verified prediction misses. Retrieve using current public
   decision state, with compact deduplicated examples, and expose provenance to
   the predictor. Existing v1/v2 test material may become explicitly declared v3
   development material, never new held-out evidence.
3. Preserve successful and failed transition support separately. Surface
   recurring confusions as prediction advice, scoped to the current context;
   they cannot override user requirements or deny legitimate authoritative calls.
4. Use measured predictor, read, validation and queue time to admit useful work.
   For native in-memory tools, optimize unnecessary actor turns and prompt size
   before adding more API speculation. A latency model or injected delay is not
   a measured live gain.
5. Keep a control with unchanged actor input and exact-call promotion. Evaluate
   goal/evidence guidance as an explicit behavior-changing treatment. This
   separates execution optimization from task-planning changes.
6. Treat observation-conditioned actor prelaunch as a later, separately tested
   extension: accept only the identical public continuation and preserve tool
   IDs, reasoning continuation, authorization and full request cost accounting.
   No speculative mutation or user-message send is admissible.

These are implementation recommendations inferred from the source/code mismatch;
they are not claims that any particular change will improve live results.

## Benchmark interpretation

The pinned native checkout is Sierra's
[tau benchmark repository](https://github.com/sierra-research/tau2-bench), revision
`2174a603f6d014ef94473ffa95957f6ce27100db`, locally named `tau3`. New official-task
runs should retain the native task IDs, task bytes, policy, environment and reward
components, and disclose any user-simulator policy change. A selected task subset
is a native tau subset score, not a full official benchmark score. Generated
fixtures remain a custom tau-compatible pilot. Do not compare either directly
against the Salesforce paper's different prediction denominator.

Report native task success/pass1 and two-trial consistency separately from
next-tool accuracy, exact full-argument match and exact speculative consumption.
Include physical calls, failures, prediction overhead, total and interaction
latency, tail sample counts and family/task-clustered paired intervals. A same-task
latency or accuracy claim requires the paired control in that study. Existing v2
success and timing numbers are development history for v3, not a fresh control.
