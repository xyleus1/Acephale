\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260825000300_shared_mailbox_pool'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'shared mailbox pool migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSenderReservation"'::regclass
      AND conname = 'EmailSenderReservation_accountId_officeId_fkey'
  ) THEN
    RAISE EXCEPTION 'sender reservations still require the mailbox office to match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailMessage"'::regclass
      AND conname = 'EmailMessage_accountId_officeId_fkey'
  ) THEN
    RAISE EXCEPTION 'email messages still require the mailbox office to match';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."EmailSenderReservation"'::regclass
      AND conname = 'EmailSenderReservation_accountId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'sender reservations lost their mailbox reference';
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
END
$$;

SELECT jsonb_build_object(
  'migration', '20260825000300_shared_mailbox_pool',
  'email_accounts', (SELECT count(*) FROM public."EmailAccount"),
  'shared_identity_index', (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'EmailAccount'
      AND indexname = 'EmailAccount_email_shared_key'
  ),
  'duplicate_mailbox_addresses', (
    SELECT count(*)
    FROM (
      SELECT lower("email")
      FROM public."EmailAccount"
      GROUP BY lower("email")
      HAVING count(*) > 1
    ) duplicates
  ),
  'cross_office_reservations', (
    SELECT count(*)
    FROM public."EmailSenderReservation" reservation
    JOIN public."EmailAccount" account ON account."id" = reservation."accountId"
    WHERE account."officeId" <> reservation."officeId"
  )
) AS verification;

COMMIT;
