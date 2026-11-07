# Native gateway component profiling

Use the [v2 methods runbook](INFRA_METHODS_V2.md) for the current artifact profile,
causal memory, retrieval and evaluation sequence.

The native profiler supplies measured opportunity inputs after a closed fresh
base collection and runtime-memory export. It does not train model weights or
execute a new official task. Run it on the guarded GPU host with the unchanged
pinned Qwen actor and predictor serving. Lexical-only profiling makes no hosted
model calls. Optional episodic retrieval can call the hosted embedding provider
through the original development budget.

The Python process reconstructs each selected public prefix in a new in-memory
retail or airline environment from the exact pinned tau source. It reapplies the
official initialization data/actions and then the prefix's prior tool calls,
including mutations, only to that private environment. Every replayed result must
match the recorded content and error flag exactly. Private task definitions and
database state remain in Python; only public messages, policy and tools enter the
actor. No future action, reward, annotation or hidden task instruction selects the
profiled read.

Create a JSON configuration with these explicit fields. Paths resolve beside the
configuration. This is a shape example, not runnable measurement evidence:

```json
{
  "version": 1,
  "datasetPath": "fresh-native-dataset",
  "cohortPath": "closed-native-base-collection",
  "memoryPath": "fresh-native-memory/runtime/artifact.json",
  "manifestPath": "observed-native-profile-manifest.json",
  "ledgerCheckpointPath": "original-ledger-checkpoint.json",
  "budgetDirectory": "ORIGINAL_BUDGET_DIRECTORY",
  "actorBaseUrl": "http://127.0.0.1:8000",
  "predictorBaseUrl": "http://127.0.0.1:8001",
  "stream": true,
  "limit": 30,
  "seed": 0,
  "maximumLifetimeSeconds": 3600
}
```

Use a new valid observed deployment manifest, with `data.datasetHash` set to the
fresh dataset bundle hash, `data.memoryHash` set to the exported memory hash, the
original family partitions, the pinned native environment and models, and the
chosen manifest seed. Preserve the source collection's immutable manifest. The
new manifest source commit must identify a clean committed checkout containing
the profiling implementation. The ledger checkpoint must still match the
nonempty original journal at its original path. The profiler verifies that journal
under its exclusive lock and freezes its existing byte prefix for sequential
workers; it never creates a replacement. Optional `episodicEmbeddingsPath` selects
the frozen corpus and requires secure `GOALSPEC_RESEARCH_DATABASE_URL`. Embedding
requests reserve and settle against the original development allocation. GPU
charges remain governed by the existing infrastructure reservation,
gross hourly cap, cumulative/session limits and independent provider watchdogs.

From the repository root, using the installed pinned tau Python environment:

```text
python -m goalspec.infra_native_profile --config NATIVE_PROFILE.json --output NEW_NATIVE_MEASUREMENTS --upstream-root PINNED_TAU_CHECKOUT
```

Set `PYTHONPATH` to this checkout's `research/goalspec/src` if needed and provide
the live `GOALSPEC_HOST_STATUS_FILE` heartbeat. A missing, expired or degraded
heartbeat prevents dispatch or interrupts the current worker and retains failure.
The entry point starts a temporary authenticated loopback gateway. Gateway tokens
exist only in process memory/environment and are not written into artifacts.

Selection uses the same current-source candidate compiler and read policy as
native prediction replay. It round-robins training/development families with
visible eligible candidates, never heldout families. The first eligible candidate
and its existing ID are frozen before any new inference. For each declared row:

1. Verify its captured public messages and schema against the closed collection.
2. Reconstruct the native state and verify all prior tool observations.
3. Run the identical seeded actor input alone and concurrently with one neutral
   ranking request. As ranking returns, start background goal refresh concurrently
   with the scheduler-managed native read. Pair order alternates by the declared
   ordinal. `predictionMs` ends at rank completion; `goalRefreshSpan` remains a
   separate recorded span, fully drained and excluded from the six admission spans.
4. Perform the actual projection-copy read through `NativeReadExecutor` and the
   Python gateway, then the actual server-side freshness-lease refresh. Preserve
   both Node gateway-inclusive intervals and independent Python operation clocks.
5. Drain both actor/predictor operations and the scheduler. Retain raw model
   responses, unchanged tool-call IDs, scheduler events, prefix/source hashes,
   host-health samples, native operation receipts and every declared failure.

If a worker or gateway operation cannot confirm physical drain, later rows are
retained as undispatched failures. The profiler publishes
`incomplete-measurements.json` and a receipt with `closed: false`, without publishing
the aggregatable `measurements.json`. Resolve the running host/operation through
the existing watchdog and preserve its reservation; uncertainty is not a zero
charge or successful cleanup.

The actor's newly proposed calls are never executed. Both actor responses must
actually request the profiled exact read. `actorLeadMs` ends when the baseline
actor decision is returned, not when its inference request is sent. Contention is
the paired difference of concurrent and baseline actor duration. Negative excess,
replay drift, missing costs, unsuccessful reads, rejected leases and timeouts are
failed rows, without zero or synthetic replacements. A prefix ending inside a
native message/tool batch or involving hidden user tools is unsupported and is
also retained as failed. Replay nondeterminism can reject a prefix even when the
original run succeeded.

The main output is `NEW_NATIVE_MEASUREMENTS/measurements.json`:

```text
python -m goalspec.infra_cli build-opportunity --bundle FRESH_NATIVE_DATASET --measurements NEW_NATIVE_MEASUREMENTS/measurements.json --output NEW_NATIVE_OPPORTUNITY
```

Version 2 measurements and raw rows bind the actual hardware, serving settings
(including `stream`, which defaults to true), models, memory, compiler, retrieval,
prompt and profiling protocol. Runtime must match all eight profile hashes. The
actual retrieval factory determines its hash. Changing the deployment or frozen
memory requires new compatible measurements, not editing an existing artifact.

At least ten completed rows are required for aggregation; failed rows remain in
the denominator. More declared rows are not permission to retry the same failed
design until it looks favorable. This paired component profile is a noisy
admission heuristic. It does not demonstrate causal contention, task success or
live latency improvement. The subsequent frozen three-arm comparison is still
required, and fast in-memory native reads may correctly yield no admissible
speculation.

Offline verification covers paired order/input/ID preservation, missing and stale
components, negative contention and drain after failure. An optional test with
`GOALSPEC_TEST_TAU_ROOT` set to the installed pinned checkout performs an actual
native snapshot and freshness-lease HTTP round trip with mocked actor/predictor
responses. That test makes zero model calls and is not live timing evidence.
