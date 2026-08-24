\set ON_ERROR_STOP on

-- Run after Prisma migrations, as the Neon database owner. The password is a
-- psql variable so it never needs to be committed:
--
-- psql "$OWNER_DATABASE_URL" \
--   --set=derya_app_password='generated-secret' \
--   --file=scripts/sql/derya-app-role.sql

SELECT format(
  'CREATE ROLE derya_app LOGIN NOINHERIT PASSWORD %L',
  :'derya_app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'derya_app'
) \gexec

ALTER ROLE derya_app LOGIN PASSWORD :'derya_app_password';
ALTER ROLE derya_app SET statement_timeout = '30s';
ALTER ROLE derya_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE derya_app NOINHERIT;

GRANT CONNECT ON DATABASE :"DBNAME" TO derya_app;
GRANT USAGE ON SCHEMA public TO derya_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM derya_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM derya_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM derya_app;

-- Keep this list explicit. A naming convention is not a security boundary.
-- Every entry is a Prisma model table used by the application runtime. Lowercase
-- workflow tables and _prisma_migrations are deliberately excluded.
DO $$
DECLARE
  app_table text;
  app_tables text[] := ARRAY[
    'Office', 'SavedView', 'CategoryOption', 'User', 'Company', 'Contact',
    'OutreachPlanItem', 'CompanyOwner', 'Activity', 'Quote', 'AssignmentChange',
    'AuditLog', 'Event', 'BackgroundJob', 'KnowledgeSource', 'KnowledgeObject',
    'KnowledgeChunk', 'EntityMention', 'MemoryEvent', 'AgentMemory',
    'MarketSignal', 'MarketSignalLink', 'MarketImpactReview',
    'MarketSignalFeedback', 'MarketIngestionRun', 'Task',
    'RiskAlert', 'CompanyContext', 'Item', 'Supplier', 'CompanySupplier',
    'LaneRate', 'Inquiry',
    'TargetPriceHistory', 'CarrierQuote', 'Forwarder', 'ForwarderRequestDraft',
    'LoadSecurityCheck', 'Carrier', 'CarrierChecklistItem', 'CarrierBid',
    'TruckloadQuote', 'ShipmentRecord', 'Job', 'AgentProposal',
    'StrategyAssessment', 'RouteOption', 'PriceRecommendation', 'RiskAssessment',
    'StrategyAction', 'JobDocument', 'JobMilestone', 'EmailAccount',
    'EmailThread', 'EmailMessage', 'EmailSenderReservation', 'LoginCode', 'CustomerPortalUser',
    'CustomerPortalLoginThrottle',
    'CustomerPortalMembership', 'CustomerPortalLoginCode', 'CustomerPortalAction',
    'SupplyWorkspace', 'SupplyWorkspaceMember', 'ConnectorInstallation',
    'SupplyImportRun', 'SupplySnapshot', 'SupplyLocation', 'SupplyItem',
    'SupplyItemAlias', 'SupplyBomVersion', 'SupplyBomLine',
    'SupplyInventoryPosition', 'SupplyDemand', 'SupplySupplierTerm',
    'SupplySupplierProfile', 'SupplyProfileFact', 'SupplyBenchmarkSeries',
    'SupplyPriceObservation', 'SupplyEquivalenceRule', 'SupplyFccProfile',
    'SupplyPlanningResult', 'SupplyMediaAsset', 'SupplyEvidence',
    'SupplyCapabilityRun', 'SupplyDecision', 'SupplyScenario',
    'SupplyScenarioComparison', 'SupplyDecisionEvidence', 'SupplyScenarioEvidence',
    'SupplyApproval', 'SupplyExecutionTask', 'SupplyExecutionEvent'
  ];
BEGIN
  FOREACH app_table IN ARRAY app_tables LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN
      RAISE EXCEPTION 'required application table public.% is missing', app_table;
    END IF;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO derya_app',
      app_table
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  workflow_table text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'derya_app'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR NOT rolcanlogin
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    JOIN pg_roles ON pg_roles.oid = pg_auth_members.member
    WHERE pg_roles.rolname = 'derya_app'
  ) THEN
    RAISE EXCEPTION 'derya_app has unsafe role attributes or memberships';
  END IF;

  IF NOT has_table_privilege('derya_app', 'public."Office"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."User"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."Company"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."SupplyWorkspace"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."CustomerPortalLoginThrottle"', 'DELETE') THEN
    RAISE EXCEPTION 'derya_app is missing required application table privileges';
  END IF;

  IF has_schema_privilege('derya_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'derya_app can create objects in the public schema';
  END IF;

  FOREACH workflow_table IN ARRAY ARRAY[
    'CompanyWorkflowAccount', 'ProcurementOrder', 'OrderSupplier',
    'ProcurementRequestKey', 'customers', 'bill_of_materials', 'orders',
    'order_vendors', 'procurement_api_idempotency',
    'procurement_communication_messages', 'procurement_sources', 'supplier_memory'
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', workflow_table)) IS NULL;
    IF has_table_privilege('derya_app', format('public.%I', workflow_table), 'SELECT')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'INSERT')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'UPDATE')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'DELETE')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'TRUNCATE')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'REFERENCES')
      OR has_table_privilege('derya_app', format('public.%I', workflow_table), 'TRIGGER') THEN
      RAISE EXCEPTION 'derya_app can access workflow-owned table %', workflow_table;
    END IF;
  END LOOP;
END
$$;
