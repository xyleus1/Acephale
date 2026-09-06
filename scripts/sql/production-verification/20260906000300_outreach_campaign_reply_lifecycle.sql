\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaignReply"') IS NULL THEN
    RAISE EXCEPTION 'Missing table OutreachCampaignReply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'OutreachCampaignReply' AND column_name = 'claimedAt'
  ) THEN
    RAISE EXCEPTION 'Missing column OutreachCampaignReply.claimedAt';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'OutreachCampaignReply' AND column_name = 'rfcMessageId'
  ) THEN
    RAISE EXCEPTION 'Missing column OutreachCampaignReply.rfcMessageId';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'OutreachCampaignReply' AND column_name = 'reservationId'
  ) THEN
    RAISE EXCEPTION 'Missing column OutreachCampaignReply.reservationId';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'OutreachCampaignReply' AND column_name = 'pendingAt'
  ) THEN
    RAISE EXCEPTION 'Missing column OutreachCampaignReply.pendingAt';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_inboundMessageId_key'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_officeId_campaignId_action_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_officeId_createdAt_idx'
  ) THEN
    RAISE EXCEPTION 'outreach campaign reply indexes are incomplete';
  END IF;
END $$;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name = '20260906000300_outreach_campaign_reply_lifecycle'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'outreach campaign reply lifecycle migration is not recorded as applied';
  END IF;
END $$;

SELECT jsonb_build_object(
  'migration', '20260906000300_outreach_campaign_reply_lifecycle',
  'reply_rows', (SELECT count(*) FROM public."OutreachCampaignReply"),
  'claimed_rows', (SELECT count(*) FROM public."OutreachCampaignReply" WHERE "action" = 'CLAIMED'),
  'pending_rows', (SELECT count(*) FROM public."OutreachCampaignReply" WHERE "action" = 'PENDING')
) AS verification;

ROLLBACK;
