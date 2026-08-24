ALTER TABLE "EmailAccount"
ADD COLUMN "dailySendLimit" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "EmailAccount"
ADD CONSTRAINT "EmailAccount_dailySendLimit_check"
CHECK ("dailySendLimit" BETWEEN 1 AND 30);

CREATE UNIQUE INDEX "EmailAccount_id_officeId_key"
ON "EmailAccount"("id", "officeId");

CREATE TYPE "EmailSenderReservationStatus" AS ENUM ('RESERVED', 'RECORDED', 'RELEASED');

CREATE TABLE "EmailSenderReservation" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "usageDate" DATE NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "messageId" TEXT,
  "status" "EmailSenderReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "localThreadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailSenderReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailSenderReservation_accountId_officeId_fkey"
    FOREIGN KEY ("accountId", "officeId")
    REFERENCES "EmailAccount"("id", "officeId")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EmailSenderReservation_officeId_idempotencyKey_key"
ON "EmailSenderReservation"("officeId", "idempotencyKey");

CREATE UNIQUE INDEX "EmailSenderReservation_messageId_accountId_officeId_key"
ON "EmailSenderReservation"("messageId", "accountId", "officeId");

ALTER TABLE "EmailSenderReservation"
ADD CONSTRAINT "EmailSenderReservation_requestHash_check"
CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

CREATE INDEX "EmailSenderReservation_officeId_usageDate_status_idx"
ON "EmailSenderReservation"("officeId", "usageDate", "status");

CREATE INDEX "EmailSenderReservation_accountId_usageDate_status_idx"
ON "EmailSenderReservation"("accountId", "usageDate", "status");

ALTER TABLE "EmailMessage"
ADD COLUMN "officeId" TEXT;

CREATE UNIQUE INDEX "EmailThread_id_officeId_key"
ON "EmailThread"("id", "officeId");

CREATE UNIQUE INDEX "EmailMessage_id_accountId_officeId_key"
ON "EmailMessage"("id", "accountId", "officeId");

ALTER TABLE "EmailMessage"
ADD CONSTRAINT "EmailMessage_threadId_officeId_fkey"
FOREIGN KEY ("threadId", "officeId")
REFERENCES "EmailThread"("id", "officeId")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "EmailMessage"
ADD CONSTRAINT "EmailMessage_accountId_officeId_fkey"
FOREIGN KEY ("accountId", "officeId")
REFERENCES "EmailAccount"("id", "officeId")
ON DELETE NO ACTION
ON UPDATE CASCADE;

ALTER TABLE "EmailSenderReservation"
ADD CONSTRAINT "EmailSenderReservation_messageId_accountId_officeId_fkey"
FOREIGN KEY ("messageId", "accountId", "officeId")
REFERENCES "EmailMessage"("id", "accountId", "officeId")
ON DELETE CASCADE
ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailSenderReservation" TO derya_app;
  END IF;
END
$$;
