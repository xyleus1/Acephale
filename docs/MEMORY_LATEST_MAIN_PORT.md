# Memory and temporal runtime on the September 8 main snapshot

## Scope and isolation

This work ports the memory branch `f4a2fb964848f78cdf9e6b27601cb281c50aa79e`
onto upstream main snapshot `7080adad57ed08bf529a1fa7234e9f2220568dc5`, the head
verified on 2026-09-08 at task start, not a claim about main at publication time.
The measured implementation is frozen at
`7e23ff685bc88b3427e236d94e5463bae01a6304`. The destination is only the
`xyleus1/derya-crm` fork, branch `codex/memory-temporal-main-20260908`.
Neither repository's main branch, deployment configuration, production
database, real mailbox, nor the original Desktop checkout is modified.

## Implementation

- Ported office-scoped state readers, immutable decision reads, dependency
  manifests, projection freshness/invalidation, temporal evidence retrieval,
  entity retrieval, reciprocal-rank fusion, and thread diversification.
- Kept the pinned main snapshot's supplier conversation tasks, CHASE, quote
  capture, automatic-notice handling, wrong-contact recovery, sender pauses,
  deadlines, retry behavior, and reconciliation.
- Compiler `supply-world-state-v1.2` shares human-message selection between
  procurement readers, supplier readers, and dependency validation. Outbound
  CHASE decisions retain their exact prior inbound anchor and recipient.
- With runtime enabled and validation mode `enforce`, covered reply, CHASE,
  and file sends require bound immutable-read proof and recheck it before a
  new provider send. Missing proof or strict conflicts block those sends;
  `shadow` observes without blocking. Recovery reconciles existing sends before
  new-send selection, including empty allow-lists and suppliers absent from the
  latest request.
  Existing bulk RFQ and supplier-nudge paths do not acquire semantic-read
  validation in this port. This is not universal action fencing.
- Schema changes are additive: the two memory-branch migrations are retained
  unchanged alongside the pinned main migrations, and the manifest includes all
  58 application migrations. Restricted role/view boundaries are preserved.
- Packet compaction allocates smaller candidates lazily, and the local vector
  baseline compiles its scope predicate once per query. Ranking, embeddings,
  scoring, and filter semantics are unchanged. Report loading is bounded to
  five runs per database transfer to avoid Node's maximum string size.
- With retrieval V2 disabled, lexical order, scores, and requested candidate
  count remain unchanged; fusion and thread diversification are disabled.

Rollout remains opt-in. `SUPPLY_STATE_RUNTIME_ENABLED`,
`SUPPLY_STATE_PROJECTIONS_ENABLED`, and `MEMORY_RETRIEVAL_V2_ENABLED` default
off; `SUPPLY_STATE_VALIDATION_MODE` defaults to `off`. Publishing this branch
does not activate these flags or apply migrations to a deployed service.
Best-effort invalidation hooks still perform database queries with the runtime
disabled, so behavioral compatibility does not mean zero additional overhead.

Validation is optimistic concurrency. A small validation-to-provider-send
race remains; provider idempotency and reconciliation are still required.

## Verification before benchmark freeze

Passed: Prisma schema validation, both generated clients, all 58 migrations
on fresh local databases, migration manifest and production migration
contracts, deployment boundary, full TypeScript check, memory write/search
database tests, read-only workflow boundary, both migration verification SQL
scripts, state runtime/projection/validation/retrieval/autopilot suites,
benchmark safety/vector/report-loading suites, and focused procurement
planning/conversation/reply/file suites. Send database tests use fake
providers with restricted application credentials, never live mailboxes.

The existing `state-recheck.test.ts` integration suite also passed at its
default six repetitions across 41 scenarios: 162/162 stale or invalid attempts
blocked and 0/84 false conflicts on unrelated/control scenarios. It ran with
semantic runtime, projections, and semantic validation explicitly disabled,
using restricted local database credentials and local document storage. This
verifies existing deterministic action guards and immutable database enforcement,
not the new semantic validator's performance. Cases include post-prepare database
changes, expiry, expected-hash mismatches, and prohibited immutable-input writes.
Its counts and timings must not be merged with the semantic fixture benchmark.

The broad changed-file lint scan reports three pre-existing errors, confirmed
verbatim in base `7080adad`: `gmail-sync.ts` uses explicit `any` in
`extractAttachments` and `reclassifyMessages`; `imap-sync.ts` uses `let` for
the never-reassigned `messages` array. Existing unused-variable warnings also
remain. These are not hidden by the focused feature-lint pass and are outside
the scoped implementation. No unrelated lint cleanup was applied.

The complete `npm run build` passed, including both Prisma clients, Next.js
compilation, build-time type validation, all 102 static pages, and tracing.
It reported existing CSS autoprefixer warnings and the machine's parent
lockfile/workspace-root warning. No deployment was performed.
Completed measurements and the rewritten publication text are in
[the results report](MEMORY_LATEST_MAIN_RESULTS.md); exact artifacts, analysis
code, and six visually checked PNG/SVG figure pairs are in
[the reproducibility package](benchmarks/memory-main-20260908/README.md).
Historical figures in `COMMERCIAL_STATE_BENCHMARK.md` are not results for this port.

## Completed benchmark publication

The audited result set contains 150 measured system/pass runs and 30,000
executions on frozen source `7e23ff6`: complete retained 10K and 50K profiles,
plus an entirely new 250K profile. These are separate launches and isolated
databases, not one uninterrupted cohort. No interrupted 250K passes are included.

At 250K, Derya Hot achieved 84.33% Evidence Recall@20 versus 72.08% for Strong
Hybrid RAG, a +12.25 percentage-point difference with paired 95% CI +9.25 to
+15.33 points. Retrieval/hydration p95 was 2,850.96ms versus 4,808.77ms
(40.71% lower); p50 was 2,404.88ms versus 2,584.28ms. Vector RAG remained the
fastest raw retrieval baseline. This is operational memory infrastructure, not
evidence of reduced process RAM use.

Derya Hot rejected 200/200 deliberately stale validation checks and accepted
200/200 matching-state checks at 250K; separate validation latency was 44.21ms
p50 and 141.44ms p95. Each class contains 20 unique single-dependency fixtures
repeated ten times. No provider action or post-read state mutation was executed,
so these counts do not establish live stale-action prevention or tolerance of
post-read unrelated changes.

The standalone 250K run completed in approximately 116 minutes with exit code
0, released its task-scoped power guard, and recorded no sleep or AC guard
failure. Its stdout nevertheless contains 14 Prisma `ConnectionReset` messages;
all cases completed, and the messages remain in the preserved logs and
[log audit](benchmarks/memory-main-20260908/log-audit.json). Completion is not
a claim that the logs were error-free.

## Reproduction contract

Use a fresh, explicitly named local benchmark database, not application
runtime URLs. Prepare all three profiles before timing so index-plan checks
see the same mixed-profile database as the prior publication cohort.
Validate vector manifests against the seeded corpus; reuse only verified
identical embeddings.

After role provisioning, verify the actual restricted application connection's
`statement_timeout`, not only the owner's database default. The role provisioning
SQL sets `derya_app` to 30 seconds, which overrides a 10-minute database default.
For reproduction of the earlier publication, apply a role-in-database 10-minute
override to the explicitly isolated benchmark database only. Never change a
production role or database setting for this purpose.

Run each profile sequentially with:

```text
npm run benchmark:run -- --profile=graph-small --vector-enabled=true --warmup-passes=3 --runs=10 --seed=42 --concurrency=4 --top-k=20
npm run benchmark:run -- --profile=graph-medium --vector-enabled=true --warmup-passes=3 --runs=10 --seed=42 --concurrency=4 --top-k=20
npm run benchmark:run -- --profile=graph-large --vector-enabled=true --warmup-passes=3 --runs=10 --seed=42 --concurrency=4 --top-k=20
npm run benchmark:report
```

Freeze the source commit and working-tree fingerprint for all timed runs.
Record all five systems, including regressions and unavailable results.
The paired recall interval resamples the 200 unique query cases, preserving
all 10 repeated passes within each case, with 10,000 bootstrap draws.
Each profile has 20 deliberately stale single-dependency read fixtures and
20 matching-state fixtures, each repeated ten times per system. Only Derya Hot
executes the real validator; other systems' no-validator outcomes are modeled.
There are no post-read state mutations or provider sends in these fixtures.

This is the existing synthetic architecture benchmark. Baseline RAG receives
office/company scope; Derya additionally uses the exact operational scope.
It is not an identical-input comparison of retrieval algorithms. Retrieval
latency excludes separately measured validation. Baseline no-validator
action outcomes are counterfactuals, not real provider sends. No process
RSS/heap benchmark is present, so do not claim a measured RAM reduction.

## Preliminary cohort and fixture correction

The first 10K cohort on `bc045050` completed all 10,000 retrieval executions
and all 50 system passes without query failures. It is retained in the separate
local `derya-memory-benchmark-20260908` artifact directory, not used as the final
publication cohort. Two setup defects were discovered during verification:

- The actual application timeout was 30 seconds, not the intended 10 minutes.
- Eight matching-state fixtures were rejected in all ten repetitions, yielding
  80 false rejections out of 200 matching checks. Their message IDs were unchanged.
  The seed builder manually hashed the obsolete latest-message shape without
  `latestInboundMessage: null`; the production registry used the new shared
  selector. Exact hash reconstruction confirmed this discrepancy. Merely seeding
  again would not fix it. The fixture builder must use the shared selector,
  retaining both genuine matching controls and deliberately stale fixtures.

The Windows orchestration script also failed to retain the child process handle,
so it read a null exit code after the successful 10K run and stopped before 50K.
This launcher failure is distinct from the measured fixture false conflicts.
The final launcher retains the handle, refreshes the process, and rejects missing
exit status. All preliminary artifacts and the launcher error remain preserved.

The final publication composes complete 10K and 50K profiles from the guarded
resume launch with the entire fresh 250K profile from its separate retry
database. All three profiles were seeded in each isolated database before
timing, using corrected fixtures and the same frozen source `7e23ff6`.
The preliminary setup-mismatch cohort, standby-interrupted cohort, and all
interrupted 250K passes remain excluded and preserved separately. Query cases,
gold evidence, retrieval scoring, synthetic stale-hash substitutions, and
confidence-interval methodology were not changed to obtain a desired result.

`test:benchmark-seed-state-read` covers matching registry/seed hashes and
evidence for inbound messages, outbound replies, automatic notices, notice-only
threads, and changed prior inbound anchors. Matching fixtures validate, while
the unchanged synthetic stale-hash construction still fails. A child-process
check confirms that the seed CLI imports without React server conditions or
loading the product's database singleton.

The safety fixtures are not real concurrent action executions. Stale reads are
constructed by substituting comparison hashes before insertion; matching reads
retain current hashes. Unrelated facts are seeded before read creation, not
mutated afterward. Only Derya Hot calls the real validator, and no provider send
is attempted. Describe results as stale validation fixtures rejected and matching
checks accepted, not as observed prevention of external stale actions or proof
of tolerance to post-read unrelated mutations.
