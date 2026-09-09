# Measured cohort findings

All numbers below come from three complete measured profiles, explicitly composed across separate launches.

| Corpus | System | Evidence Recall@20 | p50 ms | p95 ms | Gold evidence/s |
| --- | --- | ---: | ---: | ---: | ---: |
| 10,000 | Current Keyword | 71.33% | 216.65 | 727.58 | 3.3950 |
| 10,000 | Vector RAG | 69.08% | 52.85 | 89.68 | 18.1996 |
| 10,000 | Strong Hybrid RAG | 72.08% | 307.09 | 1083.97 | 2.3370 |
| 10,000 | Derya Cold | 84.33% | 467.20 | 677.71 | 2.8917 |
| 10,000 | Derya Hot | 84.33% | 380.14 | 522.41 | 3.4960 |
| 50,000 | Current Keyword | 71.33% | 444.04 | 1215.81 | 1.8259 |
| 50,000 | Vector RAG | 69.08% | 60.14 | 113.17 | 15.0321 |
| 50,000 | Strong Hybrid RAG | 72.08% | 722.43 | 2223.57 | 1.0784 |
| 50,000 | Derya Cold | 84.33% | 784.25 | 974.48 | 1.6954 |
| 50,000 | Derya Hot | 84.33% | 710.90 | 926.74 | 1.8340 |
| 250,000 | Current Keyword | 71.33% | 1708.23 | 2768.84 | 0.5894 |
| 250,000 | Vector RAG | 69.08% | 121.88 | 367.28 | 5.7465 |
| 250,000 | Strong Hybrid RAG | 72.08% | 2584.28 | 4808.77 | 0.3802 |
| 250,000 | Derya Cold | 84.33% | 2518.19 | 3037.49 | 0.5269 |
| 250,000 | Derya Hot | 84.33% | 2404.88 | 2850.96 | 0.5515 |

Paired Derya Hot minus Strong Hybrid recall differences, using 10,000 benchmark-case-cluster bootstrap resamples:

- 10,000 records: +12.25 percentage points; paired 95% CI +9.25 to +15.33 points.
- 50,000 records: +12.25 percentage points; paired 95% CI +9.33 to +15.33 points.
- 250,000 records: +12.25 percentage points; paired 95% CI +9.25 to +15.33 points.

Derya Hot checks of seeded immutable-read fixtures:

- graph-large: 200/200 deliberately stale validation fixtures rejected; matching-state checks 200/200 accepted and 0/200 rejected; validation p50/p95 44.21/141.44 ms.
- graph-medium: 200/200 deliberately stale validation fixtures rejected; matching-state checks 200/200 accepted and 0/200 rejected; validation p50/p95 107.03/279.17 ms.
- graph-small: 200/200 deliberately stale validation fixtures rejected; matching-state checks 200/200 accepted and 0/200 rejected; validation p50/p95 86.73/225.72 ms.

Interpretation limits:

- Main executor latency excludes separately measured semantic validation of seeded immutable-read fixtures.
- Each timed validation fixture has one dependency; do not generalize these timings to large production dependency manifests.
- This complete 150-run result set composes separately completed profiles; it is not one uninterrupted cohort and contains no partial-pass splicing.
- RAG baselines receive office/company scope, while Derya also receives exact operational scope; this is an architecture comparison, not identical-input retrieval ranking.
- The deliberately stale and matching-state fixture classes each contain 20 unique cases, repeated over ten passes.
- Deliberately stale fixtures substitute synthetic dependency version and value hashes before immutable-read insertion; no operational state mutation occurs after the read.
- Matching-state fixtures retain live dependency hashes. Other unrelated facts are seeded before all reads, so these checks do not measure tolerance of post-read unrelated changes.
- Only Derya Hot invokes the validator; other systems' validation outcomes are modeled no-validator controls.
- No action sends are performed. The raw stale_escape and false_conflict field names are retained for compatibility, not evidence of observed escaped actions or unrelated-change tolerance.
- Retrieval-only baseline zeros for typed facts/state reflect output capability, not absence of information in prose.
- No RSS, heap, retained-memory, or RAM-use measurement is present in these trials.
- Profiles run sequentially; cross-profile latency is not a causal scaling law.
- Both the preliminary setup-mismatch cohort and the interrupted standby-affected cohort are excluded, preserved separately, and not spliced into this cohort.
