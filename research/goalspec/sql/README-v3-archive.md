# Optional local PostgreSQL archive

This importer is an archival sidecar. It creates only the separate `goalspec_v3_archive` schema and four new tables. It never changes the legacy `goalspec` tables, repository snapshots, application tables, or evaluation memory. The canonical JSONL and Parquet export remains the primary portable artifact.

Promote the staged importer and `v3_archive.sql` to their matching repository paths after live timing finishes. The staged copy of `src/lib/goalspec/canonical.ts` is a test dependency, not a replacement for the existing core file.

Inspect without a database or credentials:

```powershell
node --import tsx scripts/goalspec-import-archive-v3.ts inspect ARCHIVE_DIRECTORY EXACT_MANIFEST_FILE_SHA256
```

To import, configure `GOALSPEC_ARCHIVE_DATABASE_URL` securely for an existing dedicated local database, then run:

```powershell
node --import tsx scripts/goalspec-import-archive-v3.ts import ARCHIVE_DIRECTORY EXACT_MANIFEST_FILE_SHA256 NEW_RECEIPT.json
```

Only explicit `127.0.0.1` or `[::1]` PostgreSQL URLs with a `goalspec_` database name are accepted. URL query overrides are rejected. If `DATABASE_URL` is already configured, matching application storage is rejected. The importer does not create databases, read environment files, connect during inspection, or access the spending ledger.

Before any connection, inspection verifies the exact manifest hash, all six JSONL/Parquet hashes and byte counts, JSONL canonicalization and row counts, source/cohort relationships, and reconstruction of every original source from `raw_utf8`. Parquet is verified by its declared hash and the exporter round-trip receipt; this TypeScript importer does not independently decode Parquet. The Python exporter independently checks that its Parquet output reconstructs JSONL and original sources.

The importer consumes JSONL again in batches of at most 128 records and rechecks each consumed stream before committing. It stores original `raw_utf8`, canonical archive row text and SHA256, plus JSONB for queries. JSONB alone does not preserve numeric text or whitespace and is not the lossless source. Auxiliary worker IDs remain archival indexes, not extra trials. Before commit it reads the new database rows back in order, verifies row hashes and exact original text, and reconstructs each canonical JSONL SHA256. The receipt records this database roundtrip separately from the pre-import Parquet verification.

One transaction and an advisory lock serialize initialization/imports. UPDATE, DELETE and TRUNCATE are rejected by triggers in this new schema. A repeated archive ID is accepted only for the identical manifest bytes/hash, matching table counts, and a new database roundtrip verification. Different contents require a new archive ID. Receipts are written with exclusive creation after commit; if receipt creation fails, rerun with a new receipt filename to verify the already committed import.

Do not run imports or full archive validation while recording live benchmark latency. No database import has been performed by preparing these files.
