# V5 final archive staging checklist

Prepared from closed small manifests and filename inventories. This is a checklist, not a frozen archive plan. No repository export, archive export/import, ZIP packaging, large-log scan, or accounting operation has been performed by this staging task. Final hashing and database work wait until every measured cohort and budget owner has closed.

## Required final operations

1. Obtain root's closure signal for development, confirmation, Derya live, BFCL, prediction replay, final reporting and final accounting. Keep unavailable or failed declared work explicitly represented, never substitute earlier successful runs.
2. Export the 22 existing `goalspec` research tables in one read-only database snapshot, using the securely configured dedicated research URL:

   ```powershell
   node --import tsx scripts/goalspec-export-repository.ts research/goalspec/runs/local-v5-repository-export-20260916
   ```

   Use a fresh directory. This preserves exact row hashes, vectors, snapshot membership, transition/error statistics, annotations and available telemetry tables. Include `jsonl-manifest.json` and every one of its explicitly named JSONL files in the final byte archive. Current publication receipts confirm 40 newly imported native episodes and 40 newly published patterns. A final table export is still outstanding.
3. Freeze an explicit `goalspec-v5-archive-plan-v1` file with every source path, byte SHA256 and role. Directory families below are staging instructions only; the executable plan must enumerate exact files and must not discover inputs by glob during execution.
4. Export lossless JSONL/Parquet, verify reconstruction, import into `goalspec_archive_v5` with independent database readback and unchanged legacy-table hashes, and package a new deterministic ZIP. Existing archives stay untouched. Use the commands in `ARCHIVE_USAGE.md`.

The preparation-only `archive-staging.template.json` names the allowed staging roots and pending final files. Its three closure flags are deliberately false. After all writers close, create a new staging input, resolve the pending checklist and run `prepare_archive_plan.py NEW_CLOSED_STAGING.json NEW_ARCHIVE_PLAN.json`. Only this preparation command enumerates the explicitly named roots. Its output contains fixed paths and hashes; the exporter never enumerates roots or discovers additional inputs. Preparation also pins all five original archive hashes, all complete native source-ZIP inventories, runtime-source subset proofs, exact service log identities and the current checkpoint pointer association. No preparation command, archive hash pass or added synthetic test ran during the final paid replay.

## Closed native training and library

Use the following exact directory roots under `research/goalspec/runs/`:

| Root | Required files or authoritative inventory |
|---|---|
| `local-v5-training-20260916` | `design.json`, `dispatch-plan.json`, `service-manifest.json`, `service-readiness.json`, `public-contexts.json`, `outcomes.jsonl`, `summary.json`, `service.log`, and the 40 exact run-ID JSON artifacts declared by the service manifest |
| `local-v5-training-plan-20260916` | `plan.json`, `dispatch.json`, `source.zip`; source ZIP rules below |
| `local-v5-training-export-20260916` | `export-manifest.json`, `repository-bundle.json`, `mining-episodes.json`, `trajectories.jsonl` |
| `local-v5-training-report-20260916` | `report.json`, `README.md`, `manifest.json` |
| `local-v5-fresh-fixtures-20260916` | Exact manifests and fixture files referenced by each closed stage's frozen plan; include synthetic evaluator truth only after its cohort closes |
| `local-v5-library-plan-20260916` | `plan.json`, `README.md`, plus `../local-v5-library-inputs-20260916.json` |
| `local-v5-library-20260916` | `accounting.json`, `dispatch.json`, `embeddings.jsonl`, `events.jsonl`, `filtered-repository-bundle.json`, `mined.json`, `omitted.json`, `publication.json`, `records.json`, `summary.json` |
| `local-v5-library-publication-20260916` | `import.json`, `publication.json`, `inspection.json` |

The complete training cohort has 40 Base trials, 36 successes and 198 tool calls. The library fits only 24 episodes from 12 fresh fitting families (21 successes and three failures). Eight selection and eight calibration episodes remain archived but cannot enter mining. Keep the original pipeline receipt, library membership and actual pattern omissions; do not imply that historical patterns were reused if the closed summary says otherwise.

Training service events are explicitly located at `local-evaluation-20260914/events-5b296892-7179-4601-bcfa-a8d403e7bc5f.jsonl`. Every later stage must obtain its own exact event path from its closed readiness record, rather than importing all unrelated service logs.

Development has subsequently closed with all 16 declared slots retained, including seven host interruptions. Include the exact `local-v5-development-20260916` cohort artifacts and traces, `local-v5-development-plan-20260916` frozen plan/source ZIP, `local-v5-development-report-20260916/{report.json,README.md,manifest.json}`, and the closed guard. Its service events are `local-evaluation-20260914/events-a5ee0895-bb68-4afd-a629-37a571abd78b.jsonl`. Also include `local-v5-development-interruption-20260916/{receipt.json,README.md,power-events.json,power-events-v2.json}`; the receipt SHA256 is `05a7d49910a1846ce75db4655279ee7866ac1cd0b60dd81565a1ca234e9a18cb`. Preserve the incomplete initial power capture as explicitly excluded evidence alongside the corrected capture, and retain every guard/status source named by the receipt. The Windows power records and heartbeat gap are host evidence, not architecture latency.

Confirmation has subsequently closed with all 36 slots and clocks valid. Include its cohort/plan/guard artifacts, `local-v5-confirmation-report-20260916/{report.json,README.md,manifest.json}`, and `local-v5-confirmation-diagnosis-20260916/{report.json,README.md,manifest.json}`. The diagnosis report SHA256 is `53f7bce8d12f4d0c1a23a7cca95e64d3aeee20598c8499d462ffb7f0c3684873`. Preserve `outputs/goalspec-v5-tools/confirmation_failure_diagnosis.py`; its nine trace source hashes are explicitly inherited from the verified closed report manifest to avoid rereading 24.2 MB during subsequent paid work. Final archive hashing must independently verify those original trace files. The diagnosis preserves every grade and makes no causal architectural claim.

## Preserve every annotation attempt

Archive all four directories separately, including failure rows and unattempted rows:

- `local-v5-annotations-20260916`
- `local-v5-annotations-20260916-b`
- `local-v5-annotations-continuation-20260916`
- `local-v5-annotations-continuation-c-20260916`

Each contains `annotation-events.jsonl`, `annotations.jsonl`, `plan.json`, `provider-events.jsonl`, `selected-public-inputs.json`, `summary.json`, and a `source/` inventory. The continuations additionally contain `continuation-annotations.jsonl`, `continuation-public-inputs.json` and `prior-annotations.jsonl`. Preserve the exact original plan files alongside them:

- `local-v5-annotations-plan-20260916.json`
- `local-v5-annotations-plan-20260916-b.json`
- `local-v5-annotations-continuation-plan-20260916.json`
- `local-v5-annotations-continuation-c-plan-20260916.json`

Keep `local-v5-annotation-partial-diagnosis-20260916.json`, `local-v5-annotation-diagnosis-20260916.json`, associated guard events/immutable status publications, and intermediate budget/recovery receipts. The attempt summaries are overlapping continuation views (0, 21, 58 and 98 graded); summing them would double-count annotations. The original planned denominator and retained failures remain authoritative.

These files are byte archives of v5 teacher/goal evidence. The current database inspection has 99 relational goal-annotation rows; it does not demonstrate that v5 annotation attempts were converted into that legacy table. Do not describe generic artifact archival as typed annotation ingestion. Final table export will make the actual database contents explicit.

## Controller, memory and all profile attempts

- Preserve `local-v5-model-pipeline-20260916/pipeline.json`, `memory-plan.json`, `memory-export-failure.json`, `fresh-dataset-plan.json`, `lineage-receipt.json`, `README.md`, and the exact inventories under `memory-b/`, `dataset/`, `neutral/`, `conditional/` and `teacher-join/`. The pipeline receipt is immutable, with SHA256 `0ca442e16918aa83319e568cdd4a4e0b0c4cc499f40e53f8edcd311891e49f17`.
- Preserve the earlier `local-controller-v5-dataset-20260916`, `local-controller-v5-dataset-20260916-b`, `local-controller-v5-trained-20260916`, `local-controller-v5-replay-20260916`, and `local-controller-v5-training-source-20260916` artifacts required by the explicit lineage. Preserve failures rather than only the final controller.
- Preserve `local-v5-native-component-profile-20260916/plan.json`, the `-b` attempt's `plan.json`, `native-samples.jsonl` and `failure.json`, and the final `-c` attempt's `plan.json`, `native-samples.jsonl`, `gateway-samples.jsonl`, `report.json` and `manifest.json`. The successful profile contains 62 repeated samples from 31 cases, not 62 independent cases; six policy rejections remain in its record.
- Preserve all `local-v5-derya-profile-20260916` equivalence, read/writer timing and fixture artifacts, plus its `frozen-profile-source.ts.txt`, `source-overlay.json`, `frozen-database-test.ts.txt`, `database-test-overlay.json`, `frozen-epoch-migration.sql` and `epoch-migration-overlay.json`. The historical measured migration bytes differ intentionally from the current production-default-disabled migration.
- Include `local-v5-derya-validation-20260916`, `local-v5-epoch-default-off-20260916`, `local-v5-bootstrap-smoke-20260916`, `local-v5-native-readiness-20260916`, and both actual telemetry-interoperability receipts. Include future fitted composition verification receipts by their exact paths.
- Derya live and BFCL have now closed. Include `local-v5-derya-live-20260916`, its plan/guard and `local-v5-derya-live-report-20260916`; the supplementary report preserves 36/36 correct original scores and their SQL/provider/paired latency counts. Include `local-bfcl-v5-probe-20260916`, its dataset/plan/guard and `local-bfcl-v5-probe-report-20260916`. Preserve the Derya plan's synthetic `private-truth.json` after closure. The temporary supplementary arm-name schema mismatch created no output, so there is no failed artifact to invent.
- After final replay closure, include `local-v5-prediction-replay-20260916`, its guard, original inputs/current plan, `local-v5-prediction-replay-plan-failed-20260916.json`, the owner's plan-hash interoperability receipt, and `local-v5-prediction-replay-report-20260916.json`. The latest design has 16 prefixes and eight rankers (128 score rows), including a separately labeled offline matched-temperature residual comparison; keep its calibration override and source hashes. The replay is still pending here, and no evolving output was read.
- Final synthesis is expected at `research/goalspec/reports/2026-09-16-v5-local/{README.md,inputs.json,manifest.json}`, with extra interpretation bound under `local-v5-final-interpretation-20260916` and the authoritative final accounting at `local-v5-budget-final-20260916.json`. Preparation templates and `FINAL_INTERPRETATION_DRAFT.md` are source artifacts only, never final result evidence. Wait for closed documentation before freezing their final bytes.

## Budget, checkpoints and guard evidence

The one authoritative cumulative journal is `local-evaluation-20260914/budget.jsonl`. Its observed filesystem size at this staging point is 338,316,062 bytes; no contents were scanned. Allow that exact final file as `role: "ledger"`, `chain: "budget"`, with the explicit `maximumFileBytes: 536870912`. The total archive-source budget remains 2 GiB. Never truncate or split away earlier reservations to fit the limit.

Wait for the last budget owner to close, then retain the exact full journal, `budget.jsonl.checkpoint-pointer.json`, its referenced immutable `budget.jsonl.checkpoint.v1.*.json`, and the independent final accounting receipt. Freeze their final hashes together. Checkpoints are `verification` artifacts, not additional ledger entries or additional billed cost. Add the explicit `budgetCheckpointBindings` association described in `ARCHIVE_USAGE.md`; it validates the pointer, content hash, original journal-path hash, prefix bytes and terminal sequence. Preserve earlier checkpoint/recovery sidecars when cited by a closed recovery receipt.

Retain each used guard's closed `events.jsonl`, declared guard source/configuration and exact immutable status JSON inventory, especially the publications referenced by native pre/post health samples and failed annotation attempts. Exclude live lock/PID/temporary files. Verify the row-level status hashes against archived publications during final staging. Costs from overlapping provider logs, trial summaries and cumulative ledger reports are not additive.

## Exact source freezes and previous archives

For each `source.zip`, first verify its whole-file SHA256 against the frozen plan. Derive the complete exact `members` map from that immutable ZIP's actual member bytes and central-directory lengths, including documentation, verification and analysis members. Require set equality between the ZIP and this newly frozen complete inventory, then verify every member's hash and length. Separately require the plan's `runtimeSources` names to be a subset of the ZIP and verify those subset hashes: `experiment_v5.prepare` archives all `collect_sources` entries, while `runtimeSources` intentionally contains only the execution category. Never equate that execution subset with the complete ZIP inventory. Retain the original ZIP unchanged and do not substitute current working-tree files for captured bytes. The closed training source ZIP SHA256 is `af2a6284c1acc84a02485c4c2f0cb823f050ee04f0eb18ffee1233d9460d7a0c`.

Add these existing outputs to `preserveArchives` using their closed receipt hashes, then independently recheck them at final export/pack:

- `outputs/goalspec-local-v1-final.zip`
- `outputs/goalspec-local-v2-final.zip`
- `outputs/goalspec-local-v3-final.zip`
- `outputs/goalspec-local-v4-final.zip`
- `outputs/goalspec-official-benchmarks-20260916.zip`

Do not nest those large archives into the new result bundle. Explicit external pins cover the native upstream revision `2174a603f6d014ef94473ffa95957f6ce27100db`, licensed raw APIGen/public datasets, model identities and environment dependencies. The new archive contains selected pinned source ZIP members and licenses, not complete upstream checkouts, virtual environments, node_modules or raw APIGen corpora.

After paid closure, archive helper and preparation tests pass 23 synthetic cases, including small injected file limits, checkpoint/journal relationships, complete source-ZIP versus runtime-subset checks and source/literal/role-bound synthetic URL exceptions. The default Windows temp directory denied access on the first pytest invocation; the same tests passed with a fresh workspace basetemp. No production-size ledger or database preservation scan has been run. The actual Postgres archive import still needs execution and readback; URL-guard unit tests alone are not an end-to-end import result.

The read-only 22-table repository export has now completed at `local-v5-repository-export-20260916`: 43,009 rows and 141,921,213 canonical JSONL bytes. It includes 5,000 normalized Salesforce APIGen-MT-5k episode records, so this archive does contain derived APIGen research records. The original 127,761,256-byte raw download is excluded. Preserve the pinned acquisition and ingestion manifests with revision `abc4a517d67c541f85f6470cbd8fd3186b36830e`, CC BY-NC 4.0 attribution and research-only restrictions, original data hash and recorded card hash. The original card bytes were not found among those local acquisition files or previous ZIP members; describe the manifest's card-hash reference honestly rather than claim to have archived the card itself. No new dataset download is needed. Native runtime workflow/memory eligibility remains restricted to fitting native families.
