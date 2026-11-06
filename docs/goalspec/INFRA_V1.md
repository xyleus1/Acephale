# GoalSpec infrastructure v1

GoalSpec observes public agent checkpoints, retrieves compatible historical
workflows, binds current arguments, and executes admitted reads concurrently with
actor inference, before a later matching tool invocation. Exact matching actor
calls can join and consume verified work.
The primary profile changes execution infrastructure, not actor weights, prompts,
or the tool catalog. Historical v1-v5 artifacts remain unchanged.

## Implementation

- `InfraSession` dispatches prediction asynchronously, checks a conservative
  overlap opportunity before retrieval, shares a goal-neutral candidate pool,
  attenuates conditional rankings by independently calibrated goal agreement,
  and fences changed requirements, mutations, cancellation and shutdown.
- `LocalChatModelPort` uses the served model's tokenizer, preserves actual call
  IDs and assistant text, rejects malformed arguments, and records provider
  lifecycle, usage, input hashes and whole-group context omissions. No hosted
  OpenAI request type is used to fake a local model request.
- The version 2 experiment manifest pins Qwen3.5-9B, Qwen3.5-0.8B, their exact
  revisions, vLLM image digest, actual hardware/software inventories, dataset,
  memory, calibration, schedule and budget hashes. Old manifest validation is
  unchanged. The checked-in example is a schema fixture, not a deployment receipt.
- The native worker connects to the authenticated Python step gateway. Python
  retains environment state, leases, user simulation, reward and native batches.
  Promotion misses do not fabricate authoritative tool calls in Node.
- The document adapter admits only currently visible identifiers from an
  immutable HTTPS allowlist. Content hashes and exact local read receipts permit
  validation without a second physical HTTP request. Authoritative repeats remain
  permitted; speculation deduplication does not restrict the actor.
- `configureDeryaInfra` installs an explicitly configured runtime into the
  existing generic chat integration. It uses the five audited read wrappers,
  current office-wide operator authorization, separate read-only transactions,
  complete projection revalidation and no epoch shortcut. Defaults and the
  existing GPT-5.6 actor remain unchanged.
- JSONL/Parquet data exports separate public prefixes, future action labels,
  outcomes and provenance. Family partitions precede mining. The memory bridge
  reuses the existing validated contextual episode format. Symbolic workflows
  use current-source binding, verified endpoints and support from multiple
  families. Historical entity values never become current arguments directly.
- Telemetry writes bounded asynchronous event artifacts, redacted lifecycle logs,
  atomic Prometheus snapshots and actor/tool OTLP spans. A separate metrics
  endpoint aggregates actual run snapshots. Model, goal, ranking, admission and
  validation events remain available in JSONL; not every event has a dedicated
  engine-level span. No vLLM in-engine co-scheduler has been implemented.

## Commands

For the current completion path, use [native preparation and launch](INFRA_NATIVE_LAUNCH.md),
[fresh data and admission artifacts](INFRA_ADMISSION.md), and
[AWS account and host readiness](../../infra/goalspec-infra-v1/AWS_READINESS.md).
The native preparation command freezes official task bytes and a checkpoint of
the original budget. The Python launcher owns its gateway and starts the new
fixed-Qwen runtime. Neither preparation nor calibration fine-tunes actor weights.

Run commands from the repository root unless stated otherwise. Output directories
must be new; immutable experiment directories cannot be overwritten.

```text
npm ci --ignore-scripts
npm run goalspec:check
npm run test:goalspec-infra
npm run test:goalspec
npm run test:goalspec-v5
npm run goalspec:infra -- doctor
python scripts/goalspec-infra-preflight.py
```

Prisma client generation is required for application integration imports. It can
run with a nonconnecting fixture DATABASE_URL; generation does not migrate a DB.
Python research dependencies use the existing frozen uv lock:

```text
cd research/goalspec
uv sync --frozen --group dev --extra analysis
uv run --frozen --extra analysis pytest --basetemp runs/infra-pytest
uv run --frozen python -m goalspec.infra_cli --help
```

Python CLI commands include `split`, `export`, `pilot`, `memory`, `verify`,
`validate-goals`, `audit`, `import-v5`, `replay-patterns`, `fit-calibration`, `score-predictions`,
and `report`. Each command exposes required arguments through `--help`.

```text
node --import tsx scripts/goalspec-infra-memory.ts PILOT_DIRECTORY ORIGINAL_MEMORY_PLAN NEW_OUTPUT
node --import tsx scripts/goalspec-infra-annotate.ts PILOT_DIRECTORY EXISTING_SHARED_LEDGER NEW_OUTPUT EXPECTED_PILOT_HASH
node --import tsx scripts/goalspec-infra-predict.ts PILOT_DIRECTORY RUNTIME_MEMORY NEW_OUTPUT LOCAL_PREDICTOR_URL 100 neutral
npm run goalspec:infra -- prepare-corpus research/goalspec/examples/infra-document-sources.json NEW_CORPUS_JSON
npm run goalspec:infra -- profile CORPUS_JSON NEW_OUTPUT
npm run goalspec:infra -- live CONFIG_JSON NEW_OUTPUT
npm run goalspec:infra-native -- CONFIG_JSON NEW_OUTPUT
npm run goalspec:infra -- serve
```

The teacher command requires the existing nonempty shared spending ledger and
securely configured OPENAI_API_KEY. It reserves each physical attempt, performs
no automatic retries, keeps uncertain reservations, retains all declared rows,
and imposes a $5 cohort limit. The teacher is GPT-5.4-2026-03-05. The intent-label
compiler retains policy, requirements and decision evidence; it omits the tool
catalog because this teacher is labeling requested intent, not choosing a tool.
Human audit remains a separate required input.

For a newly exported dataset with a separate pilot directory, append
`--dataset DATASET_DIRECTORY` to the teacher command. Both inventories, the family
partition and exact predeclared pilot membership are checked before dispatch.
The combined historical pilot needs no extra argument.

Raw prediction replay uses deterministic round-robin family partitions and excludes
test rows. It never executes predicted tools. Fit calibration from a closed replay
in the research environment:

```text
python -m goalspec.infra_cli fit-calibration --bundle DATASET_DIRECTORY --predictions RAW_PREDICTION_DIRECTORY --condition both --output NEW_OUTPUT
```

The fitter uses training rows only, reports separate development scores, and binds
the result to the exact model, prompt/compiler, candidate compiler and memory.
Runtime admission requires calibration from the pinned predictor contract.
Neutral and conditional rankings have separate fitted mappings, retained under
one artifact hash. Goal-conditioned execution rejects a missing conditional map.
Predictor compilation preserves mandatory policy, requirements and exact current
binding slices before optional whole observations and retrieved examples. The
served tokenizer determines the final input budget and omissions are recorded.

The low-level Node native CLI requires GOALSPEC_GATEWAY_URL and
GOALSPEC_GATEWAY_TOKEN for a running Python-owned gateway. The new
`goalspec.infra_native_runner` launcher creates that gateway, injects its token,
checks the service readiness identity and retains native orchestration and the
fixed user simulator. Live configs require real frozen manifests;
non-base trials additionally require compatible memory, calibration and measured
opportunity artifacts. Goal-conditioned trials require audited reliability.

Document live configs use `version: 1`, `stage`, `manifestPath`,
`ledgerCheckpointPath`, `corpusPath`, `tasksPath`, actor/predictor base URLs,
artifact paths, a predeclared task/arm/seed schedule, `maxSteps`, and
`maximumLifetimeSeconds`. Paths are relative to the configuration file.
The corpus hash must equal the manifest environment revision. Comparison stages
require complete three-arm blocks. They emit `paired-design.json` and
`paired-results.jsonl` compatible with the Python reporter. Cost remains null
until accounting supplies actual cost; missing cost is never converted to zero.

## Deployment and budgets

See [the deployment instructions](../../infra/goalspec-infra-v1/README.md) and
[AWS readiness](../../infra/goalspec-infra-v1/AWS_READINESS.md).
They cover exact model downloads, image locks, private Compose services,
Grafana/Prometheus/Tempo/Loki/Alloy, price preflight, guarded Lambda lifecycle,
independent watchdog enrollment and verified artifact export.

Infrastructure is capped by the approved $35 slice, at most $2.50 per GPU-hour
and at most 24 cumulative GPU-hours. The founder explicitly approved the hourly
increase from $1.25 on 2026-11-06; every other limit remains unchanged.
The legacy Lambda controller retains its stricter $1.25 limit; the AWS controller
uses the authoritative `versions.json` cap. Provider/control-plane failure can prevent
an automatic termination; the watchdog tooling does not promise a physically
impossible unconditional billing guarantee. The infrastructure slice must be
reserved in the original $500 study ledger before any rental is dispatched.
Historical unresolved reservations and the $65 contingency remain protected.

## Executed results and current limits

See [the implementation report](../../research/goalspec/reports/2026-11-05-infra-v1/README.md).
The report distinguishes existing-trace replay, adapter profiling, integration
tests, and unexecuted live-model evaluation. No actor or predictor was fine-tuned.
The new model weights were not downloaded, and no paid request or rental was
made during this implementation.

The local machine has no NVIDIA runtime or Docker command available. Configure
credentials through an external secret store into the executing process; an API
authentication check does not establish a credit balance. GPU smoke tests,
teacher execution, the 20-example human audit, fresh Qwen trajectory collection,
calibration on those outputs, and live paired native trials remain external
execution prerequisites. Production activation remains off. Two-hop speculation,
observation prediction, serving-pressure coordination and vector-retrieval
experiments remain follow-on work, as specified by the ordered plan.
