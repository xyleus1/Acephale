# Procurement and Bourne integration

## Runtime boundary

The Derya application connection remains on `DATABASE_URL`. It owns login,
Office records, and the authenticated tenant mapping. The workflow connection
uses `WORKFLOW_DATABASE_URL`. These connections may use the same physical Neon
database, but they must use separate roles and permission boundaries.

`WORKFLOW_DATABASE_URL` must use the restricted `dashboard_api` role and an SSL
mode of `require`, `verify-ca`, or `verify-full`. The optional
`BOURNE_WORKFLOW_WEBHOOK_URL` and `BOURNE_WORKFLOW_WEBHOOK_SECRET` are also
server-only. None of these values may use a `NEXT_PUBLIC_` name. Derya sends
the webhook secret as an `Authorization: Bearer` credential.

`PROCUREMENT_CUSTOMER_MAP_JSON` stores the server-only mapping from authenticated
Derya Office IDs to Neon customer UUIDs. API routes resolve the Office from the
active user session. No procurement route accepts a customer ID from browser
input. `CRON_SECRET` protects the Derya reconciliation endpoint and must remain
configured for the Vercel schedule.

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
6. Activate Bourne automation `6a80c50915936370994a7dfc`. Poll eligible
   `new` orders every minute. The webhook is an immediate-pickup optimization,
   not the recovery mechanism.
7. Keep Derya's protected `/api/cron/procurement-workflow` schedule enabled at
   `*/5 * * * *`. It reissues bounded wake requests only for mapped customer
   orders that remain `new` after the durable thirty-second claim window.

### Supplier contact compatibility

Production databases that had a legacy `order_vendors.email` column before the
minimal schema cutover must apply the additive contact migration as owner:

```bash
psql "$WORKFLOW_DATABASE_OWNER_URL" \
  --set=ON_ERROR_STOP=1 \
  --file=prisma/migrations/20260822000200_order_supplier_contact_compatibility/migration.sql
```

The migration adds the canonical contact columns, exposes them through the
compatibility view, backfills explicit legacy `email` and
`research.identity` contact values, and updates the insert trigger without
dropping unknown worker columns. It is safe to rerun. It does not send email,
change an order status, create a quote, or approve a supplier.

After applying it, verify the affected order with the restricted dashboard
role:

```sql
SELECT id, name, contact_name, contact_email, contact_phone, contact, identity
FROM public.order_vendors
WHERE order_id = '<order UUID>'::uuid
ORDER BY id;
```

Bourne must use `contact_email` for new writes. The legacy `email` field remains
available only for worker compatibility. Research JSON remains evidence and is
not Derya's operational contact source.

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

## Custom and inventory sourcing

Free-text and regular inventory requests use the structured Derya intake only
to collect the item, quantity, unit, technical identity, delivery location,
and need-by date. A complete intake posts to the same authenticated
`POST /api/procurement/requests` endpoint as GUILD2. It does not invoke the old
in-application supplier-research worker.

Custom requests store `request_context.source.campaign = CUSTOM` plus a bounded
request ID and optional workspace metadata. The request ID produces a stable
idempotency key. Workspace metadata groups the customer interface; it is never
an authorization input. The authenticated Office-to-customer mapping remains
the security boundary.

When CUSTOM includes a workspace ID, the server validates access to that
workspace and resolves its company before the workflow write. It freezes a
bounded snapshot of ready parsed documents and operator messages under
`request_context.company_context`. Derya replies are excluded because generated
text cannot become evidence. The same snapshot is appended to the BOM
specification with citation IDs and an untrusted-source warning, so the current
Bourne supplier worker sees the evidence without a new workflow table.

The snapshot hash and captured timestamp are derived from the included sources,
not request time. Exact retries therefore keep the same request hash. Context
changes require a new request and produce a new snapshot version. Orders created
before this integration are not backfilled.

The legacy `/api/supply-os/supplier-research` route and its campaign route
permit authenticated GET only for historical audit. Both POST handlers return
`410`, and the legacy cron does no work. Active sourcing screens restore CUSTOM
orders from Neon and poll the customer-scoped detail endpoint every seven
seconds.

## Write and read ownership

`POST /api/procurement/requests` creates or scopes a BOM and creates an order in
one workflow-database transaction. The same transaction claims the
customer-scoped idempotency key. A duplicate retry returns the original order.
Reusing a key for a different request returns a conflict.

The webhook runs only after that transaction commits. An absent, invalid,
timed-out, or unsuccessful webhook does not roll back the order.

## Reliable pickup contract

The connection has three layers:

1. The committed `orders` row is the durable request.
2. The authenticated webhook asks Bourne to inspect that order immediately.
3. Independent Bourne polling and Derya wake reconciliation recover missed,
   rejected, acknowledged-but-unprocessed, and redeploy-interrupted wakes.

Derya's reconciliation loop reads only customers present in the server-side
Office mapping. It selects at most twelve stale `new` orders, processes at most
four wake requests concurrently, and uses the existing customer-scoped
idempotency row as an atomic thirty-second wake claim. It never changes order
status, worker leases, supplier records, or approval state. Concurrent cron
invocations therefore skip already claimed work instead of duplicating wake
delivery.

Bourne owns worker claiming and recovery. It must atomically claim eligible
orders, maintain a bounded lease or heartbeat, retry infrastructure failures,
and make every external side effect idempotent. It must not use
`needs_attention` for timeouts, provider failures, webhook failures, expired
leases, or worker crashes. See `docs/BOURNE_WORKER_RELIABILITY_HANDOFF.md` for
the exact implementation contract.

The dashboard writes only BOM request fields and the initial order fields. It
does not expose an API to update workflow status, progress, approval timestamps,
leases, decision snapshots, supplier research, quotes, or Gmail identifiers.
Detail and list reads always include the authenticated external customer UUID.

## Verification

```bash
npm run test:procurement-workflow
npm run test:procurement-wake-reconciliation
npm run test:workflow-guild2
npm run test:customer-procurement-bourne
npm run test:supply-os-context
npm run test:procurement-workflow-db
npx tsc --noEmit --pretty false --incremental false
node --import tsx scripts/product-copy-policy.test.ts
```

An existing separate workflow database does not require Derya Prisma tables.
When authentication and workflow data are consolidated into one physical Neon
database, apply the current Prisma migrations as owner and provision the
restricted `derya_app` role before changing `DATABASE_URL`. The external
idempotency table remains required because it makes the idempotency claim and
order insert atomic in the authoritative Neon transaction.

Live acceptance still requires the real Neon schema, the restricted role, the
server-side Office mapping, and an authenticated deployment. Confirm that
Customer A cannot read or reuse Customer B records before enabling production
traffic.

The database-backed command requires disposable app and workflow databases.
`.github/workflows/procurement-workflow-tests.yml` provisions both from scratch
for pull requests. It does not contact production Neon.
