# Procurement and Bourne integration

## Runtime boundary

The Derya application database remains on `DATABASE_URL`. It owns login,
Office records, and the authenticated tenant mapping. The Bourne workflow
database uses `WORKFLOW_DATABASE_URL` because replacing the application
`DATABASE_URL` would disconnect auth from its own database.

`WORKFLOW_DATABASE_URL` must use the restricted `dashboard_api` role and an SSL
mode of `require`, `verify-ca`, or `verify-full`. The optional
`BOURNE_WORKFLOW_WEBHOOK_URL` and `BOURNE_WORKFLOW_WEBHOOK_SECRET` are also
server-only. None of these values may use a `NEXT_PUBLIC_` name. Derya sends
the webhook secret as an `Authorization: Bearer` credential.

`PROCUREMENT_CUSTOMER_MAP_JSON` stores the server-only mapping from authenticated
Derya Office IDs to Neon customer UUIDs. API routes resolve the Office from the
active user session. No procurement route accepts a customer ID from browser
input.

## Provisioning

1. Run `scripts/sql/procurement-dashboard-api.sql` against the Bourne Neon
   database as an owner. Supply the new role password through the documented
   psql variable. Do not put the password in a file. The script is safe to
   rerun after a partial failure. It uses only role changes permitted to Neon's
   managed owner and stops unless every elevated role attribute and membership
   is absent.
2. Set the Office mapping in the deployment environment. Use the Office ID from
   the authenticated Derya database and the customer UUID from Neon:

```json
{
  "<Derya Office.id>": "<Neon customers.id UUID>"
}
```

3. Store that JSON as `PROCUREMENT_CUSTOMER_MAP_JSON`. It is server-only auth
   metadata, not browser configuration.
4. Set `WORKFLOW_DATABASE_URL` to the `dashboard_api` connection URL with
   `sslmode=require`.
5. Optionally add a Bourne webhook trigger and set
   `BOURNE_WORKFLOW_WEBHOOK_URL` to its HTTPS URL. Store the separate trigger
   secret as `BOURNE_WORKFLOW_WEBHOOK_SECRET`.
6. Activate Bourne automation `6a80c50915936370994a7dfc`. Keep the
   `*/15 * * * *` schedule as recovery when the webhook is absent or fails.

While the automation is draft, new orders correctly remain in `new` status.

## GUILD2 sourcing

GUILD2 row Source controls use the same authenticated POST endpoint. They do
not use a second workflow route or create database tables at runtime. Each of
the 38 supplier-searchable lines has a deterministic versioned idempotency key.
The customer comes from the session-derived Office mapping, so the same line
key is independent across customers.

The bulk control remains disabled unless all 40 lines classify exactly as 38
searchable, GUILD-027 clarification required, and GUILD-039 documentation only.
It submits the 38 requests with concurrency capped at three. Each new order can
attempt the webhook once; a bulk retry returns existing orders without another
wake. Active rows poll the scoped detail endpoint every seven seconds.

## Write and read ownership

`POST /api/procurement/requests` creates or scopes a BOM and creates an order in
one workflow-database transaction. The same transaction claims the
customer-scoped idempotency key. A duplicate retry returns the original order.
Reusing a key for a different request returns a conflict.

The webhook runs only after that transaction commits. An absent, invalid,
timed-out, or unsuccessful webhook does not roll back the order.

The dashboard writes only BOM request fields and the initial order fields. It
does not expose an API to update workflow status, progress, approval timestamps,
leases, decision snapshots, supplier research, quotes, or Gmail identifiers.
Detail and list reads always include the authenticated external customer UUID.

## Verification

```bash
npm run test:procurement-workflow
npm run test:workflow-guild2
npm run test:procurement-workflow-db
npx tsc --noEmit --pretty false --incremental false
node --import tsx scripts/product-copy-policy.test.ts
```

No Derya Prisma migration is required. The external idempotency table is still
required because it makes the idempotency claim and order insert atomic in the
authoritative Neon transaction.

Live acceptance still requires the real Neon schema, the restricted role, the
server-side Office mapping, and an authenticated deployment. Confirm that
Customer A cannot read or reuse Customer B records before enabling production
traffic.

The database-backed command requires disposable app and workflow databases.
`.github/workflows/procurement-workflow-tests.yml` provisions both from scratch
for pull requests. It does not contact production Neon.
