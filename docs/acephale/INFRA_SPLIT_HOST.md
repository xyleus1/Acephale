# Windows orchestration with private Linux GPU serving

Keep the original budget journal, API key, native benchmark environment, Node
runtime and research artifacts on Windows. The Linux host runs the pinned actor,
predictor and Alloy collector. Three SSH forwards provide private model and OTLP
transport. The native Python gateway remains Windows-local on a temporary port.
Neither the original journal nor the OpenAI key needs copying to Linux.

Use the [split inventory procedure](../../infra/acephale-infra-v1/HOST_INVENTORY.md)
first. The combined observed deployment binds the actual Windows Node/Python
packages and Linux GPU/server identities. Native collection and component
profiling check the executing PATH Node version and Python interpreter against
the manifest immediately before dispatch. Selecting a portable Node for inventory
does not select it for later subprocesses.

Activate the verified Node installation in the same PowerShell session that will
launch preparation, the guard and collection. Configure `ACEPHALE_NODE_DIRECTORY`
and `ACEPHALE_CHECKOUT` with the actual local installation and checkout paths.
Select them without changing global PATH:

```powershell
$env:PATH = $env:ACEPHALE_NODE_DIRECTORY + ';' + $env:PATH
node -p process.versions.node
$env:PYTHONPATH = Join-Path $env:ACEPHALE_CHECKOUT 'research/acephale/src'
```

Use the exact pinned tau environment's Python executable for the benchmark.
The split guard itself imports no model or tau package. No guard command installs
software, provisions a GPU, changes an AWS resource or generates model output.

## Bind the private endpoints

In the collection plan passed to `infra_prepare_native`, set these endpoints and
an absolute `splitGuardPath` pointing to a new local guard configuration:

```json
{
  "actorBaseUrl": "http://127.0.0.1:18000",
  "predictorBaseUrl": "http://127.0.0.1:18001",
  "otlpBaseUrl": "http://127.0.0.1:14318",
  "splitGuardPath": "C:/RESEARCH/split-guard.json"
}
```

These fields are additions to the task/seeds/caps in the native collection plan,
not a complete plan. Create `split-guard.json` before preparation. Its
`configurationPath` identifies the new prepared configuration that preparation
will write. Relative paths below resolve beside `split-guard.json`:

```json
{
  "version": 1,
  "configurationPath": "prepared/configuration.json",
  "deploymentPath": "deployment-inventory/observed-deployment.json",
  "inventoryEvidencePath": "deployment-inventory/inventory-evidence.json",
  "sshDestination": "ubuntu@YOUR_VERIFIED_GPU_HOST",
  "sshPort": 22,
  "expectedInstanceId": "YOUR_OBSERVED_PROVIDER_INSTANCE_ID",
  "localPorts": {"actor": 18000, "predictor": 18001, "otlp": 14318},
  "maximumLifetimeSeconds": 3600
}
```

The hostname and instance ID are descriptive placeholders, not defaults. Use an
existing SSH alias or `user@host` with its host key already verified in OpenSSH's
known-hosts store. The guard uses `StrictHostKeyChecking=yes` and `BatchMode=yes`.
It never auto-accepts a host key, asks for a password, stores a private key or
changes the SSH configuration. The SSH user must be able to run `python3` and
read local Docker container status on the GPU host.

For Lambda, additionally set `provider: "lambda"`, `knownHostsPath`,
`expectedHostKeySha256` and `expectedMachineIdSha256`. The dedicated known-hosts
file contains exactly the observed host's ed25519 key. The inventory includes
the actual Lambda API receipt and machine-id hash; it never invents an EC2 ID.
Initial host trust is a recorded operator observation, not provider attestation.
Both the Python publisher and Node consumer validate the receipt content hash,
provider response, approved hardware profile, active lease name, API instance
and IP association, pinned key and machine identity. Their heartbeat provenance
includes those exact bindings and the dedicated known-hosts file's bytes. A
changed file invalidates running checks even when its added text is a comment.
Use `ubuntu@OBSERVED_IP` for Lambda, as an alias cannot establish the required
receipt association. Select its private key through a narrowly scoped OpenSSH
`Host OBSERVED_IP` configuration with `IdentityFile` and `IdentitiesOnly yes`;
the guard does not accept or persist a key itself.

The guard verifies the actual inventory hash, instance ID, deployment sections
and manifest source identity. It owns all three loopback listeners with
`ExitOnForwardFailure=yes`; an occupied port is a failure rather than permission
to use another process's listener. The remote ports stay fixed at 8000, 8001 and
4318, matching the Compose model and Alloy services.

## Run the guard and collection

Start the guard as a separate local process and keep it running for the cohort:

```text
python -m acephale.infra_split_guard --config C:/RESEARCH/split-guard.json --output C:/RESEARCH/NEW_STATUS_DIRECTORY
```

Set the same directory in the collection session:

```powershell
$env:ACEPHALE_HOST_STATUS_FILE = 'C:\RESEARCH\NEW_STATUS_DIRECTORY'
```

Then use the prepared native collection command from
[INFRA_NATIVE_LAUNCH.md](INFRA_NATIVE_LAUNCH.md), with the original local journal
and benchmark interpreter. Configure the OpenAI key securely as the final
credential step. The guard is independent of that key.

The guard performs read-only SSH probes of the bound provider host identity, exact
inventory-bound container IDs/image IDs/start times, model health/model catalogs,
and collector listener. It also checks the model catalogs through its own local
forwards. Heartbeat freshness uses the Windows observation clock after those
checks complete, never a remote wall clock. Observations taking more than 2.5
seconds fail; native dispatch accepts at most three-second-old heartbeats.
Immutable numbered publications retain failures, and the newest degraded or
malformed publication never falls back to an older healthy one.

One persistent pinned SSH process owns both the three forwards and the read-only
remote probe loop. `ExitOnForwardFailure=yes` applies before the remote `READY`
frame. Startup has a ten-second deadline and publishes degraded heartbeats while
connecting; `READY` alone never establishes health. Every subsequent observation
uses a fresh random nonce and increasing sequence. The remote process collects
its observations after receiving that request and echoes both correlation fields.
The guard rejects unsolicited, malformed, mismatched or late responses. Local
model-catalog checks share the same 2.5-second total deadline, including the remote
probe. The pinned known-hosts file is rechecked on every observation.

The implementation uses bounded queues and reader threads on Windows, with SSH
multiplexing explicitly disabled. A failure publishes degraded status before
terminating and draining the owned process and readers. That closes the forwards
and probe channel together. Reconnection requires confirmed drain; late responses
cannot enter a replacement session. Final status records both `probeClosed` and
`tunnelClosed`. The standalone one-shot observation helper remains available for
diagnostics, but the running guard does not reconnect for each observation.

The Node native service checks the bound heartbeat before startup and every 500
ms while running. Tunnel exits, stale health, another instance, changed serving
containers, substituted models, endpoint changes or another manifest abort the
service. The native profiler supports the same optional `splitGuardPath` and
`otlpBaseUrl` fields and checks the corresponding profile manifest. A new profile
manifest requires a new guard configuration/status directory; an old heartbeat
cannot authorize it. Provider shutdown and budget watchdogs remain separate and
mandatory. This local guard does not terminate EC2 or release reservations.

## Telemetry and evidence

`otlpBaseUrl` routes the actual Windows runtime spans and aggregate span metrics
to the tunneled remote Alloy receiver. Native execution retains per-export
payload hashes, destinations, acceptance results and
`service/telemetry-export-receipt.json`. Failed or partially rejected exports
cause the native service to exit unsuccessfully. Local raw traces, metric
snapshots and collection evidence remain available for export.

Collector HTTP acceptance is not proof that Grafana/Tempo/Prometheus indexed the
data. Inspect one actual trace and metric during the live deployment smoke check,
and retain that receipt separately. Offline tests exercise the real Python
gateway/new Node runtime handshake and actual loopback trace/metric requests with
mock model responses. They do not attest an AWS host, a working SSH session,
remote telemetry storage or model quality.

Local Prometheus snapshots publish through uniquely owned temporary files and
atomic replacement. Windows sharing denials receive bounded retries within a
one-second retry window; the live snapshot is never deleted or truncated to force replacement.
Unchanged rendered bytes skip replacement. The cache advances only after a
successful publication. Fatal publication errors remain visible and cause drain
to fail, while close still waits for queued writers and OTLP exporters. Concurrent
close calls share that same result, including failure. Real Windows handle tests
exercise denied replacement and recovery; they do not establish cloud telemetry
readiness or validate an aborted benchmark cohort.
