\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."EmailAccount"') IS NULL THEN
    RAISE EXCEPTION 'email account table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'sendEnabled'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'isDefaultSender'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'email sender policy columns are missing or unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE table_schema.nspname = 'public'
      AND table_relation.relname = 'EmailAccount'
      AND index_relation.relname = 'EmailAccount_officeId_default_sender_key'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'office default sender unique index is missing or unsafe';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000400_email_account_sending_config'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'email account sending migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "sendEnabled" IS NULL
       OR "isDefaultSender" IS NULL
  ) THEN
    RAISE EXCEPTION 'email sender policy contains null values';
  END IF;

  IF EXISTS (
    SELECT "officeId"
    FROM public."EmailAccount"
    WHERE "isDefaultSender"
    GROUP BY "officeId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'an office has more than one default sender';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "isDefaultSender"
      AND (
        "provider" <> 'GMAIL'
        OR NOT "isActive"
        OR NOT "sendEnabled"
        OR "refreshToken" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'a default sender is not an active connected Gmail sender';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "provider" = 'GMAIL'
      AND "isActive"
      AND "refreshToken" IS NOT NULL
      AND NOT "sendEnabled"
  ) THEN
    RAISE EXCEPTION 'an existing connected Gmail account was not enabled';
  END IF;

  IF EXISTS (
    SELECT "officeId"
    FROM public."EmailAccount"
    WHERE "provider" = 'GMAIL'
      AND "isActive"
      AND "refreshToken" IS NOT NULL
    GROUP BY "officeId"
    HAVING count(*) FILTER (WHERE "isDefaultSender") <> 1
  ) THEN
    RAISE EXCEPTION 'an office with an eligible sender has no single default';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000400_email_account_sending_config',
  'email_accounts', count(*),
  'send_enabled_accounts', count(*) FILTER (WHERE "sendEnabled"),
  'default_senders', count(*) FILTER (WHERE "isDefaultSender")
) AS verification
FROM public."EmailAccount";

COMMIT;
