-- Relink orphaned CUSTOM order routing without changing operational records.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
BEGIN
  IF to_regclass('public."ProcurementOrder"') IS NULL
    OR to_regclass('public."CompanyWorkflowAccount"') IS NULL
    OR to_regclass('public."Company"') IS NULL
    OR to_regclass('public."SupplyWorkspace"') IS NULL THEN
    RAISE EXCEPTION 'required procurement workspace schema is missing';
  END IF;

  WITH active_workspace_candidates AS (
    SELECT
      account.id AS customer_id,
      workspace.id AS workspace_id,
      company.name AS company_name,
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
  ), orphaned_orders AS (
    SELECT
      procurement_order.id,
      procurement_order.request_context #>> '{source,workspace_id}' AS original_workspace_id,
      candidate.workspace_id,
      candidate.company_name
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
  )
  UPDATE public."ProcurementOrder" AS procurement_order
  SET request_context = jsonb_set(
    jsonb_set(
      CASE
        WHEN procurement_order.request_context #>> '{source,legacy_workspace_id}' IS NULL
          THEN jsonb_set(
            procurement_order.request_context,
            '{source,legacy_workspace_id}',
            to_jsonb(orphaned_order.original_workspace_id),
            true
          )
        ELSE procurement_order.request_context
      END,
      '{source,workspace_id}',
      to_jsonb(orphaned_order.workspace_id),
      true
    ),
    '{source,company_name}',
    to_jsonb(orphaned_order.company_name),
    true
  )
  FROM orphaned_orders AS orphaned_order
  WHERE procurement_order.id = orphaned_order.id;

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
END
$migration$;

COMMIT;
