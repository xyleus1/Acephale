-- CRM outreach planner. This is additive: existing contacts stay canonical,
-- and the new plan table only tracks weekly queue slots and completion.

-- AlterTable
ALTER TABLE "Contact"
ADD COLUMN "importance" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN "bookfaceUrl" TEXT,
ADD COLUMN "outreachChannel" TEXT;

-- Seed importance from existing relationship metadata without changing it.
UPDATE "Contact"
SET "importance" = CASE
  WHEN "leverageLevel" = 'very_high' OR "relationshipStrength" = 'trusted' THEN 'critical'
  WHEN "leverageLevel" = 'high' OR "relationshipStrength" = 'strong' THEN 'high'
  ELSE 'medium'
END;

-- Give existing reachable contacts a usable default channel. Operators can
-- change this in the sheet before any outreach is marked complete.
UPDATE "Contact"
SET "outreachChannel" = CASE
  WHEN "email" IS NOT NULL AND BTRIM("email") <> '' THEN 'email'
  WHEN "linkedinUrl" IS NOT NULL AND BTRIM("linkedinUrl") <> '' THEN 'linkedin'
  ELSE NULL
END;

-- CreateTable
CREATE TABLE "OutreachPlanItem" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WEEKLY',
    "scheduledFor" TIMESTAMP(3),
    "reachedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_importance_idx" ON "Contact"("importance");

-- CreateIndex
CREATE INDEX "Contact_outreachChannel_status_idx" ON "Contact"("outreachChannel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachPlanItem_officeId_contactId_weekStart_key"
ON "OutreachPlanItem"("officeId", "contactId", "weekStart");

-- CreateIndex
CREATE INDEX "OutreachPlanItem_officeId_weekStart_channel_status_idx"
ON "OutreachPlanItem"("officeId", "weekStart", "channel", "status");

-- CreateIndex
CREATE INDEX "OutreachPlanItem_officeId_scheduledFor_status_idx"
ON "OutreachPlanItem"("officeId", "scheduledFor", "status");

-- CreateIndex
CREATE INDEX "OutreachPlanItem_officeId_reachedOutAt_idx"
ON "OutreachPlanItem"("officeId", "reachedOutAt");

-- AddForeignKey
ALTER TABLE "OutreachPlanItem"
ADD CONSTRAINT "OutreachPlanItem_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPlanItem"
ADD CONSTRAINT "OutreachPlanItem_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
