\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  supplier_count INTEGER;
  matched_contact_count INTEGER;
BEGIN
  IF to_regclass('public."OrderSupplier"') IS NULL
    OR to_regclass('public.order_vendors') IS NULL THEN
    RAISE EXCEPTION 'supplier compatibility schema is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('contact_name'),
        ('contact_email'),
        ('contact_phone'),
        ('contact'),
        ('identity')
    ) AS expected(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'order_vendors'
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'canonical supplier contact columns are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000200_order_supplier_contact_compatibility'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'supplier contact migration is not recorded as applied';
  END IF;

  SELECT count(*)
  INTO supplier_count
  FROM public.order_vendors
  WHERE order_id = '3f98d54d-7ed2-4e73-9bb3-0f2b3355f198'::uuid;

  IF supplier_count < 4 THEN
    RAISE EXCEPTION 'affected order is missing one or more expected suppliers';
  END IF;

  SELECT count(*)
  INTO matched_contact_count
  FROM (
    VALUES
      ('Ellsworth Adhesives', 'info@ellsworth.com'),
      ('The Binding Source', 'info@bindingsource.com'),
      ('Hisco', 'websupport@hiscoinc.com'),
      ('Strobels Supply', 'orders@strobelssupply.com')
  ) AS expected(name, email)
  JOIN public.order_vendors actual
    ON actual.name = expected.name
   AND actual.contact_email = expected.email
  WHERE actual.order_id = '3f98d54d-7ed2-4e73-9bb3-0f2b3355f198'::uuid;

  IF matched_contact_count <> 4 THEN
    RAISE EXCEPTION 'expected supplier contacts were not backfilled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('Ellsworth Adhesives', 'info@ellsworth.com'),
        ('The Binding Source', 'info@bindingsource.com'),
        ('Hisco', 'websupport@hiscoinc.com'),
        ('Strobels Supply', 'orders@strobelssupply.com')
    ) AS expected(name, email)
    JOIN public.order_vendors actual
      ON actual.name = expected.name
     AND actual.order_id = '3f98d54d-7ed2-4e73-9bb3-0f2b3355f198'::uuid
    WHERE (
        actual.contact_email IS DISTINCT FROM expected.email
        OR actual.contact->>'email' IS DISTINCT FROM expected.email
        OR jsonb_typeof(actual.identity) IS DISTINCT FROM 'object'
      )
  ) THEN
    RAISE EXCEPTION 'canonical supplier contact projection is incomplete';
  END IF;

  IF NOT has_schema_privilege('dashboard_api', 'public', 'USAGE')
    OR NOT has_table_privilege('dashboard_api', 'public.order_vendors', 'SELECT')
    OR has_table_privilege('dashboard_api', 'public.order_vendors', 'INSERT')
    OR has_table_privilege('dashboard_api', 'public.order_vendors', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'public.order_vendors', 'DELETE')
    OR has_table_privilege('dashboard_api', 'public.order_vendors', 'TRUNCATE') THEN
    RAISE EXCEPTION 'dashboard_api supplier permissions are unsafe';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000200_order_supplier_contact_compatibility',
  'order_id', '3f98d54d-7ed2-4e73-9bb3-0f2b3355f198',
  'supplier_count', count(*),
  'contact_email_count', count(contact_email),
  'dashboard_api_read_only', true
) AS verification
FROM public.order_vendors
WHERE order_id = '3f98d54d-7ed2-4e73-9bb3-0f2b3355f198'::uuid;

COMMIT;
