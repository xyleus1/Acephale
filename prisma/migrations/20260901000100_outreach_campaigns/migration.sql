CREATE TABLE "OutreachCampaign" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "subject" TEXT NOT NULL,
  "bodyTemplate" TEXT NOT NULL,
  "emailField" TEXT NOT NULL,
  "companyField" TEXT,
  "countryField" TEXT,
  "rowStatuses" JSONB NOT NULL,
  "filters" JSONB,
  "senderAccountId" TEXT,
  "audienceTotal" INTEGER NOT NULL DEFAULT 0,
  "audienceRecordIds" JSONB,
  "revisionHash" TEXT,
  "dailyCap" INTEGER NOT NULL DEFAULT 40,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachCampaignSend" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "senderEmail" TEXT,
  "reservationId" TEXT,
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "localThreadId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachCampaignSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachCampaign_officeId_name_key"
  ON "OutreachCampaign"("officeId", "name");
CREATE UNIQUE INDEX "OutreachCampaign_id_officeId_key"
  ON "OutreachCampaign"("id", "officeId");
CREATE INDEX "OutreachCampaign_officeId_status_idx"
  ON "OutreachCampaign"("officeId", "status");
CREATE UNIQUE INDEX "OutreachCampaignSend_campaignId_recordId_key"
  ON "OutreachCampaignSend"("campaignId", "recordId");
CREATE INDEX "OutreachCampaignSend_officeId_campaignId_status_idx"
  ON "OutreachCampaignSend"("officeId", "campaignId", "status");
CREATE INDEX "OutreachCampaignSend_officeId_sentAt_idx"
  ON "OutreachCampaignSend"("officeId", "sentAt");

ALTER TABLE "OutreachCampaign"
  ADD CONSTRAINT "OutreachCampaign_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaign"
  ADD CONSTRAINT "OutreachCampaign_listId_officeId_fkey"
  FOREIGN KEY ("listId", "officeId") REFERENCES "ResearchList"("id", "officeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaignSend"
  ADD CONSTRAINT "OutreachCampaignSend_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaignSend"
  ADD CONSTRAINT "OutreachCampaignSend_campaignId_officeId_fkey"
  FOREIGN KEY ("campaignId", "officeId") REFERENCES "OutreachCampaign"("id", "officeId") ON DELETE CASCADE ON UPDATE CASCADE;
