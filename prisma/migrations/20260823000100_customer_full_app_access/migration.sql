ALTER TABLE "CustomerPortalUser"
  ADD COLUMN "internalUserId" TEXT,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "passwordEncrypted" TEXT;

WITH account_company AS (
  SELECT
    portal_user.id,
    portal_user."officeId",
    lower(regexp_replace(
      COALESCE(
        NULLIF(company.name, ''),
        NULLIF(split_part(portal_user.email, '@', 1), ''),
        'customer'
      ),
      '[^a-zA-Z0-9._-]+',
      '',
      'g'
    )) AS base_username
  FROM "CustomerPortalUser" AS portal_user
  LEFT JOIN LATERAL (
    SELECT company.name
    FROM "CustomerPortalMembership" AS membership
    JOIN "Company" AS company ON company.id = membership."companyId"
    WHERE membership."userId" = portal_user.id
      AND membership."officeId" = portal_user."officeId"
    ORDER BY membership."isActive" DESC, membership."createdAt" ASC
    LIMIT 1
  ) AS company ON true
), normalized AS (
  SELECT
    id,
    "officeId",
    CASE
      WHEN length(base_username) BETWEEN 3 AND 72 THEN base_username
      ELSE 'customer_' || substring(md5(id), 1, 12)
    END AS base_username
  FROM account_company
), ranked AS (
  SELECT
    id,
    base_username,
    row_number() OVER (PARTITION BY "officeId", base_username ORDER BY id) AS username_rank
  FROM normalized
)
UPDATE "CustomerPortalUser" AS portal_user
SET username = CASE
  WHEN ranked.username_rank = 1 THEN ranked.base_username
  ELSE left(ranked.base_username, 72) || '_' || ranked.username_rank::text
END
FROM ranked
WHERE ranked.id = portal_user.id;

INSERT INTO "User" (
  id,
  "officeId",
  email,
  "passwordHash",
  "fullName",
  role,
  "isActive",
  "canViewWholeOffice",
  "createdAt",
  "updatedAt"
)
SELECT
  'customer_' || portal_user.id,
  portal_user."officeId",
  'customer+' || portal_user.id || '@internal.derya.invalid',
  'customer-portal-managed',
  COALESCE(NULLIF(portal_user."fullName", ''), portal_user.username),
  'ADMIN'::"UserRole",
  portal_user."isActive",
  false,
  portal_user."createdAt",
  NOW()
FROM "CustomerPortalUser" AS portal_user;

UPDATE "CustomerPortalUser"
SET "internalUserId" = 'customer_' || id;

INSERT INTO "SupplyWorkspaceMember" (
  id,
  "officeId",
  "workspaceId",
  "userId",
  role,
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'customer_access_' || md5(workspace.id || ':' || portal_user."internalUserId"),
  membership."officeId",
  workspace.id,
  portal_user."internalUserId",
  CASE
    WHEN membership.role = 'ADMIN' THEN 'OWNER'
    WHEN membership.role = 'VIEWER' THEN 'VIEWER'
    ELSE 'EDITOR'
  END,
  membership."isActive",
  membership."createdAt",
  NOW()
FROM "CustomerPortalMembership" AS membership
JOIN "CustomerPortalUser" AS portal_user ON portal_user.id = membership."userId"
JOIN LATERAL (
  SELECT candidate.id
  FROM "SupplyWorkspace" AS candidate
  WHERE candidate."officeId" = membership."officeId"
    AND candidate."companyId" = membership."companyId"
    AND candidate.status = 'ACTIVE'
  ORDER BY candidate."updatedAt" DESC
  LIMIT 1
) AS workspace ON true
ON CONFLICT ("workspaceId", "userId") DO UPDATE
SET
  role = EXCLUDED.role,
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = NOW();

CREATE UNIQUE INDEX "CustomerPortalUser_officeId_username_key"
  ON "CustomerPortalUser"("officeId", username);

CREATE UNIQUE INDEX "CustomerPortalUser_internalUserId_key"
  ON "CustomerPortalUser"("internalUserId");

ALTER TABLE "CustomerPortalUser"
  ADD CONSTRAINT "CustomerPortalUser_internalUserId_fkey"
  FOREIGN KEY ("internalUserId") REFERENCES "User"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;
