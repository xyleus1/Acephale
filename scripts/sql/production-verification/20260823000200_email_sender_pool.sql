\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'dailySendLimit'
      AND data_type = 'integer'
      AND is_nullable = 'NO'
      AND column_default = '30'
  ) THEN
    RAISE EXCEPTION 'email account daily send limit is missing or unsafe';
  END IF;

  IF to_regclass('public."EmailSenderReservation"') IS NULL THEN
    RAISE EXCEPTION 'email sender reservation table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailSenderReservation'
      AND column_name = 'requestHash'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'email sender reservation request hash is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailMessage'
      AND column_name = 'officeId'
  ) THEN
    RAISE EXCEPTION 'email message office link is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailSenderReservation'
      AND column_name = 'messageId'
  ) THEN
    RAISE EXCEPTION 'email sender reservation message link is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260823000200_email_sender_pool'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'email sender pool migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "dailySendLimit" NOT BETWEEN 1 AND 30
  ) THEN
    RAISE EXCEPTION 'email account daily send limit is outside the safe range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailSenderReservation" reservation
    JOIN public."EmailAccount" account ON account."id" = reservation."accountId"
    WHERE account."officeId" <> reservation."officeId"
  ) THEN
    RAISE EXCEPTION 'email sender reservation crosses an office boundary';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailAccount"'::regclass
      AND conname = 'EmailAccount_dailySendLimit_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'email account daily send limit constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSenderReservation"'::regclass
      AND conname = 'EmailSenderReservation_accountId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'email sender reservation tenant constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSenderReservation"'::regclass
      AND conname = 'EmailSenderReservation_requestHash_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'email sender reservation request hash constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailMessage"'::regclass
      AND conname = 'EmailMessage_threadId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'email message thread tenant constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailMessage"'::regclass
      AND conname = 'EmailMessage_accountId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'email message account tenant constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSenderReservation"'::regclass
      AND conname = 'EmailSenderReservation_messageId_accountId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'email sender reservation message tenant constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'EmailSenderReservation'
      AND indexname = 'EmailSenderReservation_officeId_idempotencyKey_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'email sender reservation idempotency index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'EmailSenderReservation'
      AND indexname = 'EmailSenderReservation_messageId_accountId_officeId_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'email sender reservation message identity index is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app')
    AND (
      NOT has_table_privilege('derya_app', 'public."EmailSenderReservation"', 'SELECT')
      OR NOT has_table_privilege('derya_app', 'public."EmailSenderReservation"', 'INSERT')
      OR NOT has_table_privilege('derya_app', 'public."EmailSenderReservation"', 'UPDATE')
      OR NOT has_table_privilege('derya_app', 'public."EmailSenderReservation"', 'DELETE')
    ) THEN
    RAISE EXCEPTION 'derya application role cannot use the email sender pool';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260823000200_email_sender_pool',
  'email_accounts', (SELECT count(*) FROM public."EmailAccount"),
  'daily_limit_30', (SELECT count(*) FROM public."EmailAccount" WHERE "dailySendLimit" = 30),
  'reservations', (SELECT count(*) FROM public."EmailSenderReservation")
) AS verification;

COMMIT;
