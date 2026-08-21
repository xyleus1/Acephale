\set ON_ERROR_STOP on

-- The procurement schema is now part of the canonical migration chain. This
-- file remains as a CI assertion so tests cannot silently rebuild a second,
-- conflicting customer and item schema.
DO $$
BEGIN
  IF to_regclass('public."CompanyWorkflowAccount"') IS NULL
    OR to_regclass('public."Item"') IS NULL
    OR to_regclass('public."ProcurementOrder"') IS NULL
    OR to_regclass('public."OrderSupplier"') IS NULL
    OR to_regclass('public."ProcurementRequestKey"') IS NULL
    OR to_regclass('public."Supplier"') IS NULL
    OR to_regclass('public."CompanySupplier"') IS NULL
    OR to_regclass('public."CompanyContext"') IS NULL THEN
    RAISE EXCEPTION 'canonical procurement schema is incomplete';
  END IF;
  IF to_regclass('public.customers') IS NULL
    OR to_regclass('public.bill_of_materials') IS NULL
    OR to_regclass('public.orders') IS NULL
    OR to_regclass('public.order_vendors') IS NULL
    OR to_regclass('public.procurement_api_idempotency') IS NULL THEN
    RAISE EXCEPTION 'procurement compatibility views are incomplete';
  END IF;
END
$$;
