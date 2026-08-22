BEGIN;

DO $$
BEGIN
  IF to_regclass('public."OrderSupplier"') IS NULL
    OR to_regclass('public.order_vendors') IS NULL THEN
    RAISE EXCEPTION 'OrderSupplier compatibility schema is incomplete';
  END IF;
END
$$;

-- The live Bourne table predated the canonical contact projection. Add the
-- columns without removing legacy worker fields such as email.
ALTER TABLE "OrderSupplier"
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact JSONB,
  ADD COLUMN IF NOT EXISTS identity JSONB;

-- PostgreSQL fixes a view's column list when the view is created. Replacing the
-- simple view exposes the appended canonical columns while retaining its ACLs
-- and triggers.
CREATE OR REPLACE VIEW order_vendors AS
SELECT * FROM "OrderSupplier";

-- Backfill only explicit contact facts. Supplier research remains evidence and
-- is not searched for arbitrary addresses or inferred people.
WITH projected AS (
  SELECT
    supplier.id,
    NULLIF(btrim(COALESCE(
      supplier.contact_name,
      supplier.contact->>'name',
      supplier.identity->>'contact_name',
      supplier.identity->'contact'->>'name',
      supplier.research->'identity'->>'contact_name',
      supplier.research->'identity'->'contact'->>'name'
    )), '') AS contact_name,
    lower(NULLIF(btrim(COALESCE(
      supplier.contact_email,
      supplier.contact->>'email',
      supplier.identity->>'contact_email',
      supplier.identity->>'email',
      to_jsonb(supplier)->>'email',
      supplier.research->'identity'->>'contact_email',
      supplier.research->'identity'->>'email',
      supplier.research->'identity'->'contact'->>'email'
    )), '')) AS contact_email,
    NULLIF(btrim(COALESCE(
      supplier.contact_phone,
      supplier.contact->>'phone',
      supplier.identity->>'contact_phone',
      supplier.identity->>'phone',
      to_jsonb(supplier)->>'phone',
      supplier.research->'identity'->>'contact_phone',
      supplier.research->'identity'->>'phone',
      supplier.research->'identity'->'contact'->>'phone'
    )), '') AS contact_phone,
    CASE
      WHEN jsonb_typeof(supplier.research->'identity') = 'object'
        THEN supplier.research->'identity'
      ELSE NULL
    END AS research_identity
  FROM "OrderSupplier" supplier
), backfill AS (
  SELECT
    supplier.id,
    projected.contact_name,
    projected.contact_email,
    projected.contact_phone,
    NULLIF(
      CASE
        WHEN jsonb_typeof(supplier.contact) = 'object' THEN supplier.contact
        ELSE '{}'::jsonb
      END || jsonb_strip_nulls(jsonb_build_object(
        'name', projected.contact_name,
        'email', projected.contact_email,
        'phone', projected.contact_phone
      )),
      '{}'::jsonb
    ) AS contact,
    CASE
      WHEN projected.research_identity IS NULL THEN supplier.identity
      ELSE projected.research_identity || CASE
        WHEN jsonb_typeof(supplier.identity) = 'object' THEN supplier.identity
        ELSE '{}'::jsonb
      END
    END AS identity
  FROM "OrderSupplier" supplier
  JOIN projected ON projected.id = supplier.id
)
UPDATE "OrderSupplier" supplier
SET contact_name = backfill.contact_name,
    contact_email = backfill.contact_email,
    contact_phone = backfill.contact_phone,
    contact = backfill.contact,
    identity = backfill.identity
FROM backfill
WHERE supplier.id = backfill.id
  AND (
    supplier.contact_name IS DISTINCT FROM backfill.contact_name
    OR supplier.contact_email IS DISTINCT FROM backfill.contact_email
    OR supplier.contact_phone IS DISTINCT FROM backfill.contact_phone
    OR supplier.contact IS DISTINCT FROM backfill.contact
    OR supplier.identity IS DISTINCT FROM backfill.identity
  );

-- Keep the worker-facing insert path aligned with the canonical read contract.
-- Inserting the complete NEW row preserves unknown legacy worker columns while
-- the explicit projection fills the fields Derya reads.
CREATE OR REPLACE FUNCTION legacy_order_supplier_insert()
RETURNS TRIGGER AS $$
DECLARE account "CompanyWorkflowAccount"%ROWTYPE;
DECLARE normalized_name TEXT;
DECLARE canonical_supplier_id UUID;
DECLARE incoming JSONB;
DECLARE normalized_contact_name TEXT;
DECLARE normalized_contact_email TEXT;
DECLARE normalized_contact_phone TEXT;
DECLARE research_identity JSONB;
BEGIN
  incoming := to_jsonb(NEW);
  SELECT workflow_account.* INTO account
  FROM "ProcurementOrder" procurement_order
  JOIN "CompanyWorkflowAccount" workflow_account ON workflow_account.id = procurement_order.customer_id
  WHERE procurement_order.id = NEW.order_id;
  IF account.id IS NULL THEN RAISE EXCEPTION 'Unknown procurement order'; END IF;
  normalized_name := lower(regexp_replace(trim(NEW.name), '\s+', ' ', 'g'));
  IF normalized_name = '' THEN RAISE EXCEPTION 'Supplier name is required'; END IF;

  normalized_contact_name := NULLIF(btrim(COALESCE(
    incoming->>'contact_name',
    incoming->'contact'->>'name',
    incoming->'identity'->>'contact_name',
    incoming->'identity'->'contact'->>'name',
    incoming->'research'->'identity'->>'contact_name',
    incoming->'research'->'identity'->'contact'->>'name'
  )), '');
  normalized_contact_email := lower(NULLIF(btrim(COALESCE(
    incoming->>'contact_email',
    incoming->'contact'->>'email',
    incoming->'identity'->>'contact_email',
    incoming->'identity'->>'email',
    incoming->>'email',
    incoming->'research'->'identity'->>'contact_email',
    incoming->'research'->'identity'->>'email',
    incoming->'research'->'identity'->'contact'->>'email'
  )), ''));
  normalized_contact_phone := NULLIF(btrim(COALESCE(
    incoming->>'contact_phone',
    incoming->'contact'->>'phone',
    incoming->'identity'->>'contact_phone',
    incoming->'identity'->>'phone',
    incoming->>'phone',
    incoming->'research'->'identity'->>'contact_phone',
    incoming->'research'->'identity'->>'phone',
    incoming->'research'->'identity'->'contact'->>'phone'
  )), '');
  research_identity := CASE
    WHEN jsonb_typeof(incoming->'research'->'identity') = 'object'
      THEN incoming->'research'->'identity'
    ELSE NULL
  END;

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

  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.contact_name := normalized_contact_name;
  NEW.contact_email := normalized_contact_email;
  NEW.contact_phone := normalized_contact_phone;
  NEW.contact := NULLIF(
    CASE
      WHEN jsonb_typeof(NEW.contact) = 'object' THEN NEW.contact
      ELSE '{}'::jsonb
    END || jsonb_strip_nulls(jsonb_build_object(
      'name', normalized_contact_name,
      'email', normalized_contact_email,
      'phone', normalized_contact_phone
    )),
    '{}'::jsonb
  );
  NEW.identity := CASE
    WHEN research_identity IS NULL THEN NEW.identity
    ELSE research_identity || CASE
      WHEN jsonb_typeof(NEW.identity) = 'object' THEN NEW.identity
      ELSE '{}'::jsonb
    END
  END;
  NEW.research := COALESCE(NEW.research, '{}'::jsonb);
  NEW.supplier_registry_id := canonical_supplier_id;
  NEW.created_at := COALESCE(NEW.created_at, now());
  NEW.updated_at := COALESCE(NEW.updated_at, now());

  INSERT INTO "OrderSupplier" SELECT (NEW).*
  RETURNING * INTO NEW;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

COMMIT;
