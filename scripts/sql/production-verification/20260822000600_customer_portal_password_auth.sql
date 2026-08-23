\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."CustomerPortalUser"') IS NULL THEN
    RAISE EXCEPTION 'customer portal user table is missing';
  END IF;

  IF to_regclass('public."CustomerPortalLoginThrottle"') IS NULL THEN
    RAISE EXCEPTION 'customer portal login throttle table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'passwordHash'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'passwordVersion'
      AND data_type = 'integer'
      AND is_nullable = 'NO'
      AND column_default = '0'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'passwordUpdatedAt'
      AND data_type = 'timestamp without time zone'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'failedLoginAttempts'
      AND data_type = 'integer'
      AND is_nullable = 'NO'
      AND column_default = '0'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'lastFailedLoginAt'
      AND data_type = 'timestamp without time zone'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'lockedUntil'
      AND data_type = 'timestamp without time zone'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'customer password columns are missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'CustomerPortalUser'
      AND constraint_row.conname = 'CustomerPortalUser_password_state_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'customer password state constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'CustomerPortalLoginThrottle'
      AND constraint_row.conname = 'CustomerPortalLoginThrottle_attempt_count_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) OR to_regclass('public."CustomerPortalLoginThrottle_expiresAt_idx"') IS NULL THEN
    RAISE EXCEPTION 'customer login throttle protections are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'DELETE') THEN
    RAISE EXCEPTION 'derya application role cannot use the customer login throttle';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000600_customer_portal_password_auth'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'customer password migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."CustomerPortalUser"
    WHERE "passwordVersion" < 0
      OR "failedLoginAttempts" < 0
      OR (("passwordHash" IS NULL) <> ("passwordUpdatedAt" IS NULL))
  ) THEN
    RAISE EXCEPTION 'customer password state is inconsistent';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000600_customer_portal_password_auth',
  'customer_accounts', count(*),
  'accounts_with_password', count(*) FILTER (WHERE "passwordHash" IS NOT NULL),
  'accounts_requiring_password', count(*) FILTER (WHERE "passwordHash" IS NULL),
  'locked_accounts', count(*) FILTER (WHERE "lockedUntil" > now())
) AS verification
FROM public."CustomerPortalUser";

SELECT jsonb_build_object(
  'login_throttle_rows', count(*),
  'invalid_throttle_rows', count(*) FILTER (WHERE "attemptCount" < 0)
) AS login_throttle_verification
FROM public."CustomerPortalLoginThrottle";

COMMIT;
