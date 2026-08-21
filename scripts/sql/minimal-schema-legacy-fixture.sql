\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "Office" (id, name, "createdAt", "updatedAt")
VALUES ('legacy-office', 'Legacy migration office', now(), now());

INSERT INTO "Company" (id, "officeId", name, status, "createdAt", "updatedAt")
VALUES ('legacy-company', 'legacy-office', 'HypnoDreamz', 'IN_PROGRESS', now(), now());

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  procurement_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bill_of_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  material TEXT NOT NULL,
  specification TEXT,
  procurement_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE RESTRICT,
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

CREATE TABLE order_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
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

CREATE TABLE procurement_api_idempotency (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key),
  CONSTRAINT procurement_api_idempotency_key_length
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT procurement_api_request_hash_length
    CHECK (char_length(request_hash) = 64)
);

ALTER TABLE orders
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at TIMESTAMPTZ,
  ADD COLUMN lease_until TIMESTAMPTZ,
  ADD COLUMN worker_run_id TEXT,
  ADD COLUMN last_error_code TEXT,
  ADD COLUMN last_error_at TIMESTAMPTZ,
  ADD COLUMN started_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'legacy_bourne_worker') THEN
    CREATE ROLE legacy_bourne_worker NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'legacy_bourne_column_worker') THEN
    CREATE ROLE legacy_bourne_column_worker NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT SELECT ON customers, bill_of_materials, orders, order_vendors,
  procurement_api_idempotency TO legacy_bourne_worker;
GRANT INSERT, UPDATE ON orders, order_vendors, procurement_api_idempotency
  TO legacy_bourne_worker;
GRANT SELECT ON customers, bill_of_materials, orders, order_vendors,
  procurement_api_idempotency TO legacy_bourne_column_worker;
GRANT UPDATE (
  attempt_count, next_attempt_at, lease_until, worker_run_id,
  last_error_code, last_error_at, started_at, completed_at, updated_at
) ON orders TO legacy_bourne_column_worker;

INSERT INTO customers (id, name, procurement_preferences)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'HypnoDreamz',
  '{"email_style":"brief"}'::jsonb
);

INSERT INTO bill_of_materials (
  id, customer_id, material, specification, procurement_preferences
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Memory foam insert',
  '40 kg per cubic meter',
  '{"packaging":"protect edges"}'::jsonb
);

INSERT INTO orders (
  id, customer_id, bom_id, quantity, unit, needed_by, notes,
  request_context, status, progress, decision_snapshot, gmail_thread_id
) VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  25,
  'units',
  '2026-09-15',
  'Keep exact request facts',
  '{"source":{"campaign":"legacy"}}'::jsonb,
  'new',
  'researching',
  '{"recommendation":"review"}'::jsonb,
  'legacy-thread'
);

UPDATE orders
SET attempt_count = 2,
    next_attempt_at = now() + interval '1 minute',
    worker_run_id = 'legacy-run'
WHERE id = '33333333-3333-4333-8333-333333333333';

INSERT INTO order_vendors (
  id, order_id, name, website, contact_email, status, research, quote
) VALUES
  (
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'Acme Parts',
    'https://acme.example',
    'sales@acme.example',
    'shortlisted',
    '{"source":"public"}'::jsonb,
    '{"amount":1250}'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '33333333-3333-4333-8333-333333333333',
    '  ACME   Parts  ',
    NULL,
    NULL,
    'found',
    '{}'::jsonb,
    NULL
  );

INSERT INTO procurement_api_idempotency (
  customer_id, idempotency_key, request_hash, order_id
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'legacy-request',
  repeat('a', 64),
  '33333333-3333-4333-8333-333333333333'
);

INSERT INTO "CompanyDocument" (
  id, "officeId", "companyId", name, url, "docType", "createdAt"
) VALUES
  (
    'legacy-ordinary-document',
    'legacy-office',
    'legacy-company',
    'commercial-invoice.pdf',
    'https://files.example/invoice.pdf',
    'invoice',
    now()
  ),
  (
    'legacy-context-file',
    'legacy-office',
    'legacy-company',
    'drawing.csv',
    'data:text/csv;base64,cGFydCxkaW1lbnNpb24=',
    'company_context_file:legacyhash:text%2Fcsv:14',
    now()
  ),
  (
    'legacy-context-markdown',
    'legacy-office',
    'legacy-company',
    'drawing.csv.md',
    'data:text/markdown;base64,' || encode(convert_to(
      '<!-- context-processing' || E'\n' ||
      '{"state":"FAILED","summary":"Legacy drawing summary","error":"Legacy parse error"}' ||
      E'\n-->\n# Parsed drawing',
      'UTF8'
    ), 'base64'),
    'company_context_markdown:legacy-context-file:FAILED',
    now()
  ),
  (
    'legacy-context-message',
    'legacy-office',
    'legacy-company',
    'Derya reply.md',
    'data:text/markdown;base64,' || encode(convert_to(
      'Use the drawing.' || E'\n\n<!-- context-citations\n' ||
      '[{"id":"document:legacy-context-file","label":"drawing.csv"}]' || E'\n-->',
      'UTF8'
    ), 'base64'),
    'company_context_message:AGENT',
    now()
  );

INSERT INTO "CrmOpportunity" (
  id, "officeId", "companyId", name, type, stage, "estimatedValue",
  currency, likelihood, priority, "nextAction", source, notes,
  "createdAt", "updatedAt"
) VALUES (
  'legacy-opportunity',
  'legacy-office',
  'legacy-company',
  'Foam reorder',
  'customer_lead',
  'qualified',
  42000,
  'USD',
  70,
  'high',
  'Confirm dimensions',
  'manual',
  'Customer expects a revised drawing.',
  now(),
  now()
);

INSERT INTO "MarginProfile" (
  id, "officeId", label, "customerTier", urgency, "marginPercent", "createdAt", "updatedAt"
) VALUES (
  'legacy-margin-profile',
  'legacy-office',
  'Unneeded margin preference',
  'existing',
  'normal',
  12.5,
  now(),
  now()
);
