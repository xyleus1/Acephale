# Observe the actual GPU deployment

`collect_inventory.py` generates the `observed-deployment.json` consumed by
`acephale.infra_prepare_native`. It assembles the large model/runtime/hardware
objects from observations instead of asking an operator to fill hashes. It supports
the Windows benchmark orchestrator and Linux GPU-serving host as distinct machines.
It does not download, install, provision, start services, read secrets, call a
model, call AWS or query instance metadata. Its only writes are two files in a
new output directory, after all observations pass.

## Prerequisites on the actual host

Use the existing image/model startup procedure in [README.md](README.md).
Both pinned model containers must already be resident on the same 48 GB GPU.
The collector verifies the exact current Compose command, image digest,
read-only model mount, downloaded model receipts, process IDs and actual NVIDIA
memory allocations. A running container without a resident allocation fails.
Run the command as an operator able to read the model tree and local Docker
socket. It uses `unix:///var/run/docker.sock` explicitly, so a remote Docker
context cannot silently identify a different host.

Run from clean committed Acephale checkouts on both machines, at the same commit.
The benchmark's actual Node 22.23.4 installation, installed `node_modules` and
Python 3.12 environment must exist on the orchestrator. Pass the interpreter and
Node executable that will actually run the native benchmark. The Node telemetry
container alone is not the native runner. The split mode does not require Node or
the benchmark Python environment on the GPU host. No package installation is
performed by either inventory command.

For AWS, copy the raw `DescribeInstances` evidence file emitted by
`aws_control.py reconcile` to the host. Its original location is
`<slice-ledger>.evidence/<leaseId>.describe-instances.<sha>.json`; the slice ledger
links its path and hash. The collector selects the instance matching the local
`/sys/devices/virtual/dmi/id/board_asset_tag` and reads its instance type and AMI.
An arbitrary AWS account ID or manually typed instance type is insufficient.
No AWS credential is needed on the GPU host for this step. This initial collector
supports AWS identity; another provider requires an explicit identity adapter.

## Split Windows orchestration and Linux GPU serving

Keep the original path-bound study journal, its existing checkpoint history and
the OpenAI key on the Windows orchestrator. The Linux host serves the two pinned
Qwen models and observability services. Preparation, native benchmark execution,
hosted simulation/grading and original-journal ownership run locally. Use the
guarded SSH-forwarded model endpoints and explicit telemetry tunnel described in
the [split-host runbook](../../docs/acephale/INFRA_SPLIT_HOST.md).
An AWS watchdog heartbeat cannot substitute for
the local benchmark's short-interval host-status heartbeat.

Put the verified Node 22.23.4 binary's directory first on the current process PATH
before collecting inventory and before launching native/profile commands. The
launcher spawns `node` from that PATH. `--node-executable` inventories a selected
binary; it does not change PATH or install it. Invoke the same explicit benchmark
Python interpreter for preparation, profiling and collection that was inventoried.

First collect actual local benchmark identity from the clean Windows checkout:

```powershell
. (Join-Path $env:USERPROFILE '.config\acephale\Enter-ResearchEnvironment.ps1')
node -p process.versions.node
python --version
python infra/acephale-infra-v1/collect_inventory.py orchestrator --python-executable (Get-Command python).Source --node-executable (Get-Command node).Source --output research/acephale/runs/orchestrator-inventory-01.json
```

The prepared local helper selects the isolated verified Node 22.23.4, the actual
pinned tau Python 3.12.14 environment, AWS CLI/profile, source path and bounded
BLAS thread settings. It lives outside Git and does not load the OpenAI key unless
explicitly invoked with `-WithOpenAI`. This activation changes only the current
shell environment. Use that same shell for subsequent preparation, guard and
collection commands. A different installation can be used by selecting its
verified binaries and source environment explicitly; the receipt must describe
the interpreter that will run the benchmark, not merely the development venv.

This command reads Git identity, lock files, installed Node package metadata and
the selected Python environment. It has no Docker, GPU, AWS, credential or journal
access. An incorrect Node or Python version fails; supply the actual pinned
executable rather than editing the receipt. It writes one new receipt with a
content hash, actual platform and retained package/lock evidence.

Copy that receipt to `/srv/acephale/orchestrator-inventory-01.json` using the
verified SSH alias for the allocated host. No journal, budget checkpoint or
OpenAI key is transferred. Then run on the Linux host:

```text
python infra/acephale-infra-v1/collect_inventory.py --models-root /srv/acephale/models --images-lock infra/acephale-infra-v1/images.resolved.json --provider-receipt /srv/acephale/provider-describe-instances.json --orchestrator-inventory /srv/acephale/orchestrator-inventory-01.json --output /srv/acephale/artifacts/deployment-inventory-01
```

The GPU collector verifies the receipt's content hash, source commit, semantic
source pins, runtime versions and exact lock inventory. It never replaces the
local runtime facts with the GPU host's Python or Node version. Copy the two
resulting inventory JSON files back to a new local run directory. Pass the local
`observed-deployment.json` to `infra_prepare_native` on Windows with the original
budget directory at its original path. Do not initialize or copy a replacement
study journal to make the paths fit a Linux host.

The existing schema remains sufficient: `runtime.node` and `runtime.python`
identify benchmark orchestration, while `runtime.vllm`, `torch`, `cuda` and
`transformers` identify the model-serving containers. `hardware` identifies the
GPU-serving host. The retained evidence explicitly records
`topology: split-orchestrator-and-gpu-host`, embeds the original orchestrator
receipt and binds its raw file SHA-256. The package-inventory hash covers both
hosts, including the orchestrator platform. Dependency-lock hashes come from the
actual orchestrator bytes; clean Windows/Linux newline differences do not become
invented byte equality. Both checkouts must still have the same commit and pins.

## Single-host collection and output

If orchestration and GPU serving intentionally run on the same host, omit
`--orchestrator-inventory` and select that host's benchmark Python/Node. This mode
does not authorize moving or replacing an existing path-bound journal. Run from
the repository root. Use a new output directory and
the real provider evidence path produced by the controller:

```text
python infra/acephale-infra-v1/collect_inventory.py --models-root /srv/acephale/models --images-lock infra/acephale-infra-v1/images.resolved.json --provider-receipt /srv/acephale/provider-describe-instances.json --python-executable /srv/acephale/benchmark-venv/bin/python --output /srv/acephale/artifacts/deployment-inventory-01
```

`--node-executable` selects an explicit Node binary if it is not on PATH.
`--compose-project` selects the existing Compose project; it defaults to
`acephale-infra-v1`. The command identifies exactly one actor and one predictor
container by Compose labels. It never starts or replaces either container.

The output is:

- `observed-deployment.json`: model, runtime and hardware fields ready for
  `infra_prepare_native --deployment`, plus the source commit and evidence hash.
- `inventory-evidence.json`: verified file manifests, package inventories,
  dependency-lock records, container image/process IDs, resident GPU allocations
  and provider-receipt hash. Model inputs are retained so every aggregate hash
  can be recomputed. Environment variables and raw Docker inspection are omitted.

Use the generated file directly with the preparation command in
[INFRA_NATIVE_LAUNCH.md](../../docs/acephale/INFRA_NATIVE_LAUNCH.md):

```text
python -m acephale.infra_prepare_native --plan collection-plan.json --deployment /srv/acephale/artifacts/deployment-inventory-01/observed-deployment.json --budget-directory ORIGINAL_BUDGET_DIRECTORY --upstream-root PINNED_TAU_CHECKOUT --output NEW_PREPARED_DIRECTORY
```

No observed inventory is created by the offline unit tests or by copying a schema
fixture. Run this collector again if the host, model bytes, source, installed
packages or serving commands change. Never repair an inventory by replacing
failed observed versions with the source pins.

## Exact hash and version semantics

All aggregate hashes use SHA-256 over compact, sorted-key, UTF-8 JSON, with the
precise inputs retained in `inventory-evidence.json`:

- `weightsHash`: verified safetensor shards, safetensor index and `config.json`
  records, sorted by relative path, including each file's byte length and SHA-256.
- `tokenizerHash`: verified tokenizer data/configuration, vocabulary, merges and
  special/added-token file records. At least one tokenizer data file is required.
- `chatTemplateHash`: verified `chat_template.jinja` / `chat_templates/*.jinja`
  records when present; otherwise the actual `tokenizer_config.json` chat-template
  value. A missing template fails rather than receiving a placeholder hash.
- `dependencyLockHash`: actual `package-lock.json`, research `uv.lock` and
  `benchmarks.lock.json` records from the clean orchestrator source checkout.
- `packageInventoryHash`: actual serving and benchmark Python name/version
  inventories, the orchestrator platform and installed Node
  name/version/package-JSON hashes.

The vLLM and Torch versions come from installed package metadata. The full CUDA
version comes from `/usr/local/cuda/version.json`, falling back to
`torch.version.cuda` only if it reports the complete pinned version. Driver CUDA
capability reported by `nvidia-smi` is not the installed runtime version. A value
such as `13.0` cannot be silently expanded to the `13.0.3` source pin. A Torch
wheel's local build suffix is retained in evidence while its base release is
used in the manifest's fixed `torch` field. Hardware GPU memory is the observed
capacity of the single GPU, in bytes.

Context limits, sampling settings, disabled thinking and frozen weights are the
declared experiment policy. The server's context length, dtype, tool parser and
model name are checked against its observed launch command. Per-request policy
is not represented as an observed model response.

## What still requires a live smoke run

`observed: true` means the recorded identity was observed. Both output files
explicitly retain `smokeReadinessVerified: false`. This command does not prove
tool-call parsing, request-level policy, successful model inference, telemetry
ingestion, export recovery, independent watchdog shutdown or speedup. Those are
separate deployment gates before any paid collection. Missing packages, image
versions, model bytes, GPU allocations or changed containers fail closed without
creating an output directory.

Offline verification, from the repository root:

```text
python -m unittest discover -s infra/acephale-infra-v1 -p test_collect_inventory.py -v
```

Tests use explicitly fake files and processes, including actual hashes of those
fixture bytes. They check tampered and unreceipted files, wrong model revision,
wrong provider host, image substitution, writable mounts, absent GPU residency,
runtime mismatches, concurrent restarts, immutable output and acceptance of the
generated sections by the real versioned JSON schema through local Ajv.
Split tests also reject modified receipts and differing source/pin identities,
verify that local runtime versions and lock bytes remain authoritative, and prove
that the GPU collector does not probe a nonexistent host benchmark environment.
