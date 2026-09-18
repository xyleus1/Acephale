# Building the v2 local package

This separate v2 packager preserves every selected file verbatim. It does not modify the v1 archive or embed its ZIP. Recipients need the preserved `goalspec-local-v1-final.zip` separately, with SHA256 `ce25a994a985597c5920eccd60e9361b341839d81a7d52269c2c22386c1da8b8`.

The tool uses only Python's standard library. It makes no network, provider, database, or subprocess calls. Final archive building must wait until root finalizes the experiment and explicitly starts packaging. Root may authorize bounded helper tests and filename inventory separately. No live journal content is needed to prepare its allowlist.

## Final inputs

Root must resolve every null path in `package-inputs.json` after phase closure. Keep each group rooted at one exact named run directory or this v2 report directory. Never use a home directory, repository root, or the live shared budget directory as an artifact group.

- Supply the final confirmation run/host directories, its final source archive, and `finalSourceId`.
- Supply completed telemetry import directories, the final 22-table JSONL/Parquet export, and its verification directory.
- Supply the closed v2 event-copy directory and its copy manifest. Raw provider/service event chains remain necessary evidence even when relational telemetry was imported.
- Supply the consistent accounting-copy directory. Set `accountingCopy.journalPath` to its copied journal, `sha256` to the root-verified copied journal hash, and `closureReceiptPath` to its included close/copy receipt. The final copied journal must include unresolved reservations. The script never substitutes the current live journal for this copy.
- Add any completed legacy replay host/output directories that root created after this initial inventory. Report analyses under this named v2 report tree are already selected by explicit suffix patterns.
- Check required files and minimum counts against the actual frozen confirmation size. If a planned phase could not run, preserve an explicit disposition receipt and update the manifest to select that evidence instead of silently claiming completion.
- Set `finalized` to `true` only when paid work, accounting, imports, exports, analyses and documentation are complete. Preserve the original failed guard/stress/development artifacts and all source captures.

The source-archive list is explicit and supports multiple historical captures. Each `source.zip` must match its own manifest checksum, exact member set, per-member hashes and source-tree hash. Every referenced frozen input must also appear in an explicit artifact group and retain its recorded hash. Historical execution captures intentionally differ; only the nominated final capture is compared with current protected execution files.

The package excludes dependency installations, `.git`, `.env`, credential-like paths, private keys, database runtime files and pytest/cache trees. It rejects links and junctions, unexpected nested ZIPs, missing completion inputs, active budget locks and selected text containing actual-looking credential values. It does not automatically redact originals. If a selected artifact is unsafe to share, stop and make an explicit, separately documented share-copy decision before changing the allowlist.

## Inventory and helper verification

After root permits execution, inventory only names without reading content hashes or the accounting journal:

```powershell
& research/goalspec/.venv/Scripts/python.exe -B research/goalspec/reports/2026-09-15-local-v2/build_package.py --check-inputs
```

The helper tests use tiny disposable fixtures. They do not access the real ledger, databases or provider:

```powershell
& research/goalspec/.venv/Scripts/python.exe -B -m pytest research/goalspec/reports/2026-09-15-local-v2/test_build_package.py -q
```

After development closed, root authorized helper verification: 11 tests passed, and scoped Ruff passed after import ordering and a bytes-literal correction. The evidence is recorded in `runs/local-v2-final-candidate-verification-20260915/verification.json`. The final ZIP has not been built.

## Final build

After root finalizes paths and confirms packaging, create a new output:

```powershell
& research/goalspec/.venv/Scripts/python.exe -B research/goalspec/reports/2026-09-15-local-v2/build_package.py --output outputs/goalspec-local-v2-final.zip --final-confirmed
```

The builder streams selected files, rechecks source-file hashes, reopens the resulting ZIP, and verifies every member's size and SHA256. It writes the ZIP, `.zip.sha256`, `.zip.manifest.json` and `.zip.verification.json with exclusive creation. `PACKAGE_MANIFEST.json` excludes its own self-hash; the external verification records that hash, and the external manifest is byte-identical to the embedded one. A failed attempt remains preserved and produces no verified-success receipt. Use a new output name for any retry.

Original artifacts retain their repository-relative paths under `repository/`. `SOURCE_ARCHIVES.json` identifies each captured source tree, `V1_PACKAGE_REFERENCE.json` identifies the separately required v1 ZIP, and `PACKAGE_INPUTS.json` records the exact final allowlist. The existing v1 checksum sidecar is checked; the v1 ZIP itself is neither reopened for hashing nor included.
