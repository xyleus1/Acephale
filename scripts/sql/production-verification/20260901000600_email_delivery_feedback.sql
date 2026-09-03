\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  table_name text;
BEGIN
  IF to_regclass('public."EmailDeliveryEvent"') IS NULL THEN
    RAISE EXCEPTION 'email delivery event table is missing';
  END IF;
  IF to_regclass('public."EmailSuppression"') IS NULL THEN
    RAISE EXCEPTION 'email suppression table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name IN ('sendPausedAt', 'sendPausedReason')
      AND is_nullable = 'YES'
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'email account send pause columns are missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailMessage'
      AND column_name = 'deliveryKind'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'email message deliveryKind column is missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailDeliveryEvent"'::regclass
      AND conname = 'EmailDeliveryEvent_officeId_fkey'
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSuppression"'::regclass
      AND conname = 'EmailSuppression_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'email delivery feedback tables lost their office tenant constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'EmailSuppression'
      AND indexname = 'EmailSuppression_officeId_email_key'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'EmailDeliveryEvent'
      AND indexname = 'EmailDeliveryEvent_messageId_key'
  ) THEN
    RAISE EXCEPTION 'email delivery feedback uniqueness indexes are missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    FOREACH table_name IN ARRAY ARRAY['EmailDeliveryEvent', 'EmailSuppression'] LOOP
      IF NOT has_table_privilege('derya_app', format('public.%I', table_name), 'SELECT')
        OR NOT has_table_privilege('derya_app', format('public.%I', table_name), 'INSERT')
        OR NOT has_table_privilege('derya_app', format('public.%I', table_name), 'UPDATE')
        OR NOT has_table_privilege('derya_app', format('public.%I', table_name), 'DELETE') THEN
        RAISE EXCEPTION 'derya_app cannot use public.%', table_name;
      END IF;

      IF has_table_privilege('derya_app', format('public.%I', table_name), 'TRUNCATE')
        OR has_table_privilege('derya_app', format('public.%I', table_name), 'REFERENCES')
        OR has_table_privilege('derya_app', format('public.%I', table_name), 'TRIGGER') THEN
        RAISE EXCEPTION 'derya_app has excessive privileges on public.%', table_name;
      END IF;
    END LOOP;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260901000600_email_delivery_feedback'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'email delivery feedback migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260901000600_email_delivery_feedback',
  'email_delivery_events', (SELECT count(*) FROM public."EmailDeliveryEvent"),
  'email_suppressions', (SELECT count(*) FROM public."EmailSuppression"),
  'paused_sender_accounts', (
    SELECT count(*)
    FROM public."EmailAccount"
    WHERE "sendPausedAt" IS NOT NULL
  ),
  'cross_office_delivery_events', (
    SELECT count(*)
    FROM public."EmailDeliveryEvent" event
    JOIN public."EmailMessage" message ON message."id" = event."messageId"
    WHERE message."officeId" IS NOT NULL
      AND message."officeId" <> event."officeId"
  )
) AS verification;

ROLLBACK;
