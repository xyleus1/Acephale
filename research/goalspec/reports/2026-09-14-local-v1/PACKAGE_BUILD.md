# Building the final local package

The packager uses only Python's standard library and performs no network, provider, or database calls. Do not build the final package until the root agent confirms that paid phases, exports, analyses, and documentation are complete.

The editable allowlist is `package-inputs.json`. Each group names one exact repository-relative directory or file. Directory groups use explicit filename patterns. Required completion files and minimum file counts are configured for all planned final outputs. Heldout telemetry uses the complete v3 directory and its import receipt; the partial v1 attempt is preserved separately, and the v2 failure before import is recorded in the amendment evidence. The database export requires 22 JSONL files, 22 Parquet files, and three manifests. It contains no budget attachment; the verbatim closed journal is selected only from `local-final-accounting-v1-20260915`. Figure artifacts and the complete acquired APIGen source, ingestion, and pilot inputs are explicitly selected. SQLite ingestion state is excluded.

Use `--check-inputs` while other work continues. This only lists file membership and missing inputs; it does not claim final readiness, acquire the budget lock, or write an archive.

```powershell
python -B research/goalspec/reports/2026-09-14-local-v1/build_package.py --check-inputs
```

After final confirmation, choose a NEW ZIP outside the selected input trees. Its parent directory must already exist.

```powershell
python -B research/goalspec/reports/2026-09-14-local-v1/build_package.py --inputs research/goalspec/reports/2026-09-14-local-v1/package-inputs.json --output outputs/goalspec-local-v1-final.zip --final-confirmed
```

The command writes the ZIP, `.zip.sha256`, `.zip.manifest.json`, and `.zip.verification.json` using exclusive creation. The final manifest records selected paths, byte counts, hashes, source categories, and input groups. It excludes its own self-hash, which appears in the external verification JSON. Every archived member is read back and hash-verified. Source and original artifact files are streamed; a large budget journal is never loaded into memory as one value.

The archive contains original artifacts under `repository/`, the original frozen `source.zip`, and actual current allowed analysis/export/docs/tests under `current-source/`. `CURRENT_SOURCE_CHANGES.json` discloses changes since the freeze. Frozen protected execution files and frozen inputs are hash-checked. This overlay lets a recipient reconstruct both the original runtime and the final report implementation.

The packager rejects credential-like filenames, private-key/database/runtime/cache files, links escaping the workspace, unrelated runtime/test directories, open budget locks, and nested ZIPs other than the declared frozen source archive. Included text, including nested frozen source members, is scanned in bounded chunks for actual-looking OpenAI key prefixes and opaque JSON authentication-token values. A detection reports only the affected path. It never prints the matching text.

The exact native train/development/heldout service manifests were inspected separately: none had token, secret, password, authorization, credential, or API-key field names or actual-looking OpenAI keys. If another selected artifact contains a credential, preserve the raw file and make an explicit redacted share copy outside it. Add a `redactedCopies` object containing `originalPath`, `sharePath`, and `reason`. The package will omit that original payload and include the share copy plus `REDACTION_RECEIPTS.json`, recording both hashes, original byte count, and explanation. It never edits the original. A frozen source archive containing a credential fails closed and needs separate handling rather than silent alteration.

Run the bounded helper checks without producing a final package:

```powershell
python -B research/goalspec/reports/2026-09-14-local-v1/test_build_package.py
```

If a build fails during writing, no verified-success sidecars are produced. Preserve the failure for review and use a new output name after resolving the reported input; existing outputs are never overwritten.
