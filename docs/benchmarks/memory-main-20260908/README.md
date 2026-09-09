# Memory and temporal benchmark: complete profile composition

Measured source: 7e23ff685bc88b3427e236d94e5463bae01a6304, based on upstream main 7080adad57ed08bf529a1fa7234e9f2220568dc5 as checked at task start.

This is 150 measured system/pass runs and 30,000 query executions assembled from three independently complete profiles, not one uninterrupted cohort. The 10K and 50K profiles were completed before a later AC-power interruption. All interrupted 250K rows were excluded and the entire 250K profile rerun in a fresh isolated database. No partial pass was filled in or selectively retried. The original failed launcher status remains visible under sources/resume.

## Reproducibility

- Each profile: five systems, 200 unique cases, three full warmup passes, ten measured passes, seed 42, concurrency four, top-k 20, and an actual app-role timeout of ten minutes.
- profile-provenance.json binds each complete profile to its original artifact hashes, source/database, run IDs, exact stage window, and infrastructure evidence. excluded-run-ids.json identifies every omitted interrupted 250K run.
- manifest.json lists raw and archived bytes and SHA-256 hashes. Gzip uses level 9 with fixed MTIME=0, no filename, and OS=255. A missing manifest means an incomplete export.
- Original profile CSV/summary/report files and both original launcher/status files are preserved. Combined summary arrays retain their original numerical values. results/report.html is rendered from that composed summary.
- Exact stdout/stderr logs for each accepted profile are preserved under sources. log-audit.json records their hashes and connection-reset/error-line counts. Completed measured cases do not imply error-free connection logs.
- Canonical statistics source is unchanged; the unchanged original extension adds query-type paired intervals without replacing the canonical overall interval. Both source hashes are recorded.
- Confidence intervals use 10,000 paired benchmark-case-cluster bootstrap resamples, retaining all ten repetitions within each sampled case. Latency percentiles use nearest rank.

## Interpretation limits

This is a synthetic architecture comparison. RAG baselines receive office/company scope, while Derya also uses exact operational scope. Typed-state/fact zeros are an output capability boundary, not proof that retrieved prose lacks the information. Preserve all five systems, MRR/fact-recall and subgroup regressions, cold/hot preparation costs, and latency-quantile tradeoffs. Profiles are measured at different times, so cross-profile timing is not a causal scaling experiment.

Only Derya Hot executes the real validator. Each profile has twenty unique deliberately stale single-dependency fixtures and twenty matching-state single-dependency fixtures, each repeated ten times. Stale comparison hashes are substituted before immutable-read insertion; matching fixtures retain live hashes. No operational mutation occurs after the read and no provider action is sent. Other baselines are modeled no-validator controls. Raw legacy stale_escape/false_conflict labels do not establish escaped external actions or tolerance of post-read unrelated changes. Do not generalize these single-dependency timings to large production manifests.

Executor latency excludes separately measured validation; separate percentile values cannot be added to obtain an end-to-end percentile. These trials contain no RSS, heap, retained-memory, or RAM measurement and support no RAM-savings claim. The separate runtime-off action-guard suite is not part of these benchmark counts.

The process-held SystemRequired power request guards idle sleep only, requires AC power, and does not override lid closure, explicit sleep, shutdown, or power loss. The accepted stages passed the preserved launcher checks. A later failure remains part of the provenance. No persistent power/lid policy was changed. No credentials, environment files, database storage, or vector binaries are packaged.

## Restore and reanalyze

Restore all .gz artifacts into sibling files with byte/hash verification and no overwrite. From this package directory, with Python installed:

```sh
python restore-artifacts.py
python analyze-composition.py --output analysis-recomputed
```

NumPy 2.3.4 was used for the canonical analysis. Verify restored raw hashes against manifest.json. Recomputed timestamps and absolute paths may differ while numerical outputs should reproduce. The analysis output must be a new child directory.

CommonJS utilities are archived byte-for-byte as .cjs.txt to avoid treating archived provenance as active repository lint targets. Their manifest rawPath identifies the original .cjs name. Restore those names only in an external working copy when inspecting or rerunning the tooling. Launcher scripts also require a separately prepared isolated environment; the credential/environment script is deliberately absent.

The six PNG/SVG figure pairs are driven only by the audited analysis. Their manifest binds renderer and input hashes and records completed visual verification.
