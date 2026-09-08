CREATE VIEW public.procurement_customer_scope
WITH (security_barrier = true)
AS
SELECT
  account.id,
  account.office_id,
  account.company_id
FROM public."CompanyWorkflowAccount" AS account;

COMMENT ON VIEW public.procurement_customer_scope IS
  'Least-privilege dashboard_api lookup for exact procurement customer tenant and company scope.';

REVOKE ALL ON public.procurement_customer_scope FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    REVOKE ALL ON public.procurement_customer_scope FROM derya_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bourne_supply_chain') THEN
    REVOKE ALL ON public.procurement_customer_scope FROM bourne_supply_chain;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api') THEN
    REVOKE ALL ON public.procurement_customer_scope FROM dashboard_api;
    GRANT SELECT ON public.procurement_customer_scope TO dashboard_api;
  END IF;
END
$$;
