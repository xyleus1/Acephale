# Acephale infrastructure v1

This standalone deployment runs fixed Qwen actors and predictors, the TypeScript
runtime, a Python research worker, and a private research database and telemetry
stack. The deployment definitions are inert until an operator explicitly launches them.

## Verified here versus required on the GPU host

The offline lifecycle tests and static configuration checks run without Docker,
credentials, model weights, or provider calls. Their results establish code
behavior only. Actual deployment, training and evaluation require retained
provider, container, model, export and cleanup receipts.

The version list is a source pin, not a claim of deployed compatibility.
Container image resolution, actual PostgreSQL version, driver compatibility,
concurrent model fit, parsed tool calls, and telemetry ingestion must pass the
host preflight before an experiment can claim this deployment was verified.

## Local checks

From the repository root:

```text
python scripts/acephale-infra-preflight.py
python infra/acephale-infra-v1/control.py validate-config
python -m unittest discover -s infra/acephale-infra-v1 -p test_control.py -v
```

Preflight reads only credential-presence booleans from the process environment.
It never searches local secret files, prints a credential value, calls a model,
downloads an image, or provisions a host. Exit status 2 means GPU prerequisites
are missing. Static validation does not replace `docker compose config`.

## Images and models

Use an explicit hardware profile from `hardware-profiles.json`. The original
48 GB A6000 guard remains intact. The A100 40 GB profile requires at least 39,000
MiB observed VRAM, actor concurrency one, actor context 32,768 and predictor
context 8,192. Both profiles require driver 580 or newer, Docker and Compose.
Keep the pinned vLLM image's Torch, CUDA and Transformers packages intact.
Do not install another Torch wheel over them.

Resolve exact container contents before deployment:

```text
python infra/acephale-infra-v1/control.py lock-images --output infra/acephale-infra-v1/images.resolved.json
python infra/acephale-infra-v1/control.py locked-compose --lock infra/acephale-infra-v1/images.resolved.json --hardware-profile a100-40gb-v1 --output infra/acephale-infra-v1/compose.resolved.json
```

These are explicit image-pull operations. They stop if a pinned tag is unavailable
or lacks an amd64 image. They never substitute another release. The resolved
Compose file stays next to the source file so relative mounts are unchanged.

In a separate downloader environment, install `huggingface_hub==2.4.0`, then run:

```text
python infra/acephale-infra-v1/control.py download-models --root /srv/acephale/models
```

Only the actor and 0.8B predictor are downloaded by default. The 2B development
ablation requires an explicit `--roles predictor_capacity_ablation`. Official
repository revisions are in `versions.json`. Each model receives a file-by-file
SHA-256 receipt; existing receipts are verified, never overwritten. Serving uses
read-only mounts and offline Hugging Face mode.

## Start the private stack

Configure two external password files, outside the repository, and set
`ACEPHALE_POSTGRES_PASSWORD_FILE` and `ACEPHALE_GRAFANA_PASSWORD_FILE` to their
absolute paths. Configure `ACEPHALE_MODELS_DIR` and `ACEPHALE_ARTIFACTS_DIR`; the
artifact directory must be writable by the runtime UID 1000 and worker UID 10001
using a shared group or explicit host ACL. Do not make it world writable.

The `cpu` profile starts the research database and observability services. The
`gpu` profile additionally starts both vLLM servers. The `runtime` profile starts
the Node service; `worker` selects an on-demand Python worker command. Always use
the resolved file after image locking:

```text
docker compose -f infra/acephale-infra-v1/compose.resolved.json --profile gpu --profile runtime config --quiet
docker compose -f infra/acephale-infra-v1/compose.resolved.json --profile gpu --profile runtime up -d --build
docker compose -f infra/acephale-infra-v1/compose.resolved.json --profile worker run --rm python-worker --help
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
docker compose -f infra/acephale-infra-v1/compose.resolved.json exec postgres psql -U acephale -d acephale_research -Atc "SHOW server_version; SELECT extversion FROM pg_extension WHERE extname='vector';"
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

The dashboard contract is `acephale_tasks_total{arm,outcome}`,
`acephale_task_duration_seconds_bucket{arm}`, `acephale_tool_calls_total{arm,kind}`,
`acephale_speculation_total{arm,outcome}`, `acephale_prediction_total{arm,outcome}`,
`acephale_goal_agreement_total{outcome}`, `acephale_spend_usd{category}` and
`acephale_reserved_usd{category}`. Cost gauges must represent disjoint known spend
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

The original durable study journal remains authoritative. The Lambda controller
uses the same exclusive infrastructure pointer as the AWS controller, preserving
unknown reservations and preventing another slice from resetting GPU hours.
The approved limits are $500 total, $35 infrastructure, $30 GPU compute, $5
associated charges, $65 protected contingency, $2.50/hour, eight hours per session
and 24 cumulative GPU hours. Credits do not raise these limits. The observed
A100 rate was $1.99/hour; every launch rechecks the actual quote and capacity.

```text
python infra/acephale-infra-v1/control.py init-ledger --ledger SLICE --plan PLAN --prior-gpu-hours RECONCILED_HOURS
python infra/acephale-infra-v1/control.py reserve-overhead --ledger SLICE --reservation-id UNIQUE_UUID --maximum-usd 5
python infra/acephale-infra-v1/control.py quote --hardware-profile a100-40gb-v1 --region REGION --output NEW_QUOTE
```

See [LAMBDA_CONTROL.md](LAMBDA_CONTROL.md) for exact plan/config schemas and the
two-region AWS cleanup-controller procedure. A normal lease requires actual
invocation receipts from both controllers, each with a completed provider
termination test. AWS hosts the small cleanup functions; the GPU remains on
Lambda. The token is held in Secrets Manager. Neither function can launch GPUs.
Private S3 lease state pins the exact registered name, optional instance ID,
setup deadline and hard deadline. Owner heartbeat expiry after 120 seconds
triggers cleanup independently of the laptop. Each minute schedule is configured
delivery, not a provider availability guarantee.

```text
python infra/acephale-infra-v1/control.py prepare-lease --ledger SLICE --hours 4 --extra-allowance-usd 0
python infra/acephale-infra-v1/lambda_watchdog_deploy.py publish --receipt DEPLOYMENT --ledger SLICE --lease-id LEASE_ID
python infra/acephale-infra-v1/lambda_watchdog_deploy.py enroll --receipt DEPLOYMENT --output ENROLLMENT
python infra/acephale-infra-v1/control.py launch --ledger SLICE --lease-id LEASE_ID --watchdog-receipt ENROLLMENT
```

Launch fetches a fresh quote and reserves before one physical launch attempt.
The supplied regional firewall ruleset and existing global rules must permit only
TCP port 22 from restricted CIDRs (IPv4 /24 or narrower; IPv6 /64 or narrower).
The tool does not change existing account-wide rules. A broad existing rule blocks
launch and must be resolved independently without disrupting other workloads.
Associated charges are reserved once through the original journal. Zero extra
allowance is permitted when the separate $5 overhead reservation covers the run.
Unknown launch charges remain reserved and block another launch. No automatic
retry creates a second instance. See [AWS_CONTROL.md](AWS_CONTROL.md) for the
separate EC2 controller, which shares the original infrastructure allocation.

The watchdog terminates at the 30-minute setup deadline unless a passing smoke
receipt is registered with `mark-ready`. A smoke receipt must be generated from
actual CUDA allocation, both resident models, parser, continuity and telemetry
checks; include `profile`, `leaseId`, `hardwareProfileHash`, `passed: true` and
detailed check results. The distinct `predictor_training` readiness purpose
requires stopped serving, an idle GPU, actual CUDA training, pinned models,
verified export and watchdog recovery. It does not assert serving fit.
`mark-ready` hashes this receipt. It does not execute those checks itself.

Normal termination requires a verified local export receipt. The receipt contains
`leaseId` and a nonempty `files` array with relative `path`, `bytes`, and `sha256`.
Verification rejects changed files and paths outside the export directory.

```text
python infra/acephale-infra-v1/control.py terminate --ledger /var/lib/acephale/infra-ledger.json --lease-id LEASE_ID --export-root /safe/export --export-receipt /safe/export/receipt.json
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
