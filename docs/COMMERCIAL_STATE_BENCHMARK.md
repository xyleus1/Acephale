# Commercial State Benchmark

The figures below are historical and predate the September 8 main-snapshot
port. The completed 150-run, 30,000-execution publication on frozen source
`7e23ff685bc88b3427e236d94e5463bae01a6304` is in
[the new results report](MEMORY_LATEST_MAIN_RESULTS.md), with
[reproducibility artifacts and figures](benchmarks/memory-main-20260908/README.md).
It combines complete retained 10K/50K profiles with a complete fresh 250K
profile, not one uninterrupted cohort or selected interrupted passes. See
[the port contract](MEMORY_LATEST_MAIN_PORT.md) for the pinned upstream main
snapshot `7080adad` verified September 8, opt-in flags, and partial action coverage.

## Purpose

The Commercial State Benchmark measures Derya's compiled current state, exact entity links, historical evidence retrieval, and semantic validation of seeded immutable reads relative to standard retrieval paths. It does not measure live provider-action safety or encode an expected winner or a target multiplier.

The benchmark runs real Derya readers, state compilation, projections, retrieval, and validation against one isolated PostgreSQL database. Production runtime code never reads the `benchmark` schema. Benchmark-only metadata is limited to `benchmark.cases`, `benchmark.runs`, and `benchmark.results`.

## Database isolation and roles

All six variables are mandatory:

```text
BENCHMARK_DATABASE_OWNER_URL
BENCHMARK_APP_DATABASE_URL
BENCHMARK_APP_DATABASE_URL_UNPOOLED
BENCHMARK_WORKFLOW_DATABASE_URL
BENCHMARK_BOURNE_DATABASE_URL
BENCHMARK_OUTPUT_DIR
```

There is no fallback to `DATABASE_URL`. Every database URL must identify the same normalized host, port, and database tuple; its database name must include `benchmark`, `bench`, `synthetic`, or `test`; and that database must differ from every configured normal runtime database. Workflow reads use `dashboard_api` with SSL required. Communication-ledger writes use `bourne_supply_chain`. The application path uses `derya_app`.

Benchmark preparation installs `pg_trgm`, one benchmark-only GIN index on
`KnowledgeChunk.text`, and one benchmark-only B-tree index on
`MemoryEvent(officeId, objectId)`. The GIN index preserves the lexical
retriever's existing `ILIKE '%term%'` predicate. The B-tree index supports the
retriever's exact-scope preflight for linked events. Preparation and every
completed profile seed explicitly `ANALYZE` the Company Brain retrieval tables
so query plans do not depend on autovacuum timing.

For inputs with an exact operational scope, the lexical retriever resolves the
same direct-object, mention, direct-event, and linked-object identities used by
its final predicates. Preflight and final reads share one bounded Repeatable
Read transaction, so a concurrent link write cannot fall between the two read
phases. The retriever intersects identities across scopes, then retains the
original filters, tokens, scoring, ordering, and limits with a redundant ID
restriction. Database orderings use stable ID tie-breakers. An empty exact scope
therefore skips the broad text reads without changing its result meaning.

This is a bounded benchmark optimization, not a sub-30-second latency
guarantee. The retriever accepts two-character tokens, which have no selective
trigram for a leading-and-trailing-wildcard search. Its object and event
predicates also contain cross-relation `OR` branches. PostgreSQL may therefore
retain sequential or broad tenant scans for those cases. Benchmark preparation
deliberately does not add GIN indexes to object, mention, or event columns until
their current query shapes can use those indexes consistently without changing
retrieval semantics. Inputs without exact operational scopes can still take the
legacy broad-scan path, and the added indexes do not guarantee sub-30-second
queries.

Reset is deliberately separate from seed and requires `ALLOW_BENCHMARK_RESET=1`. It deletes only rows owned by the benchmark's stable office prefix and the three benchmark metadata tables. It does not truncate arbitrary application tables.

## Corpus contract

Every profile contains the same fixed commercial problem set:

- 2 offices, 12 companies, 120 suppliers, and 48 procurement requests
- 8 densely documented golden suppliers and 4 densely documented golden companies
- 12 scripted scenario families
- 200 evaluation queries
- 40 immutable-read validation fixtures: 20 deliberately stale and 20 matching-state

The query distribution is 40 exact lookups, 40 semantic queries, 35 current-versus-stale questions, 30 temporal questions, 30 exact entity-hop questions, 15 routing and tenant-isolation questions, and 10 autopilot-action questions. Semantic queries paraphrase the evidence. Exact queries intentionally favor keyword retrieval. Gold facts, evidence pointers, and dependency versions are evaluation metadata and are never passed into retrieval.

Profiles differ only in unrelated, realistically shaped distractor history:

| Profile | Aggregate retrievable records |
| --- | ---: |
| `graph-small` | 10,000 |
| `graph-medium` | 50,000 |
| `graph-large` | 250,000 |

The aggregate includes Company Context, procurement communication, routed email, Company Brain objects and chunks, memory events, supplier facts, price observations, supply evidence, and execution events. Correct answers do not change with profile size.

## Compared systems

- `CURRENT_KEYWORD`: the pre-V2 lexical `hybridSearchMemory` path.
- `VECTOR_RAG`: source-linked vector top-K only, when an actual vector adapter is enabled.
- `STRONG_HYBRID_RAG`: lexical and vector results fused with Reciprocal Rank Fusion, without projections or semantic validation.
- `DERYA_COLD`: live state compilation plus exact entity and temporal evidence retrieval, with projections bypassed.
- `DERYA_HOT`: valid state projections, query-specific evidence retrieval, and semantic dependency validation.

Vector-dependent systems are reported as unavailable when no vector backend and embedding model are configured. They are never replaced with fabricated scores. All active systems use the same profile, cases, top-K values, process concurrency, warmup policy, and environment label.

## Metrics

The runner records Recall@5, Recall@10, Recall@20, MRR, current-state accuracy, temporal-order accuracy, entity-resolution accuracy, p50 and p95 latency, projection hit rate, cold and hot hydration latency, tenant leakage, unrouted-mail leakage, strict stale-state detection, stale-action escape, false conflicts, and validation p50 and p95.

The `strict_stale_detected`, `stale_escape`, and `false_conflict` outcome names
are legacy fixture fields, not observed external actions. Stale fixtures
substitute dependency hashes before immutable-read
insertion; matching fixtures retain current hashes. Only Derya Hot invokes the
real validator, while the other systems are modeled no-validator controls.
Each fixture has one dependency. No provider send or post-read state mutation
is executed, and unrelated-change tolerance is not measured. Validation latency
is separate from retrieval/hydration latency. No RSS, heap, or RAM-use benchmark
is present. See the new results report for the ten-pass publication denominator.

Evidence bandwidth is:

```text
sum of correct gold evidence references returned / sum of measured retrieval-hydration seconds
```

Fact bandwidth is:

```text
correct gold current-state facts returned / context-hydration wall-clock seconds
```

These ratios are not wall-clock concurrent throughput. The externally usable multiplier is Derya hot bandwidth divided by strong-hybrid bandwidth. It is absent when either measured denominator or required baseline is unavailable. It is never rounded into a marketing claim.

## Commands

```bash
npm run benchmark:db:prepare
npm run benchmark:seed -- --profile=graph-small --seed=42
npm run benchmark:seed -- --profile=graph-medium --seed=42
npm run benchmark:seed -- --profile=graph-large --seed=42
npm run benchmark:doctor
npm run benchmark:run -- --profile=graph-small
npm run benchmark:run -- --profile=graph-medium
npm run benchmark:run -- --profile=graph-large
npm run benchmark:report
ALLOW_BENCHMARK_RESET=1 npm run benchmark:reset
```

`benchmark:doctor` checks roles, tenant links, routing, stable IDs, provenance, query and scenario counts, profile sizes, gold coverage, concurrency coverage, and the read-only dashboard boundary. It also rejects application schema dependencies on benchmark metadata.

## Outputs

`benchmark:report` writes the following beneath `BENCHMARK_OUTPUT_DIR`:

- `summary.json`, containing measured configuration and aggregate results
- `results.csv`, containing per-case measured results
- `report.html`, a standalone static report whose graphs are derived from those results

The HTML report includes Recall@20 by system and query type, recall-latency Pareto position, evidence bandwidth, p95 latency by corpus size, cold-versus-hot hydration latency, and the legacy stale-escape versus false-conflict fixture fields. Those field names do not establish live action outcomes. Every graph repeats the measured corpus size, query count, top-K, embedding model, run count, environment label, and timestamp.

## Consistency boundary

State validation is optimistic semantic concurrency, not a distributed transaction across the application database, workflow database, and Gmail. A final provider call still has a small validation-to-send race. Existing provider idempotency, sender reservation, event recording, and reconciliation remain required.

## Historical measured results

All three final compiler-v1.1 profiles were measured on 2026-08-28 UTC with seed
42, one run per system and profile, 200 queries, top-K 20, four-case process
concurrency, and ten warmup cases. The environment was Windows 10.0.26200 on a
12th Gen Intel Core i5-1235U with 8 GiB RAM and 12 logical CPUs. The database
was PostgreSQL 17 over local TLS. `VECTOR_RAG` and `STRONG_HYBRID_RAG` were
explicitly skipped because no vector adapter or common embedding model was
configured.

| Profile | System | Recall@5 | Recall@20 | MRR | p50 ms | p95 ms | Evidence/s | Facts/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10K | `CURRENT_KEYWORD` | 0.7133 | 0.7133 | 0.9142 | 138.3 | 5,290.5 | 1.715 | 3.299 |
| 10K | `DERYA_COLD` | 0.7083 | 0.8433 | 0.5867 | 550.5 | 746.5 | 2.433 | 3.944 |
| 10K | `DERYA_HOT` | 0.7083 | 0.8717 | 0.5864 | 548.9 | 753.3 | 2.614 | 4.065 |
| 50K | `CURRENT_KEYWORD` | 0.7133 | 0.7133 | 0.9210 | 1,553.2 | 4,435.8 | 0.551 | 1.060 |
| 50K | `DERYA_COLD` | 0.7083 | 0.8433 | 0.5649 | 1,756.6 | 2,311.0 | 0.759 | 1.314 |
| 50K | `DERYA_HOT` | 0.7083 | 0.8717 | 0.5646 | 1,771.0 | 2,259.5 | 0.802 | 1.279 |
| 250K | `CURRENT_KEYWORD` | 0.7133 | 0.7133 | 0.9067 | 1,782.1 | 5,112.8 | 0.433 | 0.832 |
| 250K | `DERYA_COLD` | 0.7083 | 0.8433 | 0.5867 | 4,110.4 | 5,279.9 | 0.320 | 0.526 |
| 250K | `DERYA_HOT` | 0.7083 | 0.8717 | 0.5864 | 5,117.2 | 6,478.0 | 0.275 | 0.441 |

`DERYA_HOT` produced a 0.925 projection hit rate at every profile. Across the
40 immutable-read fixtures, it rejected the deliberately stale reads and
accepted the matching-state reads (raw `strict_stale_detected` rate 1.0,
`stale_escape` rate 0, and `false_conflict` rate 0). Systems without semantic
validation had modeled detection rate 0 and modeled `stale_escape` rate 1.0.
These values are not measured escaped provider actions or post-read unrelated
changes. Tenant and unrouted-mail leakage counts were zero for every active
system and profile.

The results are mixed and should be read as measurements, not a winner claim.
`DERYA_HOT` improved Recall@20 over keyword search from 0.7133 to 0.8717 and
improved temporal-order and entity-resolution accuracy, but keyword had a
slightly higher Recall@5, much higher MRR, and higher measured current-state
accuracy in this corpus. Derya's bandwidth advantage was present at 10K and
50K, but reversed at 250K. Hot p50 was slower than keyword at all three sizes;
hot p95 was lower than keyword at 10K and 50K and higher at 250K. The measured
current-state accuracy was 0.8925 for keyword and 0.8095 for both Derya variants; temporal-order
accuracy was 0.1333 for keyword versus 0.3556 for hot; entity-resolution
accuracy was 0.7444 versus 0.7800.

No externally usable bandwidth multiplier is reported. Its required
`STRONG_HYBRID_RAG` denominator was unavailable because vector retrieval was
disabled, and the report records `vector_retrieval_disabled` rather than
substituting a fabricated value. `summary.json`, `results.csv`, and
`report.html` under `BENCHMARK_OUTPUT_DIR` are the authoritative measured
artifacts.
