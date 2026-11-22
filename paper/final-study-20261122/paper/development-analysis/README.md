# Unvalidated development outcome figure

This figure copies the closed 36-run development cohort: six families, twelve three-arm paired blocks, twelve runs per arm. Reward completion is 12/12 in each arm; reward plus configured constraint-clean completion is 8/12 base, 9/12 neutral, and 9/12 Acephale. Every timing is invalid and all recorded speculative starts are zero. It is not a heldout result or canonical acceptance.

Reproduce with the existing Python environment containing Matplotlib 3.11.2:
    python plot_development.py
Run in a fresh directory without an existing output folder. The script verifies the exact copied data and report hashes, writes SVG/PDF/PNG, and performs a page-bounds check. It does not recompute statistics, call models, or change outcomes.

development-original-report.json retains the entire original computed report and its source SHA256, with explicit unvalidated/reporting-amendment labels. It contains no private cloud or filesystem references. The report's closed status means complete development evidence, not acceptance. Usage-derived hosted costs are not reconciled invoices; GPU costs are excluded. Degenerate empirical bootstrap intervals do not prove population perfection or equivalence. Actor seed17 is common to both predictor groups; predictor weights are confounded with preassigned task variants.

Private lineage retains every original outcome, scope, tool-schema expansion and earlier failure. No raw outcome was normalized or overwritten. The copied statistical implementation SHA256 is recorded in the projection.
