# Memory and temporal port: measured results

Completed 2026-09-09. Measured implementation: `7e23ff685bc88b3427e236d94e5463bae01a6304`, based on upstream main snapshot `7080adad57ed08bf529a1fa7234e9f2220568dc5`, verified when this port began on September 8. This is not a claim that the snapshot remains current upstream main.

Publication is limited to `xyleus1/derya-crm`, branch `codex/memory-temporal-main-20260908`. No upstream/main update, production migration, deployment, or real provider send is part of this work. Runtime/projection/retrieval flags remain opt-in; see [implementation and verification](MEMORY_LATEST_MAIN_PORT.md).

The accepted result set contains **150 complete measured runs and 30,000 executions**: three whole profiles, five systems, 200 unique cases per profile, and ten measured passes. It explicitly composes separately completed profiles, not one uninterrupted launch. No interrupted 250K passes were included.

## Revised publication text

As we built our logistics agents, we found that conversational retrieval alone does not give multiple agents a shared, current view of changing shipment data, purchase orders, and RFQs. Reconstructing operational state from historical messages can leave agents reasoning from different versions of the same facts.

We built agentic memory that combines durable, evidence-linked operational history, immutable decision-read snapshots, and an updated representation of current supply-chain state. An agent can read current quotes, lead times, terms, inventory, demand, and open issues, then retrieve the historical evidence relevant to its decision.

After porting this infrastructure onto the September 8 main snapshot, we reran our synthetic benchmark. At 250K retrievable records, Derya Hot achieved 84.33% Evidence Recall@20 versus 72.08% for Strong Hybrid RAG, a +12.25 percentage-point improvement. The paired 95% confidence interval was +9.25 to +15.33 points. Retrieval p95 was 2.85s versus 4.81s, 40.7% lower. Vector RAG remained the fastest raw retrieval baseline.

This compares architectures, including Derya's additional operational scope, not identical-input ranking algorithms. The full report retains the tradeoffs: Derya had lower mean reciprocal rank (MRR) and entity-resolution scores, and we did not measure RAM savings.

We also validate the specific state a covered agent action relied on. Across ten repetitions of 20 deliberately stale, single-dependency read fixtures, all 200 checks were rejected; all 200 matching-state checks were accepted. Separate validation latency was 44.2ms p50 and 141.4ms p95. These were seeded validation fixtures, not live action executions or tests of unrelated changes after a read.

For long-running logistics agents, the important distinction is that the company's operational state persists even when the agent reasoning over it does not.

Publication note: results combine complete 10K/50K profiles with a complete fresh 250K rerun. The 250K runner logged connection resets despite zero failed measured cases; the exact logs and limitations are preserved below.

## Retrieval results

Each row aggregates 200 unique cases across all ten measured passes. Latency is the executor's retrieval/hydration time, excluding separately measured semantic validation. Percentiles are nearest-rank over 2,000 executions, not averages of pass percentiles.

| Records | System | Evidence Recall@20 | p50 ms | p95 ms | Correct gold evidence/s |
| --- | --- | ---: | ---: | ---: | ---: |
| 10K | Current Keyword | 71.33% | 216.65 | 727.58 | 3.3950 |
| 10K | Vector RAG | 69.08% | 52.85 | 89.68 | 18.1996 |
| 10K | Strong Hybrid RAG | 72.08% | 307.09 | 1083.97 | 2.3370 |
| 10K | Derya Cold | 84.33% | 467.20 | 677.71 | 2.8917 |
| 10K | Derya Hot | 84.33% | 380.14 | 522.41 | 3.4960 |
| 50K | Current Keyword | 71.33% | 444.04 | 1215.81 | 1.8259 |
| 50K | Vector RAG | 69.08% | 60.14 | 113.17 | 15.0321 |
| 50K | Strong Hybrid RAG | 72.08% | 722.43 | 2223.57 | 1.0784 |
| 50K | Derya Cold | 84.33% | 784.25 | 974.48 | 1.6954 |
| 50K | Derya Hot | 84.33% | 710.90 | 926.74 | 1.8340 |
| 250K | Current Keyword | 71.33% | 1708.23 | 2768.84 | 0.5894 |
| 250K | Vector RAG | 69.08% | 121.88 | 367.28 | 5.7465 |
| 250K | Strong Hybrid RAG | 72.08% | 2584.28 | 4808.77 | 0.3802 |
| 250K | Derya Cold | 84.33% | 2518.19 | 3037.49 | 0.5269 |
| 250K | Derya Hot | 84.33% | 2404.88 | 2850.96 | 0.5515 |

At 250K, Hot's p95 is 40.71% lower and p50 is 6.94% lower than Hybrid. Hot/Hybrid correct-evidence bandwidth is 1.451x, paired 95% CI 1.362x to 1.545x. Bandwidth divides summed correct gold items by summed retrieval time; it is not concurrent wall-clock throughput. Hot is not fastest: Vector wins raw latency, and Hot's 250K p95 is 2.97% slower than Keyword's. Hot/Keyword bandwidth is 0.936x, paired 95% CI 0.879x to 0.997x. At 10K, Hot's p50 is 23.78% slower than Hybrid's despite its lower p95. Ratios of latency quantiles are descriptive, not paired latency confidence intervals.

The paired recall improvement is +12.25 points at all three sizes. Its 95% CI is +9.25 to +15.33 at 10K, +9.33 to +15.33 at 50K, and +9.25 to +15.33 at 250K. These intervals use 10,000 case-cluster bootstrap samples, retaining all ten repetitions within each sampled case; repeated executions are not independent new questions.

## Quality tradeoffs

Scores below use a 0-to-1 scale. Typed-state and typed-fact zeros for retrieval-only baselines describe their output capability, not absence of relevant information in retrieved prose. Evidence Recall@20 is neither state accuracy nor LLM answer accuracy.

| Records | System | MRR | Typed fact recall | Typed state accuracy | Temporal order | Entity resolution |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 10K | Current Keyword | 0.9067 | 0 | 0 | 0.1333 | 0.4444 |
| 10K | Vector RAG | 0.9188 | 0 | 0 | 0.1333 | 0.5778 |
| 10K | Strong Hybrid RAG | 0.9567 | 0 | 0 | 0.1333 | 0.4444 |
| 10K | Derya Cold | 0.6529 | 0.4142 | 0.3429 | 0.2333 | 0.3778 |
| 10K | Derya Hot | 0.6529 | 0.4142 | 0.3429 | 0.2333 | 0.3778 |
| 50K | Current Keyword | 0.9138 | 0 | 0 | 0.1333 | 0.4444 |
| 50K | Vector RAG | 0.9213 | 0 | 0 | 0.1333 | 0.5778 |
| 50K | Strong Hybrid RAG | 0.9700 | 0 | 0 | 0.1333 | 0.4444 |
| 50K | Derya Cold | 0.5936 | 0.4142 | 0.3429 | 0.2667 | 0.3778 |
| 50K | Derya Hot | 0.5936 | 0.4142 | 0.3429 | 0.2667 | 0.3778 |
| 250K | Current Keyword | 0.9063 | 0 | 0 | 0.1333 | 0.4444 |
| 250K | Vector RAG | 0.9208 | 0 | 0 | 0.1333 | 0.5778 |
| 250K | Strong Hybrid RAG | 0.9588 | 0 | 0 | 0.1333 | 0.4444 |
| 250K | Derya Cold | 0.6154 | 0.4142 | 0.3429 | 0.2333 | 0.3778 |
| 250K | Derya Hot | 0.6154 | 0.4142 | 0.3429 | 0.2333 | 0.3778 |

Higher evidence coverage coexists with lower MRR and entity resolution. The typed current-state score remains 34.29%, not 84.33%. These are material limitations, not universal accuracy improvements.

At 250K, the paired Hot-minus-Hybrid evidence-recall differences by query category are:

| Category | Unique cases | Difference, pp | Paired 95% CI, pp |
| --- | ---: | ---: | --- |
| Exact lookup | 40 | +8.75 | +3.75 to +15.00 |
| Semantic | 40 | +8.75 | +3.75 to +15.00 |
| Current versus stale | 35 | +15.71 | +8.10 to +24.29 |
| Temporal explanation | 30 | +18.33 | +9.44 to +27.78 |
| Entity hop | 30 | +8.33 | +1.67 to +15.00 |
| Routing / tenant | 15 | +16.67 | +6.67 to +30.00 |
| Autopilot-action retrieval | 10 | +15.00 | 0.00 to +30.00 |

The last interval touches zero. Query-category intervals use the preserved statistical extension and are not a multiple-comparison-adjusted guarantee. The action category measures retrieval, not provider execution.

## Semantic validation and projection costs

Only Derya Hot invokes the production validator, passing office ID and immutable read ID. Expected fixture outcomes are checked afterward. Each profile contains 20 unique stale and 20 matching-state, single-dependency fixtures, each repeated ten times.

| Records | Stale checks rejected | Matching checks accepted | Separate p50 ms | Separate p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 10K | 200/200 | 200/200 | 86.73 | 225.72 |
| 50K | 200/200 | 200/200 | 107.03 | 279.17 |
| 250K | 200/200 | 200/200 | 44.21 | 141.44 |

Stale version/value hashes are substituted before immutable-read insertion. Matching fixtures retain current dependency hashes. No operational mutation occurs after the read, no unrelated post-read mutation is tested, and no provider action is sent. Legacy raw fields named `stale_escape` or `false_conflict` are compatibility labels, not observations of escaped external actions or unrelated-change tolerance. Other systems use modeled no-validator controls. Do not generalize single-dependency validation latency to large manifests or add separate p95 values to invent an end-to-end p95.

The separate local, runtime-off action-guard integration suite blocked 162/162 stale or invalid attempts and produced 0/84 false conflicts across 41 scenarios repeated six times. It used real local mutations, immutable-input checks, and fake providers. Its guarded-action p50/p95 was 11.3/41.1ms. Those existing guards are not the semantic benchmark, and the counts/timings are not pooled.

| Records | Materialization p50 ms | First preparation-call p50 ms | Cold hydration p50 ms | Hot hydration p50 ms | Canonical amortization, reads |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10K | 154.80 | 228.67 | 467.01 | 379.93 | 1.78 |
| 50K | 142.15 | 190.78 | 783.26 | 710.63 | 1.96 |
| 250K | 278.43 | 387.26 | 2517.85 | 2404.70 | 2.46 |

The canonical amortization estimate divides median build-plus-persist materialization cost by the difference of median cold/hot hydration times. It excludes additional preparation/verification costs and has no confidence interval. The first preparation-call timer also stops before a separate verification compile, whose p50 was 93.43, 103.46, and 137.74ms respectively. Using first-call medians instead gives illustrative ratios of 2.63, 2.63, and 3.42 reads, not the canonical statistic or verification-inclusive setup cost. Do not sum these marginal medians to invent a combined setup median. Neither calculation establishes production break-even. Each profile prepared 12 projections with zero recorded preparation failures. Cold had no projection hits; Hot had 100% hits in these prepared fixtures. Maintenance and invalidation costs still exist; overlapping component timings must not be summed.

## Method, provenance, and interruptions

- Identical measured commit and source fingerprint across all accepted profiles: `12abbebcc499750d8a9f5eddd613be4bded950218b09a37b0ef4b9b7e78f3e11`.
- Five systems, 200 unique cases per profile, three complete 200-case warmup passes per system, ten measured passes, seed 42, concurrency four, top-k 20. Warmups cover the case set, not every retrievable corpus record. System order rotates; cases use shared seeded orders. The app role's actual statement timeout was verified at ten minutes.
- Local shared workstation: Intel Core i5-1235U, 12 logical processors, 8 GiB RAM, Windows build 10.0.26200, Node 22.16.0 x64, PostgreSQL 17.5. Prisma pool: 32 connections, 120-second pool timeout. No RSS, heap, retained-memory, or RAM-use metric was collected.
- Vector baseline: pinned MiniLM, q8, 384 dimensions, model revision `cb3d680149bf9a3209564e1b27ab3bb355b65707`, Transformers 4.2.0. Asset identity/reuse was checked without rebuilding the index. The 250K aggregate retrievable-record corpus includes 83,269 vector chunks; it does not mean 250,000 vectors.
- RAG baselines receive office/company scope. Derya additionally receives exact operational scope and typed state. This is a synthetic architecture comparison, not an identical-input ranking-algorithm comparison or a real-world answer-quality trial.
- Confidence intervals use the unchanged canonical statistics implementation, NumPy 2.3.4, bootstrap seed 20260827, and 10,000 paired case-cluster samples. They are conditional on this synthetic workload. No causal claim is made about old-versus-new implementation speed or cross-profile scaling on this shared machine.

Accepted stage windows, all UTC on September 9:

| Profile | Whole-profile stage window | Local database |
| --- | --- | --- |
| 10K | 00:18:55.050 to 00:38:30.890 | `derya_main_benchmark_resume` |
| 50K | 00:38:31.415 to 01:15:08.472 | `derya_main_benchmark_resume` |
| 250K | 05:40:27.589 to 07:36:23.675 | `derya_main_benchmark_large_retry` |

These windows include preparation/warmup within the runner, not only measured execution. The 250K measured runs span 06:13:42.762 to 07:36:20.196 UTC. Its launcher ended successfully at 07:36:24.177 UTC after releasing its process-held power request; 6,755 AC checks and 229 sleep-log checks found no interruption. No persistent power policy was changed.

Excluded attempts remain preserved locally: the preliminary fixture/timeout mismatch cohort on `bc045050`; a later standby-interrupted cohort; and all 45 recorded 250K run IDs from the AC-interrupted resume launch. The complete 10K and 50K snapshots from the latter launch were accepted before that later interruption; its failed terminal status remains in the package. The fresh 250K database was prepared and verified independently. Windows rebooted unexpectedly before its launch; local PostgreSQL recovery and exact-target readiness checks completed before any timed work. No partial pass was filled in and no individual measured pass was selectively replaced.

### Connection diagnostics

All 150 accepted runs and 30,000 measured executions completed with zero failed/skipped results. All five 250K warmup summaries also recorded three passes, 600 executions, and zero failures each. This does not mean the connection logs were error-free.

The exact [runner logs and hash/count audit](benchmarks/memory-main-20260908/log-audit.json) show no Prisma error lines in accepted 10K/50K logs and 14 Windows `ConnectionReset` code 10054 messages in 250K stdout: one before measured progress, seven interleaved with Cold passes, two with Hot passes, and four after the final success/artifact JSON. These messages lack timestamps/client IDs, so log position does not establish a failed query or a causal latency adjustment. All measured rows and their timings are retained unchanged.

The local PostgreSQL log additionally recorded three shared-memory child-reservation warnings (Windows code 487), at 05:48:34.706, 06:24:45.285, and 07:11:04.750 UTC. The first was before measured runs; the others fell within Cold pass 2 and Keyword pass 7. Ten server-side client-reset notices occurred after the final measured run during the cleanup interval. No one-to-one cause is established. No server FATAL/ERROR, shutdown, or recovery entry occurred within the measured interval. These workstation diagnostics limit claims of pristine or production-representative latency; they are not grounds for deleting unfavorable samples.

## Verification and scope

The port passed full TypeScript validation, both Prisma schema/client checks, all 58 fresh local migrations and manifest validation, the complete application build before the fixture-only `7e23ff6` change, and focused memory, projection, retrieval, vector, reporting, procurement, send-recovery, route, and restricted-role database regressions. TypeScript and the new seed/validator regression passed again after that fixture correction. The final benchmark additionally passed exact database row/grid audits and 41 fail-closed composition tests. Broad changed-file lint still has three pre-existing Gmail/IMAP errors confirmed on the base snapshot; this work does not claim a clean global lint run.

Covered fresh reply/CHASE/file-send paths recheck immutable action inputs with runtime enabled and semantic validation in enforce mode. Previously sent-message reconciliation still happens first. Bulk RFQ and supplier nudge paths are not newly semantically fenced, and an optimistic validation-to-provider race remains. The port preserves current supplier-task, mailbox, retry, notice-suppression, and approval behavior; it is not a universal or atomic action-safety guarantee.

## Figures and reproduction

Six inspected PNG/SVG pairs, with source and input hashes:

- [Evidence recall and tail latency](benchmarks/memory-main-20260908/figures/01_recall_latency.png)
- [Recall across corpus profiles](benchmarks/memory-main-20260908/figures/02_recall_scaling.png)
- [Recall by query category](benchmarks/memory-main-20260908/figures/03_query_types.png)
- [Correct evidence per retrieval second](benchmarks/memory-main-20260908/figures/04_evidence_bandwidth.png)
- [Stale-read validation fixtures](benchmarks/memory-main-20260908/figures/05_semantic_concurrency.png)
- [Quality tradeoffs](benchmarks/memory-main-20260908/figures/06_quality_tradeoffs.png)

The [artifact package](benchmarks/memory-main-20260908/README.md) includes raw results, exact original profile artifacts, launcher/status evidence, excluded IDs, portable analysis, unchanged canonical statistics, figure sources, logs, and a completion manifest with hashes. Data CSV hashes are bound into findings and verified again by the renderer and exporter. Gzip compression is deterministic and round-trip checked. Copy the package outside the repository, then run `python restore-artifacts.py` and `python analyze-composition.py --output analysis-recomputed`; see its README for requirements. No database, environment file, credential, provider account, or production access is needed for numerical reanalysis.

An actual portable check in a fresh external directory verified all 57 packaged artifacts, restored all nine compressed files, and reran the analysis successfully. All 15 system aggregates, 72 overall paired comparisons, 474 confidence-interval rows, all three data CSV hashes, and findings Markdown reproduced exactly; only generation time and absolute input-path metadata differed. The completion manifest SHA-256 is `c22c0f6ff71a829a3f61901105c628b4fffb348b36f06c8ae5b9ae747cfcd7e1`. Separately implemented raw-data calculations also reproduced all 15 metric groups, the 250K overall and seven query-type recall intervals, and all 15 bandwidth-ratio intervals.

All 58 package files, including the manifest, were also verified byte-for-byte in Git's staged objects. A narrowly scoped `.gitattributes` rule disables line-ending normalization for this package. Archived CSVs, scripts, and Windows logs intentionally retain their original CRLF/whitespace for checksum reproducibility; an unrestricted Git whitespace check flags those preserved bytes. The separately authored documentation passes its scoped whitespace, punctuation, secret-pattern, and link checks. The six manifest-listed runner logs are explicitly tracked despite the repository's general `*.log` ignore rule.
