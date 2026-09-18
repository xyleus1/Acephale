# GoalSpec v4 results packager

Run this tool after the selected work is closed. It has no default artifact collection, network access, database access, or provider calls. The workspace is the repository containing this script. Supply an explicit allowlist and a new ZIP path inside that workspace; the output directory must already exist.

```json
{
  "schemaVersion": 1,
  "entries": [
    {"path": "research/goalspec/runs/EXPLICIT-CLOSED-RUN/source.zip", "role": "executed-source-archive"},
    {"path": "research/goalspec/runs/EXPLICIT-CLOSED-REPORT", "role": "artifact"},
    {"path": "scripts/EXPLICIT-LATER-ANALYSIS.ts", "role": "analysis-overlay"}
  ]
}
```

These paths are examples, not an automatically selected collection. Roles are mandatory. Executed source ZIPs must be individually named files. The packager preserves their exact bytes. Later analysis files have their own `analysis-overlay/` member prefix and are never presented as the source executed by a native trial. Classification comes from the allowlist; the packager does not attest that a particular source archive was executed.

```powershell
research/goalspec/.venv/Scripts/python.exe outputs/goalspec-v4-tools/build_package.py --allowlist outputs/explicit-v4-allowlist.json --output outputs/new-v4-results.zip
```

Directory entries expand only to their regular files. Overlapping selections, symlinks, Windows junctions, paths outside the workspace, credential or environment paths, caches, mutable lock files, and existing outputs are rejected. The output cannot sit inside an included directory. Known immutable dependency lockfiles remain eligible. Selected ZIPs are inspected for unsafe member paths, linked members, duplicate names, or encryption, without extracting their contents. Path checks do not substitute for reviewing allowed file contents for secrets.

The archive includes a normalized allowlist and a manifest with every payload member's SHA-256, byte length, role, and repository path. It uses fixed timestamps, permissions, deterministic ordering, and `ZIP_STORED` to avoid compression-library differences. The completed ZIP is read back in bounded chunks and every member is verified. Standard output reports the ZIP and manifest hashes. The manifest does not contain its own recursive hash; its hash is in this final receipt.

Limits are 100,000 files, 2 GiB per file, 8 GiB total payload, a 1 MiB allowlist, and a 64 MiB manifest. Files and selected directories must remain unchanged while packaging. A failed build removes only the incomplete ZIP created by that invocation. Existing source artifacts are never modified.

`prepare_allowlist.py` writes the named v4 study selection, including the exact raw dependencies listed by the controller and annotation input manifests. It checks those dependency hashes and refuses to overwrite an existing allowlist. Final cleanup receipts can be added to the draft allowlist before its single final package build.

`hash_research_tables.mjs` records a read-only audit of existing local research tables, excluding the separate `goalspec_archive_v4` schema. Invoke it with `node --import tsx` and a new receipt path after configuring the dedicated database URL through `GOALSPEC_ARCHIVE_DATABASE_URL`. It hashes each PostgreSQL `row_to_json` UTF-8 representation, sorts those row hashes, and records their aggregate hash, row counts, byte lengths, and column-definition hashes. Matching before/after receipts establish preservation of those table contents and columns, without claiming a complete physical-database or role/sequence audit.

Synthetic packager checks use `python -m unittest discover -s outputs/goalspec-v4-tools -p test_build_package.py -v`. The Windows check accounts for Python 3.12 exposing different `ctime` semantics through `stat` and `fstat`; device, file ID, size, modification time, and mode still fence file changes.
