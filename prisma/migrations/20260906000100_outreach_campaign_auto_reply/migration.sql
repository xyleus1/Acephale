ALTER TABLE "OutreachCampaign"
  ADD COLUMN "replyMode" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "replyContext" JSONB;

CREATE TABLE "OutreachCampaignReply" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "draft" TEXT,
    "sentMessageId" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachCampaignReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachCampaignReply_inboundMessageId_key"
  ON "OutreachCampaignReply"("inboundMessageId");
CREATE INDEX "OutreachCampaignReply_officeId_campaignId_action_idx"
  ON "OutreachCampaignReply"("officeId", "campaignId", "action");
CREATE INDEX "OutreachCampaignReply_officeId_createdAt_idx"
  ON "OutreachCampaignReply"("officeId", "createdAt");

ALTER TABLE "OutreachCampaignReply"
  ADD CONSTRAINT "OutreachCampaignReply_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachCampaignReply"
  ADD CONSTRAINT "OutreachCampaignReply_campaignId_officeId_fkey"
  FOREIGN KEY ("campaignId", "officeId") REFERENCES "OutreachCampaign"("id", "officeId") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "OutreachCampaignReply" TO derya_app;
  END IF;
END $$;
