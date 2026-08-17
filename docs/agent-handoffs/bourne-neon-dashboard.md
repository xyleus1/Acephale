# Bourne procurement dashboard handoff

## Scope

This branch adds the minimum authenticated Derya dashboard integration for
creating procurement requests in Bourne's Neon database and polling their
workflow state. Supplier research, approvals, email, quotes, leases, and model
work remain owned by Bourne.

## Database boundary

- `DATABASE_URL` remains the Derya authentication database.
- `WORKFLOW_DATABASE_URL` must be the SSL-only `dashboard_api` connection, not
  an owner or Bourne automation credential.
- `PROCUREMENT_CUSTOMER_MAP_JSON` maps the authenticated Derya Office ID to the
  Neon customer UUID on the server.
- There is no Derya Prisma schema change or migration.
- `scripts/sql/procurement-dashboard-api.sql` provisions the external Neon role
  and customer-scoped idempotency table. That provisioning is required before
  runtime use.

## Safety properties

- Browser input cannot select a customer or set workflow-owned fields.
- BOM, order, list, detail, and idempotency operations use the Office-derived
  customer UUID.
- The idempotency claim and order insert share one Neon transaction.
- The optional webhook runs after commit and cannot remove or roll back an
  order.
- The database role cannot update orders or mutate order vendors.
- Browser responses omit credentials, webhook configuration, leases, and email
  identifiers.
- Approval controls are informational. Approval remains in Bourne Inbox.
- GUILD2 uses this same endpoint for every Source action. Its bulk planner must
  see 40 classified lines, skip GUILD-027, retain GUILD-039 as documentation,
  and submit only 38 searchable lines with bounded concurrency.
- A duplicate GUILD2 line key returns the existing customer-scoped order and
  cannot issue another webhook wake.

## Verification state

Passed locally:

- `npm run test:procurement-workflow`
- `npm run test:workflow-guild2`
- `npx tsc --noEmit --pretty false --incremental false`
- `node --import tsx scripts/product-copy-policy.test.ts`
- `node --import tsx scripts/supply-os-deployment-boundary.test.ts`
- production `next build` with non-secret placeholder configuration

Still required:

- `npm run test:procurement-workflow-db` against provisioned temporary Derya
  and workflow databases
- staged Neon role inspection and cross-customer acceptance tests
- authenticated deployment smoke test

The pull-request workflow
`.github/workflows/procurement-workflow-tests.yml` now provisions separate
disposable app and workflow databases and runs the database-backed suite. It
must pass before production provisioning.

The local database-backed run was attempted. PostgreSQL `initdb` failed before
database creation because the host had exhausted its System V shared-memory ID
limit. This is an environment block, not a passing database test.

The built Next.js server was also invoked for an unauthenticated route smoke
test. The sandbox rejected the local listener with `listen EPERM` on
`127.0.0.1:3107`, so no HTTP response was claimed.

## Deployment stop

Do not treat this branch as production-approved. Do not activate Bourne until
the staged database tests pass and Mert explicitly approves production
activation.
