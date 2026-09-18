# Post-closure v2 repository export

These commands are prepared, not executed. Wait for root to confirm that the 48-trial confirmation and its host have closed. Use only the dedicated research database on loopback port 55440. The exact 96 new run IDs, manifest hashes, and event header identities are recorded in `telemetry-export-plan.json`.

The source event files under `research/goalspec/runs/local-evaluation-20260914` are:

| Stage | Runs | Event file |
| --- | ---: | --- |
| Development 1 | 24 | `events-8d62260c-e4ab-46fc-976e-fc69d1182f4a.jsonl` |
| Development 2 | 24 | `events-254eb9cf-cecf-45ca-8ba1-d3b5394cdd80.jsonl` |
| Confirmation | 48 | `events-cf379b4d-6725-462c-8f3b-6c7afd22c92e.jsonl` |

The importer identifies each phase's streams from the saved service-manifest run IDs, validates immutable event hashes, and rejects streams lacking a final `service_closed` event. All failed native outcomes remain included. Existing destinations must not be overwritten; retain any partial attempt and choose a new retry name.

From the repository root, after closure authorization:

```powershell
$env:GOALSPEC_DATABASE_URL = 'postgresql://goalspec_owner@127.0.0.1:55440/goalspec_research'
node --import tsx scripts/goalspec-telemetry.ts import research/goalspec/runs/local-v2-development-1-20260915 research/goalspec/runs/local-evaluation-20260914 research/goalspec/runs/local-v2-development-1-db-telemetry-20260915
node --import tsx scripts/goalspec-telemetry.ts import research/goalspec/runs/local-v2-development-2-20260915 research/goalspec/runs/local-evaluation-20260914 research/goalspec/runs/local-v2-development-2-db-telemetry-20260915
node --import tsx scripts/goalspec-telemetry.ts import research/goalspec/runs/local-v2-confirmation-20260915 research/goalspec/runs/local-evaluation-20260914 research/goalspec/runs/local-v2-confirmation-db-telemetry-20260915
```

Expected cumulative native runs and outcome verdicts: **372**, comprising training 48, development 84 and held-out 240. These counts include the original 276 runs, both new development rounds, and the one 48-trial confirmation cohort. Retain the frozen 32-pattern library with snapshot `native-training-v1-20260915` and content digest `90f5555ae711279cf085bde86fc3182dffdf9729ceecc99eb65bb6f4ef2bfb97`.

After imports and count/frozen-library verification, create a new read-only JSONL export and verified Parquet conversion:

```powershell
node --import tsx scripts/goalspec-export-repository.ts research/goalspec/runs/repository-final-export-v2-20260915
& research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/export_parquet.py research/goalspec/runs/repository-final-export-v2-20260915
```

The export selects exactly 22 research tables, producing 22 JSONL files, 22 Parquet files and three manifests. Its row count depends on the actual completed telemetry. Do not attach the live budget journal. Root supplies a separately verified, consistent accounting copy after all paid replay work closes, along with the final copied event logs and their hashes. Update the package allowlist only with the actual successful import/export/copy paths and receipts.

The repository export preserves native artifact hashes and raw events. The v2 native JSON files and study claims/designs/completions remain necessary to reproduce stage identity, user-policy hashes, independent outcomes and total/drain timing; do not substitute the relational export for those original artifacts.
