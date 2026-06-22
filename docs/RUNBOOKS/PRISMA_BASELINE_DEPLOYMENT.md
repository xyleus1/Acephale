# Prisma Baseline Deployment Runbook

This runbook exists because the Phase 1-H2 company-brain migrations are
additive and assume the original freight CRM schema already exists. The release
now includes a pre-brain baseline migration so fresh databases and existing
databases can both use Prisma migration history safely.

## Migration Order

Expected order:

1. `00000000000000_baseline_pre_brain`
2. `20260621000100_company_brain_memory`
3. `20260622000100_market_intelligence`
4. `20260622000200_market_impact_review`
5. `20260622000300_firecrawl_market_ingestion`

The baseline was generated from `HEAD:prisma/schema.prisma`, which represents
the pre-company-brain schema in this branch. It intentionally does not create
`Knowledge*`, `MemoryEvent`, `AgentMemory`, `MarketSignal`,
`MarketSignalLink`, `MarketImpactReview`, `MarketSignalFeedback`, or
`MarketIngestionRun`; those are handled by later additive migrations.

## Never Do This In Production

- Do not run `prisma db push`.
- Do not run `prisma migrate dev`.
- Do not run `prisma migrate reset`.
- Do not run commands until the shell is pointed at the intended database.
- Do not run migration commands from a shell that prints secrets.

## Path A: Fresh Staging Database

Use this when the staging database is empty and disposable or newly provisioned.

1. Configure staging env vars:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
```

2. Check the target before applying:

```bash
npx prisma validate
npx prisma migrate status
```

3. Apply the full migration chain:

```bash
npx prisma migrate deploy
```

4. Verify final schema matches the current Prisma schema:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

`No difference detected.` means the database schema matches the current Prisma
datamodel.

5. Deploy preview/staging app code and run app smoke checks:

```bash
npm run build
npm run memory:doctor
npm run market:doctor
npm run audit:tenant-scope
```

Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
`MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false` until separate live-ingestion
approval.

## Path B: Existing Production Database With Pre-Brain Schema And No Migration History

Use this when production already has the pre-brain freight CRM tables but does
not have Prisma migration records.

1. Take and verify a production database backup.

2. Confirm production currently matches the baseline/pre-brain schema. Use a
safe read-only comparison from a controlled shell:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel /tmp/derya-pre-brain-schema.prisma \
  --exit-code
```

Create `/tmp/derya-pre-brain-schema.prisma` from the known pre-brain commit
used to generate the baseline:

```bash
git show 9727e55:prisma/schema.prisma > /tmp/derya-pre-brain-schema.prisma
```

If the diff reports real schema differences, stop. Do not stamp the baseline
until the mismatch is understood.

3. Mark only the baseline as already applied:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline_pre_brain
```

This records that the existing database already contains the schema represented
by the baseline migration. It does not run the baseline SQL.

4. Apply the additive company-brain migrations:

```bash
npx prisma migrate deploy
```

5. Verify final schema:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

6. Run production smoke checks. Keep external intelligence advisory and keep
market cron/live ingestion disabled until operators approve source expansion.

## Rollback Caveat

Vercel code rollback does not roll back database schema. These migrations are
intended to be forward-compatible and additive. If application rollback is
needed, roll back the deployment, preserve the database snapshot, and do not
attempt manual schema rollback unless a separate database restore plan has been
approved.

## Local Disposable Verification Performed

D0 was verified against a disposable local Postgres database:

1. Created a throwaway local database.
2. Ran `npx prisma migrate deploy`.
3. Confirmed all five migrations applied in order.
4. Ran `npx prisma migrate diff --from-url <throwaway-url>
   --to-schema-datamodel prisma/schema.prisma --exit-code`.
5. Received `No difference detected.`
6. Dropped the throwaway database.

No production database commands were run.
