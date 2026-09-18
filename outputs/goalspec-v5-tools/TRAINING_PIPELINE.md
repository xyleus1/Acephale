# V5 post-closure training pipeline

Run these commands from `C:\Users\apexs\derya-crm-memory-main-20260908` only after the40 Base training slots and the annotation continuation have closed, with no paid measurement stage active. The helper never dispatches provider requests. It writes new paths and rejects overwrites.

The historical dataset is `research/goalspec/runs/local-controller-v5-dataset-20260916-b`, with239 unchanged public frame identities and dataset SHA256 `eb1d7bb02e08a0940bf9bb31e449f62f3df5dde68d4d4d1f9b3ff247e28ea729`. Its original permission source is `local-controller-v4-dataset-20260916-c/manifest.json`. The prior memory is `local-memory-v3-20260915/artifact.json`; only its v1-training episodes in the actual11 old fitting families are eligible.

```powershell
$v5Runs = 'research/goalspec/runs'
$v5Pipeline = "$v5Runs/local-v5-model-pipeline-20260916"

node --import tsx outputs/goalspec-v5-tools/prepare-training-pipeline.ts memory-plan "$v5Runs/local-v5-training-20260916" "$v5Runs/local-v5-fresh-fixtures-20260916/training/fresh-tasks.json" $v5Pipeline

node --import tsx scripts/goalspec-build-memory-v5.ts "$v5Pipeline/memory-plan.json" "$v5Pipeline/memory"

node --import tsx outputs/goalspec-v5-tools/prepare-training-pipeline.ts fresh-plan $v5Pipeline

node --import tsx scripts/goalspec-controller-v5-fresh-dataset.ts "$v5Pipeline/fresh-dataset-plan.json" "$v5Pipeline/dataset"

research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/train_controller_v5.py "$v5Pipeline/dataset" "$v5Pipeline/neutral" --epochs 120

node --import tsx scripts/goalspec-controller-v5-teacher-join.ts "$v5Pipeline/dataset" "$v5Runs/local-v5-annotations-continuation-c-20260916" "$v5Pipeline/teacher-join"

research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/train_controller_v5_teacher.py "$v5Pipeline/neutral/controller.json" "$v5Pipeline/teacher-join" "$v5Pipeline/conditional" --epochs 80
```

`memory-plan` checks cohort closure and hashes its five declared files, fixture manifest, historical dataset and manifests. It derives the new12/4/4 family split before reading labels and writes `pipeline.json` plus `memory-plan.json`. The new memory snapshot ID is `native-training-v5-20260916`. Its explicit exclusions cover every old family outside the actual11 fitting families and all fresh selection, calibration and development families. The memory builder applies exclusions before reading excluded native traces. Unverified native outcomes remain recorded exclusions. Historical source values cannot become current arguments.

`fresh-plan` verifies the completed memory has only allowed families, then binds its exact file hash. The fresh exporter preserves all old frame/group/prefix hashes, adds fresh public prefixes and marks unannotated goal labels as masked. Only a declared compatibility view changes the experience snapshot used for retrieval. New neutral training uses action labels in fitting families; selection chooses epochs and calibration chooses temperature. The fresh goal weights remain zero until the independent teacher stage.

The teacher join retains the original100-row denominator and verifies the complete v1/v2 continuation chain, archived source files, provider events, previous bytes and exact public-prefix identities. Previously attempted incomplete rows are never replaced. Missing or unsupported/unknown goal labels are masked. The residual fitter freezes neutral weights and uses separate preassigned goal-fitting, goal-selection and agreement-calibration families. At least five completed rows in each of those folds are required; otherwise retain the failed fit receipt and the valid neutral artifact, without inventing labels or relaxing the split. A small correlated calibration set remains a pilot estimate, not proof of unseen-family calibration.

The controller artifacts are `neutral/controller.json` and `conditional/controller.json`. Their separate reports contain selection epochs, losses, actual family lineages and agreement-calibration counts. The conditional artifact preserves the neutral model's fitting-family allowlist. Set runtime `memoryAllowedFamilies` to the selected controller's `lineage.trainingFamilies`. Workflow mining/export must independently use `pipeline.json.allowedMemoryFamilies` too; this helper does not mine workflow records or alter the legacy comparison library.

The root process writes the experiment configuration after the prescribed development selection, preserving measured utility estimates and the selected actor-context policy. It should select one exact artifact through `controllerPath`; this pipeline does not invent estimates or choose a model from confirmation outcomes. After both model reports and that configuration are closed:

```powershell
node --import tsx outputs/goalspec-v5-tools/prepare-training-pipeline.ts receipt $v5Pipeline PATH_TO_CLOSED_CONFIGURATION_JSON
```

This writes `lineage-receipt.json` with file SHA256 hashes, artifact content hashes, memory families, neutral and teacher partitions, missing-label counts and the exact configuration. It verifies frozen neutral weights, exact source-dataset joins and absence of non-fitting families from the memory. The optional configuration argument can be omitted to issue a model-only receipt; that receipt cannot later be overwritten.

Targeted validation, sequentially in a root-approved quiet CPU slot:

```powershell
node --import tsx --test --test-concurrency=1 scripts/goalspec-controller-v5-fresh-dataset.test.ts scripts/goalspec-controller-v5-teacher-join.test.ts scripts/goalspec-memory-v5.test.ts

research/goalspec/.venv/Scripts/python.exe -m pytest research/goalspec/tests/test_controller_v5_fresh.py research/goalspec/tests/test_controller_v5_teacher.py -q --basetemp .test-artifacts/goalspec-v5-fresh-teacher-synthetic-20260916

node --import tsx --test scripts/goalspec-bootstrap-v3.test.ts
```

Validation already performed: fresh export3/3, memory builder3/3, teacher join7/7 (including chained unknown-attempt preservation), Python synthetic training5/5. Root separately ran bootstrap7/7, including the pre-policy pool regression. The first fresh-export synthetic run exposed an unsupported fixture environment string; the fixture now uses the pinned environment, and the exporter explicitly rejects unsupported native commits. No actual fresh training or plan preparation was run while these commands were drafted.

## Closed execution and export recovery

The actual execution has now completed under `research/goalspec/runs/local-v5-model-pipeline-20260916`; its README and model-only `lineage-receipt.json` contain the results. One offline memory export failed before output creation because copied relative historical provenance paths did not match the new absolute-path registry. The failure is preserved in `memory-export-failure.json`. A regression now verifies that path normalization preserves source bytes and labels; the memory suite passed4/4.

The retry wrote `memory-b`, preserving the original immutable planning receipt. Recovery-path support lives in a separate helper, so the original planning generator's captured hash remains unchanged. The corresponding executed recovery commands were:

```powershell
node --import tsx scripts/goalspec-build-memory-v5.ts "$v5Pipeline/memory-plan.json" "$v5Pipeline/memory-b"
node --import tsx outputs/goalspec-v5-tools/prepare-training-pipeline-recovery.ts fresh-plan $v5Pipeline "$v5Pipeline/memory-b"
node --import tsx outputs/goalspec-v5-tools/prepare-training-pipeline-recovery.ts receipt $v5Pipeline
```

The remaining dataset, neutral fit, annotation join and residual-fit commands ran as shown above. The first fresh-plan recovery command used the identical recovery implementation before it was copied to the separate filename; the original planning generator was then restored byte-for-byte before library validation. No original data, planning receipt, model or report was overwritten.
