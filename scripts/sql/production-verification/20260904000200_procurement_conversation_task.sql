\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."ProcurementConversationTask"') IS NULL THEN
    RAISE EXCEPTION 'procurement conversation task table is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('officeId'),
        ('orderId'),
        ('vendorId'),
        ('stage'),
        ('action'),
        ('attempts'),
        ('nextAttemptAt'),
        ('lastAttemptAt'),
        ('lastError'),
        ('lastSuccessAt'),
        ('settledAt')
    ) AS expected(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'ProcurementConversationTask'
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'procurement conversation task columns are incomplete';
  END IF;

  -- One task per supplier conversation. Without this a pass could own the same
  -- thread twice and retry it twice.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ProcurementConversationTask'
      AND indexname = 'ProcurementConversationTask_officeId_orderId_vendorId_key'
  ) THEN
    RAISE EXCEPTION 'procurement conversation task uniqueness is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260904000200_procurement_conversation_task'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'procurement conversation task migration is not recorded as applied';
  END IF;
END
$$;

COMMIT;
