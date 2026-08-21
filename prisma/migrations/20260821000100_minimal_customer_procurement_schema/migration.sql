BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keep the worker contract available as views, but give every durable table one
-- clear job. Renames preserve rows, foreign keys, and external worker updates.
DO $$
BEGIN
  IF to_regclass('public."CompanyWorkflowAccount"') IS NULL
    AND to_regclass('public.customers') IS NOT NULL THEN
    ALTER TABLE customers RENAME TO "CompanyWorkflowAccount";
  END IF;
  IF to_regclass('public."Item"') IS NULL
    AND to_regclass('public.bill_of_materials') IS NOT NULL THEN
    ALTER TABLE bill_of_materials RENAME TO "Item";
  END IF;
  IF to_regclass('public."ProcurementOrder"') IS NULL
    AND to_regclass('public.orders') IS NOT NULL THEN
    ALTER TABLE orders RENAME TO "ProcurementOrder";
  END IF;
  IF to_regclass('public."OrderSupplier"') IS NULL
    AND to_regclass('public.order_vendors') IS NOT NULL THEN
    ALTER TABLE order_vendors RENAME TO "OrderSupplier";
  END IF;
  IF to_regclass('public."ProcurementRequestKey"') IS NULL
    AND to_regclass('public.procurement_api_idempotency') IS NOT NULL THEN
    ALTER TABLE procurement_api_idempotency RENAME TO "ProcurementRequestKey";
  END IF;
END
$$;

-- Preserve grants for every existing worker role before the renamed tables are
-- hidden behind their lowercase compatibility views. The live worker can have
-- a separate role from Derya's dashboard_api connection.
CREATE TEMP TABLE minimal_legacy_workflow_grants_20260821 ON COMMIT DROP AS
SELECT
  relation.relname AS canonical_name,
  CASE relation.relname
    WHEN 'CompanyWorkflowAccount' THEN 'customers'
    WHEN 'Item' THEN 'bill_of_materials'
    WHEN 'ProcurementOrder' THEN 'orders'
    WHEN 'OrderSupplier' THEN 'order_vendors'
    WHEN 'ProcurementRequestKey' THEN 'procurement_api_idempotency'
  END AS view_name,
  CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(relation.relacl) acl
WHERE namespace.nspname = 'public'
  AND relation.relname IN (
    'CompanyWorkflowAccount', 'Item', 'ProcurementOrder', 'OrderSupplier',
    'ProcurementRequestKey'
  )
  AND relation.relacl IS NOT NULL
  AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

CREATE TEMP TABLE minimal_legacy_workflow_column_grants_20260821 ON COMMIT DROP AS
SELECT
  relation.relname AS canonical_name,
  CASE relation.relname
    WHEN 'CompanyWorkflowAccount' THEN 'customers'
    WHEN 'Item' THEN 'bill_of_materials'
    WHEN 'ProcurementOrder' THEN 'orders'
    WHEN 'OrderSupplier' THEN 'order_vendors'
    WHEN 'ProcurementRequestKey' THEN 'procurement_api_idempotency'
  END AS view_name,
  CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type,
  attribute.attname AS column_name
FROM pg_attribute attribute
JOIN pg_class relation ON relation.oid = attribute.attrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
WHERE namespace.nspname = 'public'
  AND relation.relname IN (
    'CompanyWorkflowAccount', 'Item', 'ProcurementOrder', 'OrderSupplier',
    'ProcurementRequestKey'
  )
  AND attribute.attacl IS NOT NULL
  AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE');

CREATE TABLE IF NOT EXISTS "CompanyWorkflowAccount" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id TEXT,
  company_id TEXT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE "CompanyWorkflowAccount" ADD COLUMN IF NOT EXISTS office_id TEXT;
ALTER TABLE "CompanyWorkflowAccount" ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE "CompanyWorkflowAccount" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- The legacy worker customer must resolve to exactly one real Company. Refuse
-- the migration instead of guessing across tenants.
WITH unique_matches AS (
  SELECT account.id AS account_id, min(company.id) AS company_id
  FROM "CompanyWorkflowAccount" account
  JOIN "Company" company ON lower(trim(company.name)) = lower(trim(account.name))
  GROUP BY account.id
  HAVING count(*) = 1
)
UPDATE "CompanyWorkflowAccount" account
SET company_id = matched.company_id,
    office_id = company."officeId"
FROM unique_matches matched
JOIN "Company" company ON company.id = matched.company_id
WHERE account.id = matched.account_id
  AND (account.company_id IS NULL OR account.office_id IS NULL);

DO $$
DECLARE unresolved text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO unresolved
  FROM "CompanyWorkflowAccount"
  WHERE company_id IS NULL OR office_id IS NULL;
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Workflow customers do not map uniquely to Company: %', unresolved;
  END IF;
END
$$;

ALTER TABLE "CompanyWorkflowAccount" ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE "CompanyWorkflowAccount" ALTER COLUMN company_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyWorkflowAccount_company_id_key"
  ON "CompanyWorkflowAccount"(company_id);
CREATE INDEX IF NOT EXISTS "CompanyWorkflowAccount_office_id_name_idx"
  ON "CompanyWorkflowAccount"(office_id, name);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyWorkflowAccount_office_id_fkey') THEN
    ALTER TABLE "CompanyWorkflowAccount" ADD CONSTRAINT "CompanyWorkflowAccount_office_id_fkey"
      FOREIGN KEY (office_id) REFERENCES "Office"(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyWorkflowAccount_company_id_fkey') THEN
    ALTER TABLE "CompanyWorkflowAccount" ADD CONSTRAINT "CompanyWorkflowAccount_company_id_fkey"
      FOREIGN KEY (company_id) REFERENCES "Company"(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Item" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id TEXT NOT NULL REFERENCES "Office"(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES "CompanyWorkflowAccount"(id) ON DELETE SET NULL,
  material TEXT NOT NULL,
  sku TEXT,
  specification TEXT,
  "manufacturer" TEXT,
  "partNumber" TEXT,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS office_id TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "manufacturer" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "partNumber" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "Item" ALTER COLUMN customer_id DROP NOT NULL;

UPDATE "Item" item
SET office_id = account.office_id,
    company_id = account.company_id
FROM "CompanyWorkflowAccount" account
WHERE item.customer_id = account.id
  AND (item.office_id IS NULL OR item.company_id IS NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Item" WHERE office_id IS NULL OR company_id IS NULL) THEN
    RAISE EXCEPTION 'One or more items are not linked to a tenant-scoped Company';
  END IF;
END
$$;

ALTER TABLE "Item" ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE "Item" ALTER COLUMN company_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Item_company_id_sku_key" ON "Item"(company_id, sku);
CREATE INDEX IF NOT EXISTS "Item_office_id_company_id_material_idx" ON "Item"(office_id, company_id, material);
CREATE INDEX IF NOT EXISTS "Item_customer_id_idx" ON "Item"(customer_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Item_office_id_fkey') THEN
    ALTER TABLE "Item" ADD CONSTRAINT "Item_office_id_fkey"
      FOREIGN KEY (office_id) REFERENCES "Office"(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Item_company_id_fkey') THEN
    ALTER TABLE "Item" ADD CONSTRAINT "Item_company_id_fkey"
      FOREIGN KEY (company_id) REFERENCES "Company"(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Supplier" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "officeId" TEXT NOT NULL REFERENCES "Office"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  website TEXT,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "sourceRefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_officeId_normalizedName_key"
  ON "Supplier"("officeId", "normalizedName");
CREATE INDEX IF NOT EXISTS "Supplier_officeId_status_name_idx"
  ON "Supplier"("officeId", status, name);

CREATE TABLE IF NOT EXISTS "CompanySupplier" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "officeId" TEXT NOT NULL REFERENCES "Office"(id) ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  "supplierId" UUID NOT NULL REFERENCES "Supplier"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  notes TEXT,
  "sourceRefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompanySupplier_companyId_supplierId_key"
  ON "CompanySupplier"("companyId", "supplierId");
CREATE INDEX IF NOT EXISTS "CompanySupplier_officeId_companyId_status_idx"
  ON "CompanySupplier"("officeId", "companyId", status);
CREATE INDEX IF NOT EXISTS "CompanySupplier_officeId_supplierId_idx"
  ON "CompanySupplier"("officeId", "supplierId");

CREATE TABLE IF NOT EXISTS "CompanyContext" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "officeId" TEXT NOT NULL REFERENCES "Office"(id) ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  "itemId" UUID REFERENCES "Item"(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL DEFAULT 'DOCUMENT',
  name TEXT NOT NULL,
  description TEXT,
  "storageUrl" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "contentHash" TEXT,
  markdown TEXT,
  "processingState" TEXT DEFAULT 'READY',
  "processingError" TEXT,
  payload JSONB,
  "createdByUserId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyContext_officeId_companyId_contentHash_key"
  ON "CompanyContext"("officeId", "companyId", "contentHash");
CREATE INDEX IF NOT EXISTS "CompanyContext_officeId_companyId_itemId_kind_createdAt_idx"
  ON "CompanyContext"("officeId", "companyId", "itemId", kind, "createdAt");
CREATE INDEX IF NOT EXISTS "CompanyContext_officeId_companyId_processingState_createdAt_idx"
  ON "CompanyContext"("officeId", "companyId", "processingState", "createdAt");

CREATE TABLE IF NOT EXISTS "ProcurementOrder" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES "CompanyWorkflowAccount"(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES "Item"(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  needed_by DATE,
  notes TEXT,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  progress TEXT,
  approval_requested_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  decision_snapshot JSONB,
  gmail_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ProcurementOrder_customer_id_status_created_at_idx"
  ON "ProcurementOrder"(customer_id, status, created_at);
CREATE INDEX IF NOT EXISTS "ProcurementOrder_bom_id_idx" ON "ProcurementOrder"(bom_id);

CREATE TABLE IF NOT EXISTS "OrderSupplier" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES "ProcurementOrder"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact JSONB,
  identity JSONB,
  status TEXT NOT NULL,
  research JSONB NOT NULL DEFAULT '{}'::jsonb,
  quote JSONB,
  supplier_registry_id UUID,
  gmail_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE "OrderSupplier" ADD COLUMN IF NOT EXISTS supplier_registry_id UUID;
CREATE INDEX IF NOT EXISTS "OrderSupplier_order_id_status_idx" ON "OrderSupplier"(order_id, status);
CREATE INDEX IF NOT EXISTS "OrderSupplier_supplier_registry_id_idx" ON "OrderSupplier"(supplier_registry_id);

CREATE TABLE IF NOT EXISTS "ProcurementRequestKey" (
  customer_id UUID NOT NULL REFERENCES "CompanyWorkflowAccount"(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id UUID REFERENCES "ProcurementOrder"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key),
  CONSTRAINT "ProcurementRequestKey_key_length" CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT "ProcurementRequestKey_hash_length" CHECK (char_length(request_hash) = 64)
);
CREATE INDEX IF NOT EXISTS "ProcurementRequestKey_order_id_idx" ON "ProcurementRequestKey"(order_id);

-- Turn legacy soft preferences into ordinary, attributable company or item
-- context. No preference JSON remains on the hard-data tables.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CompanyWorkflowAccount'
      AND column_name = 'procurement_preferences'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "CompanyContext" (
        id, "officeId", "companyId", kind, name, description, markdown,
        "processingState", payload, "createdAt", "updatedAt"
      )
      SELECT
        'customer-pref-' || account.id::text,
        account.office_id,
        account.company_id,
        'NOTE',
        'Imported company procurement context',
        'Imported from the retired customer preference field.',
        '# Company procurement context' || E'\n\n' || jsonb_pretty(account.procurement_preferences),
        'READY',
        jsonb_build_object('source', 'customers.procurement_preferences'),
        account.created_at,
        account.updated_at
      FROM "CompanyWorkflowAccount" account
      WHERE account.procurement_preferences IS NOT NULL
        AND account.procurement_preferences <> '{}'::jsonb
      ON CONFLICT (id) DO NOTHING
    $sql$;
    ALTER TABLE "CompanyWorkflowAccount" DROP COLUMN procurement_preferences;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Item'
      AND column_name = 'procurement_preferences'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "CompanyContext" (
        id, "officeId", "companyId", "itemId", kind, name, description,
        markdown, "processingState", payload, "createdAt", "updatedAt"
      )
      SELECT
        'item-pref-' || item.id::text,
        item.office_id,
        item.company_id,
        item.id,
        'NOTE',
        'Imported item procurement context',
        'Imported from the retired item preference field.',
        '# Item procurement context' || E'\n\n' || jsonb_pretty(item.procurement_preferences),
        'READY',
        jsonb_build_object('source', 'bill_of_materials.procurement_preferences'),
        item.created_at,
        item.updated_at
      FROM "Item" item
      WHERE item.procurement_preferences IS NOT NULL
        AND item.procurement_preferences <> '{}'::jsonb
      ON CONFLICT (id) DO NOTHING
    $sql$;
    ALTER TABLE "Item" DROP COLUMN procurement_preferences;
  END IF;
END
$$;

-- Flatten the old CompanyDocument encoding into one structured context row per
-- original document, message, note, or action. Parsed Markdown joins its file.
CREATE FUNCTION minimal_context_safe_jsonb_20260821(value TEXT)
RETURNS JSONB AS $$
BEGIN
  RETURN COALESCE(value::jsonb, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::jsonb;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
BEGIN
  IF to_regclass('public."CompanyDocument"') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "CompanyContext" (
        id, "officeId", "companyId", kind, name, description, "storageUrl",
        "mimeType", "sizeBytes", "contentHash", markdown, "processingState",
        "processingError", payload, "createdByUserId", "createdAt", "updatedAt"
      )
      SELECT
        file.id,
        file."officeId",
        file."companyId",
        'DOCUMENT',
        file.name,
        processing.metadata->>'summary',
        file.url,
        replace(replace(split_part(substr(file."docType", 22), ':', 2), '%2F', '/'), '%2f', '/'),
        NULLIF(split_part(substr(file."docType", 22), ':', 3), '')::integer,
        split_part(substr(file."docType", 22), ':', 1),
        CASE
          WHEN position(E'\n-->\n' IN decoded.raw) > 0
          THEN split_part(decoded.raw, E'\n-->\n', 2)
          ELSE decoded.raw
        END,
        COALESCE(
          processing.metadata->>'state',
          NULLIF(reverse(split_part(reverse(parsed."docType"), ':', 1)), ''),
          'FAILED'
        ),
        processing.metadata->>'error',
        jsonb_build_object('source', 'CompanyDocument'),
        file."uploadedByUserId",
        file."createdAt",
        file."createdAt"
      FROM "CompanyDocument" file
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM "CompanyDocument" candidate
        WHERE candidate."docType" LIKE 'company_context_markdown:' || file.id || ':%'
        ORDER BY candidate."createdAt" DESC
        LIMIT 1
      ) parsed ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN parsed.url LIKE 'data:%;base64,%'
          THEN convert_from(decode(split_part(parsed.url, ',', 2), 'base64'), 'UTF8')
          ELSE NULL
        END AS raw
      ) decoded ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN decoded.raw LIKE '<!-- context-processing' || E'\n%'
          THEN minimal_context_safe_jsonb_20260821(
            split_part(split_part(decoded.raw, '<!-- context-processing' || E'\n', 2), E'\n-->', 1)
          )
          ELSE '{}'::jsonb
        END AS metadata
      ) processing ON true
      WHERE file."docType" LIKE 'company_context_file:%'
      ON CONFLICT (id) DO NOTHING
    $sql$;

    EXECUTE $sql$
      INSERT INTO "CompanyContext" (
        id, "officeId", "companyId", kind, name, "storageUrl", markdown,
        "processingState", payload, "createdByUserId", "createdAt", "updatedAt"
      )
      SELECT
        entry.id,
        entry."officeId",
        entry."companyId",
        CASE
          WHEN entry."docType" LIKE 'company_context_message:%' THEN 'MESSAGE'
          WHEN entry."docType" LIKE 'company_context_procurement:%' THEN 'ACTION'
          ELSE 'DOCUMENT'
        END,
        entry.name,
        CASE
          WHEN entry."docType" LIKE 'company_context_message:%'
            OR entry."docType" LIKE 'company_context_procurement:%'
          THEN NULL
          ELSE entry.url
        END,
        CASE
          WHEN entry."docType" LIKE 'company_context_message:%'
          THEN CASE
            WHEN position(E'\n\n<!-- context-citations\n' IN decoded.raw) > 0
            THEN split_part(decoded.raw, E'\n\n<!-- context-citations\n', 1)
            ELSE decoded.raw
          END
          ELSE NULL
        END,
        CASE
          WHEN entry."docType" LIKE 'company_context_procurement:%'
          THEN reverse(split_part(reverse(entry."docType"), ':', 1))
          ELSE 'READY'
        END,
        CASE
          WHEN entry."docType" LIKE 'company_context_message:%'
          THEN jsonb_build_object(
            'role', reverse(split_part(reverse(entry."docType"), ':', 1)),
            'citations', citation_data.citations
          )
          WHEN entry."docType" LIKE 'company_context_procurement:%'
            AND entry.url LIKE 'data:%;base64,%'
          THEN convert_from(decode(split_part(entry.url, ',', 2), 'base64'), 'UTF8')::jsonb
          ELSE jsonb_strip_nulls(jsonb_build_object(
            'source', 'CompanyDocument',
            'legacy_doc_type', entry."docType"
          ))
        END,
        entry."uploadedByUserId",
        entry."createdAt",
        entry."createdAt"
      FROM "CompanyDocument" entry
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN entry."docType" LIKE 'company_context_message:%'
            AND entry.url LIKE 'data:%;base64,%'
          THEN convert_from(decode(split_part(entry.url, ',', 2), 'base64'), 'UTF8')
          ELSE NULL
        END AS raw
      ) decoded ON true
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN position(E'\n\n<!-- context-citations\n' IN decoded.raw) > 0
          THEN minimal_context_safe_jsonb_20260821(
            split_part(
              split_part(decoded.raw, E'\n\n<!-- context-citations\n', 2),
              E'\n-->',
              1
            )
          )
          ELSE '[]'::jsonb
        END AS citations
      ) citation_data ON true
      WHERE entry."docType" IS NULL
        OR entry."docType" NOT LIKE 'company_context_file:%'
          AND entry."docType" NOT LIKE 'company_context_markdown:%'
          AND entry."docType" NOT LIKE 'company_context_upload_chunk:%'
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END
$$;

DROP FUNCTION minimal_context_safe_jsonb_20260821(TEXT);

-- Preserve old CRM opportunity content as company context before removing the
-- unused table and its unused foreign key columns.
DO $$
BEGIN
  IF to_regclass('public."CrmOpportunity"') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "CompanyContext" (
        id, "officeId", "companyId", kind, name, description, markdown,
        "processingState", payload, "createdByUserId", "createdAt", "updatedAt"
      )
      SELECT
        'opportunity-' || opportunity.id,
        opportunity."officeId",
        opportunity."companyId",
        'NOTE',
        opportunity.name,
        opportunity.notes,
        '# Imported opportunity' || E'\n\n'
          || '- Stage: ' || opportunity.stage || E'\n'
          || '- Priority: ' || opportunity.priority || E'\n'
          || CASE WHEN opportunity."nextAction" IS NULL THEN ''
            ELSE '- Next action: ' || opportunity."nextAction" || E'\n' END,
        'READY',
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'CrmOpportunity',
          'legacy_id', opportunity.id,
          'type', opportunity.type,
          'stage', opportunity.stage,
          'estimated_value', opportunity."estimatedValue",
          'currency', opportunity.currency,
          'likelihood', opportunity.likelihood,
          'priority', opportunity.priority,
          'next_action', opportunity."nextAction",
          'next_action_at', opportunity."nextActionAt",
          'source_name', opportunity.source,
          'source_refs', opportunity."sourceRefs",
          'brain_slug', opportunity."brainSlug",
          'contact_id', opportunity."contactId",
          'inquiry_id', opportunity."inquiryId"
        )),
        opportunity."createdByUserId",
        opportunity."createdAt",
        opportunity."updatedAt"
      FROM "CrmOpportunity" opportunity
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END
$$;

ALTER TABLE IF EXISTS "Activity" DROP COLUMN IF EXISTS "opportunityId";
ALTER TABLE IF EXISTS "Task" DROP COLUMN IF EXISTS "opportunityId";
DROP TABLE IF EXISTS "CrmOpportunity";

-- Preserve the only active pricing-policy input as one Office field. Labels,
-- tiers, and urgency variants were not read by active pricing decisions.
ALTER TABLE "Office" ADD COLUMN IF NOT EXISTS "pricingTargetMarginPct" DOUBLE PRECISION;
DO $$
BEGIN
  IF to_regclass('public."MarginProfile"') IS NOT NULL THEN
    UPDATE "Office" office
    SET "pricingTargetMarginPct" = policy.target_margin
    FROM (
      SELECT "officeId", min("marginPercent") AS target_margin
      FROM "MarginProfile"
      GROUP BY "officeId"
    ) policy
    WHERE office.id = policy."officeId"
      AND office."pricingTargetMarginPct" IS NULL;
  END IF;
END
$$;
DROP TABLE IF EXISTS "MarginProfile";
DROP TABLE IF EXISTS "CompanyDocument";

-- Normalize existing request suppliers into one reusable supplier identity and
-- one company-specific supplier link. OrderSupplier retains only request state.
INSERT INTO "Supplier" (id, "officeId", name, "normalizedName", website, status, "createdAt", "updatedAt")
SELECT DISTINCT ON (account.office_id, normalized.name)
  gen_random_uuid(),
  account.office_id,
  supplier.name,
  normalized.name,
  supplier.website,
  'UNVERIFIED',
  supplier.created_at,
  supplier.updated_at
FROM "OrderSupplier" supplier
JOIN "ProcurementOrder" procurement_order ON procurement_order.id = supplier.order_id
JOIN "CompanyWorkflowAccount" account ON account.id = procurement_order.customer_id
CROSS JOIN LATERAL (
  SELECT lower(regexp_replace(trim(supplier.name), '\s+', ' ', 'g')) AS name
) normalized
WHERE normalized.name <> ''
ORDER BY account.office_id, normalized.name, supplier.updated_at DESC
ON CONFLICT ("officeId", "normalizedName") DO UPDATE
SET website = COALESCE("Supplier".website, EXCLUDED.website),
    "updatedAt" = GREATEST("Supplier"."updatedAt", EXCLUDED."updatedAt");

UPDATE "OrderSupplier" order_supplier
SET supplier_registry_id = supplier.id
FROM "ProcurementOrder" procurement_order
JOIN "CompanyWorkflowAccount" account ON account.id = procurement_order.customer_id
JOIN "Supplier" supplier ON supplier."officeId" = account.office_id
WHERE order_supplier.order_id = procurement_order.id
  AND supplier."normalizedName" = lower(regexp_replace(trim(order_supplier.name), '\s+', ' ', 'g'))
  AND order_supplier.supplier_registry_id IS DISTINCT FROM supplier.id;

INSERT INTO "CompanySupplier" (
  id, "officeId", "companyId", "supplierId", status, "sourceRefs", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (account.company_id, order_supplier.supplier_registry_id)
  gen_random_uuid(),
  account.office_id,
  account.company_id,
  order_supplier.supplier_registry_id,
  'CANDIDATE',
  jsonb_build_object('source', 'OrderSupplier'),
  order_supplier.created_at,
  order_supplier.updated_at
FROM "OrderSupplier" order_supplier
JOIN "ProcurementOrder" procurement_order ON procurement_order.id = order_supplier.order_id
JOIN "CompanyWorkflowAccount" account ON account.id = procurement_order.customer_id
WHERE order_supplier.supplier_registry_id IS NOT NULL
ORDER BY account.company_id, order_supplier.supplier_registry_id, order_supplier.updated_at DESC
ON CONFLICT ("companyId", "supplierId") DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderSupplier_supplier_registry_id_fkey') THEN
    ALTER TABLE "OrderSupplier" ADD CONSTRAINT "OrderSupplier_supplier_registry_id_fkey"
      FOREIGN KEY (supplier_registry_id) REFERENCES "Supplier"(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE FUNCTION company_context_scope_guard()
RETURNS TRIGGER AS $$
DECLARE company_office TEXT;
DECLARE item_company TEXT;
DECLARE item_office TEXT;
DECLARE user_office TEXT;
BEGIN
  SELECT "officeId" INTO company_office FROM "Company" WHERE id = NEW."companyId";
  IF company_office IS DISTINCT FROM NEW."officeId" THEN
    RAISE EXCEPTION 'CompanyContext company is outside the office scope';
  END IF;
  IF NEW."itemId" IS NOT NULL THEN
    SELECT company_id, office_id INTO item_company, item_office FROM "Item" WHERE id = NEW."itemId";
    IF item_company IS DISTINCT FROM NEW."companyId" OR item_office IS DISTINCT FROM NEW."officeId" THEN
      RAISE EXCEPTION 'CompanyContext item is outside the company scope';
    END IF;
  END IF;
  IF NEW."createdByUserId" IS NOT NULL THEN
    SELECT "officeId" INTO user_office FROM "User" WHERE id = NEW."createdByUserId";
    IF user_office IS DISTINCT FROM NEW."officeId" THEN
      RAISE EXCEPTION 'CompanyContext creator is outside the office scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "CompanyContext_scope_guard"
BEFORE INSERT OR UPDATE ON "CompanyContext"
FOR EACH ROW EXECUTE FUNCTION company_context_scope_guard();

CREATE FUNCTION item_scope_guard()
RETURNS TRIGGER AS $$
DECLARE company_office TEXT;
DECLARE account_company TEXT;
DECLARE account_office TEXT;
BEGIN
  SELECT "officeId" INTO company_office FROM "Company" WHERE id = NEW.company_id;
  IF company_office IS DISTINCT FROM NEW.office_id THEN
    RAISE EXCEPTION 'Item company is outside the office scope';
  END IF;
  IF NEW.customer_id IS NOT NULL THEN
    SELECT company_id, office_id INTO account_company, account_office
    FROM "CompanyWorkflowAccount" WHERE id = NEW.customer_id;
    IF account_company IS DISTINCT FROM NEW.company_id OR account_office IS DISTINCT FROM NEW.office_id THEN
      RAISE EXCEPTION 'Item workflow account is outside the company scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "Item_scope_guard"
BEFORE INSERT OR UPDATE ON "Item"
FOR EACH ROW EXECUTE FUNCTION item_scope_guard();

CREATE FUNCTION company_supplier_scope_guard()
RETURNS TRIGGER AS $$
DECLARE company_office TEXT;
DECLARE supplier_office TEXT;
BEGIN
  SELECT "officeId" INTO company_office FROM "Company" WHERE id = NEW."companyId";
  SELECT "officeId" INTO supplier_office FROM "Supplier" WHERE id = NEW."supplierId";
  IF company_office IS DISTINCT FROM NEW."officeId"
    OR supplier_office IS DISTINCT FROM NEW."officeId" THEN
    RAISE EXCEPTION 'CompanySupplier references cross office scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "CompanySupplier_scope_guard"
BEFORE INSERT OR UPDATE ON "CompanySupplier"
FOR EACH ROW EXECUTE FUNCTION company_supplier_scope_guard();

CREATE FUNCTION company_workflow_account_scope_guard()
RETURNS TRIGGER AS $$
DECLARE company_office TEXT;
BEGIN
  SELECT "officeId" INTO company_office FROM "Company" WHERE id = NEW.company_id;
  IF company_office IS DISTINCT FROM NEW.office_id THEN
    RAISE EXCEPTION 'CompanyWorkflowAccount references cross office scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "CompanyWorkflowAccount_scope_guard"
BEFORE INSERT OR UPDATE ON "CompanyWorkflowAccount"
FOR EACH ROW EXECUTE FUNCTION company_workflow_account_scope_guard();

CREATE FUNCTION procurement_order_scope_guard()
RETURNS TRIGGER AS $$
DECLARE account_company TEXT;
DECLARE account_office TEXT;
DECLARE item_company TEXT;
DECLARE item_office TEXT;
BEGIN
  SELECT company_id, office_id INTO account_company, account_office
  FROM "CompanyWorkflowAccount" WHERE id = NEW.customer_id;
  SELECT company_id, office_id INTO item_company, item_office
  FROM "Item" WHERE id = NEW.bom_id;
  IF account_company IS DISTINCT FROM item_company
    OR account_office IS DISTINCT FROM item_office THEN
    RAISE EXCEPTION 'ProcurementOrder item is outside the company scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "ProcurementOrder_scope_guard"
BEFORE INSERT OR UPDATE ON "ProcurementOrder"
FOR EACH ROW EXECUTE FUNCTION procurement_order_scope_guard();

CREATE FUNCTION order_supplier_scope_guard()
RETURNS TRIGGER AS $$
DECLARE order_office TEXT;
DECLARE supplier_office TEXT;
BEGIN
  IF NEW.supplier_registry_id IS NOT NULL THEN
    SELECT account.office_id INTO order_office
    FROM "ProcurementOrder" procurement_order
    JOIN "CompanyWorkflowAccount" account ON account.id = procurement_order.customer_id
    WHERE procurement_order.id = NEW.order_id;
    SELECT "officeId" INTO supplier_office
    FROM "Supplier" WHERE id = NEW.supplier_registry_id;
    IF order_office IS DISTINCT FROM supplier_office THEN
      RAISE EXCEPTION 'OrderSupplier supplier is outside the order office scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "OrderSupplier_scope_guard"
BEFORE INSERT OR UPDATE ON "OrderSupplier"
FOR EACH ROW EXECUTE FUNCTION order_supplier_scope_guard();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProcurementOrder" procurement_order
    JOIN "CompanyWorkflowAccount" account ON account.id = procurement_order.customer_id
    JOIN "Item" item ON item.id = procurement_order.bom_id
    WHERE account.company_id IS DISTINCT FROM item.company_id
      OR account.office_id IS DISTINCT FROM item.office_id
  ) THEN
    RAISE EXCEPTION 'Existing ProcurementOrder rows cross company scope';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ProcurementRequestKey" request_key
    JOIN "ProcurementOrder" procurement_order ON procurement_order.id = request_key.order_id
    WHERE request_key.customer_id IS DISTINCT FROM procurement_order.customer_id
  ) THEN
    RAISE EXCEPTION 'Existing ProcurementRequestKey rows cross company scope';
  END IF;
END
$$;

CREATE FUNCTION procurement_request_key_scope_guard()
RETURNS TRIGGER AS $$
DECLARE order_customer UUID;
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    SELECT customer_id INTO order_customer
    FROM "ProcurementOrder" WHERE id = NEW.order_id;
    IF order_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'ProcurementRequestKey order is outside the customer scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER "ProcurementRequestKey_scope_guard"
BEFORE INSERT OR UPDATE ON "ProcurementRequestKey"
FOR EACH ROW EXECUTE FUNCTION procurement_request_key_scope_guard();

-- Compatibility views keep the external procurement worker online while the
-- application and operator use the canonical table names.
CREATE VIEW customers AS
SELECT id, name, '{}'::jsonb AS procurement_preferences, created_at, updated_at
FROM "CompanyWorkflowAccount";

CREATE VIEW bill_of_materials AS
SELECT id, customer_id, material, specification,
  '{}'::jsonb AS procurement_preferences, created_at
FROM "Item";

CREATE VIEW orders AS
SELECT * FROM "ProcurementOrder";

CREATE VIEW order_vendors AS
SELECT * FROM "OrderSupplier";

CREATE VIEW procurement_api_idempotency AS
SELECT * FROM "ProcurementRequestKey";

CREATE FUNCTION legacy_bom_insert()
RETURNS TRIGGER AS $$
DECLARE account "CompanyWorkflowAccount"%ROWTYPE;
DECLARE inserted "Item"%ROWTYPE;
BEGIN
  SELECT * INTO account FROM "CompanyWorkflowAccount" WHERE id = NEW.customer_id;
  IF account.id IS NULL THEN RAISE EXCEPTION 'Unknown company workflow account'; END IF;
  INSERT INTO "Item" (
    id, office_id, company_id, customer_id, material, specification, created_at, updated_at
  ) VALUES (
    COALESCE(NEW.id, gen_random_uuid()), account.office_id, account.company_id,
    NEW.customer_id, NEW.material, NEW.specification,
    COALESCE(NEW.created_at, now()), now()
  ) RETURNING * INTO inserted;
  IF NEW.procurement_preferences IS NOT NULL AND NEW.procurement_preferences <> '{}'::jsonb THEN
    INSERT INTO "CompanyContext" (
      "officeId", "companyId", "itemId", kind, name, description, markdown,
      "processingState", payload
    ) VALUES (
      account.office_id, account.company_id, inserted.id, 'NOTE',
      'Item procurement context', 'Submitted with the procurement request.',
      '# Item procurement context' || E'\n\n' || jsonb_pretty(NEW.procurement_preferences),
      'READY', jsonb_build_object('source', 'bill_of_materials compatibility view')
    );
  END IF;
  NEW.id := inserted.id;
  NEW.created_at := inserted.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER bill_of_materials_insert
INSTEAD OF INSERT ON bill_of_materials
FOR EACH ROW EXECUTE FUNCTION legacy_bom_insert();

CREATE FUNCTION legacy_order_supplier_insert()
RETURNS TRIGGER AS $$
DECLARE account "CompanyWorkflowAccount"%ROWTYPE;
DECLARE normalized_name TEXT;
DECLARE canonical_supplier_id UUID;
BEGIN
  SELECT workflow_account.* INTO account
  FROM "ProcurementOrder" procurement_order
  JOIN "CompanyWorkflowAccount" workflow_account ON workflow_account.id = procurement_order.customer_id
  WHERE procurement_order.id = NEW.order_id;
  IF account.id IS NULL THEN RAISE EXCEPTION 'Unknown procurement order'; END IF;
  normalized_name := lower(regexp_replace(trim(NEW.name), '\s+', ' ', 'g'));
  IF normalized_name = '' THEN RAISE EXCEPTION 'Supplier name is required'; END IF;

  INSERT INTO "Supplier" (
    id, "officeId", name, "normalizedName", website, status, "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid(), account.office_id, NEW.name, normalized_name,
    NEW.website, 'UNVERIFIED', COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
  )
  ON CONFLICT ("officeId", "normalizedName") DO UPDATE
  SET website = COALESCE("Supplier".website, EXCLUDED.website),
      "updatedAt" = GREATEST("Supplier"."updatedAt", EXCLUDED."updatedAt")
  RETURNING id INTO canonical_supplier_id;

  INSERT INTO "CompanySupplier" (
    id, "officeId", "companyId", "supplierId", status, "sourceRefs", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid(), account.office_id, account.company_id, canonical_supplier_id,
    'CANDIDATE', jsonb_build_object('source', 'order_vendors compatibility view'),
    COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
  ) ON CONFLICT ("companyId", "supplierId") DO NOTHING;

  INSERT INTO "OrderSupplier" (
    id, order_id, name, website, contact_name, contact_email, contact_phone,
    contact, identity, status, research, quote, supplier_registry_id,
    gmail_message_id, created_at, updated_at
  ) VALUES (
    COALESCE(NEW.id, gen_random_uuid()), NEW.order_id, NEW.name, NEW.website,
    NEW.contact_name, NEW.contact_email, NEW.contact_phone, NEW.contact,
    NEW.identity, NEW.status, COALESCE(NEW.research, '{}'::jsonb), NEW.quote,
    canonical_supplier_id, NEW.gmail_message_id, COALESCE(NEW.created_at, now()),
    COALESCE(NEW.updated_at, now())
  ) RETURNING id, supplier_registry_id, created_at, updated_at
    INTO NEW.id, NEW.supplier_registry_id, NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
CREATE TRIGGER order_vendors_insert
INSTEAD OF INSERT ON order_vendors
FOR EACH ROW EXECUTE FUNCTION legacy_order_supplier_insert();

DO $$
DECLARE preserved_grant RECORD;
DECLARE grantee_sql TEXT;
BEGIN
  FOR preserved_grant IN
    SELECT DISTINCT canonical_name, view_name, grantee, privilege_type
    FROM minimal_legacy_workflow_grants_20260821
    WHERE view_name IS NOT NULL
  LOOP
    grantee_sql := CASE
      WHEN preserved_grant.grantee = 'PUBLIC' THEN 'PUBLIC'
      ELSE quote_ident(preserved_grant.grantee)
    END;
    EXECUTE format(
      'GRANT %s ON %I TO %s',
      preserved_grant.privilege_type,
      preserved_grant.view_name,
      grantee_sql
    );
    IF preserved_grant.grantee <> current_user THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE %I FROM %s',
        preserved_grant.canonical_name,
        grantee_sql
      );
    END IF;
  END LOOP;

  FOR preserved_grant IN
    SELECT DISTINCT canonical_name, view_name, grantee, privilege_type, column_name
    FROM minimal_legacy_workflow_column_grants_20260821
    WHERE view_name IS NOT NULL
  LOOP
    grantee_sql := CASE
      WHEN preserved_grant.grantee = 'PUBLIC' THEN 'PUBLIC'
      ELSE quote_ident(preserved_grant.grantee)
    END;
    EXECUTE format(
      'GRANT %s (%I) ON %I TO %s',
      preserved_grant.privilege_type,
      preserved_grant.column_name,
      preserved_grant.view_name,
      grantee_sql
    );
    IF preserved_grant.grantee <> current_user AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = preserved_grant.canonical_name
        AND column_name = preserved_grant.column_name
    ) THEN
      EXECUTE format(
        'REVOKE %s (%I) ON %I FROM %s',
        preserved_grant.privilege_type,
        preserved_grant.column_name,
        preserved_grant.canonical_name,
        grantee_sql
      );
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api') THEN
    REVOKE ALL ON "CompanyWorkflowAccount", "Item", "ProcurementOrder", "OrderSupplier",
      "ProcurementRequestKey", customers, bill_of_materials, orders, order_vendors,
      procurement_api_idempotency FROM dashboard_api;
    GRANT SELECT (id) ON customers TO dashboard_api;
    GRANT SELECT ON bill_of_materials TO dashboard_api;
    GRANT INSERT (customer_id, material, specification, procurement_preferences)
      ON bill_of_materials TO dashboard_api;
    GRANT SELECT ON orders TO dashboard_api;
    GRANT INSERT (
      customer_id, bom_id, quantity, unit, needed_by, notes,
      request_context, status, progress
    ) ON orders TO dashboard_api;
    GRANT SELECT ON order_vendors TO dashboard_api;
    GRANT SELECT, INSERT ON procurement_api_idempotency TO dashboard_api;
    GRANT UPDATE (order_id, updated_at) ON procurement_api_idempotency TO dashboard_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Item", "Supplier", "CompanySupplier", "CompanyContext" TO derya_app;
    REVOKE ALL ON "CompanyWorkflowAccount", "ProcurementOrder", "OrderSupplier", "ProcurementRequestKey",
      customers, bill_of_materials, orders, order_vendors, procurement_api_idempotency FROM derya_app;
  END IF;
END
$$;

COMMIT;
