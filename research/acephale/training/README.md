# Predictor training

This environment changes only the pinned `Qwen/Qwen3.5-0.8B` predictor through
LoRA. The actor, authorization and executable tool catalog stay fixed. Ranking
targets are observed next-batch membership for the runtime's frozen candidate
window. Goal targets use audited public-prefix annotations. Missing actor
responses are unknown, never negative labels.

The lock pins Python 3.12, PyTorch 2.13.0, Transformers 5.10.1, PEFT 0.21.0,
TRL 1.16.0, Accelerate 1.15.0 and Datasets 5.2.0. Serving has its own environment.
The canonical image definition is
[`trainer.Dockerfile`](../../../infra/acephale-infra-v1/trainer.Dockerfile).

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

```text
python -m acephale.training_container build --source REPOSITORY --output NEW_IMAGE_BUILD
python -m acephale.training_container run --receipt NEW_IMAGE_BUILD/image-receipt.json --action smoke --dataset NEW_DATASET --model PINNED_PREDICTOR_DIRECTORY --lease TRAINING_LEASE.json --actor-container FULL_STOPPED_ACTOR_CONTAINER_ID --output NEW_SMOKE
```

The launcher obtains the image digest from `docker image inspect`, validates it
against the build receipt and injects it into the trainer. It mounts models,
data and lease read-only, disables container networking and runs as the ordinary
Linux host operator. The Docker image is not published automatically.

`smoke` performs one real optimizer step on the prepared examples, verifies
nonzero LoRA gradients and frozen base weights, reloads the adapter and merges
it. This proves the machinery, not prediction quality or native task success.
After a successful smoke, run the prespecified seeds separately:

```text
python -m acephale.training_container run --receipt IMAGE_RECEIPT --action train --seed 17 --max-steps 500 --maximum-seconds 3600 --dataset DATASET --model BASE --lease LEASE --actor-container ACTOR_ID --output NEW_SEED17
python -m acephale.training_container run --receipt IMAGE_RECEIPT --action export --training-run NEW_SEED17/artifacts --dataset DATASET --model BASE --lease LEASE --actor-container ACTOR_ID --output NEW_EXPORT17
```

Repeat with seed 29 and new output paths. Select checkpoints using development
data only. The default is at most three epochs, 500 steps and one hour per
training command, within a lease capped at two hours. LoRA uses rank 16, alpha
32, dropout 0.05, AdamW at 1e-4, weight decay 0.01, norm clip 1.0, warmup 0.03,
microbatch 1 and accumulation 16. The exact text attention, Gated DeltaNet and
MLP linear modules are enumerated and verified before training. Vision and base
weights remain frozen. Prompts are masked with -100; no sample is truncated to
fit the 8,192-token context or 1,024-token completion limit.

## Artifacts and evaluation

Training writes `training-specification.json`, TensorBoard events, checkpoints,
`adapter/`, a reload probe and `receipt.json`. The receipt records actual
optimizer steps, nonzero-gradient checks, before/after adapter and frozen-base
hashes, loss diagnostics, elapsed time and GPU memory. Failures retain evidence.

Export writes `model/`, `predictor.json`, `training-manifest.json`,
`dataset-manifest.json`, `training-receipt.json` and `verification.json`. The
predictor identity binds adapter and merged file inventories, exact preserved
tokenizer bytes, actual run specification, fit/calibration families and verified
binary token IDs. Its served name identifies the derived weights. Reload and
merge comparisons use complete last-token logits plus matching top-token
decisions. Real vLLM serving parity must still pass before deployment.

`training_container run --action evaluate --partition development` measures
teacher-forced completion loss and token accuracy under the same lease. It does
not measure goal agreement, free-running ranking quality, native reward or
latency. Those require the frozen prediction replay, independent annotation
grading and paired native benchmark harnesses. Refit calibration and opportunity
profiles for the derived predictor identity before speculative execution.
