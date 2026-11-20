# Numerical-methods attachment

This attachment reports observed serving configurations and fixed numerical
qualification probes alongside the study report. It copies observations without
rerunning models, computing scores, changing scientific manifests or revising
gates. This document describes the release procedure, not a completed run. See
[current state](../STATE.md) for measured results and remaining work, and
[methods](../METHODS.md) for the frozen experiment.

## Current component-based publication

The accepted `prospective-component-publication-02` operator package handles
scientific components completed under different physical owners. Its
`component_publication.py` retains the original aggregate allowlist and scoring
formulas. `component_numerical.py` follows each component's actual numerical
provenance. These operator sources and their independent reviews are pinned in
private execution receipts; they are not interchangeable with an unreviewed copy.

Publication requires all twelve original components: export; replay, analysis and
opportunity profiling for each of seeds 17 and 29; two development segments;
held-out selection; and two held-out segments. A closed component can contain
failed or censored predictions and trials. Those rows and their declared
denominators remain in the report.

The required evidence is:

- The actual latest closed component index, each owner's original execution and
  cleanup records, provider termination or local exit evidence, and local process
  and task closure. Failed earlier attempts retain their original status.
- An accepted final-index handoff under an existing physically closed owner,
  the immutable financial snapshot used by the report, and the completed
  finalizer output containing `report/report.json`. Both the report assembler
  and summary renderer must have actual successful exits and drained processes.
- For every recorded physical qualification: serving completion, policy,
  effective Compose, tuned configuration, before/after attestation, diagnostic
  receipt, both three-request reports, inventory, deployment and original proof.
- Every applicable numerical companion and its exact parent and scientific-file
  references. Native outputs must reference their inputs; inputs must reference
  the current qualification and adopted calibration. The adoption must bind the
  original scientific component. Replay and analysis retain their original
  qualification, replay and calibration chains.

Qualifications are grouped by physical owner and original serving occurrence.
The current procedure has no fixed owner or companion count. It retains recorded
qualifications even when an owner produced no scientific output. Offline analysis
uses its verified historical replay derivation and claims neither current serving
nor a new numerical observation. Missing companions are rejected rather than
replaced by a count-based assumption.

Use the exact reviewed source hashes from the execution and publication receipts,
the frozen analysis checkout and the pinned research Python environment. Never
replace an expected hash with a newly calculated one to admit changed source.
The accepted reporter explicitly handles interrupted grading while preserving
original scoring formulas, all calibration rows, unknown requests and their
reservations. It does not relabel the interrupted original command as successful.

The execution order is:

1. Validate the actual closed index with the accepted final-report handoff.
2. Run the component finalizer with the source-bound reporter and summary
   renderer, immutable financial snapshot and original study bindings. Preserve
   the assembler and renderer's actual process receipts.
3. Fill a new `publication-input.template.json` instance with the handoff index,
   handoff result and completed report directory. Hash that input; retain the
   original template.
4. From the accepted operator package, stage a new private bundle:

```text
<research-python> -B component_publication.py --configuration <actual-input.json> --configuration-sha256 <actual-sha256> --output <new-private-bundle> --figures
```

The destination must be a new direct child of that package. The publisher checks
the twelve components, actual report and renderer closure, original aggregate
allowlist, numerical chains and source hashes. It uses the scalar diagnostic
projection from the reviewed
[numerical extractor](../../research/acephale/scripts/project_numerical_methods.py)
and the existing [study plotter](../../research/acephale/scripts/plot_study_report.py).
It does not open the live financial journal or dispatch models.

The completed bundle contains `aggregate-results.json`, `public-provenance.json`,
`numerical-methods.json`, `Acephale-results.md`, `methods-and-limitations.md`, and
twelve figure files: native and paired views for development and held-out, each
in PNG, PDF and SVG. The figure manifest and final `publication-manifest.json`
bind the actual files and source identities. The final manifest is written last;
a partial directory or failed figure process is not a publishable bundle.

Public projection retains approved hashes, counts, enums and scalar observations.
It aliases physical owners and sanitizes interrupted-grading provenance. Raw
responses, private paths and identifiers do not enter the aggregate allowlist.
Review the staged text and figures before copying manifest-listed files to the
public repository; this command performs no public copy or Git push.

## Historical four-occurrence procedure

The earlier whole-run extractor expected four closed checkpoints and phase
receipts: `seed17_01`, `seed29_01`, `seed17_02` and `seed29_02`. Its fixed graph had
exactly 20 companions: qualification for all four; replay/calibration and
opportunity inputs/outputs for both `-01` occurrences; development inputs/outputs
for `seed29-01` and `seed17-02`; and held-out inputs/outputs for `seed17-02` and
`seed29-02`.

That standalone `project_numerical_methods.py` command produced a separate
`numerical-methods-manifest.json` alongside its attachment. Its source remains
retained for reproducibility and supplies the current scalar diagnostic
projection. Its four-checkpoint admission and fixed 20-companion assumption do
not describe the current split-owner release procedure. Keep historical artifacts
unchanged; use the component publisher for the current study.

## Measurements and interpretation

Each recorded qualification has a fixed baseline of three requests followed by three
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

- Run the accepted report adapter and original aggregate projection only after
  all twelve scientific components and their physical owners have closed.
- Generate this attachment from those same artifacts. Review every recorded
  physical qualification and its six diagnostic rows, including baseline
  failures, along with every component's complete companion graph.
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
