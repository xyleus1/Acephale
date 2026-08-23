\set ON_ERROR_STOP on

INSERT INTO public."SupplyWorkspace" (
  id, "officeId", "companyId", name, status, "createdAt", "updatedAt"
) VALUES (
  'workspace-relink-current',
  'legacy-office',
  'legacy-company',
  'Current HypnoDreamz workspace',
  'ACTIVE',
  now(),
  now()
);

INSERT INTO public."Company" (
  id, "officeId", name, status, "createdAt", "updatedAt"
) VALUES (
  'workspace-relink-ambiguous-company',
  'legacy-office',
  'Ambiguous workspace company',
  'IN_PROGRESS',
  now(),
  now()
);

INSERT INTO public."CompanyWorkflowAccount" (
  id, office_id, company_id, name, created_at, updated_at
) VALUES (
  '97979797-9797-4797-8797-979797979797',
  'legacy-office',
  'workspace-relink-ambiguous-company',
  'Ambiguous workspace company',
  now(),
  now()
);

INSERT INTO public."SupplyWorkspace" (
  id, "officeId", "companyId", name, status, "createdAt", "updatedAt"
) VALUES
  (
    'workspace-relink-ambiguous-a',
    'legacy-office',
    'workspace-relink-ambiguous-company',
    'Ambiguous workspace A',
    'ACTIVE',
    now(),
    now()
  ),
  (
    'workspace-relink-ambiguous-b',
    'legacy-office',
    'workspace-relink-ambiguous-company',
    'Ambiguous workspace B',
    'ACTIVE',
    now(),
    now()
  );

INSERT INTO public."Item" (
  id, office_id, company_id, customer_id, material, created_at, updated_at
) VALUES (
  '98989898-9898-4898-8898-989898989898',
  'legacy-office',
  'workspace-relink-ambiguous-company',
  '97979797-9797-4797-8797-979797979797',
  'Ambiguous workspace fixture item',
  now(),
  now()
);

INSERT INTO public."ProcurementOrder" (
  id, customer_id, bom_id, quantity, unit, request_context, status,
  created_at, updated_at
) VALUES
  (
    '91919191-9191-4191-8191-919191919191',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    1,
    'unit',
    '{"source":{"system":"Derya Supply OS","campaign":"CUSTOM","workspace_id":"workspace-relink-retired","company_name":"Dreamz","request_id":"keep-me"}}'::jsonb,
    'sourcing',
    '2026-08-01 00:00:00+00',
    '2026-08-01 00:00:00+00'
  ),
  (
    '92929292-9292-4292-8292-929292929292',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    1,
    'unit',
    '{"source":{"system":"Derya Supply OS","campaign":"GUILD2","workspace_id":"workspace-relink-retired"}}'::jsonb,
    'sourcing',
    '2026-08-01 00:00:00+00',
    '2026-08-01 00:00:00+00'
  ),
  (
    '93939393-9393-4393-8393-939393939393',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    1,
    'unit',
    '{"source":{"system":"Derya Supply OS","campaign":"CUSTOM"}}'::jsonb,
    'sourcing',
    '2026-08-01 00:00:00+00',
    '2026-08-01 00:00:00+00'
  ),
  (
    '94949494-9494-4494-8494-949494949494',
    '97979797-9797-4797-8797-979797979797',
    '98989898-9898-4898-8898-989898989898',
    1,
    'unit',
    '{"source":{"system":"Derya Supply OS","campaign":"CUSTOM","workspace_id":"workspace-relink-ambiguous-retired"}}'::jsonb,
    'sourcing',
    '2026-08-01 00:00:00+00',
    '2026-08-01 00:00:00+00'
  ),
  (
    '95959595-9595-4595-8595-959595959595',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    1,
    'unit',
    '{"source":{"system":"Derya Supply OS","campaign":"CUSTOM","workspace_id":"workspace-relink-retired-again","legacy_workspace_id":"first-retired"}}'::jsonb,
    'sourcing',
    '2026-08-01 00:00:00+00',
    '2026-08-01 00:00:00+00'
  );
