\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."ResearchProject"') IS NULL THEN
    RAISE EXCEPTION 'research project table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ResearchList'
      AND column_name = 'projectId'
  ) THEN
    RAISE EXCEPTION 'research list project column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_class.relname = 'ResearchProject_officeId_slug_key'
      AND index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
  ) THEN
    RAISE EXCEPTION 'research project office slug uniqueness is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_state
    WHERE constraint_state.conrelid = 'public."ResearchList"'::regclass
      AND constraint_state.conname = 'ResearchList_projectId_fkey'
      AND constraint_state.contype = 'f'
      AND constraint_state.confrelid = 'public."ResearchProject"'::regclass
      AND constraint_state.confdeltype = 'r'
      AND constraint_state.conkey = ARRAY[
        (
          SELECT attribute.attnum
          FROM pg_attribute attribute
          WHERE attribute.attrelid = 'public."ResearchList"'::regclass
            AND attribute.attname = 'projectId'
        )::smallint,
        (
          SELECT attribute.attnum
          FROM pg_attribute attribute
          WHERE attribute.attrelid = 'public."ResearchList"'::regclass
            AND attribute.attname = 'officeId'
        )::smallint
      ]
      AND constraint_state.confkey = ARRAY[
        (
          SELECT attribute.attnum
          FROM pg_attribute attribute
          WHERE attribute.attrelid = 'public."ResearchProject"'::regclass
            AND attribute.attname = 'id'
        )::smallint,
        (
          SELECT attribute.attnum
          FROM pg_attribute attribute
          WHERE attribute.attrelid = 'public."ResearchProject"'::regclass
            AND attribute.attname = 'officeId'
        )::smallint
      ]
  ) THEN
    RAISE EXCEPTION 'research list project tenant constraint is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') AND (
    NOT has_table_privilege('derya_app', 'public."ResearchProject"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."ResearchProject"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."ResearchProject"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."ResearchProject"', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'derya_app cannot use public."ResearchProject"';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260902000200_research_projects'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'research projects migration is not recorded as applied';
  END IF;
END
$$;

ROLLBACK;
