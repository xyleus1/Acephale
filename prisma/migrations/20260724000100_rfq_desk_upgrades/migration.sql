-- RFQ desk upgrades: assignment, operator-entered contact fields, the
-- "real details from WhatsApp" box, and forwarded-to partner tracking.
-- Additive only; run `prisma migrate deploy` against prod BEFORE merging.

ALTER TABLE "Inquiry" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "manualDetails" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "forwardedTo" TEXT;

CREATE INDEX "Inquiry_officeId_assignedToUserId_idx" ON "Inquiry"("officeId", "assignedToUserId");

ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
