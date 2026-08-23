ALTER TABLE "CompanyContext"
  ADD COLUMN "createdByPortalUserId" TEXT,
  ADD COLUMN "customerVisible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CompanyContext"
  ADD CONSTRAINT "CompanyContext_createdByPortalUserId_fkey"
  FOREIGN KEY ("createdByPortalUserId") REFERENCES "CustomerPortalUser"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "CompanyContext_officeId_companyId_customerVisible_createdAt_idx"
  ON "CompanyContext"("officeId", "companyId", "customerVisible", "createdAt");

CREATE INDEX "CompanyContext_createdByPortalUserId_createdAt_idx"
  ON "CompanyContext"("createdByPortalUserId", "createdAt");

CREATE OR REPLACE FUNCTION company_context_scope_guard()
RETURNS TRIGGER AS $$
DECLARE company_office TEXT;
DECLARE item_company TEXT;
DECLARE item_office TEXT;
DECLARE user_office TEXT;
DECLARE portal_user_office TEXT;
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
  IF NEW."createdByPortalUserId" IS NOT NULL THEN
    SELECT "officeId" INTO portal_user_office
    FROM "CustomerPortalUser"
    WHERE id = NEW."createdByPortalUserId";
    IF portal_user_office IS DISTINCT FROM NEW."officeId" THEN
      RAISE EXCEPTION 'CompanyContext portal creator is outside the office scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
