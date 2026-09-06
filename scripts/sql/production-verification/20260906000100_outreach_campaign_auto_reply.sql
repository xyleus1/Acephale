\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaign"') IS NULL
    OR to_regclass('public."OutreachCampaignReply"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign auto-reply tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('replyMode', 'text'), ('replyContext', 'jsonb')) AS expected(column_name, data_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'OutreachCampaign'
        AND actual.column_name = expected.column_name
        AND actual.data_type = expected.data_type
    )
  ) THEN
    RAISE EXCEPTION 'outreach campaign reply settings columns are missing or have the wrong type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('officeId'), ('campaignId'), ('threadId'), ('inboundMessageId'),
      ('intent'), ('confidence'), ('action'), ('reason'), ('draft'),
      ('sentMessageId'), ('providerMessageId'), ('sentAt'), ('createdAt')
    ) AS expected(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'OutreachCampaignReply'
        AND actual.column_name = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION 'outreach campaign reply columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_inboundMessageId_key'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_officeId_campaignId_action_idx'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'OutreachCampaignReply'
      AND indexname = 'OutreachCampaignReply_officeId_createdAt_idx'
  ) THEN
    RAISE EXCEPTION 'outreach campaign reply indexes are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignReply"'::regclass
      AND conname = 'OutreachCampaignReply_officeId_fkey'
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignReply"'::regclass
      AND conname = 'OutreachCampaignReply_campaignId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'outreach campaign reply tenant constraints are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260906000100_outreach_campaign_auto_reply'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'outreach campaign auto-reply migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260906000100_outreach_campaign_auto_reply',
  'campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'auto_reply_rows', (SELECT count(*) FROM public."OutreachCampaignReply"),
  'sent_rows', (
    SELECT count(*) FROM public."OutreachCampaignReply" WHERE "action" = 'SENT'
  )
) AS verification;

ROLLBACK;
