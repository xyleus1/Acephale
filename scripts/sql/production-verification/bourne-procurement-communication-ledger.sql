\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public.procurement_communication_messages') IS NULL THEN
    RAISE EXCEPTION 'procurement communication ledger is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'public.procurement_communication_messages'::regclass
      AND convalidated
      AND conname IN (
        'procurement_communication_order_customer_fk',
        'procurement_communication_vendor_order_fk',
        'procurement_communication_provider_message_unique',
        'procurement_communication_counterparty_participant'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'procurement communication ledger constraints are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_index
    JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
    WHERE pg_index.indrelid = 'public.procurement_communication_messages'::regclass
      AND index_class.relname IN (
        'procurement_communication_vendor_time_idx',
        'procurement_communication_thread_idx'
      )
      AND pg_index.indisvalid
  ) <> 2 THEN
    RAISE EXCEPTION 'procurement communication ledger indexes are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('dashboard_api', 'bourne_supply_chain')
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR NOT rolcanlogin
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    JOIN pg_roles ON pg_roles.oid = pg_auth_members.member
    WHERE pg_roles.rolname IN ('dashboard_api', 'bourne_supply_chain')
  ) THEN
    RAISE EXCEPTION 'procurement communication runtime roles are unsafe';
  END IF;
  IF NOT has_table_privilege(
    'dashboard_api',
    'public.procurement_communication_messages',
    'SELECT'
  ) OR has_table_privilege(
    'dashboard_api',
    'public.procurement_communication_messages',
    'INSERT'
  ) OR has_table_privilege(
    'dashboard_api',
    'public.procurement_communication_messages',
    'UPDATE'
  ) OR has_table_privilege(
    'dashboard_api',
    'public.procurement_communication_messages',
    'DELETE'
  ) OR has_table_privilege(
    'dashboard_api',
    'public.procurement_communication_messages',
    'TRUNCATE'
  ) OR has_schema_privilege('dashboard_api', 'public', 'CREATE')
    OR has_database_privilege('dashboard_api', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'dashboard_api procurement communication privileges are unsafe';
  END IF;
  IF NOT has_table_privilege(
    'bourne_supply_chain',
    'public.procurement_communication_messages',
    'SELECT'
  ) OR NOT has_table_privilege(
    'bourne_supply_chain',
    'public.procurement_communication_messages',
    'INSERT'
  ) OR has_table_privilege(
    'bourne_supply_chain',
    'public.procurement_communication_messages',
    'UPDATE'
  ) OR has_table_privilege(
    'bourne_supply_chain',
    'public.procurement_communication_messages',
    'DELETE'
  ) OR has_table_privilege(
    'bourne_supply_chain',
    'public.procurement_communication_messages',
    'TRUNCATE'
  ) OR has_schema_privilege('bourne_supply_chain', 'public', 'CREATE')
    OR has_database_privilege('bourne_supply_chain', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'bourne_supply_chain procurement communication privileges are unsafe';
  END IF;
  IF has_table_privilege(
    'derya_app',
    'public.procurement_communication_messages',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'derya_app can read the procurement communication ledger';
  END IF;
END
$$;

ROLLBACK;
