\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  index_name text;
  table_name_var text;
BEGIN
  IF to_regclass('public."OutreachCampaign"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign table is missing';
  END IF;

  IF to_regclass('public."OutreachCampaignSend"') IS NULL THEN
    RAISE EXCEPTION 'outreach campaign send table is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260901000100_outreach_campaigns'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'outreach campaigns migration is not recorded as applied';
  END IF;

  FOREACH index_name IN ARRAY ARRAY[
    'OutreachCampaign_officeId_name_key',
    'OutreachCampaign_id_officeId_key',
    'OutreachCampaign_officeId_status_idx',
    'OutreachCampaignSend_campaignId_recordId_key',
    'OutreachCampaignSend_officeId_campaignId_status_idx',
    'OutreachCampaignSend_officeId_sentAt_idx'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class index_class
      JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
      JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
      WHERE index_schema.nspname = 'public'
        AND index_class.relname = index_name
        AND index_state.indisvalid
        AND index_state.indisready
    ) THEN
      RAISE EXCEPTION 'outreach campaign index % is missing or invalid', index_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_class.relname = 'OutreachCampaign_officeId_name_key'
      AND index_state.indisunique
      AND index_state.indisvalid
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_class.relname = 'OutreachCampaign_id_officeId_key'
      AND index_state.indisunique
      AND index_state.indisvalid
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_class.relname = 'OutreachCampaignSend_campaignId_recordId_key'
      AND index_state.indisunique
      AND index_state.indisvalid
  ) THEN
    RAISE EXCEPTION 'outreach campaign unique indexes are missing or invalid';
  END IF;

  FOREACH table_name_var IN ARRAY ARRAY['OutreachCampaign', 'OutreachCampaignSend'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = table_name_var
        AND column_name = 'officeId'
        AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'outreach table % is missing required office scoping', table_name_var;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaign"'::regclass
      AND conname = 'OutreachCampaign_officeId_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'outreach campaign office foreign key is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaign"'::regclass
      AND conname = 'OutreachCampaign_listId_officeId_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'outreach campaign research list foreign key is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignSend"'::regclass
      AND conname = 'OutreachCampaignSend_officeId_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'outreach campaign send office foreign key is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."OutreachCampaignSend"'::regclass
      AND conname = 'OutreachCampaignSend_campaignId_officeId_fkey'
      AND contype = 'f'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'outreach campaign send tenant foreign key is missing or invalid';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    RAISE EXCEPTION 'derya_app role is missing';
  END IF;

  IF NOT has_table_privilege('derya_app', 'public."OutreachCampaign"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaign"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaign"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaign"', 'DELETE')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'DELETE') THEN
    RAISE EXCEPTION 'derya_app is missing required outreach campaign table privileges';
  END IF;

  IF has_table_privilege('derya_app', 'public."OutreachCampaign"', 'TRUNCATE')
    OR has_table_privilege('derya_app', 'public."OutreachCampaign"', 'REFERENCES')
    OR has_table_privilege('derya_app', 'public."OutreachCampaign"', 'TRIGGER')
    OR has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'TRUNCATE')
    OR has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'REFERENCES')
    OR has_table_privilege('derya_app', 'public."OutreachCampaignSend"', 'TRIGGER') THEN
    RAISE EXCEPTION 'derya_app has excessive outreach campaign table privileges';
  END IF;

  IF has_schema_privilege('derya_app', 'public', 'CREATE')
    OR has_database_privilege('derya_app', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'derya_app can create objects in the public schema or database';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260901000100_outreach_campaigns',
  'outreach_campaigns', (SELECT count(*) FROM public."OutreachCampaign"),
  'outreach_campaign_sends', (SELECT count(*) FROM public."OutreachCampaignSend")
) AS verification;

ROLLBACK;
