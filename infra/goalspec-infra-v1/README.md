# GoalSpec infrastructure v1

This additive deployment runs fixed Qwen actors and predictors, the TypeScript
runtime, a Python research worker, and a private research database and telemetry
stack. It does not modify the Derya database or create AWS resources.

## Verified here versus required on the GPU host

The offline lifecycle tests and static configuration checks run without Docker,
credentials, model weights, or provider calls. This checkout's Windows host has
no Docker or NVIDIA command available. No GPU model was downloaded, no container
was started, no provider account was contacted, and no resource was provisioned.

The version list is a source pin, not a claim of deployed compatibility.
Container image resolution, actual PostgreSQL version, driver compatibility,
concurrent model fit, parsed tool calls, and telemetry ingestion must pass the
host preflight before an experiment can claim this deployment was verified.

## Local checks

From the repository root:

```text
python scripts/goalspec-infra-preflight.py
python infra/goalspec-infra-v1/control.py validate-config
python -m unittest discover -s infra/goalspec-infra-v1 -p test_control.py -v
```

Preflight reads only credential-presence booleans from the process environment.
It never searches local secret files, prints a credential value, calls a model,
downloads an image, or provisions a host. Exit status 2 means GPU prerequisites
are missing. Static validation does not replace `docker compose config`.

## Images and models

Use a Linux x86-64 host with a 48 GB NVIDIA GPU, driver 580 or newer, Docker and
Compose. Keep the pinned vLLM image's Torch, CUDA and Transformers packages intact.
Do not install another Torch wheel over them.

Resolve exact container contents before deployment:

```text
python infra/goalspec-infra-v1/control.py lock-images --output infra/goalspec-infra-v1/images.resolved.json
python infra/goalspec-infra-v1/control.py locked-compose --lock infra/goalspec-infra-v1/images.resolved.json --output infra/goalspec-infra-v1/compose.resolved.json
```

These are explicit image-pull operations. They stop if a pinned tag is unavailable
or lacks an amd64 image. They never substitute another release. The resolved
Compose file stays next to the source file so relative mounts are unchanged.

In a separate downloader environment, install `huggingface_hub==2.4.0`, then run:

```text
python infra/goalspec-infra-v1/control.py download-models --root /srv/goalspec/models
```

Only the actor and 0.8B predictor are downloaded by default. The 2B development
ablation requires an explicit `--roles predictor_capacity_ablation`. Official
repository revisions are in `versions.json`. Each model receives a file-by-file
SHA-256 receipt; existing receipts are verified, never overwritten. Serving uses
read-only mounts and offline Hugging Face mode.

## Start the private stack

Configure two external password files, outside the repository, and set
`GOALSPEC_POSTGRES_PASSWORD_FILE` and `GOALSPEC_GRAFANA_PASSWORD_FILE` to their
absolute paths. Configure `GOALSPEC_MODELS_DIR` and `GOALSPEC_ARTIFACTS_DIR`; the
artifact directory must be writable by the runtime UID 1000 and worker UID 10001
using a shared group or explicit host ACL. Do not make it world writable.

The `cpu` profile starts the research database and observability services. The
`gpu` profile additionally starts both vLLM servers. The `runtime` profile starts
the Node service; `worker` selects an on-demand Python worker command. Always use
the resolved file after image locking:

```text
docker compose -f infra/goalspec-infra-v1/compose.resolved.json --profile gpu --profile runtime config --quiet
docker compose -f infra/goalspec-infra-v1/compose.resolved.json --profile gpu --profile runtime up -d --build
docker compose -f infra/goalspec-infra-v1/compose.resolved.json --profile worker run --rm python-worker --help
```

Both inference servers stay resident for all arms. Actor GPU allocation is 0.65;
predictor allocation is 0.20. Actual simultaneous fit is a gate. Requests must
set `chat_template_kwargs.enable_thinking=false`; the adapter owns that setting.
The actor endpoint is `http://127.0.0.1:8000/v1`; predictor is port 8001.

The database publishes no host port. Published dashboards and APIs bind loopback:
Grafana 3000, Prometheus 9090, runtime metrics 4319, OTLP 4317/4318. Use SSH tunnels.
There is no Docker socket mount or privileged container. Each service has CPU/RAM
limits and no automatic restart policy. The runtime's outgoing network is explicit;
database, telemetry and inference services use the internal network.

Check actual database versions after startup:

```text
docker compose -f infra/goalspec-infra-v1/compose.resolved.json exec postgres psql -U goalspec -d goalspec_research -Atc "SHOW server_version; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

Require PostgreSQL 17.11 and pgvector 0.8.7. The pgvector tag is a candidate release
tag until this check passes; its digest is recorded before startup. If it packages
a different PostgreSQL patch version, stop and produce a correctly pinned image;
do not silently broaden the manifest's version requirement.

## Telemetry

The runtime exposes `/metrics` on 4319 and sends OTLP HTTP to Alloy on 4318.
Alloy forwards traces to Tempo, metrics to Prometheus and logs to Loki. Its file
log input reads only `/artifacts/**/logs/lifecycle.jsonl`; those files must contain redacted
lifecycle data, not raw user content or credentials. Raw replay artifacts remain
separate. The Grafana dashboard deliberately displays no data for unmeasured
metrics rather than inventing zero values.

The dashboard contract is `goalspec_tasks_total{arm,outcome}`,
`goalspec_task_duration_seconds_bucket{arm}`, `goalspec_tool_calls_total{arm,kind}`,
`goalspec_speculation_total{arm,outcome}`, `goalspec_prediction_total{arm,outcome}`,
`goalspec_goal_agreement_total{outcome}`, `goalspec_spend_usd{category}` and
`goalspec_reserved_usd{category}`. Cost gauges must represent disjoint known spend
and outstanding reservations to avoid double counting. Budget enforcement remains
in the durable dispatcher; the alert is not enforcement. Metrics absent from a
given experiment are left absent. Telemetry retention is 48 hours; export before
host cleanup. Application artifacts have their own retention policy.

## Bounded Lambda lifecycle

Official API contract: <https://docs.lambda.com/api/cloud>.
The client uses Bearer authentication against `https://cloud.lambda.com/api/v1`.
Do not use a public advertised price as a launch quote. `quote` obtains current
`price_cents_per_hour`, regional availability and a concrete `gpu-base-24-04`
image ID using read-only API calls. Authentication is loaded only for explicitly
requested provider commands.

The original durable study ledger must first reserve the infrastructure allocation
inside the total $500 ceiling with its $65 protected contingency. The infrastructure
ledger below enforces only that allocated infrastructure slice. It is not a second
source of truth for unrelated model spending. Initialization requires reconciled
historical amounts; it does not default to the old checkpoint.

```text
python infra/goalspec-infra-v1/control.py init-ledger --ledger /var/lib/goalspec/infra-ledger.json --overall-reserved-usd RECONCILED_TOTAL --prior-infra-usd RECONCILED_INFRA --prior-gpu-hours RECONCILED_HOURS
python infra/goalspec-infra-v1/control.py quote --region REGION --output /var/lib/goalspec/current-quote.receipt.json
```

Launch requires a separate always-on controller enrolled for the same ledger.
Install the supplied service/timer examples on that controller, configure its
provider credential in an external environment file, verify the timer is active,
and exercise watchdog recovery with a simulated lease before producing an
enrollment receipt. The receipt is an operator attestation, not proof that a
future machine/network outage cannot happen. The controller must not be the rented
VM or a laptop subject to standby. Run a second provider-control watchdog on an
independent controller before paid work; these source files do not establish that
such a controller already exists.

An enrollment JSON receipt contains `profile: "goalspec-infra-v1"`,
`controllerKind: "independent_always_on"`, `maxPollSeconds: 60` or lower,
`verifiedAt` as Unix seconds, and `ledgerPath` as the ledger's resolved path.
It must be verified within five minutes of launch.

```text
python infra/goalspec-infra-v1/control.py launch --ledger /var/lib/goalspec/infra-ledger.json --region REGION --ssh-key-name EXISTING_KEY_NAME --firewall-ruleset-id RESTRICTED_RULESET --hours 4 --extra-allowance-usd 2 --watchdog-receipt /var/lib/goalspec/watchdog.receipt.json
```

Launch fetches a fresh quote and reserves before one physical launch attempt.
The supplied regional firewall ruleset and existing global rules must permit only
TCP port 22 from restricted CIDRs (IPv4 /24 or narrower; IPv6 /64 or narrower).
The tool does not change existing account-wide rules. A broad existing rule blocks
launch and must be resolved independently without disrupting other workloads.
Maximum price is $1.25/hour; maximum session is eight hours; cumulative reservations
cannot exceed 24 GPU-hours or $35. At least $1 per session is reserved for tax,
billing lag and related overhead. Choose an allowance covering the actual account's
taxes and charges; it is not an automatic invoice estimate. Unknown launch charges
remain reserved and block another launch. No retry creates a second instance.

The watchdog terminates at the 30-minute setup deadline unless a passing smoke
receipt is registered with `mark-ready`. A smoke receipt must be generated from
actual CUDA allocation, both resident models, parser, continuity and telemetry
checks; include `profile`, `leaseId`, `passed: true` and detailed check results.
`mark-ready` hashes this receipt. It does not execute those checks itself.

Normal termination requires a verified local export receipt. The receipt contains
`leaseId` and a nonempty `files` array with relative `path`, `bytes`, and `sha256`.
Verification rejects changed files and paths outside the export directory.

```text
python infra/goalspec-infra-v1/control.py terminate --ledger /var/lib/goalspec/infra-ledger.json --lease-id LEASE_ID --export-root /safe/export --export-receipt /safe/export/receipt.json
```

`--emergency` skips the export gate to stop spending at a deadline. The watchdog
uses this mode. Normal operation exports continuously to reduce emergency loss.
Termination uses the provider API and verifies provider state. It never assumes
`shutdown` or `poweroff` stops billing. Reservations are retained after termination
until separate invoice reconciliation, so an uncertain response cannot free money.
The bounded costs depend on the watchdog and provider responding; outages remain
an operational risk, not a guaranteed financial cap.

## Final host verification

Before recording a paid experiment: validate every service's native configuration,
verify pinned image/software inventories, test both models concurrently, confirm
real tool-call IDs and argument parsing, check actor/predictor contention, ingest
one trace and metric, test artifact export, and test both watchdogs. Store the
receipts in the experiment manifest. Unit tests and static JSON validation do not
substitute for those live checks.
