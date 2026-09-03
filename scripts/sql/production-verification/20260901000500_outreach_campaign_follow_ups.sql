\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."OutreachCampaignFollowUp"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign follow-up table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutreachCampaign'
      AND column_name = 'followUps'
      AND data_type = 'jsonb'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'outreach campaign followUps column is missing or not nullable jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignFollowUp"'::regclass
      AND conname = 'OutreachCampaignFollowUp_officeId_fkey'
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignFollowUp"'::regclass
      AND conname = 'OutreachCampaignFollowUp_campaignId_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'outreach campaign follow-up table lost its office or campaign tenant constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'OutreachCampaignFollowUp'
      AND indexname = 'OutreachCampaignFollowUp_campaignId_recordId_step_key'
  ) THEN
    RAISE EXCEPTION 'outreach campaign follow-up step uniqueness index is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    IF NOT has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'SELECT')
      OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'INSERT')
      OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'UPDATE')
      OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'DELETE') THEN
      RAISE EXCEPTION 'derya_app cannot use public.OutreachCampaignFollowUp';
    END IF;

    IF has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'TRUNCATE')
      OR has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'REFERENCES')
      OR has_table_privilege('derya_app', 'public."OutreachCampaignFollowUp"', 'TRIGGER') THEN
      RAISE EXCEPTION 'derya_app has excessive privileges on public.OutreachCampaignFollowUp';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260901000500_outreach_campaign_follow_ups'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'outreach campaign follow-up migration is not recorded as applied';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260901000500_outreach_campaign_follow_ups',
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'campaigns_with_follow_ups', (
    SELECT count(*)
    FROM public."OutreachCampaign"
    WHERE "followUps" IS NOT NULL
  ),
  'outreach_campaign_follow_ups', (SELECT count(*) FROM public."OutreachCampaignFollowUp"),
  'cross_office_follow_ups', (
    SELECT count(*)
    FROM public."OutreachCampaignFollowUp" follow_up
    JOIN public."OutreachCampaign" campaign ON campaign."id" = follow_up."campaignId"
    WHERE campaign."officeId" <> follow_up."officeId"
  )
) AS verification;

ROLLBACK;
