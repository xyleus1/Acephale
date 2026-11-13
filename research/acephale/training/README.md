# Predictor training

This environment changes only the pinned `Qwen/Qwen3.5-0.8B` predictor through
LoRA. The actor, authorization and executable tool catalog stay fixed. Ranking
targets are observed next-batch membership for the runtime's frozen candidate
window. Goal targets use audited public-prefix annotations. Missing actor
responses are unknown, never negative labels.

The lock pins Python 3.12, PyTorch 2.13.0, Transformers 5.10.1, PEFT 0.21.0,
TRL 1.16.0, Accelerate 1.15.0 and Datasets 5.2.0. Serving has its own environment.
The next trainer profile also pins `flash-linear-attention[cuda]` and `fla-core`
0.6.0. It uses the upstream Gated DeltaNet and gated normalization kernels while
retaining PyTorch convolution and SDPA for full attention. Every loaded DeltaNet
layer is checked; the actual kernel identities appear in fitting and profiling
specifications. This changes the trainer environment and requires a fresh image,
smoke, numerical serving qualification and throughput profile before main fitting.
The earlier reference-kernel measurements remain historical observations.
The canonical image definition is
[`trainer.Dockerfile`](../../../infra/acephale-infra-v1/trainer.Dockerfile).
Its C compiler and development-header dependency closure is pinned in
[`trainer-system-packages.txt`](../../../infra/acephale-infra-v1/trainer-system-packages.txt)
and included in the image-input hash. The image retains its complete installed
package inventory at `/usr/local/share/acephale-trainer-packages.tsv`. TRL's fused
loss uses Triton's C driver build even when `torch_compile` is disabled. Missing
locked system packages fail the build; no newer package is substituted.

The upstream [pinned Transformers implementation](https://github.com/huggingface/transformers/blob/v5.10.1/src/transformers/models/qwen3_5/modeling_qwen3_5.py)
selects these optional kernels at import time. The FLA [installation guide](https://github.com/fla-org/flash-linear-attention/blob/main/INSTALL.md)
describes CUDA extras and keeping the existing PyTorch installation. The lock
preserves the established PyTorch, Transformers, TRL and model versions. No
speedup or accuracy improvement is established by dependency installation alone.

## Prepare actual compiled examples

First use `scripts/acephale-training-export.ts` with the real serving tokenizer.
The exporter freezes the serving prompt and candidate order before attaching
observed labels. Its JSONL rows contain the exact prompt, completion, family,
partition, hashes and provenance. Python validates those rows without loading
weights:

```text
python -m acephale.training_cli prepare --rows EXPORTED.jsonl --output NEW_DATASET
python -m acephale.training_cli verify NEW_DATASET
```

Goal and conditional-ranking rows additionally require `--review-pilot PILOT.json
--reviews REVIEWS.jsonl --annotations ANNOTATIONS.jsonl`. Reviews must bind the
exact annotation hashes, cover at least 20 selected examples, achieve at least
90% semantic acceptance and contain zero unsupported bindings. Neutral ranking
can be prepared independently while that review is outstanding.

The four immutable partitions are `weight_fit`, `calibration`, `development` and
`test`. Calibration families also supply independent goal-reliability grading.
They cannot fit weights or enter workflow memory. Historical test/development
rows cannot be reassigned to fitting. The data manifest binds every partition
file, family, prompt compiler, tokenizer, review and recipe.

## Build and run on the qualified Linux host

Use the existing provider reservation and watchdog. Stop the actor and obtain a
training lease through the infrastructure controller. Do not reset any budget
journal. The host launcher checks the actual stopped actor container, active
lease and immutable Docker image, and stops its container if the lease fails.
The source checkout must be clean and committed before image construction.
All output directories below must be new and outside the checkout.

The image normalizes only public copied source, contracts and packaging-file
permissions after dependency installation. This supports checkouts created with
umask 027 and both UID 10001 and the host-UID launcher without recursively changing
the installed environment, models or private output. A CPU-only regression uses
the exact Dockerfile permission command, restrictive fixture inputs and both UIDs:

```sh
# Cache the exact pinned FROM image first; the fixture never pulls implicitly.
docker pull python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ACEPHALE_TEST_DOCKER_PERMISSIONS=1 python -m pytest research/acephale/tests/test_trainer_image_permissions.py -q
```

Run this from the repository root using the research environment. The fixture
loads no model or GPU and removes only its own two temporary images. Passing it
does not replace the actual trainer's host-UID `training_implementation()` and
compiler checks. A Dockerfile change requires a new source-bound image receipt;
never relabel an earlier image or recovery attempt as built from this source.

```text
python -m acephale.training_container build --source REPOSITORY --output NEW_IMAGE_BUILD
python -m acephale.training_container run --receipt NEW_IMAGE_BUILD/image-receipt.json --action smoke --dataset NEW_DATASET --model PINNED_PREDICTOR_DIRECTORY --lease TRAINING_LEASE.json --actor-container FULL_STOPPED_ACTOR_CONTAINER_ID --output NEW_SMOKE
```

The launcher obtains the image digest from `docker image inspect`, validates it
against the build receipt and injects it into the trainer. It mounts models,
data and lease read-only, disables container networking and runs as the ordinary
Linux host operator. The Docker image is not published automatically.

`smoke` performs one real optimizer step on the prepared examples, verifies
nonzero LoRA gradients and frozen base weights, and reloads the adapter. The
default `merged` mode retains the original merge check. To test the explicit
native-LoRA path, add `--artifact-mode unmerged_lora`; it preserves the exact
adapter and requires separate real vLLM qualification. Neither smoke proves
prediction quality or native task success.

After the smoke and actual serving check, stop serving and acquire the fitting
lease. Run `--action profile --maximum-seconds 600` through the same container
launcher with a new output directory. It tests 4/4, 2/8 and 1/16 on the 16 longest
distinct fitting rows, falling back only after CUDA OOM. The disposable step
exports no weights. Freeze `selection.json` and its selected batch/accumulation
for both seeds before fitting; include those options in each training command.
Run the prespecified seeds separately:

```text
python -m acephale.training_container run --receipt IMAGE_RECEIPT --action train --seed 17 --max-steps 500 --maximum-seconds 3600 --dataset DATASET --model BASE --lease LEASE --actor-container ACTOR_ID --output NEW_SEED17
python -m acephale.training_container run --receipt IMAGE_RECEIPT --action export --artifact-mode unmerged_lora --training-run NEW_SEED17/artifacts --dataset DATASET --model BASE --lease LEASE --actor-container ACTOR_ID --output NEW_EXPORT17
```

Repeat with seed 29 and new output paths. Retain both seeds; do not select a winner
from held-out results. The default is at most three epochs, 500 steps and one hour
per command. A v2 lease can explicitly allocate the approved four fitting hours;
v3 adds eight fitting hours to the cumulative allowance. Original reserved
windows remain counted, and v1 leases retain their two-hour ceiling. Every stage remains inside its provider
and experiment deadline. LoRA uses rank 16, alpha
32, dropout 0.05, AdamW at 1e-4, weight decay 0.01, norm clip 1.0, warmup 0.03,
effective batch size 16. Use `--micro-batch 4 --gradient-accumulation 4`, or the
2/8 then 1/16 fallback after measured memory checks. Freeze the profile before fitting. The exact text attention, Gated DeltaNet and
MLP linear modules are enumerated and verified before training. Vision and base
weights remain frozen. Prompts are masked with -100; no sample is truncated to
fit the 8,192-token context or 1,024-token completion limit.

## Artifacts and evaluation

Training writes `training-specification.json`, TensorBoard events, checkpoints,
`adapter/`, a reload probe and `receipt.json`. The receipt records actual
optimizer steps, nonzero-gradient checks, before/after adapter and frozen-base
hashes, loss diagnostics, elapsed time and GPU memory. Failures retain evidence.

Merged export writes `model/`, `predictor.json`, `training-manifest.json`,
`dataset-manifest.json`, `training-receipt.json` and `verification.json`. The
predictor identity binds adapter and merged file inventories, exact preserved
tokenizer bytes, actual run specification, fit/calibration families and verified
binary token IDs. Its served name identifies the derived weights. Reload and
merge comparisons use complete last-token logits plus matching top-token
decisions. Real vLLM serving parity must still pass before deployment.

Explicit unmerged export instead writes `adapter/`, `base-receipt.json` and
`serving-probe.json` alongside the manifest/verification chain. The v2 predictor
identity binds FP32 adapter storage, BF16 native-LoRA arithmetic and the exact
base snapshot. Use `--predictor-export EXPORT_DIRECTORY --model EXACT_BASE` for
container evaluation; the export and base are mounted separately and read-only.
The operator serves the base plus one exact adapter alias and records a real
probe response. Admission requires that proof and a subsequent observation of
the same container, command, image and source. The fixed probe requires identical
top token and a conditional binary probability difference at most 0.01; it is a
loading sanity check, not complete numerical equivalence or task accuracy.

Probe creation, adapter reload and merged inference share explicit bfloat16
autocast, inference mode and eval mode. The exact versioned context is recorded
in the specification, saved probe and export verification. This prevents an
Accelerate-wrapped training forward from being compared with an unwrapped forward
under a different precision context. Legacy or altered context declarations are
rejected; do not modify or reseal old probes. Reload and merge tolerances remain
unchanged. A context-consistency repair does not establish actual model parity
until a new authorized run passes all checks.

`training_container run --action evaluate --partition development` measures
teacher-forced completion loss and token accuracy under the same lease. It does
not measure goal agreement, free-running ranking quality, native reward or
latency. Those require the frozen prediction replay, independent annotation
grading and paired native benchmark harnesses. Refit calibration and opportunity
profiles for the derived predictor identity before speculative execution.

## Run a declared sequence

`python -m acephale.experiment_runner --manifest RUN.json --output NEW_DIRECTORY`
runs existing commands on Linux or Windows without shell interpolation. Linux
owns a process group; Windows starts a suspended child inside a kill-on-close
Job Object before allowing it to run. Timeout and shutdown drain descendants.
GPU fitting still runs in the qualified Linux container. The manifest binds
`sourceCommit`, hashed input files, an absolute deadline, maximum duration and an
ordered list of stages. Each stage supplies argv, a timeout and artifact checks
with explicit successful result fields. Commands can reference `{source}`,
`{output}`, `{input:name}` and a completed `{stage:id}`.

Use `--resume` only for the same manifest and verified completed stages. Failed
or interrupted stages require a separate recovery attempt. Container stages must
bind the launch receipt and immutable image so timeout cleanup can confirm the
exact container is gone. The runner does not grant cloud or spending authority.
