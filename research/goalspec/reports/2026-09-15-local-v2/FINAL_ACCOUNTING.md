# Final paid-work closure and accounting

Finalization completed at 2026-09-15 19:23:42 UTC after root confirmed the final 213/213 grading jobs and host closed. Exactly one budget reporter ran. The ledger lock was released; both process checks found no matching research dispatcher, and all nine paid host records showed terminal closure with their execution-state holds released. Failed development and smoke outcomes remain preserved.

| Measure | Original v1 final | Final combined total | Post-v1 change |
| --- | ---: | ---: | ---: |
| Known usage cost | $21.920303 | $29.271244 | $7.350941 |
| Spent or reserved | $70.291194 | $86.195518 | $15.904324 |
| Unresolved requests | 39 | 43 | 4 |

The 43 unresolved requests comprise 39 original requests, one development-2 request and three confirmation requests. Every original v1 ledger entry is unchanged. Known usage is included within commitments; these are overlapping measures. The journal records retained root maxima of $57.50, including the unresolved parents' already-known child usage. No reservation was released by finalization.

The [stage reconciliation](../../runs/local-final-accounting-v2-20260915/stage-accounting.json) attributes all post-v1 costs, with no residual category. The [closure receipt](../../runs/local-final-accounting-v2-20260915/closure.json) and [accounting manifest](../../runs/local-final-accounting-v2-20260915/manifest.json) preserve process checks, lock checks and hashes. The verbatim journal copy is 330,784,467 bytes with SHA256 `14b6c199db93db62192ba513157c7429d2628988970a764b3e0ccf9322a32d13`. Seven [native event copies](../../runs/local-closed-native-events-v2-20260915/manifest.json) were verified and exported as 26,451 native OTLP spans. Five accounting artifact hashes and all seven event-copy hashes also passed independent readback verification.

The command below documents the completed invocation; its existing destinations deliberately prevent rerunning it. Offline execution replay does not use the provider or ledger. Any future accounting snapshot requires an explicit instruction and new destinations. Never run the command while paid work is active.

From the repository root, with both destinations absent:

```powershell
python -B research/goalspec/reports/2026-09-15-local-v2/finalize_accounting.py --root . --output research/goalspec/runs/local-final-accounting-v2-20260915 --event-output research/goalspec/runs/local-closed-native-events-v2-20260915 --all-paid-closed
```

The finalizer checks terminal host records, known research dispatcher process names and the absent budget lock. It invokes the existing budget reporter once, verifies the lock is released and journal bytes are unchanged, then creates and verifies a verbatim journal copy plus copies of all shared native service event logs. It never kills processes, deletes files or locks, reads credentials, or calls a provider. Unrelated Node processes may remain running.

The accounting output contains `budget-report.json`, `budget-journal.jsonl`, `stage-accounting.json`, `otel.json`, `closure.json`, and `manifest.json`. Native event copies have their own manifest. OTLP includes native service events only; standalone prediction, annotation and grading JSONL remain separate evidence. Failed historical hosts and attempts are preserved.

`stage-accounting.json` compares the original v1 final known cost of $21.920303 and spent-or-reserved amount of $70.291194 with the actual final totals. Known usage sums request leaves; commitments sum root actuals or retained maxima. A parent's unresolved maximum already contains its child reservations. The expected unresolved count is 43 (39 original, one development-2, three confirmation), but the actual ledger result is reported and the expected-count comparison is explicit. No unresolved reservation is released by this workflow.

On failure, preserve partial output. Diagnose the cause and obtain a new finalization instruction with new destination names rather than overwriting or deleting anything. Do not retry the previously blocked credential deletion.

The independent closed prediction audit is in `legacy-prediction-audit.json`. Reproducing it requires the research Python environment and `--output NEW_JSON_PATH`; its script intentionally refuses overwrites. This audit verified 213 completed pinned-model calls at attempt zero, both hash chains, all ordered output links, and structural/source validity. Its recorded prediction-only cost is $0.249979. Structural validity does not establish semantic correctness, and the reused v1 checkpoints are development evidence.
