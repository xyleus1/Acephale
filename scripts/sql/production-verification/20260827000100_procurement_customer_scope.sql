BEGIN READ ONLY;

DO $verification$
DECLARE
  view_options TEXT[];
  unexpected_columns TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260827000100_procurement_customer_scope'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'procurement customer scope migration is not recorded as applied';
  END IF;

  IF to_regclass('public.procurement_customer_scope') IS NULL THEN
    RAISE EXCEPTION 'procurement_customer_scope view is missing';
  END IF;

  SELECT relation.reloptions
  INTO view_options
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'procurement_customer_scope'
    AND relation.relkind = 'v';
  IF view_options IS NULL OR NOT ('security_barrier=true' = ANY(view_options)) THEN
    RAISE EXCEPTION 'procurement_customer_scope must be a security-barrier view';
  END IF;

  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
  INTO unexpected_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'procurement_customer_scope'
    AND column_name NOT IN ('id', 'office_id', 'company_id');
  IF unexpected_columns IS NOT NULL THEN
    RAISE EXCEPTION 'procurement_customer_scope exposes unexpected columns: %', unexpected_columns;
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'procurement_customer_scope'
      AND column_name IN ('id', 'office_id', 'company_id')
  ) <> 3 THEN
    RAISE EXCEPTION 'procurement_customer_scope does not expose the required exact scope columns';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api') THEN
    IF NOT has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'SELECT') THEN
      RAISE EXCEPTION 'dashboard_api cannot read procurement_customer_scope';
    END IF;
    IF has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'INSERT')
      OR has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'UPDATE')
      OR has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'DELETE')
      OR has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'TRUNCATE')
      OR has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'REFERENCES')
      OR has_table_privilege('dashboard_api', 'public.procurement_customer_scope', 'TRIGGER') THEN
      RAISE EXCEPTION 'dashboard_api has unsafe procurement_customer_scope privileges';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app')
    AND has_table_privilege('derya_app', 'public.procurement_customer_scope', 'SELECT') THEN
    RAISE EXCEPTION 'derya_app can read workflow-owned procurement_customer_scope';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bourne_supply_chain')
    AND has_table_privilege('bourne_supply_chain', 'public.procurement_customer_scope', 'SELECT') THEN
    RAISE EXCEPTION 'bourne_supply_chain can read procurement_customer_scope';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'procurement_customer_scope'
      AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can read procurement_customer_scope';
  END IF;
END
$verification$;

COMMIT;
