ALTER TABLE "OutreachCampaign" ADD COLUMN "followUps" JSONB;

CREATE TABLE "OutreachCampaignFollowUp" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "skipReason" TEXT,
  "senderEmail" TEXT,
  "reservationId" TEXT,
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "localThreadId" TEXT,
  "error" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachCampaignFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachCampaignFollowUp_campaignId_recordId_step_key"
  ON "OutreachCampaignFollowUp"("campaignId", "recordId", "step");
CREATE INDEX "OutreachCampaignFollowUp_officeId_campaignId_status_idx"
  ON "OutreachCampaignFollowUp"("officeId", "campaignId", "status");
CREATE INDEX "OutreachCampaignFollowUp_officeId_sentAt_idx"
  ON "OutreachCampaignFollowUp"("officeId", "sentAt");

ALTER TABLE "OutreachCampaignFollowUp"
  ADD CONSTRAINT "OutreachCampaignFollowUp_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaignFollowUp"
  ADD CONSTRAINT "OutreachCampaignFollowUp_campaignId_officeId_fkey"
  FOREIGN KEY ("campaignId", "officeId") REFERENCES "OutreachCampaign"("id", "officeId") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "OutreachCampaignFollowUp" TO derya_app;
  END IF;
END
$$;
