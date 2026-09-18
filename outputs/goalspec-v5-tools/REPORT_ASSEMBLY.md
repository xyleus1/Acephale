# Closed v5 report assembly

`assemble_report.py` uses only explicit closed JSON report files. It does not inspect raw native cases, call a provider, alter grades, recompute confidence intervals, fit a controller or merge incompatible benchmark scores. Run it only after all declared cohorts have closed, including failed slots.

```powershell
research/goalspec/.venv/Scripts/python.exe -X utf8 -B outputs/goalspec-v5-tools/assemble_report.py --inputs EXPLICIT_INPUTS_JSON --output NEW_REPORT_DIRECTORY
```

The configuration has version `goalspec-v5-final-synthesis-v1`, `allDeclaredCohortsClosed: true`, and `inputs` containing all ten roles: `annotation`, `training`, `development`, `confirmation`, `derya_profile`, `derya_live`, `bfcl`, `prediction`, `controller`, `budget`.

An available role must have `path`, exact file `sha256`, and `closed: true`. Paths resolve relative to the input configuration directory. `expectedVersion` optionally pins additional schema versions. An unavailable role must instead have `available: false` and an actual `reason`; it must not point at a partial cohort or an earlier substitute run.

```json
{
  "version": "goalspec-v5-final-synthesis-v1",
  "allDeclaredCohortsClosed": true,
  "inputs": {
    "annotation": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "training": {"available": false, "reason": "Actual reason if no closed report exists"},
    "development": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "confirmation": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "derya_profile": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "derya_live": {"path": "EXACT_CLOSED_SUMMARY.json", "sha256": "EXACT_SHA256", "closed": true},
    "bfcl": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "prediction": {"path": "EXACT_CLOSED_REPORT.json", "sha256": "EXACT_SHA256", "closed": true},
    "controller": {
      "path": "EXACT_FROZEN_FIT_REPORT.json", "sha256": "EXACT_SHA256", "closed": true,
      "bindings": [{"label": "Selected checkpoint", "pointer": "/selectedCheckpoint", "format": "text"}]
    },
    "budget": {"path": "EXACT_FINAL_CUMULATIVE_BUDGET.json", "sha256": "EXACT_SHA256", "closed": true}
  }
}
```

Use `annotation_report.py` output for annotation diagnosis; `report_v5.py` report.json separately for training, development and confirmation; the Derya profile's report.json and live harness's summary.json; `bfcl_probe.py score` report.json; `prediction_replay_report.py` report.json; the selected controller fit report; and `goalspec-budget-report.ts` final JSON.

Variable controller diagnostics or optional extra measures use explicit `bindings`: a label, RFC6901 JSON pointer, and format (`number`, `count`, `percent`, `pp`, `usd`, `text`, or `ci`). A `ci` binding may have unit `percent`, `pp` or `number`. Missing pointers display unavailable, never zero. Bind only actual declared source measures; do not infer held-out accuracy from fitted or calibration scores.

The assembler preserves native family intervals, domain results, paired signs, failures and physical-call coverage. Partial physical-call totals are labeled known subtotals and the underlying per-success estimate remains unavailable. It separates cumulative settled usage, unresolved charges and reserved budget. It does not add component costs to the cumulative ledger again. The BFCL probe, PostgreSQL component profile, synthetic Derya live tasks, custom native fixtures and selected public official tasks retain distinct labels and latency definitions.

Outputs are `README.md`, the exact input configuration bytes, and `manifest.json` with input/output/generator SHA256s. An existing output directory is rejected. Input hashes are rechecked before writing. The assembler consumes existing intervals and does not invent missing confidence bounds.
