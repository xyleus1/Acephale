# Numerical-methods attachment

This attachment reports the observed serving configuration and fixed numerical
qualification probes alongside a completed study. It copies observations; it does
not rerun models, compute scores, change a scientific manifest or revise a gate.
The frozen aggregate projector remains the authority for final report closure.

## Required completed artifacts

The private run must contain all of the following before extraction:

- `final-report-01/report/report.json`, its completed finalization receipt, the
  owner and execution results, verified cleanup and drained finalizer children.
- The existing three-file aggregate publication bundle: `aggregate-results.json`,
  `methods-and-limitations.md` and `publication-manifest.json`.
- Four closed occurrence checkpoints and phase receipts: `seed17_01`,
  `seed29_01`, `seed17_02`, `seed29_02`. Each checkpoint must hash-bind its phase
  receipt; each phase receipt must hash-bind the numerical companions.
- For every occurrence: verified serving completion, policy, effective Compose,
  tuned configuration, before/after attestation, diagnostic receipt, both complete
  three-request diagnostic reports, inventory, deployment and the original proof.
- The numerical companions for qualification, replay, calibration and applicable
  native input/output stages, with their original parent and scientific-file
  bindings. The existing numerical reader validates these locally.

There must be exactly 20 companions: qualification for all four occurrences;
replay/calibration and opportunity inputs/outputs for both `-01` occurrences;
development inputs/outputs for `seed29-01` and `seed17-02`; heldout inputs/outputs
for `seed17-02` and `seed29-02`. A closed phase without a required pair is rejected.

Use the reviewed source hashes from the execution/publication receipts for
`project_public_aggregates.py`, `numerical_policy_binding.py` and
`serving_precision.py`. Do not replace an expected hash with a newly calculated
hash merely to admit changed source. The aggregate reader also requires the exact
clean frozen analysis checkout. Use the research Python environment containing
the pinned canonical JSON dependency.

```powershell
python research/acephale/scripts/project_numerical_methods.py `
  --projector <reviewed-private-projector.py> `
  --projector-sha256 <reviewed-projector-sha256> `
  --binding-sha256 <reviewed-binding-reader-sha256> `
  --precision-sha256 <reviewed-precision-source-sha256> `
  --publication <completed-aggregate-bundle-directory> `
  --output <new-attachment-directory>
```

The command writes only `numerical-methods.json` and
`numerical-methods-manifest.json` in a new destination. The latter binds the
extractor, attachment bytes and original publication manifest. The attachment
binds the original complete report SHA256/content hash, reader source hashes,
four phase receipts, companion hashes and observed numerical artifact hashes.
The original aggregate bundle is unchanged. Inputs are rehashed before output.

## Measurements and interpretation

Each occurrence has a fixed baseline of three requests followed by three
configured requests. The configured proof is always response zero. Every
configured response must pass the original top-token and 0.01 conditional
probability gate. A baseline numerical failure remains in the attachment; other
baseline failures cannot qualify serving. No best-of-three response selection or
threshold relaxation is permitted.

The existing provenance reader ties the original proof's response hash to
configured response zero. The runtime's fixed-proof reader verifies all three
configured raw responses and their qualification receipts before admission.
Extraction separately checks that the retained pass flags agree with the stored
differences and that passing-row values match their original receipts. It does
not rederive probabilities from raw responses or run a new numerical experiment.

The public rows retain variant, index, requested cache intent, pass/fail,
conditional token-one probability, absolute difference from the original
reference, observed cached-token count and its presence flag. Missing cached-token
telemetry stays null. Salt domains A/A/B request cold/warm/cold behavior; these
labels do not prove cache hits. Raw prompts, token arrays, responses, salts,
private paths, environment values and host/container/lease identifiers are omitted.

Only the predictor's standard vLLM SHRINK configuration selects `split_k=1`.
Weights, reference, actor and gate remain fixed. The attestation observes the
installed resolver in the same image/container. It is not an engine kernel trace,
a determinism proof or proof of the historical discrepancy's cause. Diagnostic
probabilities and request timings are not goal agreement, tool prediction
accuracy, native task accuracy or end-to-end latency measurements.

## Final publication checklist

- Run the unchanged final reporter and aggregate projector only after actual
  scientific closure, export and verified cleanup.
- Generate this attachment from those same closed artifacts. Review its four
  occurrences and all six rows per occurrence, including any baseline failures.
- Render the existing study figures, inspect the actual PNG/PDF/SVG outputs and
  retain the figure manifest. Do not infer live speedup from diagnostic timing.
- Report native task success, logical actor calls, physical environment work,
  live latency, sample/family counts, paired intervals and cost separately.
- Identify this study as a custom tau-compatible pilot. Preserve failed and
  censored declared trials, missing telemetry and the seed/design limitations in
  the frozen methods notes. Teacher-forced accuracy is not native task accuracy.
- Publish only the reviewed aggregate bundle, figures, this attachment and their
  manifests. Keep operational receipts and raw traces in their existing private
  locations. A missing closed stage remains missing; no score is forecast.
