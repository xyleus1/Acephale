# Minimal schema cutover

This migration renames the active procurement worker tables and holds exclusive
table locks while it converts legacy context. Treat it as a maintenance-window
migration. Do not deploy the matching application code first.

## Preconditions

1. Create a current Neon restore point or branch.
2. Record row counts for `Company`, `CompanyDocument`, `CrmOpportunity`,
   `MarginProfile`, `customers`, `bill_of_materials`, `orders`,
   `order_vendors`, and `procurement_api_idempotency` when they exist.
3. Rehearse all 28 migrations against the restore point. The populated CI
   contract is the minimum acceptance bar, not a substitute for this rehearsal.
4. Schedule a maintenance window and pause the Bourne worker, procurement wake
   cron, and operator writes. Confirm no long-running transaction is using the
   five worker tables.

## Cutover

1. Apply `20260821000100_minimal_customer_procurement_schema` with the database
   owner connection. The five-second lock timeout must abort a busy cutover
   instead of waiting indefinitely.
2. Confirm the migration completed before deploying the application. Never run
   DDL from the Vercel build.
3. Verify the saved Office pricing target, Company-to-workflow mapping, item and
   order counts, supplier links, Context document count, message citations, and
   compatibility-view grants for every worker role.
4. Deploy the application and test one HypnoDreamz file upload, one Context
   read, one item-specific Context record, and one procurement request.
5. Resume Bourne and the wake cron only after the request appears through the
   lowercase compatibility views and its reliability fields remain writable.

## Abort and recovery

If the migration times out, fails a scope check, or produces a count mismatch,
do not deploy the application. Keep workers paused, inspect the failing row on
the restore-point branch, and rerun the rehearsal. If the migration committed
but verification fails, restore or promote the pre-cutover Neon branch before
resuming traffic.
