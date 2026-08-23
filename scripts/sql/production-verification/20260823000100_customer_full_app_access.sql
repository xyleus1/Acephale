\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'username'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'internalUserId'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerPortalUser'
      AND column_name = 'passwordEncrypted'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'customer full-app access columns are missing';
  END IF;

  IF to_regclass('public."CustomerPortalUser_officeId_username_key"') IS NULL
    OR to_regclass('public."CustomerPortalUser_internalUserId_key"') IS NULL THEN
    RAISE EXCEPTION 'customer account uniqueness indexes are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260823000100_customer_full_app_access'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'customer full-app access migration is not recorded as applied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."CustomerPortalUser" AS portal_user
    LEFT JOIN public."User" AS internal_user
      ON internal_user.id = portal_user."internalUserId"
      AND internal_user."officeId" = portal_user."officeId"
    WHERE portal_user.username IS NULL
      OR portal_user.username !~ '^[a-z0-9][a-z0-9._-]{2,79}$'
      OR portal_user."internalUserId" IS NULL
      OR internal_user.id IS NULL
      OR internal_user."canViewWholeOffice"
  ) THEN
    RAISE EXCEPTION 'customer app identity state is inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."CustomerPortalMembership" AS membership
    JOIN public."CustomerPortalUser" AS portal_user ON portal_user.id = membership."userId"
    JOIN public."SupplyWorkspace" AS workspace
      ON workspace."officeId" = membership."officeId"
      AND workspace."companyId" = membership."companyId"
      AND workspace.status = 'ACTIVE'
    LEFT JOIN public."SupplyWorkspaceMember" AS workspace_member
      ON workspace_member."workspaceId" = workspace.id
      AND workspace_member."userId" = portal_user."internalUserId"
    WHERE membership."isActive"
      AND (workspace_member.id IS NULL OR NOT workspace_member."isActive")
  ) THEN
    RAISE EXCEPTION 'active customer company access is not linked to the full app';
  END IF;
END
$$;

SELECT jsonb_build_object(
  'migration', '20260823000100_customer_full_app_access',
  'customer_accounts', count(*),
  'linked_app_accounts', count(*) FILTER (WHERE "internalUserId" IS NOT NULL),
  'visible_passwords', count(*) FILTER (WHERE "passwordEncrypted" IS NOT NULL)
) AS verification
FROM public."CustomerPortalUser";

COMMIT;
