\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."ResearchList"') IS NULL THEN
    RAISE EXCEPTION 'research list table is missing';
  END IF;

  IF to_regclass('public."ResearchRecord"') IS NULL THEN
    RAISE EXCEPTION 'research record table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ResearchRecord'
      AND column_name = 'officeId'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'research record office scoping is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ResearchRecord'
      AND column_name = 'searchText'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'research record search text column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."ResearchList"'::regclass
      AND conname = 'ResearchList_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'research list office constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."ResearchRecord"'::regclass
      AND conname = 'ResearchRecord_listId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'research record tenant constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ResearchList'
      AND indexname = 'ResearchList_officeId_slug_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'research list slug uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ResearchList'
      AND indexname = 'ResearchList_id_officeId_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'research list tenant identity index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ResearchRecord'
      AND indexname = 'ResearchRecord_listId_dedupeKey_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'research record dedupe uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ResearchRecord'
      AND indexname = 'ResearchRecord_officeId_listId_idx'
  ) THEN
    RAISE EXCEPTION 'research record office index is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."ResearchRecord" record
    JOIN public."ResearchList" list ON list."id" = record."listId"
    WHERE list."officeId" <> record."officeId"
  ) THEN
    RAISE EXCEPTION 'research record crosses an office boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."ResearchRecord"
    WHERE "status" NOT IN ('new', 'reviewed', 'rejected')
  ) THEN
    RAISE EXCEPTION 'research record status is outside the allowed set';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260825000100_research_lists'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'research lists migration is not recorded as applied';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260825000200_research_lists_app_grants'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'research list grant migration is not recorded as applied';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app')
    AND (
      NOT has_table_privilege('derya_app', 'public."ResearchList"', 'SELECT')
      OR NOT has_table_privilege('derya_app', 'public."ResearchList"', 'INSERT')
      OR NOT has_table_privilege('derya_app', 'public."ResearchList"', 'UPDATE')
      OR NOT has_table_privilege('derya_app', 'public."ResearchList"', 'DELETE')
      OR NOT has_table_privilege('derya_app', 'public."ResearchRecord"', 'SELECT')
      OR NOT has_table_privilege('derya_app', 'public."ResearchRecord"', 'INSERT')
      OR NOT has_table_privilege('derya_app', 'public."ResearchRecord"', 'UPDATE')
      OR NOT has_table_privilege('derya_app', 'public."ResearchRecord"', 'DELETE')
    ) THEN
    RAISE EXCEPTION 'derya application role cannot use the research lists';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260825000200_research_lists_app_grants',
  'research_lists', (SELECT count(*) FROM public."ResearchList"),
  'research_records', (SELECT count(*) FROM public."ResearchRecord")
) AS verification;

COMMIT;
