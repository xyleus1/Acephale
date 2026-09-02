ALTER TABLE "OutreachCampaign" ADD COLUMN "variants" JSONB;
ALTER TABLE "OutreachCampaignSend" ADD COLUMN "variantKey" TEXT;
