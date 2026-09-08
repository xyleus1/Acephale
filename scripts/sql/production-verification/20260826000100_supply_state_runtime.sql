BEGIN READ ONLY;

DO $$
DECLARE
  invalid_workspace_scope bigint;
  invalid_reference_scope bigint;
  dashboard_role text := 'dashboard_api';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260826000100_supply_state_runtime'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Supply state runtime migration is not recorded as applied';
  END IF;

  IF to_regclass('public."SupplyStateProjection"') IS NULL
    OR to_regclass('public."SupplyStateRead"') IS NULL THEN
    RAISE EXCEPTION 'Supply state runtime tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'SupplyDecision' AND column_name = 'stateReadId'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'SupplyCapabilityRun' AND column_name = 'stateReadId'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'SupplyExecutionTask' AND column_name = 'stateReadId'
  ) THEN
    RAISE EXCEPTION 'Supply state read reference columns are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conname IN (
      'SupplyStateProjection_officeId_fkey',
      'SupplyStateProjection_workspaceId_fkey',
      'SupplyStateRead_officeId_fkey',
      'SupplyStateRead_workspaceId_fkey',
      'SupplyCapabilityRun_stateReadId_fkey',
      'SupplyDecision_stateReadId_fkey',
      'SupplyExecutionTask_stateReadId_fkey'
    )
      AND contype = 'f'
      AND convalidated
  ) <> 7 THEN
    RAISE EXCEPTION 'Supply state runtime foreign keys are missing or not validated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public."SupplyStateRead"'::regclass
      AND tgname = 'SupplyStateRead_immutable_guard'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Supply state reads are missing the immutability trigger';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgname IN (
      'SupplyStateProjection_workspace_scope_guard',
      'SupplyStateRead_workspace_scope_guard'
    )
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) <> 2 THEN
    RAISE EXCEPTION 'Supply state rows are missing enabled workspace scope guards';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgname IN (
      'SupplyCapabilityRun_state_read_scope_guard',
      'SupplyDecision_state_read_scope_guard',
      'SupplyExecutionTask_state_read_scope_guard',
      'SupplyCapabilityRun_state_read_immutable_guard',
      'SupplyDecision_state_read_immutable_guard',
      'SupplyExecutionTask_state_read_immutable_guard'
    )
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) <> 6 THEN
    RAISE EXCEPTION 'Supply state read references are missing enabled scope or immutability guards';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgname IN (
      'SupplyDecision_state_projection_invalidate',
      'SupplyApproval_state_projection_invalidate',
      'SupplyExecutionTask_state_projection_invalidate',
      'SupplyExecutionEvent_state_projection_invalidate'
    )
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) <> 4 THEN
    RAISE EXCEPTION 'Supply workspace control projections are missing enabled invalidation triggers';
  END IF;

  SELECT
    (SELECT count(*)
     FROM public."SupplyStateProjection" projection
     JOIN public."SupplyWorkspace" workspace ON workspace.id = projection."workspaceId"
     WHERE projection."workspaceId" IS NOT NULL
       AND workspace."officeId" <> projection."officeId")
    +
    (SELECT count(*)
     FROM public."SupplyStateRead" state_read
     JOIN public."SupplyWorkspace" workspace ON workspace.id = state_read."workspaceId"
     WHERE state_read."workspaceId" IS NOT NULL
       AND workspace."officeId" <> state_read."officeId")
  INTO invalid_workspace_scope;

  IF invalid_workspace_scope <> 0 THEN
    RAISE EXCEPTION 'Supply state rows cross office and workspace scope';
  END IF;

  SELECT
    (SELECT count(*)
     FROM public."SupplyDecision" decision
     JOIN public."SupplyStateRead" state_read ON state_read.id = decision."stateReadId"
     WHERE decision."officeId" <> state_read."officeId"
       OR decision."workspaceId" IS DISTINCT FROM state_read."workspaceId")
    +
    (SELECT count(*)
     FROM public."SupplyCapabilityRun" run
     JOIN public."SupplyStateRead" state_read ON state_read.id = run."stateReadId"
     WHERE run."officeId" <> state_read."officeId"
       OR run."workspaceId" IS DISTINCT FROM state_read."workspaceId")
    +
    (SELECT count(*)
     FROM public."SupplyExecutionTask" task
     JOIN public."SupplyStateRead" state_read ON state_read.id = task."stateReadId"
     WHERE task."officeId" <> state_read."officeId"
       OR task."workspaceId" IS DISTINCT FROM state_read."workspaceId")
  INTO invalid_reference_scope;

  IF invalid_reference_scope <> 0 THEN
    RAISE EXCEPTION 'Durable Supply OS rows reference state reads outside their scope';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') AND (
    NOT has_table_privilege('derya_app', 'public."SupplyStateProjection"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."SupplyStateProjection"', 'INSERT')
    OR NOT has_table_privilege('derya_app', 'public."SupplyStateProjection"', 'UPDATE')
    OR NOT has_table_privilege('derya_app', 'public."SupplyStateProjection"', 'DELETE')
    OR NOT has_table_privilege('derya_app', 'public."SupplyStateRead"', 'SELECT')
    OR NOT has_table_privilege('derya_app', 'public."SupplyStateRead"', 'INSERT')
    OR has_table_privilege('derya_app', 'public."SupplyStateRead"', 'UPDATE')
    OR has_table_privilege('derya_app', 'public."SupplyStateRead"', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'derya_app Supply state runtime privileges violate the immutable-read contract';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = dashboard_role) AND (
    has_table_privilege(dashboard_role, 'public."SupplyStateProjection"', 'SELECT')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateProjection"', 'INSERT')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateProjection"', 'UPDATE')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateProjection"', 'DELETE')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateRead"', 'SELECT')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateRead"', 'INSERT')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateRead"', 'UPDATE')
    OR has_table_privilege(dashboard_role, 'public."SupplyStateRead"', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'dashboard_api received application-owned Supply state runtime privileges';
  END IF;
END
$$;

COMMIT;
