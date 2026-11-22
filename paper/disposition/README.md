# Dated incomplete disposition

recorded-snapshot.json is a public projection of the validated reporting-only sidecar. Its original private SHA-256 and claim-observation SHA-256 are retained; physical locations and administrative identifiers are omitted. Reads were individually strongly consistent, not atomic across all rows.

export_snapshot.py requires this exact reviewed projection, the exact three accepted report JSON files already present under paper/sources, and the exact copied accepted-values Markdown. It validates all inputs before creating a fresh output directory. It copies values and emits studyComplete=false; it does not run a statistical estimator or infer pending results.

The output directory reproduces incomplete-report.json, recorded-accepted-values.json and manuscript-accepted-values.md. The private adapter remains responsible for any future acceptance proof; a different snapshot requires a new explicit publication.
