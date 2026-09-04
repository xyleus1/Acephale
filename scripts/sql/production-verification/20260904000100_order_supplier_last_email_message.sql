\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OrderSupplier"') IS NULL
    OR to_regclass('public.order_vendors') IS NULL THEN
    RAISE EXCEPTION 'supplier compatibility schema is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('last_email_message_id'), ('email_thread_id')) AS expected(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'OrderSupplier'
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'supplier outreach message columns are missing from OrderSupplier';
  END IF;

  -- The compatibility view fixes its column list at creation, so a supplier row
  -- stamped by an RFQ send is only visible to the request through a view that
  -- was replaced after the columns were added.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('last_email_message_id'), ('email_thread_id')) AS expected(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'order_vendors'
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'supplier outreach message columns are missing from order_vendors';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260904000100_order_supplier_last_email_message'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'supplier outreach message migration is not recorded as applied';
  END IF;
END
$$;

COMMIT;
