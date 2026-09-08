\set ON_ERROR_STOP on

-- Run this against the Bourne workflow database as an owner. Supply the
-- password as a psql variable so it is not written into this repository:
-- The restricted bourne_supply_chain runtime role must already exist.
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
    OR to_regclass('public.procurement_api_idempotency') IS NULL
    OR to_regclass('public.procurement_customer_scope') IS NULL THEN
    RAISE EXCEPTION 'canonical procurement request key schema is missing';
  END IF;
END
$$;

\ir bourne-procurement-communication-ledger.sql

REVOKE ALL ON customers FROM dashboard_api;
REVOKE ALL ON bill_of_materials FROM dashboard_api;
REVOKE ALL ON orders FROM dashboard_api;
REVOKE ALL ON order_vendors FROM dashboard_api;
REVOKE ALL ON procurement_api_idempotency FROM dashboard_api;
REVOKE ALL ON procurement_customer_scope FROM dashboard_api;

GRANT SELECT (id) ON customers TO dashboard_api;
GRANT SELECT ON procurement_customer_scope TO dashboard_api;

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

-- A supplier reply that carries a price and a lead time has to land on the row
-- the request reads its quotes from, otherwise outreach never becomes a
-- purchase order. The dashboard role is given no update privilege on the table
-- at all: it may only call this function, which is the database boundary that
-- proves the row belongs to the calling customer, touches the quote column
-- alone, and refuses a row that already holds a quote. A caller that passes
-- another customer's order changes nothing.
CREATE OR REPLACE FUNCTION record_order_vendor_quote(
  p_customer_id uuid,
  p_order_id uuid,
  p_vendor_id uuid,
  p_quote jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_customer_id IS NULL OR p_order_id IS NULL OR p_vendor_id IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_quote) <> 'object' OR p_quote = '{}'::jsonb THEN
    RAISE EXCEPTION 'a recorded quote must be a non empty object';
  END IF;

  UPDATE order_vendors
  SET quote = p_quote, updated_at = now()
  WHERE order_vendors.id = p_vendor_id
    AND order_vendors.order_id = p_order_id
    AND EXISTS (
      SELECT 1
      FROM orders
      WHERE orders.id = p_order_id
        AND orders.customer_id = p_customer_id
    )
    AND (
      coalesce(jsonb_typeof(to_jsonb(order_vendors)->'quote'), 'null') <> 'object'
      OR to_jsonb(order_vendors)->'quote' = '{}'::jsonb
    );

  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written = 1;
END
$$;

REVOKE ALL ON FUNCTION record_order_vendor_quote(uuid, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_order_vendor_quote(uuid, uuid, uuid, jsonb) TO dashboard_api;

-- The lifecycle status was the last field the external worker owned, which left
-- every request the application itself sources sitting on its submitted status
-- while suppliers were being found and contacted. The dashboard role still gets
-- no update privilege on the table: it may only call this function, which is the
-- database boundary that proves the order belongs to the calling customer, moves
-- the status forward along the fixed ladder and never backwards, refuses any
-- status the application is not allowed to set, and leaves a request that a
-- human or the worker has already settled or flagged untouched. Returns the new
-- status, or null when nothing moved.
CREATE OR REPLACE FUNCTION advance_order_status(
  p_customer_id uuid,
  p_order_id uuid,
  p_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ladder jsonb := '{
    "new": 0,
    "researching": 1,
    "awaiting_shortlist_approval": 1,
    "sourcing": 2,
    "awaiting_order_approval": 3,
    "ordered": 4
  }'::jsonb;
  current_status text;
  written integer;
BEGIN
  IF p_customer_id IS NULL OR p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Placing an order, cancelling one and flagging one for attention stay with
  -- the operator, so the automation can only reach the three sourcing statuses.
  IF p_status IS NULL OR p_status NOT IN ('researching', 'sourcing', 'awaiting_order_approval') THEN
    RAISE EXCEPTION 'order status % may not be set by the application', coalesce(p_status, 'null');
  END IF;

  SELECT procurement_order.status INTO current_status
  FROM "ProcurementOrder" AS procurement_order
  WHERE procurement_order.id = p_order_id
    AND procurement_order.customer_id = p_customer_id;

  IF current_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- A status outside the ladder, such as cancelled or needs_attention, is a
  -- decision the automation must not overwrite with sourcing progress.
  IF NOT ladder ? current_status THEN
    RETURN NULL;
  END IF;

  IF (ladder->>p_status)::int <= (ladder->>current_status)::int THEN
    RETURN NULL;
  END IF;

  UPDATE "ProcurementOrder"
  SET status = p_status, updated_at = now()
  WHERE "ProcurementOrder".id = p_order_id
    AND "ProcurementOrder".customer_id = p_customer_id
    AND ladder ? "ProcurementOrder".status
    AND (ladder->>"ProcurementOrder".status)::int < (ladder->>p_status)::int;

  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN CASE WHEN written = 1 THEN p_status ELSE NULL END;
END
$$;

REVOKE ALL ON FUNCTION advance_order_status(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_order_status(uuid, uuid, text) TO dashboard_api;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON procurement_customer_scope
FROM dashboard_api;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
ON procurement_api_idempotency
FROM dashboard_api;

DO $$
BEGIN
  IF NOT has_table_privilege('dashboard_api', 'procurement_customer_scope', 'SELECT') THEN
    RAISE EXCEPTION 'dashboard_api cannot read procurement customer scope';
  END IF;
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
    OR has_column_privilege('dashboard_api', 'order_vendors', 'name', 'UPDATE')
    OR has_column_privilege('dashboard_api', 'order_vendors', 'status', 'UPDATE')
    OR has_column_privilege('dashboard_api', 'order_vendors', 'contact_email', 'UPDATE')
    OR has_column_privilege('dashboard_api', 'order_vendors', 'research', 'UPDATE')
    OR has_column_privilege('dashboard_api', 'order_vendors', 'quote', 'UPDATE')
    OR NOT has_function_privilege(
      'dashboard_api',
      'record_order_vendor_quote(uuid, uuid, uuid, jsonb)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'dashboard_api',
      'advance_order_status(uuid, uuid, text)',
      'EXECUTE'
    )
    OR has_column_privilege('dashboard_api', 'orders', 'status', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'DELETE')
    OR has_table_privilege('dashboard_api', 'order_vendors', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'procurement_api_idempotency', 'DELETE')
    OR has_table_privilege('dashboard_api', 'procurement_api_idempotency', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'INSERT')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'DELETE')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'TRUNCATE')
    OR has_table_privilege('dashboard_api', 'procurement_customer_scope', 'INSERT')
    OR has_table_privilege('dashboard_api', 'procurement_customer_scope', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'procurement_customer_scope', 'DELETE')
    OR has_table_privilege('dashboard_api', 'procurement_customer_scope', 'TRUNCATE') THEN
    RAISE EXCEPTION 'dashboard_api has unsafe workflow privileges';
  END IF;
END
$$;
