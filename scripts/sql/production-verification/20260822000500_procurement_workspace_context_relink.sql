\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  expected_order_count INTEGER;
  ledger_count INTEGER;
  outbound_count INTEGER;
  inbound_count INTEGER;
  bay_area_outbound_count INTEGER;
  bay_area_inbound_count INTEGER;
BEGIN
  IF to_regclass('public."ProcurementOrder"') IS NULL
    OR to_regclass('public."CompanyWorkflowAccount"') IS NULL
    OR to_regclass('public."Company"') IS NULL
    OR to_regclass('public."SupplyWorkspace"') IS NULL
    OR to_regclass('public.procurement_communication_messages') IS NULL THEN
    RAISE EXCEPTION 'procurement workspace or communication schema is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000500_procurement_workspace_context_relink'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'procurement workspace relink migration is not recorded as applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyWorkflowAccount" AS account
    JOIN public."Company" AS company
      ON company.id = account.company_id
     AND company."officeId" = account.office_id
    JOIN public."SupplyWorkspace" AS workspace
      ON workspace."officeId" = account.office_id
     AND workspace."companyId" = account.company_id
    WHERE account.id = 'e784e4d9-97a8-496d-8705-c99eba8e86df'::uuid
      AND company.id = 'cmt1rgt7x0004rn8t2txf0ypz'
      AND company.name = 'HypnoDreamz'
      AND workspace.id = 'cmt1rgth70006rn8tvneq4dha'
      AND workspace.status = 'ACTIVE'
      AND workspace."archivedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'HypnoDreamz active workspace mapping is missing';
  END IF;

  SELECT count(*)
  INTO expected_order_count
  FROM public."ProcurementOrder"
  WHERE id IN (
      '24cb31bd-d974-4040-939c-cd8e76dd8967'::uuid,
      'e3f6cacc-ca34-4d01-a787-c09da6805bce'::uuid
    )
    AND customer_id = 'e784e4d9-97a8-496d-8705-c99eba8e86df'::uuid
    AND request_context #>> '{source,system}' = 'Derya Supply OS'
    AND request_context #>> '{source,campaign}' = 'CUSTOM'
    AND request_context #>> '{source,workspace_id}' = 'cmt1rgth70006rn8tvneq4dha'
    AND request_context #>> '{source,legacy_workspace_id}' = 'cmszhzq3c0003l804g5qf9yv8'
    AND request_context #>> '{source,company_name}' = 'HypnoDreamz';

  IF expected_order_count <> 2 THEN
    RAISE EXCEPTION 'expected HypnoDreamz procurement orders were not relinked';
  END IF;

  IF EXISTS (
    WITH active_workspace_candidates AS (
      SELECT
        account.id AS customer_id,
        workspace.id AS workspace_id,
        count(*) OVER (PARTITION BY account.id) AS active_workspace_count
      FROM public."CompanyWorkflowAccount" AS account
      JOIN public."Company" AS company
        ON company.id = account.company_id
       AND company."officeId" = account.office_id
      JOIN public."SupplyWorkspace" AS workspace
        ON workspace."officeId" = account.office_id
       AND workspace."companyId" = account.company_id
       AND workspace.status = 'ACTIVE'
       AND workspace."archivedAt" IS NULL
    )
    SELECT 1
    FROM public."ProcurementOrder" AS procurement_order
    JOIN active_workspace_candidates AS candidate
      ON candidate.customer_id = procurement_order.customer_id
     AND candidate.active_workspace_count = 1
    LEFT JOIN public."SupplyWorkspace" AS original_workspace
      ON original_workspace.id = procurement_order.request_context #>> '{source,workspace_id}'
    WHERE jsonb_typeof(procurement_order.request_context -> 'source') = 'object'
      AND procurement_order.request_context #>> '{source,system}' = 'Derya Supply OS'
      AND procurement_order.request_context #>> '{source,campaign}' = 'CUSTOM'
      AND nullif(procurement_order.request_context #>> '{source,workspace_id}', '') IS NOT NULL
      AND original_workspace.id IS NULL
      AND procurement_order.request_context #>> '{source,workspace_id}' <> candidate.workspace_id
  ) THEN
    RAISE EXCEPTION 'eligible procurement workspace relink candidates remain';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE direction = 'OUTBOUND'),
    count(*) FILTER (WHERE direction = 'INBOUND')
  INTO ledger_count, outbound_count, inbound_count
  FROM public.procurement_communication_messages
  WHERE customer_id = 'e784e4d9-97a8-496d-8705-c99eba8e86df'::uuid
    AND order_id IN (
      '24cb31bd-d974-4040-939c-cd8e76dd8967'::uuid,
      'e3f6cacc-ca34-4d01-a787-c09da6805bce'::uuid
    );

  IF ledger_count <> 9 OR outbound_count <> 7 OR inbound_count <> 2 THEN
    RAISE EXCEPTION 'Bourne communication ledger totals changed during relink';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE direction = 'OUTBOUND'
        AND sent_at = TIMESTAMPTZ '2026-08-19 09:04:33+00'
    ),
    count(*) FILTER (
      WHERE direction = 'INBOUND'
        AND sent_at = TIMESTAMPTZ '2026-08-19 17:15:20+00'
    )
  INTO bay_area_outbound_count, bay_area_inbound_count
  FROM public.procurement_communication_messages
  WHERE customer_id = 'e784e4d9-97a8-496d-8705-c99eba8e86df'::uuid
    AND order_id = '24cb31bd-d974-4040-939c-cd8e76dd8967'::uuid
    AND vendor_id = 'c01a827c-e736-475e-a085-e7e665035af9'::uuid;

  IF bay_area_outbound_count <> 1 OR bay_area_inbound_count <> 1 THEN
    RAISE EXCEPTION 'Bay Area Circuits verification pair changed during relink';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000500_procurement_workspace_context_relink',
  'workspace_id', 'cmt1rgth70006rn8tvneq4dha',
  'relinked_order_count', count(DISTINCT communication.order_id),
  'message_count', count(*),
  'outbound_count', count(*) FILTER (WHERE communication.direction = 'OUTBOUND'),
  'inbound_count', count(*) FILTER (WHERE communication.direction = 'INBOUND')
) AS verification
FROM public.procurement_communication_messages AS communication
WHERE communication.customer_id = 'e784e4d9-97a8-496d-8705-c99eba8e86df'::uuid
  AND communication.order_id IN (
    '24cb31bd-d974-4040-939c-cd8e76dd8967'::uuid,
    'e3f6cacc-ca34-4d01-a787-c09da6805bce'::uuid
  );

COMMIT;
