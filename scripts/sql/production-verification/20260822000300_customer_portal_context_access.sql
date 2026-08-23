\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  scope_guard_definition TEXT;
BEGIN
  IF to_regclass('public."CompanyContext"') IS NULL
    OR to_regclass('public."CustomerPortalUser"') IS NULL THEN
    RAISE EXCEPTION 'customer Context schema is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CompanyContext'
      AND column_name = 'createdByPortalUserId'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'portal creator column is missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CompanyContext'
      AND column_name = 'customerVisible'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'customer visibility column is missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
    JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    WHERE constraint_row.conname = 'CompanyContext_createdByPortalUserId_fkey'
      AND constraint_row.contype = 'f'
      AND source_schema.nspname = 'public'
      AND source_table.relname = 'CompanyContext'
      AND target_table.relname = 'CustomerPortalUser'
      AND constraint_row.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'portal creator foreign key is missing or unsafe';
  END IF;

  IF to_regclass('public."CompanyContext_officeId_companyId_customerVisible_createdAt_idx"') IS NULL
    OR to_regclass('public."CompanyContext_createdByPortalUserId_createdAt_idx"') IS NULL THEN
    RAISE EXCEPTION 'customer Context access indexes are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000300_customer_portal_context_access'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'customer Context migration is not recorded as applied';
  END IF;

  SELECT pg_get_functiondef(procedure_row.oid)
  INTO scope_guard_definition
  FROM pg_proc procedure_row
  JOIN pg_namespace procedure_schema ON procedure_schema.oid = procedure_row.pronamespace
  WHERE procedure_schema.nspname = 'public'
    AND procedure_row.proname = 'company_context_scope_guard';

  IF scope_guard_definition IS NULL
    OR position('createdByPortalUserId' IN scope_guard_definition) = 0
    OR position('CustomerPortalUser' IN scope_guard_definition) = 0 THEN
    RAISE EXCEPTION 'portal creator tenant guard is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."CompanyContext"
    WHERE "customerVisible" IS NULL
  ) THEN
    RAISE EXCEPTION 'customer visibility contains null values';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000300_customer_portal_context_access',
  'context_rows', count(*),
  'customer_visible_rows', count(*) FILTER (WHERE "customerVisible")
) AS verification
FROM public."CompanyContext";

COMMIT;
