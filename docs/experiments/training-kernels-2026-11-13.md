# Declared Gated DeltaNet training kernel change

The earlier one-step diagnostic used the PyTorch reference DeltaNet path and
measured 125.55 seconds per optimizer step at microbatch 1, accumulation 16.
That observation does not predict the larger corpus's throughput or justify
shortening either main seed.

The next trainer pins `flash-linear-attention[cuda]==0.6.0` and `fla-core==0.6.0`
with the existing PyTorch 2.13.0, Transformers 5.10.1, PEFT 0.21.0 and TRL 1.16.0.
The dependency resolver adds only those packages and `einops==0.8.2` to the
existing lock. Actor and predictor base weights remain unchanged.

Transformers already integrates FLA through `chunk_gated_delta_rule`,
`fused_recurrent_gated_delta_rule` and `FusedRMSNormGated`. The new loader verifies
that every instantiated Qwen Gated DeltaNet layer uses those actual functions.
It rejects a fallback or an unexpected convolution extension. Convolution stays
on PyTorch, full attention stays on SDPA, and packing remains disabled. This is
partial kernel acceleration, not a claim that every fast path is enabled.

Both fitting and disposable profiling specifications record the observed kernel
profile alongside package versions, image digest, source inventory and lock hash.
The changed environment requires a new smoke and the same strict adapter reload
and vLLM numerical checks. Only a new measured profile can establish throughput
and size the common full-seed allocation. Existing failed or slower runs remain
unchanged.

Sources: [Transformers v5.10.1 implementation](https://github.com/huggingface/transformers/blob/v5.10.1/src/transformers/models/qwen3_5/modeling_qwen3_5.py),
[FLA installation](https://github.com/fla-org/flash-linear-attention/blob/main/INSTALL.md),
[FLA 0.6.0](https://pypi.org/project/flash-linear-attention/0.6.0/),
[fla-core 0.6.0](https://pypi.org/project/fla-core/0.6.0/).
