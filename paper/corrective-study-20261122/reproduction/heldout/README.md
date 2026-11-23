# Original native analysis reproduction
These files reproduce the numerical sections of the original native report from the accompanying safe row/design projection. The executions remain **UNVALIDATED**; reproducing arithmetic does not establish qualified scientific acceptance.

Use Python 3.12 and the pinned dependencies:
    python -m pip install -r requirements.lock
    python reproduce_native.py --input native-statistical-inputs.json --expected original-numerical-sections.json --output reproduced.json

The estimator functions, class definitions and native assembly statements are copied from the original sources. original-source-binding.json records source and fragment hashes. The package preserves every selected slot, original family/arm/trial/seed, censor/failure status, missing-cost/audit fields, invalid timing and scheduler missingness. The same family bootstrap seed42/2000 resamples and original weighting are retained. No raw task text, prompts, user data, account IDs or private runtime paths are required.

original_safe_rows.py records the unchanged preprocessing that generated the public safe rows. It is included for auditability; reproduction consumes the already-extracted rows. Operational archive/plan hashes remain copied provenance and are not regenerated from private paths. Costs are provider-usage-derived records, not invoice reconciliation. A zero value accompanied by an explicit original missingness flag must not be interpreted as an observed zero.
