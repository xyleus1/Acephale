# Memory and temporal runtime on latest main

## Scope and isolation

This work ports the memory branch `f4a2fb964848f78cdf9e6b27601cb281c50aa79e`
onto upstream main `7080adad57ed08bf529a1fa7234e9f2220568dc5`, the head
verified on 2026-09-08 at task start. The destination is only the
`xyleus1/derya-crm` fork, branch `codex/memory-temporal-main-20260908`.
Neither repository's main branch, deployment configuration, production
database, real mailbox, nor the original Desktop checkout is modified.

## Implementation

- Ported office-scoped state readers, immutable decision reads, dependency
  manifests, projection freshness/invalidation, temporal evidence retrieval,
  entity retrieval, reciprocal-rank fusion, and thread diversification.
- Kept latest-main supplier conversation tasks, CHASE, quote capture,
  automatic-notice handling, wrong-contact recovery, sender pauses,
  deadlines, retry behavior, and reconciliation.
- Compiler `supply-world-state-v1.2` shares human-message selection between
  procurement readers, supplier readers, and dependency validation. Outbound
  CHASE decisions retain their exact prior inbound anchor and recipient.
- Reply, CHASE, and file sends recheck the immutable input before the provider
  send. Recovery reconciles existing sends before new-send selection,
  including empty allow-lists and suppliers absent from the latest request.
  Existing bulk RFQ and supplier-nudge paths do not acquire semantic-read
  validation in this port. This is not universal action fencing.
- Schema changes are additive: the two memory-branch migrations are retained
  unchanged alongside latest-main migrations, and the manifest includes all
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
Measured benchmark results will be recorded separately when complete.
Historical figures in `COMMERCIAL_STATE_BENCHMARK.md` are not results for
this port.

## Reproduction contract

Use a fresh, explicitly named local benchmark database, not application
runtime URLs. Prepare all three profiles before timing so index-plan checks
see the same mixed-profile database as the prior publication cohort.
Validate vector manifests against the seeded corpus; reuse only verified
identical embeddings. Run each profile sequentially with:

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
Stale-action trials have 20 distinct relevant-change scenarios and 20
distinct unrelated-change controls, each repeated 10 times per system.

This is the existing synthetic architecture benchmark. Baseline RAG receives
office/company scope; Derya additionally uses the exact operational scope.
It is not an identical-input comparison of retrieval algorithms. Retrieval
latency excludes separately measured validation. Baseline no-validator
action outcomes are counterfactuals, not real provider sends. No process
RSS/heap benchmark is present, so do not claim a measured RAM reduction.
