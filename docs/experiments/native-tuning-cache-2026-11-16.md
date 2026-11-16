# Saved-checkpoint kernel-cache portability, November 16, 2026

The sixth evaluation-only attempt passed strict input admission but failed its
seed 17 inference preparation. It produced no trained replay, teacher-forced
development score or paired native benchmark result. Both trained adapters and
their original reference probes remain unchanged; neither optimizer was repeated.

## Observation

The [earlier diagnostic](reload-preparation-2026-11-15.md) reproduced both saved
probes exactly after a fitting-batch warmup. Repeating that procedure in the new
export process did not reproduce seed 17's reference:

| Seed 17 comparison | Mismatches / 248,320 logits | Maximum absolute error |
| --- | ---: | ---: |
| Earlier warmup against original reference | 0 | 0 |
| New warmup against original reference | 18,971 | 0.19140625 |
| New repeated probe against original reference | 18,971 | 0.19140625 |
| New first probe against its repeat | 0 | 0 |

The original `rtol=0.02, atol=0.03` check failed. The repeated outputs were
bitwise identical to each other, so repeatability within one process did not
establish reproduction across processes. Loaded weights, reference bytes,
reconstructed batch and recorded package versions matched. The selected Triton
configurations differed for three kernels after warmup and four after probes,
including normalization, cumulative sum and `recompute_w_u_fwd` configurations.

This supports a timing-based kernel-selection hypothesis; it does not identify
one causal kernel or prove cache restoration will fix the logits. The earlier
warmup success alone was not portable. Its reconstructed first batch still does
not establish the original training sampler state.

The failed archive contains 39 verified files. Managed work drained, automatic
cleanup completed and provider termination was verified. Archive SHA-256:
`e551f31431637c21da94c38ec60ddf6e42297db59a1339da554f946067ae4c10`.

## Prospective repair

Triton supports persistent autotune timings through `cache_results`. Its pinned
3.7.1 `Autotuner.check_disk_cache` derives a key from the compiler, backend,
kernel, relevant environment, typed tuning key and candidate configurations. A
matching file lets the native reader select the minimum recorded timing.
See the [API](https://triton-lang.org/main/python-api/generated/triton.autotune.html)
and [versioned implementation](https://github.com/triton-lang/triton/blob/v3.7.1/python/triton/runtime/autotuner.py).
Hugging Face also documents packaging tuned configurations for matching devices
and shapes; this is supporting practice, not a claim that Acephale uses its
example kernel or achieves its reported speedup.
See [shipping autotune configurations](https://huggingface.co/docs/kernels/main/en/builder/triton-autotune).

The proposed preparation restores each seed's eleven original native timing
files from the successful archive, preserving their bytes and native cache
directory names. It runs before model/FLA/autotuner imports, verifies the installed
Triton reader and lets that reader perform lookup. It does not construct custom
kernel configurations, replace in-memory tuner state or search for a new profile.
The two seed profiles remain distinct. It then runs the same fitting-input
warmup and original probes and verifies the selected profiles, batch and weights.
Strict export and separate vLLM qualification remain mandatory.

All 41 focused CPU integrity tests passed. An actual installed-image check, with
no runtime-boundary mocks or network access, restored all 22 original files and
executed the package-identity gate. These checks establish byte and format
compatibility only. Fresh GPU cache-key agreement, numerical recovery and task
performance remain pending. No scoring threshold, data split or model weight
changed, and no benchmark score is inferred from this failed attempt.

Successful archive SHA-256:
`c1fd619a6f035fa156129fa181116e693aab45b5472af03985df3d06cf121130`.
Prospective cache helper SHA-256:
`20c8fbc7e9495e71a5f0c639562c8884b79843010097b9d45b1b956a5a95d9b6`.
