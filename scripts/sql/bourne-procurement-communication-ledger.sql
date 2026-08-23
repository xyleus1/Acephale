\set ON_ERROR_STOP on
SET search_path = public, pg_temp;
SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- Bourne owns writes to this append-only communication ledger. Derya reads it
-- through the restricted dashboard_api role and never receives provider
-- credentials. Apply this file as the Bourne Neon database owner after the
-- dashboard_api and bourne_supply_chain roles exist.

DO $$
BEGIN
  IF to_regclass('public."ProcurementOrder"') IS NULL
    OR to_regclass('public."OrderSupplier"') IS NULL THEN
    RAISE EXCEPTION 'canonical procurement tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_api') THEN
    RAISE EXCEPTION 'dashboard_api role is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'dashboard_api'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR NOT rolcanlogin
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    JOIN pg_roles ON pg_roles.oid = pg_auth_members.member
    WHERE pg_roles.rolname = 'dashboard_api'
  ) THEN
    RAISE EXCEPTION 'dashboard_api has unsafe role attributes or memberships';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bourne_supply_chain') THEN
    RAISE EXCEPTION 'bourne_supply_chain role is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'bourne_supply_chain'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
        OR NOT rolcanlogin
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    JOIN pg_roles ON pg_roles.oid = pg_auth_members.member
    WHERE pg_roles.rolname = 'bourne_supply_chain'
  ) THEN
    RAISE EXCEPTION 'bourne_supply_chain has unsafe role attributes or memberships';
  END IF;
END
$$;

SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I', namespace.nspname, index_class.relname)
FROM pg_index
JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
WHERE namespace.nspname = 'public'
  AND index_class.relname IN (
    'ProcurementOrder_id_customer_id_key',
    'OrderSupplier_id_order_id_key',
    'procurement_communication_vendor_time_idx',
    'procurement_communication_thread_idx'
  )
  AND NOT pg_index.indisvalid
\gexec

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProcurementOrder_id_customer_id_key"
ON public."ProcurementOrder" (id, customer_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "OrderSupplier_id_order_id_key"
ON public."OrderSupplier" (id, order_id);

CREATE TABLE IF NOT EXISTS public.procurement_communication_messages (
  customer_id UUID NOT NULL,
  order_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  provider TEXT NOT NULL,
  account_email TEXT NOT NULL,
  counterparty_email TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT,
  rfc_message_id TEXT,
  direction TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails JSONB NOT NULL,
  cc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body_text TEXT,
  body_truncated BOOLEAN NOT NULL DEFAULT false,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, provider, account_email, provider_message_id),
  CONSTRAINT procurement_communication_provider_message_unique
    UNIQUE (provider, account_email, provider_message_id),
  CONSTRAINT procurement_communication_order_customer_fk
    FOREIGN KEY (order_id, customer_id)
    REFERENCES public."ProcurementOrder" (id, customer_id)
    ON DELETE RESTRICT,
  CONSTRAINT procurement_communication_vendor_order_fk
    FOREIGN KEY (vendor_id, order_id)
    REFERENCES public."OrderSupplier" (id, order_id)
    ON DELETE RESTRICT,
  CONSTRAINT procurement_communication_provider_shape
    CHECK (provider ~ '^[A-Z0-9_]{1,40}$'),
  CONSTRAINT procurement_communication_direction
    CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  CONSTRAINT procurement_communication_account_email_length
    CHECK (
      char_length(account_email) BETWEEN 3 AND 320
      AND account_email = lower(account_email)
      AND account_email !~ '^[[:space:]]|[[:space:]]$'
    ),
  CONSTRAINT procurement_communication_counterparty_email_length
    CHECK (
      char_length(counterparty_email) BETWEEN 3 AND 320
      AND counterparty_email = lower(counterparty_email)
      AND counterparty_email !~ '^[[:space:]]|[[:space:]]$'
    ),
  CONSTRAINT procurement_communication_provider_message_id_length
    CHECK (
      char_length(provider_message_id) BETWEEN 1 AND 1000
      AND provider_message_id !~ '^[[:space:]]|[[:space:]]$'
    ),
  CONSTRAINT procurement_communication_provider_thread_id_length
    CHECK (
      provider_thread_id IS NULL
      OR (
        char_length(provider_thread_id) BETWEEN 1 AND 1000
        AND provider_thread_id !~ '^[[:space:]]|[[:space:]]$'
      )
    ),
  CONSTRAINT procurement_communication_rfc_message_id_length
    CHECK (
      rfc_message_id IS NULL
      OR (
        char_length(rfc_message_id) BETWEEN 1 AND 1000
        AND rfc_message_id !~ '^[[:space:]]|[[:space:]]$'
      )
    ),
  CONSTRAINT procurement_communication_from_email_length
    CHECK (
      char_length(from_email) BETWEEN 1 AND 320
      AND from_email = lower(from_email)
      AND from_email !~ '^[[:space:]]|[[:space:]]$'
    ),
  CONSTRAINT procurement_communication_from_name_length
    CHECK (from_name IS NULL OR char_length(from_name) <= 320),
  CONSTRAINT procurement_communication_subject_length
    CHECK (subject IS NULL OR char_length(subject) <= 2000),
  CONSTRAINT procurement_communication_body_length
    CHECK (body_text IS NULL OR char_length(body_text) <= 1000000),
  CONSTRAINT procurement_communication_to_emails_array
    CHECK (jsonb_typeof(to_emails) = 'array'),
  CONSTRAINT procurement_communication_to_emails_length
    CHECK (jsonb_array_length(to_emails) <= 50),
  CONSTRAINT procurement_communication_cc_emails_array
    CHECK (jsonb_typeof(cc_emails) = 'array'),
  CONSTRAINT procurement_communication_cc_emails_length
    CHECK (jsonb_array_length(cc_emails) <= 50),
  CONSTRAINT procurement_communication_attachments_array
    CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT procurement_communication_counterparty_participant
    CHECK (
      (direction = 'INBOUND' AND from_email = counterparty_email)
      OR (
        direction = 'OUTBOUND'
        AND (
          to_emails @> jsonb_build_array(counterparty_email)
          OR cc_emails @> jsonb_build_array(counterparty_email)
        )
      )
    )
);

DO $$
DECLARE
  invalid_columns TEXT;
  missing_constraints TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.procurement_communication_messages'::regclass
      AND relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'procurement_communication_messages is not a table';
  END IF;

  WITH expected(column_name, udt_name, nullable) AS (
    VALUES
      ('customer_id', 'uuid', false),
      ('order_id', 'uuid', false),
      ('vendor_id', 'uuid', false),
      ('provider', 'text', false),
      ('account_email', 'text', false),
      ('counterparty_email', 'text', false),
      ('provider_message_id', 'text', false),
      ('provider_thread_id', 'text', true),
      ('rfc_message_id', 'text', true),
      ('direction', 'text', false),
      ('from_email', 'text', false),
      ('from_name', 'text', true),
      ('to_emails', 'jsonb', false),
      ('cc_emails', 'jsonb', false),
      ('subject', 'text', true),
      ('body_text', 'text', true),
      ('body_truncated', 'bool', false),
      ('attachments', 'jsonb', false),
      ('sent_at', 'timestamptz', false),
      ('recorded_at', 'timestamptz', false)
  )
  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
  INTO invalid_columns
  FROM expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
    AND actual.table_name = 'procurement_communication_messages'
    AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
    OR actual.udt_name <> expected.udt_name
    OR (actual.is_nullable = 'YES') <> expected.nullable;
  IF invalid_columns IS NOT NULL THEN
    RAISE EXCEPTION 'procurement communication columns are missing or unsafe: %', invalid_columns;
  END IF;

  WITH expected(column_name, column_default) AS (
    VALUES
      ('cc_emails', '''[]''::jsonb'),
      ('body_truncated', 'false'),
      ('attachments', '''[]''::jsonb'),
      ('recorded_at', 'now()')
  )
  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
  INTO invalid_columns
  FROM expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
    AND actual.table_name = 'procurement_communication_messages'
    AND actual.column_name = expected.column_name
  WHERE actual.column_default IS DISTINCT FROM expected.column_default;
  IF invalid_columns IS NOT NULL THEN
    RAISE EXCEPTION 'procurement communication defaults are missing or unsafe: %', invalid_columns;
  END IF;

  WITH expected(column_name) AS (
    SELECT unnest(ARRAY[
      'customer_id', 'order_id', 'vendor_id', 'provider', 'account_email',
      'counterparty_email', 'provider_message_id', 'provider_thread_id',
      'rfc_message_id', 'direction', 'from_email', 'from_name', 'to_emails',
      'cc_emails', 'subject', 'body_text', 'body_truncated', 'attachments',
      'sent_at', 'recorded_at'
    ]::text[])
  )
  SELECT string_agg(actual.column_name, ', ' ORDER BY actual.column_name)
  INTO invalid_columns
  FROM information_schema.columns AS actual
  LEFT JOIN expected ON expected.column_name = actual.column_name
  WHERE actual.table_schema = 'public'
    AND actual.table_name = 'procurement_communication_messages'
    AND expected.column_name IS NULL
    AND actual.is_nullable = 'NO'
    AND actual.column_default IS NULL;
  IF invalid_columns IS NOT NULL THEN
    RAISE EXCEPTION 'procurement communication table has unsupported required columns: %', invalid_columns;
  END IF;

  WITH expected(constraint_name, constraint_type, definition) AS (
    VALUES
      ('procurement_communication_messages_pkey', 'p', $definition$PRIMARY KEY (customer_id, provider, account_email, provider_message_id)$definition$),
      ('procurement_communication_provider_message_unique', 'u', $definition$UNIQUE (provider, account_email, provider_message_id)$definition$),
      ('procurement_communication_order_customer_fk', 'f', $definition$FOREIGN KEY (order_id, customer_id) REFERENCES "ProcurementOrder"(id, customer_id) ON DELETE RESTRICT$definition$),
      ('procurement_communication_vendor_order_fk', 'f', $definition$FOREIGN KEY (vendor_id, order_id) REFERENCES "OrderSupplier"(id, order_id) ON DELETE RESTRICT$definition$),
      ('procurement_communication_provider_shape', 'c', $definition$CHECK (provider ~ '^[A-Z0-9_]{1,40}$'::text)$definition$),
      ('procurement_communication_direction', 'c', $definition$CHECK (direction = ANY (ARRAY['INBOUND'::text, 'OUTBOUND'::text]))$definition$),
      ('procurement_communication_account_email_length', 'c', $definition$CHECK (char_length(account_email) >= 3 AND char_length(account_email) <= 320 AND account_email = lower(account_email) AND account_email !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_counterparty_email_length', 'c', $definition$CHECK (char_length(counterparty_email) >= 3 AND char_length(counterparty_email) <= 320 AND counterparty_email = lower(counterparty_email) AND counterparty_email !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_provider_message_id_length', 'c', $definition$CHECK (char_length(provider_message_id) >= 1 AND char_length(provider_message_id) <= 1000 AND provider_message_id !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_provider_thread_id_length', 'c', $definition$CHECK (provider_thread_id IS NULL OR char_length(provider_thread_id) >= 1 AND char_length(provider_thread_id) <= 1000 AND provider_thread_id !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_rfc_message_id_length', 'c', $definition$CHECK (rfc_message_id IS NULL OR char_length(rfc_message_id) >= 1 AND char_length(rfc_message_id) <= 1000 AND rfc_message_id !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_from_email_length', 'c', $definition$CHECK (char_length(from_email) >= 1 AND char_length(from_email) <= 320 AND from_email = lower(from_email) AND from_email !~ '^[[:space:]]|[[:space:]]$'::text)$definition$),
      ('procurement_communication_from_name_length', 'c', $definition$CHECK (from_name IS NULL OR char_length(from_name) <= 320)$definition$),
      ('procurement_communication_subject_length', 'c', $definition$CHECK (subject IS NULL OR char_length(subject) <= 2000)$definition$),
      ('procurement_communication_body_length', 'c', $definition$CHECK (body_text IS NULL OR char_length(body_text) <= 1000000)$definition$),
      ('procurement_communication_to_emails_array', 'c', $definition$CHECK (jsonb_typeof(to_emails) = 'array'::text)$definition$),
      ('procurement_communication_to_emails_length', 'c', $definition$CHECK (jsonb_array_length(to_emails) <= 50)$definition$),
      ('procurement_communication_cc_emails_array', 'c', $definition$CHECK (jsonb_typeof(cc_emails) = 'array'::text)$definition$),
      ('procurement_communication_cc_emails_length', 'c', $definition$CHECK (jsonb_array_length(cc_emails) <= 50)$definition$),
      ('procurement_communication_attachments_array', 'c', $definition$CHECK (jsonb_typeof(attachments) = 'array'::text)$definition$),
      ('procurement_communication_counterparty_participant', 'c', $definition$CHECK (direction = 'INBOUND'::text AND from_email = counterparty_email OR direction = 'OUTBOUND'::text AND (to_emails @> jsonb_build_array(counterparty_email) OR cc_emails @> jsonb_build_array(counterparty_email)))$definition$)
  )
  SELECT string_agg(expected.constraint_name, ', ' ORDER BY expected.constraint_name)
  INTO missing_constraints
  FROM expected
  LEFT JOIN pg_constraint AS actual
    ON actual.conrelid = 'public.procurement_communication_messages'::regclass
    AND actual.conname = expected.constraint_name
    AND actual.convalidated
  WHERE actual.oid IS NULL
    OR actual.contype::text <> expected.constraint_type
    OR pg_get_constraintdef(actual.oid, true) <> expected.definition;
  IF missing_constraints IS NOT NULL THEN
    RAISE EXCEPTION 'procurement communication constraints are missing or unsafe: %', missing_constraints;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.procurement_communication_messages'::regclass
      AND conname = 'procurement_communication_order_customer_fk'
      AND (confrelid <> 'public."ProcurementOrder"'::regclass OR confdeltype <> 'r')
  ) OR EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.procurement_communication_messages'::regclass
      AND conname = 'procurement_communication_vendor_order_fk'
      AND (confrelid <> 'public."OrderSupplier"'::regclass OR confdeltype <> 'r')
  ) THEN
    RAISE EXCEPTION 'procurement communication foreign keys are unsafe';
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS procurement_communication_vendor_time_idx
ON public.procurement_communication_messages (
  customer_id,
  order_id,
  vendor_id,
  sent_at DESC,
  provider_message_id DESC
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS procurement_communication_thread_idx
ON public.procurement_communication_messages (
  customer_id,
  order_id,
  vendor_id,
  provider,
  account_email,
  provider_thread_id
);

REVOKE ALL ON public.procurement_communication_messages FROM PUBLIC;
REVOKE ALL ON public.procurement_communication_messages FROM dashboard_api;
GRANT SELECT ON public.procurement_communication_messages TO dashboard_api;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.procurement_communication_messages
FROM dashboard_api;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM dashboard_api;
REVOKE CREATE ON SCHEMA public FROM bourne_supply_chain;
SELECT format(
  'REVOKE CREATE ON DATABASE %I FROM dashboard_api, bourne_supply_chain',
  current_database()
)
\gexec
GRANT USAGE ON SCHEMA public TO bourne_supply_chain;
REVOKE ALL ON public.procurement_communication_messages FROM bourne_supply_chain;
GRANT SELECT, INSERT ON public.procurement_communication_messages TO bourne_supply_chain;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.procurement_communication_messages
FROM bourne_supply_chain;

DO $$
BEGIN
  IF NOT has_table_privilege('dashboard_api', 'procurement_communication_messages', 'SELECT')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'INSERT')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'UPDATE')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'DELETE')
    OR has_table_privilege('dashboard_api', 'procurement_communication_messages', 'TRUNCATE')
    OR has_schema_privilege('dashboard_api', 'public', 'CREATE')
    OR has_database_privilege('dashboard_api', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'dashboard_api has unsafe procurement communication privileges';
  END IF;
  IF NOT has_table_privilege('bourne_supply_chain', 'procurement_communication_messages', 'SELECT')
    OR NOT has_table_privilege('bourne_supply_chain', 'procurement_communication_messages', 'INSERT')
    OR has_table_privilege('bourne_supply_chain', 'procurement_communication_messages', 'UPDATE')
    OR has_table_privilege('bourne_supply_chain', 'procurement_communication_messages', 'DELETE')
    OR has_table_privilege('bourne_supply_chain', 'procurement_communication_messages', 'TRUNCATE')
    OR has_schema_privilege('bourne_supply_chain', 'public', 'CREATE')
    OR has_database_privilege('bourne_supply_chain', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'bourne_supply_chain has unsafe procurement communication privileges';
  END IF;
END
$$;
