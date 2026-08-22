\set ON_ERROR_STOP on

SET ROLE legacy_bourne_worker;
UPDATE orders
SET attempt_count = attempt_count + 1,
    next_attempt_at = '2026-08-22T01:00:00Z',
    lease_until = '2026-08-22T01:05:00Z',
    worker_run_id = 'verified-run',
    last_error_code = 'verified-error',
    last_error_at = '2026-08-22T00:55:00Z',
    started_at = '2026-08-22T00:50:00Z',
    completed_at = '2026-08-22T01:10:00Z'
WHERE id = '33333333-3333-4333-8333-333333333333';
RESET ROLE;

SET ROLE legacy_bourne_column_worker;
UPDATE orders
SET attempt_count = attempt_count + 1,
    next_attempt_at = '2026-08-22T02:00:00Z',
    lease_until = '2026-08-22T02:05:00Z',
    worker_run_id = 'verified-column-run',
    last_error_code = 'verified-column-error',
    last_error_at = '2026-08-22T01:55:00Z',
    started_at = '2026-08-22T01:50:00Z',
    completed_at = '2026-08-22T02:10:00Z'
WHERE id = '33333333-3333-4333-8333-333333333333';
RESET ROLE;

DO $$
DECLARE relation_kind "char";
BEGIN
  IF to_regclass('public."CompanyDocument"') IS NOT NULL
    OR to_regclass('public."CrmOpportunity"') IS NOT NULL
    OR to_regclass('public."MarginProfile"') IS NOT NULL THEN
    RAISE EXCEPTION 'retired tables still exist';
  END IF;

  SELECT relkind INTO relation_kind FROM pg_class WHERE oid = 'public.customers'::regclass;
  IF relation_kind <> 'v' THEN
    RAISE EXCEPTION 'customers must be a compatibility view';
  END IF;

  IF (SELECT count(*) FROM "CompanyWorkflowAccount" WHERE company_id = 'legacy-company') <> 1
    OR (SELECT count(*) FROM "Item" WHERE company_id = 'legacy-company') <> 1
    OR (SELECT count(*) FROM "ProcurementOrder" WHERE notes = 'Keep exact request facts') <> 1
    OR (SELECT count(*) FROM "ProcurementRequestKey" WHERE idempotency_key = 'legacy-request') <> 1 THEN
    RAISE EXCEPTION 'workflow identity, item, order, or request key was not preserved';
  END IF;

  IF (SELECT count(*) FROM "Supplier" WHERE "officeId" = 'legacy-office') <> 1
    OR (SELECT count(*) FROM "CompanySupplier" WHERE "companyId" = 'legacy-company') <> 1
    OR (SELECT count(DISTINCT supplier_registry_id) FROM "OrderSupplier") <> 1 THEN
    RAISE EXCEPTION 'supplier identities were not normalized';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_vendors'
      AND column_name IN ('contact_name', 'contact_email', 'contact_phone', 'contact', 'identity')
  ) <> 5
    OR NOT EXISTS (
      SELECT 1
      FROM "OrderSupplier"
      WHERE id = '44444444-4444-4444-8444-444444444444'
        AND email = 'sales@acme.example'
        AND contact_name = 'Ada Buyer'
        AND contact_email = 'sales@acme.example'
        AND contact_phone = '+1 555 0100'
        AND contact->>'email' = 'sales@acme.example'
        AND identity->>'email' = 'sales@acme.example'
    ) OR NOT has_column_privilege(
      'dashboard_api', 'public.order_vendors', 'contact_email', 'SELECT'
    ) THEN
    RAISE EXCEPTION 'legacy supplier contact was not projected into the canonical contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CompanyContext"
    WHERE id = 'legacy-ordinary-document'
      AND "storageUrl" = 'https://files.example/invoice.pdf'
      AND payload->>'legacy_doc_type' = 'invoice'
  ) THEN
    RAISE EXCEPTION 'ordinary document storage reference was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CompanyContext"
    WHERE id = 'legacy-context-file'
      AND description = 'Legacy drawing summary'
      AND "processingState" = 'FAILED'
      AND "processingError" = 'Legacy parse error'
      AND markdown = '# Parsed drawing'
  ) THEN
    RAISE EXCEPTION 'parsed document explanation was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CompanyContext"
    WHERE id = 'legacy-context-message'
      AND kind = 'MESSAGE'
      AND markdown = 'Use the drawing.'
      AND payload->>'role' = 'AGENT'
      AND payload->'citations'->0->>'id' = 'document:legacy-context-file'
  ) THEN
    RAISE EXCEPTION 'message body or citations were not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CompanyContext"
    WHERE id = 'opportunity-legacy-opportunity'
      AND payload->>'stage' = 'qualified'
      AND payload->>'estimated_value' = '42000'
  ) THEN
    RAISE EXCEPTION 'opportunity context was not preserved';
  END IF;

  IF (SELECT "pricingTargetMarginPct" FROM "Office" WHERE id = 'legacy-office') <> 12.5
    OR (SELECT count(*) FROM "CompanyContext" WHERE id LIKE '%margin%') <> 0 THEN
    RAISE EXCEPTION 'active pricing target was not reduced to the Office policy field';
  END IF;

  IF (SELECT count(*) FROM "CompanyContext" WHERE id = 'customer-pref-11111111-1111-4111-8111-111111111111') <> 1
    OR (SELECT count(*) FROM "CompanyContext" WHERE id = 'item-pref-22222222-2222-4222-8222-222222222222' AND "itemId" IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'legacy soft preferences were not converted to scoped context';
  END IF;

  IF has_table_privilege('dashboard_api', 'public."ProcurementOrder"', 'SELECT')
    OR NOT has_table_privilege('dashboard_api', 'public.orders', 'SELECT')
    OR NOT has_column_privilege('dashboard_api', 'public.orders', 'customer_id', 'INSERT') THEN
    RAISE EXCEPTION 'dashboard role did not retain only its compatibility contract';
  END IF;

  IF NOT has_table_privilege('legacy_bourne_worker', 'public.orders', 'SELECT')
    OR NOT has_table_privilege('legacy_bourne_worker', 'public.orders', 'UPDATE')
    OR has_table_privilege('legacy_bourne_worker', 'public."ProcurementOrder"', 'SELECT')
    OR (
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name IN (
          'attempt_count', 'next_attempt_at', 'lease_until', 'worker_run_id',
          'last_error_code', 'last_error_at', 'started_at', 'completed_at'
        )
    ) <> 8
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'attempt_count', 'next_attempt_at', 'lease_until', 'worker_run_id',
        'last_error_code', 'last_error_at', 'started_at', 'completed_at'
      ]) AS column_name
      WHERE NOT has_column_privilege(
        'legacy_bourne_column_worker', 'public.orders', column_name, 'UPDATE'
      ) OR has_column_privilege(
        'legacy_bourne_column_worker', 'public."ProcurementOrder"', column_name, 'UPDATE'
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM orders
      WHERE id = '33333333-3333-4333-8333-333333333333'
        AND attempt_count = 4
        AND next_attempt_at = '2026-08-22T02:00:00Z'::timestamptz
        AND lease_until = '2026-08-22T02:05:00Z'::timestamptz
        AND worker_run_id = 'verified-column-run'
        AND last_error_code = 'verified-column-error'
        AND last_error_at = '2026-08-22T01:55:00Z'::timestamptz
        AND started_at = '2026-08-22T01:50:00Z'::timestamptz
        AND completed_at = '2026-08-22T02:10:00Z'::timestamptz
    ) THEN
    RAISE EXCEPTION 'Bourne role grants or reliability columns were not preserved';
  END IF;
END
$$;

SET ROLE legacy_bourne_worker;
INSERT INTO order_vendors (
  id, order_id, name, website, email, status, research
) VALUES (
  '12121212-1212-4212-8212-121212121212',
  '33333333-3333-4333-8333-333333333333',
  'Beta Parts',
  'https://beta.example',
  'QUOTES@BETA.EXAMPLE',
  'shortlisted',
  '{"identity":{"contact":{"name":"Grace Seller","phone":"+1 555 0101"}}}'::jsonb
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "OrderSupplier"
    WHERE id = '12121212-1212-4212-8212-121212121212'
      AND email = 'QUOTES@BETA.EXAMPLE'
      AND contact_name = 'Grace Seller'
      AND contact_email = 'quotes@beta.example'
      AND contact_phone = '+1 555 0101'
      AND contact->>'email' = 'quotes@beta.example'
      AND supplier_registry_id IS NOT NULL
  ) OR (
    SELECT count(*)
    FROM "CompanySupplier"
    WHERE "companyId" = 'legacy-company'
  ) <> 2 THEN
    RAISE EXCEPTION 'Bourne insert did not preserve legacy fields and canonical contacts';
  END IF;
END
$$;

INSERT INTO "Company" (id, "officeId", name, status, "createdAt", "updatedAt")
VALUES ('legacy-other-company', 'legacy-office', 'Other customer', 'IN_PROGRESS', now(), now());

INSERT INTO "Item" (
  id, office_id, company_id, material, created_at, updated_at
) VALUES (
  '66666666-6666-4666-8666-666666666666',
  'legacy-office',
  'legacy-other-company',
  'Other item',
  now(),
  now()
);

INSERT INTO "CompanyWorkflowAccount" (
  id, office_id, company_id, name, created_at, updated_at
) VALUES (
  '77777777-7777-4777-8777-777777777777',
  'legacy-office',
  'legacy-other-company',
  'Other customer',
  now(),
  now()
);

INSERT INTO "ProcurementOrder" (
  id, customer_id, bom_id, quantity, unit, status, created_at, updated_at
) VALUES (
  '88888888-8888-4888-8888-888888888888',
  '77777777-7777-4777-8777-777777777777',
  '66666666-6666-4666-8666-666666666666',
  1,
  'unit',
  'new',
  now(),
  now()
);

INSERT INTO "Office" (id, name, "createdAt", "updatedAt")
VALUES ('legacy-other-office', 'Other legacy office', now(), now());

INSERT INTO "Company" (id, "officeId", name, status, "createdAt", "updatedAt")
VALUES ('legacy-foreign-company', 'legacy-other-office', 'Foreign customer', 'IN_PROGRESS', now(), now());

INSERT INTO "User" (
  id, "officeId", email, "passwordHash", "fullName", role,
  "isActive", "canViewWholeOffice", "createdAt", "updatedAt"
) VALUES (
  'legacy-foreign-user',
  'legacy-other-office',
  'foreign-user@example.test',
  'not-used',
  'Foreign user',
  'ADMIN',
  true,
  true,
  now(),
  now()
);

INSERT INTO "Supplier" (
  id, "officeId", name, "normalizedName", status, "createdAt", "updatedAt"
) VALUES (
  '99999999-9999-4999-8999-999999999999',
  'legacy-other-office',
  'Foreign supplier',
  'foreign supplier',
  'UNVERIFIED',
  now(),
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "ProcurementOrder" (
      customer_id, bom_id, quantity, unit, status, created_at, updated_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      1,
      'unit',
      'new',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-company order was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-company order was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%outside the company scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "CompanyContext" (
      "officeId", "companyId", kind, name, "processingState"
    ) VALUES (
      'legacy-other-office',
      'legacy-company',
      'NOTE',
      'Invalid cross-office company context',
      'READY'
    );
    RAISE EXCEPTION 'cross-office company context was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office company context was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%company is outside the office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "Item" (
      id, office_id, company_id, material, created_at, updated_at
    ) VALUES (
      'aaaaaaaa-5555-4555-8555-555555555555',
      'legacy-other-office',
      'legacy-company',
      'Invalid cross-office item',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-office company item was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office company item was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%company is outside the office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "CompanyContext" (
      "officeId", "companyId", kind, name, "processingState", "createdByUserId"
    ) VALUES (
      'legacy-office',
      'legacy-company',
      'NOTE',
      'Invalid cross-office creator',
      'READY',
      'legacy-foreign-user'
    );
    RAISE EXCEPTION 'cross-office context creator was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office context creator was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%creator is outside the office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "Item" (
      id, office_id, company_id, customer_id, material, created_at, updated_at
    ) VALUES (
      'aaaaaaaa-1111-4111-8111-111111111111',
      'legacy-office',
      'legacy-company',
      '77777777-7777-4777-8777-777777777777',
      'Invalid workflow item',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-company item workflow account was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-company item workflow account was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%workflow account is outside the company scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "CompanySupplier" (
      id, "officeId", "companyId", "supplierId", status, "createdAt", "updatedAt"
    ) VALUES (
      'aaaaaaaa-2222-4222-8222-222222222222',
      'legacy-office',
      'legacy-company',
      '99999999-9999-4999-8999-999999999999',
      'CANDIDATE',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-office company supplier was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office company supplier was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%references cross office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "CompanyWorkflowAccount" (
      id, office_id, company_id, name, created_at, updated_at
    ) VALUES (
      'aaaaaaaa-3333-4333-8333-333333333333',
      'legacy-other-office',
      'legacy-company',
      'Invalid workflow account',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-office workflow account was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office workflow account was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%references cross office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "OrderSupplier" (
      id, order_id, supplier_registry_id, name, status, research, created_at, updated_at
    ) VALUES (
      'aaaaaaaa-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      '99999999-9999-4999-8999-999999999999',
      'Invalid foreign supplier',
      'candidate',
      '{}'::jsonb,
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-office order supplier was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-office order supplier was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%supplier is outside the order office scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "CompanyContext" (
      "officeId", "companyId", "itemId", kind, name, "processingState"
    ) VALUES (
      'legacy-office',
      'legacy-company',
      '66666666-6666-4666-8666-666666666666',
      'NOTE',
      'Invalid cross-company context',
      'READY'
    );
    RAISE EXCEPTION 'cross-company context was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-company context was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%outside the company scope%' THEN RAISE; END IF;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    UPDATE "ProcurementRequestKey"
    SET order_id = '88888888-8888-4888-8888-888888888888'
    WHERE customer_id = '11111111-1111-4111-8111-111111111111'
      AND idempotency_key = 'legacy-request';
    RAISE EXCEPTION 'cross-customer request key was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-customer request key was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%outside the customer scope%' THEN RAISE; END IF;
  END;
END
$$;

SELECT 'Populated legacy migration contract passed.' AS result;
