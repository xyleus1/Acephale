\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaign"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutreachCampaign'
      AND column_name = 'senderDisplayName'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'outreach campaign sender display name column is missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260901000400_outreach_campaign_sender_display_name'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender display name migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260901000400_outreach_campaign_sender_display_name',
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'sender_display_names', (
    SELECT count(*)
    FROM public."OutreachCampaign"
    WHERE "senderDisplayName" IS NOT NULL
  )
) AS verification;

ROLLBACK;
