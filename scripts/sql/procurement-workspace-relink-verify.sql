\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ProcurementOrder"
    WHERE id = '91919191-9191-4191-8191-919191919191'::uuid
      AND request_context #>> '{source,workspace_id}' = 'workspace-relink-current'
      AND request_context #>> '{source,legacy_workspace_id}' = 'workspace-relink-retired'
      AND request_context #>> '{source,company_name}' = 'HypnoDreamz'
      AND request_context #>> '{source,request_id}' = 'keep-me'
      AND updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
  ) THEN
    RAISE EXCEPTION 'eligible workspace order was not safely relinked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."ProcurementOrder"
    WHERE id = '95959595-9595-4595-8595-959595959595'::uuid
      AND request_context #>> '{source,workspace_id}' = 'workspace-relink-current'
      AND request_context #>> '{source,legacy_workspace_id}' = 'first-retired'
      AND updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
  ) THEN
    RAISE EXCEPTION 'existing workspace provenance was overwritten';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."ProcurementOrder"
    WHERE id = '92929292-9292-4292-8292-929292929292'::uuid
      AND request_context #>> '{source,workspace_id}' = 'workspace-relink-retired'
      AND request_context #>> '{source,campaign}' = 'GUILD2'
      AND updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public."ProcurementOrder"
    WHERE id = '93939393-9393-4393-8393-939393939393'::uuid
      AND request_context #>> '{source,workspace_id}' IS NULL
      AND updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public."ProcurementOrder"
    WHERE id = '94949494-9494-4494-8494-949494949494'::uuid
      AND request_context #>> '{source,workspace_id}' = 'workspace-relink-ambiguous-retired'
      AND updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
  ) THEN
    RAISE EXCEPTION 'an unsafe or out-of-scope workspace order was relinked';
  END IF;

  IF (
    SELECT count(*)
    FROM public."ProcurementOrder"
    WHERE id IN (
      '91919191-9191-4191-8191-919191919191'::uuid,
      '95959595-9595-4595-8595-959595959595'::uuid
    )
      AND request_context #>> '{source,workspace_id}' = 'workspace-relink-current'
  ) <> 2 THEN
    RAISE EXCEPTION 'workspace relink is not idempotent';
  END IF;
END
$$;
