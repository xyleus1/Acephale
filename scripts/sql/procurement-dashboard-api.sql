\set ON_ERROR_STOP on

-- Run this against the Bourne workflow database as an owner. Supply the
-- password as a psql variable so it is not written into this repository:
--
-- psql "$OWNER_DATABASE_URL" \
--   --set=dashboard_api_password='generated-secret' \
--   --file=scripts/sql/procurement-dashboard-api.sql

SELECT format(
  'CREATE ROLE dashboard_api LOGIN NOINHERIT PASSWORD %L',
  :'dashboard_api_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api'
) \gexec

ALTER ROLE dashboard_api SET statement_timeout = '10s';
ALTER ROLE dashboard_api SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE dashboard_api NOINHERIT;

-- Neon owners are managed roles, not PostgreSQL superusers. They cannot use
-- ALTER ROLE to restate the target's superuser attribute.
-- Verify the SQL-created role's safe defaults instead of trying to rewrite
-- superuser-controlled attributes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api'
  ) THEN
    RAISE EXCEPTION 'dashboard_api role was not created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'dashboard_api'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    JOIN pg_roles ON pg_roles.oid = pg_auth_members.member
    WHERE pg_roles.rolname = 'dashboard_api'
  ) THEN
    RAISE EXCEPTION 'dashboard_api has unsafe role attributes or memberships';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO dashboard_api;
REVOKE CREATE ON SCHEMA public FROM dashboard_api;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM dashboard_api;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM dashboard_api;

DO $$
BEGIN
  IF to_regclass('public."ProcurementRequestKey"') IS NULL
    OR to_regclass('public.procurement_api_idempotency') IS NULL THEN
    RAISE EXCEPTION 'canonical procurement request key schema is missing';
  END IF;
END
$$;

REVOKE ALL ON customers FROM dashboard_api;
REVOKE ALL ON bill_of_materials FROM dashboard_api;
REVOKE ALL ON orders FROM dashboard_api;
REVOKE ALL ON order_vendors FROM dashboard_api;
REVOKE ALL ON procurement_api_idempotency FROM dashboard_api;

GRANT SELECT (id) ON customers TO dashboard_api;

GRANT SELECT ON bill_of_materials TO dashboard_api;
GRANT INSERT (
  customer_id,
  material,
  specification,
  procurement_preferences
) ON bill_of_materials TO dashboard_api;

GRANT SELECT ON orders TO dashboard_api;
GRANT INSERT (
  customer_id,
  bom_id,
  quantity,
  unit,
  needed_by,
  notes,
  request_context,
  status,
  progress
) ON orders TO dashboard_api;

GRANT SELECT ON order_vendors TO dashboard_api;
GRANT SELECT, INSERT ON procurement_api_idempotency TO dashboard_api;
GRANT UPDATE (order_id, updated_at) ON procurement_api_idempotency TO dashboard_api;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON customers, bill_of_materials, orders, order_vendors
FROM dashboard_api;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
ON procurement_api_idempotency
FROM dashboard_api;

DO $$
BEGIN
  IF has_table_privilege('dashboard_api', 'customers', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'customers', 'DELETE')
    OR has_table_privilege('dashboard_api', 'customers', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'bill_of_materials', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'bill_of_materials', 'DELETE')
    OR has_table_privilege('dashboard_api', 'bill_of_materials', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'orders', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'orders', 'DELETE')
    OR has_table_privilege('dashboard_api', 'orders', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'INSERT')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'DELETE')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'procurement_api_idempotency', 'DELETE')
    OR has_table_privilege('dashboard_api', 'procurement_api_idempotency', 'TRUNCATE') THEN
    RAISE EXCEPTION 'dashboard_api has unsafe workflow privileges';
  END IF;
END
$$;
