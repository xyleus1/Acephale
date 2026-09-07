-- AlterTable
ALTER TABLE "world_contact" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "mailboxDomain" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "world_contact_source_verifiedAt_idx" ON "world_contact"("source", "verifiedAt");
