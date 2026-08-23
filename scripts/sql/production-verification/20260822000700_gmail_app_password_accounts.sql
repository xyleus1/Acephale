\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public."EmailAccount"') IS NULL
    OR to_regclass('public."EmailMessage"') IS NULL THEN
    RAISE EXCEPTION 'email integration tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'displayName'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'credentialSecret'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailMessage'
      AND column_name = 'rfcMessageId'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Gmail app-password columns are missing or unsafe';
  END IF;

  IF COALESCE(col_description('public."EmailAccount"'::regclass, (
    SELECT ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAccount'
      AND column_name = 'credentialSecret'
  )), '') NOT LIKE 'AES-256-GCM encrypted provider credential.%' THEN
    RAISE EXCEPTION 'encrypted credential column documentation is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260822000700_gmail_app_password_accounts'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Gmail app-password migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "provider" = 'GMAIL_APP_PASSWORD'
      AND (
        "credentialSecret" IS NULL
        OR "credentialSecret" NOT LIKE 'enc:v1:%'
        OR "accessToken" IS NOT NULL
        OR "refreshToken" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'a Gmail app-password account has unsafe credential state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."EmailAccount"
    WHERE "credentialSecret" IS NOT NULL
      AND "provider" <> 'GMAIL_APP_PASSWORD'
  ) THEN
    RAISE EXCEPTION 'an unsupported provider has an app-password credential';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260822000700_gmail_app_password_accounts',
  'app_password_accounts', count(*) FILTER (WHERE "provider" = 'GMAIL_APP_PASSWORD'),
  'encrypted_credentials', count(*) FILTER (WHERE "credentialSecret" LIKE 'enc:v1:%'),
  'send_enabled_accounts', count(*) FILTER (
    WHERE "provider" = 'GMAIL_APP_PASSWORD' AND "sendEnabled"
  )
) AS verification
FROM public."EmailAccount";

COMMIT;
