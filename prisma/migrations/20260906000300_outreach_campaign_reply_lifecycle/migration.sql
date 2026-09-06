ALTER TABLE "OutreachCampaignReply"
ADD COLUMN "claimedAt" TIMESTAMP(3),
ADD COLUMN "rfcMessageId" TEXT,
ADD COLUMN "reservationId" TEXT,
ADD COLUMN "pendingAt" TIMESTAMP(3);
