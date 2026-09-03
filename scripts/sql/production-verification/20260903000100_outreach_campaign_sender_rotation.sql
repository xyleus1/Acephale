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
      AND column_name = 'senderRotation'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'outreach campaign sender rotation column is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260903000100_outreach_campaign_sender_rotation'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender rotation migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260903000100_outreach_campaign_sender_rotation',
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'rotation_campaigns', (
    SELECT count(*)
    FROM public."OutreachCampaign"
    WHERE "senderRotation" = true
  ),
  'pinned_campaigns', (
    SELECT count(*)
    FROM public."OutreachCampaign"
    WHERE "senderRotation" = false
  )
) AS verification;

ROLLBACK;
