# Bounded post-run archival importer

`import_archive_postrun.ts` is a separate offline importer overlay. The captured `scripts/goalspec-import-archive-v3.ts` remains byte-identical and its SHA256 must equal `51b431980e7f0fe86d8b2befeb7756544ecaa1a69c7271fc0501b0bacb7a4504` before validation or database work begins.

The first original-importer attempt exhausted Node's default heap. A second attempt with a larger heap failed without a classified cause. Root preserved both attempts and confirmed the archive schema was absent after rollback. The precise cause of the second failure remains unknown. Independent source review identified two memory risks addressed here: `readline` can queue many large lines while database work waits, and 128-row batches combine large trial records into a single encoded parameter or readback response.

The overlay retains manifest/file hashes, canonical JSONL checks, original-source reconstruction, the loopback dedicated-database guard, immutable archive identity, one transaction, append-only schema, exact stored-row verification, and final JSONL roundtrip hashes. Its changes are:

- A pull-based reader consumes 64 KiB chunks and yields one complete line at a time. An explicit 64 MiB line ceiling fails closed before database connection if exceeded.
- Writes hold at most eight rows or 2 MiB of exactly measured JSON parameter bytes. A row larger than 2 MiB is admitted alone; it is counted in the receipt.
- Readback first selects at most eight row sizes, then fetches no more than 2 MiB of text, with one larger row allowed alone. This limits the response as well as the write parameter.
- Failures report only sanitized class, code, database code, cause code, and internal phase. Messages, stacks, URLs, SQL, and parameters are excluded.

The receipt records both importer source hashes, configured limits, observed write-batch sizes and readback row counts. These are application-level bounds, not a measured total-process memory claim. Root independently compares all 22 legacy table hashes before and after import; the importer's schema isolation does not replace that check.

Root owns PostgreSQL startup, shutdown, and secure connection configuration. After root confirms the execution replay has closed and starts the dedicated database, run once using the existing authorized `GOALSPEC_ARCHIVE_DATABASE_URL` environment value:

```powershell
node --max-old-space-size=4096 --import tsx research/goalspec/reports/2026-09-15-local-v3/import_archive_postrun.ts import research/goalspec/runs/local-final-artifact-archive-v3-20260915-b 4cd7e85163b9cb2ae1ec9707fa452e2fee0c5e8bde3003c05f2b2b3165e17fa3 research/goalspec/runs/repository-final-verification-v3-20260915/v3-archive-import.json
```

The archive ID and input hashes are unchanged. If that identity was already committed, the importer verifies existing data instead of inserting it again. The receipt filename must be new. Do not start a separate `inspect` pass: this import command performs complete file validation before opening its transaction.

After successful import, root creates the final legacy export and verifies that all table bytes match the before-import export and v2 baseline:

```powershell
node --import tsx scripts/goalspec-export-repository.ts research/goalspec/runs/repository-final-export-v3-20260915
research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/export_parquet.py research/goalspec/runs/repository-final-export-v3-20260915
```

Final export metadata timestamps can differ; the 22 table row counts, byte counts, and JSONL hashes must match. Keep the separate final budget journal outside these repository exports.
