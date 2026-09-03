ALTER TABLE "EmailAccount" ADD COLUMN "sendPausedAt" TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN "sendPausedReason" TEXT;

ALTER TABLE "EmailMessage" ADD COLUMN "deliveryKind" TEXT;

CREATE TABLE "EmailDeliveryEvent" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "accountId" TEXT,
  "messageId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "permanent" BOOLEAN NOT NULL DEFAULT false,
  "recipients" TEXT NOT NULL,
  "detail" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDeliveryEvent_messageId_key" ON "EmailDeliveryEvent"("messageId");
CREATE INDEX "EmailDeliveryEvent_officeId_kind_occurredAt_idx"
  ON "EmailDeliveryEvent"("officeId", "kind", "occurredAt");
CREATE INDEX "EmailDeliveryEvent_accountId_kind_permanent_occurredAt_idx"
  ON "EmailDeliveryEvent"("accountId", "kind", "permanent", "occurredAt");

ALTER TABLE "EmailDeliveryEvent"
  ADD CONSTRAINT "EmailDeliveryEvent_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailDeliveryEvent"
  ADD CONSTRAINT "EmailDeliveryEvent_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDeliveryEvent"
  ADD CONSTRAINT "EmailDeliveryEvent_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailSuppression" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "detail" TEXT,
  "evidenceMessageId" TEXT,
  "accountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSuppression_officeId_email_key" ON "EmailSuppression"("officeId", "email");
CREATE INDEX "EmailSuppression_officeId_reason_idx" ON "EmailSuppression"("officeId", "reason");

ALTER TABLE "EmailSuppression"
  ADD CONSTRAINT "EmailSuppression_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailDeliveryEvent" TO derya_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailSuppression" TO derya_app;
  END IF;
END
$$;
