# Numerical validation: beta and KKT candidate

This research note records an unsuccessful diagnostic on one frozen seed29 numerical probe. It does not revise the working manuscript, accepted study results, or the frozen protocol. The original study remains incomplete.

All three requested cold/warm/cold adapter checks of the four-file candidate recorded conditional probability **0.22270013882530884**, against the frozen **0.23370635691404026**. The recorded absolute difference **0.011006218088731423** exceeded the unchanged **0.01** tolerance. Top token 4754 matched, but the numerical gate failed. This was not an official qualification pass.

| Retained diagnostic | Recorded conditional probability | Limit |
| --- | ---: | --- |
| Original serving baseline | 0.21206880435710532 | One response from a partial baseline sequence |
| Earlier beta-only candidate | 0.22270013882530884 in three checks | Requested cold/warm/cold; failed gate |
| Beta plus KKT candidate | 0.22270013882530884 in three checks | Requested cold/warm/cold; failed gate |
| Adapter-disabled base control | 0.9579122720843811 | Control, not a trained-model pass |
| Earlier same-host HF adapter reference | 0.23934934732271168 | Reference-only result, not serving qualification |

The original baseline and HF reference were not repeated in the later session. The baseline error was 0.021637552556934947; the earlier HF error was 0.005642990408671417. These are recorded values, not new calculations.

## Source changes and actual route

The candidate image contained three Python changes introducing beta BF16 round-trip boundaries and one change to the Triton chunk_scaled_dot_kkt.py source. Exact original and candidate hashes for all four files, the pinned base and candidate image digests, and the unchanged native-extension digest appear in [recorded-evidence.json](recorded-evidence.json). Recorded model and LoRA precision remained BF16; the model length was 8192, maximum sequences one, and logprobs mode raw_logprobs. No token-speculation configuration was enabled.

The actual startup record selected **FlashInfer GDN prefill**, with automatic selection and head dimension 128. The associated source-route record places the patched Triton KKT outside that active prefill path. **The KKT correction was not exercised on the selected prefill route.** Unchanged output therefore does not establish that the corrected KKT mathematics is ineffective. Installed source and Triton warmup messages are not evidence that each modified kernel executed for the request. This note does not establish a complete root cause.

## Interpretation and reproducibility

The cache labels describe requested cold/warm/cold conditions. Cached-token telemetry and detailed prompt-token cache fields were null, so actual cache hits, misses and effective cache state remain unknown. No latency, throughput or task-accuracy estimate is derived from these diagnostic calls.

The observed diagnostic handback records drained diagnostic processes, restored original serving and released diagnostic ownership. It explicitly did not authorize scientific dispatch. The two published versions of the later comparison were byte-identical, not two separate diagnostic runs.

The [evidence projection](recorded-evidence.json) copies recorded values and retains source digests. The assembly verified four request/response canonical hashes, raw selected logprobs, input IDs, top tokens, image-source lineage and the separate handback receipt. No model calls, probability calculations or statistical recomputation were performed to produce this note.

[extract_public_evidence.py](extract_public_evidence.py) reproduces this whitelist projection only from the exact reviewed integration JSON with SHA256 7cbd7bedf7ac52247c2799bb7a5e7d9368b95ee48ec64c443946110bb53ff4e4. Any altered input is rejected before projection or output creation. This extractor is bound to that snapshot; it is not a general validator of serving evidence:

    python extract_public_evidence.py --input PATH_TO_RETAINED_INTEGRATION_JSON --output recorded-evidence.json

The output must be a new file. Full raw evidence remains separately retained with controlled access; this public projection excludes prompts, private cloud locations, account/resource/command identifiers and ownership records. Source digests identify original file bytes; requestHash and responseHash identify RFC 8785 canonical JSON. Hashes alone are not a public release of the raw evidence.

These observations support a failed numerical diagnostic with limited route coverage. They do not support gate passage, scientific acceptance, full-engine equivalence, a solved cause, or an accuracy or latency benefit. Accepted prediction reports and the failed opportunity profile keep their original denominators and dispositions.
