# Numerical-validation follow-up: Virginia session03 and Ohio session04

This additive research note records two completed diagnostic sessions on the same frozen seed29 probe. It preserves the [earlier numerical note](../numerical-validation-20261122/README.md), the working manuscript and all study results. Neither candidate passed the original numerical gate; neither session is a new task benchmark or accepted scientific unit.

## Recorded outcomes

The frozen conditional probability was **0.23370635691404026**. The unchanged gate requires the top token to match and the absolute probability difference to be at most **0.01**. All three trained checks in each session recorded **0.21206880435710532**, with recorded error **0.021637552556934947** and matching top token 4754. Thus all trained checks failed the gate.

| Candidate | Trained checks | Adapter-disabled control | Numerical disposition |
| --- | --- | ---: | --- |
| Virginia session03, four Python source changes | Three at 0.21206880435710532 | 0.9579122816965473 | Failed |
| Ohio session04, five Python source changes | Three at 0.21206880435710532 | 0.9626731040886339 | Failed |

The equal trained conditional probabilities do not mean identical raw outputs. Virginia recorded selected logprobs of -23.906312942504883 and -25.218812942504883; Ohio recorded -23.750062942504883 and -25.062562942504883. Each recorded difference was -1.3125. The control values also differ. These records remain separate from each other and from the earlier Ohio beta/KKT diagnostic; no cross-session performance estimate is calculated.

## Source and route coverage

Virginia's image contained the three beta BF16 round-trip source changes plus the Triton chunk_scaled_dot_kkt.py change. Ohio's image retained those four changes and added causal_conv1d.py. Exact original/candidate source hashes, image digests and the unchanged native-extension digest are retained in [recorded-evidence.json](recorded-evidence.json). Both input bindings identify the same frozen adapter, configuration, predictor and probe bytes.

Virginia's own startup record selected **Triton/FLA GDN prefill**, with automatic selection and head dimension 128. This supports the selected backend, but the retained startup receipt is not a per-request trace proving every modified kernel executed.

Ohio's own startup record selected **FlashInfer GDN prefill**, also automatic with head dimension 128. Its route receipt explicitly states that the retained Triton KKT source is bypassed on that selected prefill route. Therefore Ohio's failed result does not test the KKT correction on its Triton prefill path. Ohio also retained compiled convolution-cache evidence; compilation is distinct from proof of per-request invocation. No complete causal explanation or general conclusion about the mathematical correction's effectiveness is established.

Recorded serving settings remained BF16 model/LoRA precision, model length 8192, one sequence and raw logprobs, with no token-speculation configuration. The requested query sequence was cold/warm/cold, but cached-token telemetry and detailed cache fields were null. Cache hits, misses and effective cache state are not established. Diagnostic request durations are not reported as latency or throughput findings.

## Closure and reproducibility

Each formal handback records drained diagnostic processes, restored original prediction serving, unchanged actor, and released diagnostic ownership. Both explicitly deny qualification passage and scientific-dispatch authority. The later sessions did not repeat the original baseline or HF reference.

The [recorded evidence](recorded-evidence.json) contains copied values, separate source digests and route limits. Assembly checked eight raw request/response pairs against canonical hashes and recorded rows, selected logprobs, top tokens and input IDs; it also checked image lineage and each comparison's binding to its formal handback. No models, statistics or probabilities were recomputed.

The companion extractor requires one exact reviewed private integration snapshot, identified by its SHA256 in the script. It rejects altered input before creating output:

    python extract_public_evidence.py --input PATH_TO_REVIEWED_INTEGRATION_JSON --output recorded-evidence.json

The output must be new. This public projection excludes prompts, private cloud locations, account/resource/command identifiers and ownership records. Full raw evidence remains separately retained with controlled access. Source hashes identify original bytes; request/response hashes identify RFC 8785 canonical JSON. The study remains incomplete, and these diagnostic failures do not revise accepted result denominators or establish accuracy, latency, task-success or scientific-acceptance claims.
