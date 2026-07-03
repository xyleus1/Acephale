-- Inbox → CRM touch: resolve email threads to CRM companies/contacts so every
-- inbound/outbound email lands on a relationship timeline.
-- Additive only: preserve existing EmailThread records.

ALTER TABLE "EmailThread" ADD COLUMN "companyId" TEXT;
ALTER TABLE "EmailThread" ADD COLUMN "contactId" TEXT;

-- Indexes
CREATE INDEX "EmailThread_companyId_idx" ON "EmailThread"("companyId");
CREATE INDEX "EmailThread_contactId_idx" ON "EmailThread"("contactId");

-- Foreign keys
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
