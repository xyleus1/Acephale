\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Missing table _prisma_migrations';
  END IF;
  IF NOT has_table_privilege('derya_app', 'public."_prisma_migrations"', 'SELECT') THEN
    RAISE EXCEPTION 'derya_app cannot read public._prisma_migrations';
  END IF;
END $$;

SELECT jsonb_build_object(
  'migration', '20260907000100_grant_prisma_migrations_read',
  'can_read_migrations', has_table_privilege('derya_app', 'public."_prisma_migrations"', 'SELECT')
) AS verification;

ROLLBACK;
