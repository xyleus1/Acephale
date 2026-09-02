\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaign"') IS NULL
    OR to_regclass('public."OutreachCampaignSend"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutreachCampaign'
      AND column_name = 'variants'
      AND data_type = 'jsonb'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'outreach campaign variants column is missing or not nullable jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutreachCampaignSend'
      AND column_name = 'variantKey'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'outreach campaign send variant key column is missing or not nullable text';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260902000100_outreach_campaign_ab_variants'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'outreach campaign variants migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260902000100_outreach_campaign_ab_variants',
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'campaign_sends', (SELECT count(*) FROM public."OutreachCampaignSend"),
  'variant_campaigns', (
    SELECT count(*)
    FROM public."OutreachCampaign"
    WHERE "variants" IS NOT NULL
  ),
  'variant_sends', (
    SELECT count(*)
    FROM public."OutreachCampaignSend"
    WHERE "variantKey" IS NOT NULL
  )
) AS verification;

ROLLBACK;
