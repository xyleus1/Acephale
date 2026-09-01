\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  granted_table text;
BEGIN
  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name IN (
        '20260825000300_shared_mailbox_pool',
        '20260825000400_leadgen_attribution',
        '20260826000100_leadgen_usable_contact',
        '20260901000100_outreach_campaigns',
        '20260901000200_leadgen_outreach_app_grants'
      )
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 5 THEN
    RAISE EXCEPTION 'the pending lead gen, outreach, and grant migrations are not all recorded as applied';
  END IF;

  IF to_regclass('public."LeadGenRun"') IS NULL THEN
    RAISE EXCEPTION 'LeadGenRun is missing, so prospecting runs cannot be recorded';
  END IF;

  IF to_regclass('public."LeadDiscovery"') IS NULL THEN
    RAISE EXCEPTION 'LeadDiscovery is missing, so prospecting candidates cannot be recorded';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'LeadDiscovery'
      AND column_name = 'usableContact'
      AND is_nullable = 'NO'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'LeadDiscovery.usableContact is missing, nullable, or still carries a default';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."LeadGenRun"'::regclass
      AND conname = 'LeadGenRun_officeId_fkey'
      AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."LeadDiscovery"'::regclass
      AND conname = 'LeadDiscovery_officeId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'the lead gen tables lost their office tenant constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."LeadDiscovery"'::regclass
      AND conname = 'LeadDiscovery_runId_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'LeadDiscovery lost its run reference';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    FOREACH granted_table IN ARRAY ARRAY[
      'LeadGenRun',
      'LeadDiscovery',
      'OutreachCampaign',
      'OutreachCampaignSend'
    ] LOOP
      IF NOT has_table_privilege('derya_app', format('public.%I', granted_table), 'SELECT')
        OR NOT has_table_privilege('derya_app', format('public.%I', granted_table), 'INSERT')
        OR NOT has_table_privilege('derya_app', format('public.%I', granted_table), 'UPDATE')
        OR NOT has_table_privilege('derya_app', format('public.%I', granted_table), 'DELETE') THEN
        RAISE EXCEPTION 'derya_app cannot use public.%', granted_table;
      END IF;

      IF has_table_privilege('derya_app', format('public.%I', granted_table), 'TRUNCATE')
        OR has_table_privilege('derya_app', format('public.%I', granted_table), 'REFERENCES')
        OR has_table_privilege('derya_app', format('public.%I', granted_table), 'TRIGGER') THEN
        RAISE EXCEPTION 'derya_app has excessive privileges on public.%', granted_table;
      END IF;
    END LOOP;

    IF has_schema_privilege('derya_app', 'public', 'CREATE')
      OR has_database_privilege('derya_app', current_database(), 'CREATE') THEN
      RAISE EXCEPTION 'derya_app can create objects in the public schema or database';
    END IF;
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260901000200_leadgen_outreach_app_grants',
  'leadgen_runs', (SELECT count(*) FROM public."LeadGenRun"),
  'lead_discoveries', (SELECT count(*) FROM public."LeadDiscovery"),
  'orphan_discoveries', (
    SELECT count(*)
    FROM public."LeadDiscovery" discovery
    LEFT JOIN public."LeadGenRun" run ON run."id" = discovery."runId"
    WHERE discovery."runId" IS NOT NULL
      AND run."id" IS NULL
  ),
  'cross_office_discoveries', (
    SELECT count(*)
    FROM public."LeadDiscovery" discovery
    JOIN public."LeadGenRun" run ON run."id" = discovery."runId"
    WHERE run."officeId" <> discovery."officeId"
  ),
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'outreach_campaign_sends', (SELECT count(*) FROM public."OutreachCampaignSend")
) AS verification;

COMMIT;
