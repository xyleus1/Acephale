\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaignSend"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign send table is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutreachCampaignSend'
      AND column_name IN ('intro', 'renderedSubject', 'renderedBody')
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) <> 3 THEN
    RAISE EXCEPTION 'outreach campaign send personalization columns are missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260906000200_outreach_campaign_send_intro'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'outreach campaign send intro migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260906000200_outreach_campaign_send_intro',
  'campaign_sends', (SELECT count(*) FROM public."OutreachCampaignSend"),
  'intros', (
    SELECT count(*)
    FROM public."OutreachCampaignSend"
    WHERE "intro" IS NOT NULL
  ),
  'rendered_subjects', (
    SELECT count(*)
    FROM public."OutreachCampaignSend"
    WHERE "renderedSubject" IS NOT NULL
  ),
  'rendered_bodies', (
    SELECT count(*)
    FROM public."OutreachCampaignSend"
    WHERE "renderedBody" IS NOT NULL
  )
) AS verification;

ROLLBACK;
