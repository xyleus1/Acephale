-- Connected mailboxes become one shared pool for the whole application.
-- Mail keeps its own office: a message and a sender reservation still carry the
-- office they belong to, but they no longer have to match the office that first
-- connected the mailbox, so the composite account constraints are replaced by
-- plain account references.

ALTER TABLE "EmailMessage"
DROP CONSTRAINT IF EXISTS "EmailMessage_accountId_officeId_fkey";

ALTER TABLE "EmailSenderReservation"
DROP CONSTRAINT IF EXISTS "EmailSenderReservation_accountId_officeId_fkey";

ALTER TABLE "EmailSenderReservation"
ADD CONSTRAINT "EmailSenderReservation_accountId_fkey"
FOREIGN KEY ("accountId")
REFERENCES "EmailAccount"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- A mailbox now exists once for the whole application, so duplicate addresses
-- have to be merged by an operator before this migration can complete. Failing
-- here is deliberate: silently skipping the index would leave two rows able to
-- ingest the same mailbox and double its daily send capacity.
DO $$
DECLARE
  duplicate_addresses text;
BEGIN
  SELECT string_agg(email, ', ')
  INTO duplicate_addresses
  FROM (
    SELECT lower("email") AS email
    FROM public."EmailAccount"
    GROUP BY lower("email")
    HAVING count(*) > 1
    ORDER BY 1
  ) AS duplicates;

  IF duplicate_addresses IS NOT NULL THEN
    RAISE EXCEPTION
      'shared mailbox pool migration blocked: merge duplicate mailbox rows first (%)',
      duplicate_addresses;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "EmailAccount_email_shared_key"
ON public."EmailAccount" (lower("email"));
