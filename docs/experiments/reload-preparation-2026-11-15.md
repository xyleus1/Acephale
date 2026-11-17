# Saved-checkpoint inference preparation, November 15, 2026

Both main predictor seeds completed 204 optimizer updates. This diagnostic uses
their saved adapters and original full-vocabulary reference logits. It does not
train, replace the references or change the acceptance tolerance.

## Actual GPU observations

The A100-SXM4-40GB ran the same pinned Qwen3.5-0.8B base with BF16 parameters,
18 FP32 `A_log` vectors and FP32 LoRA adapters. Loaded base and adapter parameter
hashes matched their original training receipts for both seeds. Software was
PyTorch 2.13.0, Transformers 5.10.1, PEFT 0.21, TRL 1.16 and FLA 0.6.

| Original saved-probe comparison | Seed 17 | Seed 29 |
| --- | ---: | ---: |
| Cold baseline mismatches / 248,320 | 14,972 | 13,137 |
| Cold maximum absolute error | 0.1875 | 0.203125 |
| After fitting-input warmup, mismatches | 0 | 0 |
| After warmup, maximum absolute error | 0 | 0 |
| Repeated probe, mismatches | 0 | 0 |

All comparisons retain `rtol=0.02, atol=0.03`. Ten of eleven cold variants were
bitwise identical within each seed, including cache, Trainer, input-gradient,
checkpoint and Accelerate variants. Disabling PyTorch BF16 reduced-precision
reduction changed results but failed the gate for both seeds. No optimizer was
constructed. Independent CPU checks compared the four warm-probe tensor byte
arrays directly with the original saved arrays and confirmed exact equality.

## Common preparation procedure

1. Verify the frozen fitting dataset, original checkpoint, precision policy and
   exact loaded parameter hashes.
2. Set the original seed and construct the original SFTTrainer data pipeline.
   Obtain its first fitting batch without creating an optimizer or scheduler.
3. Set evaluation mode. Under `torch.inference_mode()` and BF16 autocast, run one
   forward call with `use_cache=False`, `logits_to_keep=1` and no labels.
4. Run the original 256-token probe twice and compare every last-token logit
   with the original reference. Recheck weight and reference hashes.

The reconstructed batches were `[4, 5955]` and `[4, 5993]`. Their tensor hashes,
selection procedure and kernel configurations are retained. Historical sampler
state was not available, so these are not certified as the exact historical
first batches. Only fitting inputs selected the warmup; no held-out task result
was used to choose it.

## Interpretation and qualification boundary

The same warmup restored exact outputs for both seeds. Selected FLA/Triton
configurations changed, including `chunk_fwd_o` from `BK=32, BV=32, warps=2` to
`BK=64, BV=64, warps=4`. Other kernels changed too. This supports a numerical
dependence on first-workload/kernel tuning history; it does not isolate one
kernel as the sole cause or recover the missing historical tuning metadata.

Diagnostic success is not export or serving qualification. The prospective
export must run the common preparation in its own process, then pass the
unchanged strict export gate. The separate vLLM acceptance check must also pass
before trained prediction replay or native task benchmarking.

Cold archive SHA-256:
`3fb184308e9e8e3718c35b4939262ca1d474fe722139f46947c7f6bd3857a6fa`.
Warmup archive SHA-256:
`c1fd619a6f035fa156129fa181116e693aab45b5472af03985df3d06cf121130`.
Both archives were exported, individually inventoried and verified after managed
process drain. All original failures remain retained.
