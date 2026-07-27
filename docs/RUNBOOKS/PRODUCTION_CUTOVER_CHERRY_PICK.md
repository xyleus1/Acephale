# Production Cutover With Fresh Office And Cherry-Pick Import

This runbook moves production to a fresh current-schema Neon database. It does
not migrate the old production database in place. The old database is treated
as a source for a controlled JSON export, then selected business data is
imported into a new real Office.

The point is to avoid dragging old auth/session/OAuth/portal-token/memory/market
residue into the new company-brain release. Do not improvise here.

## Non-Negotiables

- Do not run `prisma db push` against production.
- Do not run `prisma migrate dev` against production.
- Do not run `prisma migrate reset` against production.
- Do not print connection strings, tokens, passwords, or OAuth secrets.
- Do not copy Gmail OAuth access or refresh tokens.
- Do not copy sessions.
- Do not copy old portal tokens.
- Do not copy old `Knowledge*`, `MemoryEvent`, `AgentMemory`, market signal,
  market impact, market feedback, or market ingestion rows.
- Do not copy background jobs.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false`.
- Do not run live Firecrawl ingestion during cutover.

## A. Create Fresh Neon Production Database

Create a fresh Neon branch/database:

- Branch: `production-company-brain`
- Database: `derya_production`

Keep the pooled URL for the app runtime and the direct/unpooled URL for Prisma
migrations.

## B. Set Local Production Env Only After Confirmation

Before setting local env vars, confirm:

- the old production database has a backup;
- the new Neon database is empty or disposable;
- the new Neon database is not the old production database;
- the shell will not echo secrets into logs.

Then set the new production direct URL only in the controlled shell:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
```

## C. Apply Current Schema To Fresh Production DB

Run only against the confirmed fresh Neon production database:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected final diff:

```text
No difference detected.
```

Stop on drift. Do not fix drift with `db push`.

## D. Create Production Office And Admin

Set these env vars without printing values:

```bash
export PRODUCTION_OFFICE_NAME="..."
export PRODUCTION_ADMIN_EMAIL="..."
export PRODUCTION_ADMIN_PASSWORD="..."
export ALLOW_PRODUCTION_OFFICE_SEED=1
npm run seed:production-office
```

The script is idempotent by Office name and admin email. It creates one Office
and one active ADMIN user. It never prints the password or password hash.

## E. Export From Old DB

Run from a shell pointed at the old database through `OLD_DATABASE_URL`, not
through `DATABASE_URL`.

```bash
export OLD_DATABASE_URL="postgresql://..."
export OLD_OFFICE_ID="..."
# or: export OLD_OFFICE_NAME="..."
export EXPORT_PATH="./exports/production-cutover-office.json"
export INCLUDE_EMAILS=false
export INCLUDE_DOCUMENT_METADATA=true
export INCLUDE_CLOSED_JOBS=false
npm run export:office-cherry-pick
```

Exported by default:

- companies
- contacts
- company owner references by safe user email only
- activities
- quotes
- shipment records
- inquiries
- active jobs unless `INCLUDE_CLOSED_JOBS=true`
- milestones
- company and job document metadata only
- carrier quotes
- forwarders
- lane rates
- margin profiles
- target price history

Never exported:

- `EmailAccount.accessToken`
- `EmailAccount.refreshToken`
- session cookies
- password hashes
- old `Job.portalToken`
- background jobs
- `Knowledge*`, `MemoryEvent`, `AgentMemory`
- market signals, links, reviews, feedback, ingestion runs
- agent proposals
- forwarder draft send artifacts

Emails are excluded by default. If `INCLUDE_EMAILS=true`, exported email data is
sanitized and does not include email accounts, OAuth tokens, Gmail message IDs,
or provider external IDs for remapping.

## F. Import Dry Run

Point `DATABASE_URL` at the new production database, then run a dry run:

```bash
export TARGET_OFFICE_ID="..."
# or: export TARGET_OFFICE_NAME="..."
export IMPORT_PATH="./exports/production-cutover-office.json"
export DRY_RUN=true
npm run import:office-cherry-pick
```

Dry run writes nothing. If the counts look wrong, stop.

## G. Import Write Mode

Only after the dry run is reviewed:

```bash
export ALLOW_CHERRY_PICK_IMPORT=1
export DRY_RUN=false
npm run import:office-cherry-pick
```

The import is idempotent where the data model gives us stable keys:

- Company: Office + name
- Forwarder: Office + email
- Job: Office + reference
- other records: conservative natural-key matching

Old portal tokens are not imported. If an old job had a portal token, a new
64-hex random token is generated.

Document imports are metadata-only. `JobDocument.url` is null and
`CompanyDocument.url` uses a `metadata-only://...` sentinel because that column
is required by the schema.

## H. Validate Import

```bash
npm run validate:office-import
```

The validator checks:

- target Office exists;
- active ADMIN user exists;
- company/contact/active inquiry/active job counts;
- no token-bearing `EmailAccount` rows;
- no market intelligence residue;
- portal tokens use the new 64-hex shape;
- no obvious cross-office job/inquiry/activity relationships;
- imported document rows are metadata-only.

## I. Set Vercel Production Env Vars

Set production env vars in Vercel without exposing values:

- `DATABASE_URL` = Neon production pooled URL
- `DATABASE_URL_UNPOOLED` or `DIRECT_URL` = Neon production direct URL
- `TOKEN_ENCRYPTION_KEY`
- `CRON_SECRET`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `FIRECRAWL_API_KEY`
- `MARKET_INTELLIGENCE_PROVIDER=firecrawl`
- `MARKET_INTELLIGENCE_CRON_ENABLED=false`
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN=1`
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET=25`

Use production-safe document storage. Local disk is not acceptable for real
production document uploads unless explicitly accepted as a temporary limitation.

## J. Merge PR To Main

Only merge after:

- migrations succeeded against the fresh production database;
- import validation passed;
- Vercel production env vars are configured;
- market cron remains disabled;
- Gmail OAuth redirect URI is correct for production.

## K. Production Smoke Test

After production deploy:

- login works;
- dashboard loads;
- intelligence page loads;
- CRM/customer pages load;
- RFQ pages load;
- job pages load;
- quote PDF route works;
- valid portal token works;
- `job.id` as portal token fails;
- Gmail reconnect flow starts with the production redirect URI;
- cron routes reject unauthenticated calls;
- market cron remains disabled.

Do not run a live Firecrawl pilot during cutover. That belongs to a separate,
reviewed staging/production task after production is stable.
