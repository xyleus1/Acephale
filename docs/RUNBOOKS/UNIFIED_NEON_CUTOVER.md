# Unified Neon Cutover

This runbook moves Derya authentication and procurement into one physical Neon
database without collapsing their permission boundaries. The old application
database remains untouched as rollback until the new login and procurement
flow pass production smoke tests.

## Target layout

- One Neon database contains quoted Prisma application tables such as
  `"Office"`, `"User"`, `"Company"`, and `"SupplyWorkspace"`.
- The same database contains workflow tables such as `customers`, `orders`,
  `order_vendors`, and `procurement_api_idempotency`.
- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` use the `derya_app` role.
- `WORKFLOW_DATABASE_URL` uses the existing `dashboard_api` role.
- Bourne keeps its own workflow role.
- The Neon owner connection is used only for migrations and provisioning.

Do not point `DATABASE_URL` at `dashboard_api`. That role is intentionally
unable to read or write the Prisma authentication tables. Do not point the app
at the Neon owner either.

## 1. Test outside production

The `Procurement workflow security` GitHub job provisions this exact combined
layout in a disposable PostgreSQL database. Do not continue unless that job
passes.

## 2. Apply the Prisma schema as owner

Use the direct owner connection in a controlled shell. Do not print it.

```bash
DATABASE_URL="$OWNER_DATABASE_URL" \
DATABASE_URL_UNPOOLED="$OWNER_DATABASE_URL" \
npx prisma migrate status

DATABASE_URL="$OWNER_DATABASE_URL" \
DATABASE_URL_UNPOOLED="$OWNER_DATABASE_URL" \
npx prisma migrate deploy

DATABASE_URL="$OWNER_DATABASE_URL" \
DATABASE_URL_UNPOOLED="$OWNER_DATABASE_URL" \
npx prisma migrate status
```

Do not use a whole-database Prisma diff as a clean-schema assertion here. The
lowercase workflow tables are intentionally outside Prisma and will appear as
extra objects. Never use `prisma db push`, `migrate dev`, or `migrate reset`.

## 3. Provision the application role

Generate a new password in the shell and do not paste it into chat or source
control.

```bash
read -s "DERYA_APP_PASSWORD?New derya_app password: "
echo

psql "$OWNER_DATABASE_URL" \
  --set=derya_app_password="$DERYA_APP_PASSWORD" \
  --file=scripts/sql/derya-app-role.sql
```

Build pooled and direct Neon URLs for `derya_app`. Verify each with:

```bash
psql "$DERYA_APP_DATABASE_URL" -Atc 'SELECT current_user'
psql "$DERYA_APP_DATABASE_URL_UNPOOLED" -Atc 'SELECT current_user'
```

Both must print only `derya_app`.

## 4. Create the fresh login and Dreamz workspace

The seed is idempotent. It creates one Office, one active ADMIN user, one
Company, one SupplyWorkspace, and one OWNER membership. It does not print the
password or password hash.

```bash
read -s "PRODUCTION_ADMIN_PASSWORD?New Derya login password: "
echo

ALLOW_PRODUCTION_OFFICE_SEED=1 \
DATABASE_URL="$DERYA_APP_DATABASE_URL" \
DATABASE_URL_UNPOOLED="$DERYA_APP_DATABASE_URL_UNPOOLED" \
PRODUCTION_OFFICE_NAME="Dreamz" \
PRODUCTION_COMPANY_NAME="Dreamz" \
PRODUCTION_WORKSPACE_NAME="Dreamz" \
PRODUCTION_ADMIN_NAME="Mert" \
PRODUCTION_ADMIN_EMAIL="mert@usederya.com" \
PRODUCTION_ADMIN_PASSWORD="$PRODUCTION_ADMIN_PASSWORD" \
npm run seed:production-office
```

Keep the returned Office ID. Map that Office ID to the intended workflow
`customers.id` in `PROCUREMENT_CUSTOMER_MAP_JSON`. This mapping is server-only.
The seeded email must also be present in the server-side `LOGIN_ALLOWED_EMAILS`
configuration or credential login will be rejected before the password check.

## 5. Change only the production server variables

In Vercel Production, replace:

- `DATABASE_URL` with the pooled `derya_app` URL.
- `DATABASE_URL_UNPOOLED` with the direct `derya_app` URL.
- `DIRECT_URL` with the direct `derya_app` URL if the deployment still carries
  that compatibility variable.
- `PROCUREMENT_CUSTOMER_MAP_JSON` with the new Office ID mapped to the intended
  workflow customer UUID.

Keep these unchanged:

- `WORKFLOW_DATABASE_URL`
- `BOURNE_WORKFLOW_WEBHOOK_URL`
- `BOURNE_WORKFLOW_WEBHOOK_SECRET`
- `AUTH_SECRET`

Redeploy Production after the variables are saved. Existing cookies from the
old database will not authorize a missing user in the new database, so sign in
with the new password.

The application runtime reads Prisma through `DATABASE_URL` and
`DATABASE_URL_UNPOOLED`. Once those point to the unified database, the legacy
`POSTGRES_*`, `PG*`, and old integration variables are not part of the login or
application query path. Remove them only after rollback is no longer needed.

## 6. Production smoke test

Verify in this order:

1. Password login succeeds at `https://app.derya.ai/login`.
2. The header shows Dreamz and the Dreamz workspace opens.
3. The sourcing queue can read the mapped workflow customer.
4. Creating one request commits exactly one order.
5. The webhook wake advances that exact order.
6. Supplier results appear through the customer-scoped detail route.
7. `derya_app` cannot read or update `orders` directly.
8. `dashboard_api` cannot read `"User"` or update workflow status.

Keep the old database and its former Vercel values available for rollback until
all eight checks pass. Do not delete it during commissioning.
