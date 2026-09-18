# Final v2 research repository export

The dedicated research database on loopback port 55440 contains 372 native runs and 372 outcome verdicts after all three v2 cohorts were imported. Phase counts are training 48, development 84, and held-out 240. The new cohorts contain 24, 24, and 48 outcomes respectively, including every failure.

The completed export is `research/goalspec/runs/repository-final-export-v2-20260915`: 22 research tables, 42,707 rows, and 47 files. All 44 data-file hashes and all JSONL row counts passed independent readback; the Parquet exporter verified every JSONL roundtrip. The database export has no accounting attachment.

- Final manifest SHA256: `15ec640196b461a2cc9be52281cc9467c11e941ec1d0e38fbafb06dcd31a98ed`.
- JSONL manifest SHA256: `a490afd7f484e8f304ad7b275757e6852716d316e3c50ce2196e258a6117689b`.
- Verification receipt: `research/goalspec/runs/repository-final-verification-v2-20260915/database-export.json`, SHA256 `1fb8393d8098384532b30dceb5f6291513ed832c137918ed940d64e85a4c8e2c`.

All 96 new native artifact hashes and independent verdicts match the exported records. The export contains 2,259 execution frames, 2,306 prediction records, and 27,516 execution events. The 32-pattern training library and its embeddings are unchanged. All 11 frozen memory table JSONL hashes match the preserved v1 export; the frozen training snapshot digest remains `90f5555ae711279cf085bde86fc3182dffdf9729ceecc99eb65bb6f4ef2bfb97`.

The first development-1 import stopped after one committed run because 21 failed trials had no per-run service events. Its original partial output is preserved under `local-v2-development-1-db-telemetry-20260915`. The successful retry is `local-v2-development-1-db-telemetry-retry-20260915`; the preexisting run export is byte-identical. The importer now accepts only declared, failed initial-greeting executions with zero per-run events and a closed owning phase. It retains the three original shared manifest/start/close events and records explicit unobserved failure provenance. It creates no per-run event or execution frame for those missing observations.

The repair affected only export tooling and its verification test. Its exact amended source files are preserved in `repository-final-verification-v2-20260915/tooling`, with original paths and hashes in `database-export.json`; use these at their original `scripts/` paths to reproduce the imports. `telemetry-amendment.json` records the failed attempt, five targeted tests, and idempotent retry. `source-freeze.json` verifies that the final confirmation's protected execution sources and frozen inputs remain unchanged.

The other successful import directories are `local-v2-development-2-db-telemetry-20260915` and `local-v2-confirmation-db-telemetry-20260915`. Their `import.json` receipts are hash-bound in the database verification receipt. The exact original event stream names and all 96 run IDs remain in `telemetry-export-plan.json`.

Root independently rechecked all 44 data-file hashes and the 42,707 row total, then stopped the dedicated PostgreSQL cluster at 19:19:21 UTC. The status command exited 3, indicating that the cluster was stopped, and no listener remained on port 55440. The completed receipt is [research-postgres-shutdown.json](../../runs/repository-final-verification-v2-20260915/research-postgres-shutdown.json). The commands used from the repository root were:

```powershell
powershell -NoProfile -File scripts/goalspec-local-postgres.ps1 -Action stop
powershell -NoProfile -File scripts/goalspec-local-postgres.ps1 -Action status
```

The receipt preserves the actual stop/status outputs and independent export verification. These commands targeted only the portable research cluster; application tables were never read or modified by the research exporter. The final package requires that shutdown receipt and a separately finalized consistent accounting copy after all paid replay work closes.
