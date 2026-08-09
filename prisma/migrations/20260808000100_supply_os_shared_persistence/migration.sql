-- CreateTable
CREATE TABLE "SupplyWorkspace" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT,
    "createdByUserId" TEXT,
    "externalKey" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyWorkspaceMember" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyWorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyImportRun" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "adapter" TEXT NOT NULL DEFAULT 'CSV',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceName" TEXT,
    "sourceHash" TEXT,
    "idempotencyKey" TEXT,
    "mapping" JSONB,
    "validation" JSONB,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplySnapshot" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "importRunId" TEXT,
    "createdByUserId" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceHash" TEXT,
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyLocation" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "locationKey" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyItem" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "externalId" TEXT,
    "sku" TEXT,
    "manufacturer" TEXT,
    "mpn" TEXT,
    "gtin" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'COMPONENT',
    "unitOfMeasure" TEXT NOT NULL,
    "metadata" JSONB,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyItemAlias" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "aliasType" TEXT NOT NULL,
    "aliasValue" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "canonicalItemKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DECIMAL(5,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyBomVersion" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "productItemId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceSystem" TEXT,
    "externalId" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyBomVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyBomLine" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "scrapRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "alternativeGroup" TEXT,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyBomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyInventoryPosition" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "positionKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "unitOfMeasure" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(20,6) NOT NULL,
    "quantityAllocated" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "quantityInTransit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "quantityOnOrder" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "asOf" TIMESTAMP(3) NOT NULL,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyInventoryPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyDemand" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "demandKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyMediaAsset" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "itemId" TEXT,
    "locationId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePageUrl" TEXT,
    "creator" TEXT,
    "license" TEXT,
    "attribution" TEXT,
    "contentHash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyWorkspace_officeId_status_updatedAt_idx" ON "SupplyWorkspace"("officeId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupplyWorkspace_officeId_companyId_status_idx" ON "SupplyWorkspace"("officeId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyWorkspace_officeId_externalKey_key" ON "SupplyWorkspace"("officeId", "externalKey");

-- CreateIndex
CREATE INDEX "SupplyWorkspaceMember_officeId_userId_isActive_idx" ON "SupplyWorkspaceMember"("officeId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "SupplyWorkspaceMember_officeId_workspaceId_isActive_idx" ON "SupplyWorkspaceMember"("officeId", "workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyWorkspaceMember_workspaceId_userId_key" ON "SupplyWorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "SupplyImportRun_officeId_workspaceId_status_createdAt_idx" ON "SupplyImportRun"("officeId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyImportRun_officeId_idempotencyKey_key" ON "SupplyImportRun"("officeId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplySnapshot_importRunId_key" ON "SupplySnapshot"("importRunId");

-- CreateIndex
CREATE INDEX "SupplySnapshot_officeId_workspaceId_status_publishedAt_idx" ON "SupplySnapshot"("officeId", "workspaceId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "SupplySnapshot_officeId_createdAt_idx" ON "SupplySnapshot"("officeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplySnapshot_workspaceId_version_key" ON "SupplySnapshot"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "SupplyLocation_officeId_workspaceId_name_idx" ON "SupplyLocation"("officeId", "workspaceId", "name");

-- CreateIndex
CREATE INDEX "SupplyLocation_officeId_countryCode_idx" ON "SupplyLocation"("officeId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyLocation_snapshotId_locationKey_key" ON "SupplyLocation"("snapshotId", "locationKey");

-- CreateIndex
CREATE INDEX "SupplyItem_officeId_workspaceId_sku_idx" ON "SupplyItem"("officeId", "workspaceId", "sku");

-- CreateIndex
CREATE INDEX "SupplyItem_officeId_manufacturer_mpn_idx" ON "SupplyItem"("officeId", "manufacturer", "mpn");

-- CreateIndex
CREATE INDEX "SupplyItem_officeId_gtin_idx" ON "SupplyItem"("officeId", "gtin");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyItem_snapshotId_itemKey_key" ON "SupplyItem"("snapshotId", "itemKey");

-- CreateIndex
CREATE INDEX "SupplyItemAlias_officeId_workspaceId_canonicalItemKey_isAct_idx" ON "SupplyItemAlias"("officeId", "workspaceId", "canonicalItemKey", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyItemAlias_workspaceId_aliasType_normalizedValue_key" ON "SupplyItemAlias"("workspaceId", "aliasType", "normalizedValue");

-- CreateIndex
CREATE INDEX "SupplyBomVersion_officeId_workspaceId_productItemId_idx" ON "SupplyBomVersion"("officeId", "workspaceId", "productItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyBomVersion_snapshotId_productItemId_revision_key" ON "SupplyBomVersion"("snapshotId", "productItemId", "revision");

-- CreateIndex
CREATE INDEX "SupplyBomLine_officeId_workspaceId_parentItemId_idx" ON "SupplyBomLine"("officeId", "workspaceId", "parentItemId");

-- CreateIndex
CREATE INDEX "SupplyBomLine_officeId_workspaceId_componentItemId_idx" ON "SupplyBomLine"("officeId", "workspaceId", "componentItemId");

-- CreateIndex
CREATE INDEX "SupplyBomLine_snapshotId_bomVersionId_idx" ON "SupplyBomLine"("snapshotId", "bomVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyBomLine_bomVersionId_lineNumber_key" ON "SupplyBomLine"("bomVersionId", "lineNumber");

-- CreateIndex
CREATE INDEX "SupplyInventoryPosition_officeId_workspaceId_itemId_idx" ON "SupplyInventoryPosition"("officeId", "workspaceId", "itemId");

-- CreateIndex
CREATE INDEX "SupplyInventoryPosition_officeId_workspaceId_locationId_idx" ON "SupplyInventoryPosition"("officeId", "workspaceId", "locationId");

-- CreateIndex
CREATE INDEX "SupplyInventoryPosition_snapshotId_asOf_idx" ON "SupplyInventoryPosition"("snapshotId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyInventoryPosition_snapshotId_positionKey_key" ON "SupplyInventoryPosition"("snapshotId", "positionKey");

-- CreateIndex
CREATE INDEX "SupplyDemand_officeId_workspaceId_itemId_status_idx" ON "SupplyDemand"("officeId", "workspaceId", "itemId", "status");

-- CreateIndex
CREATE INDEX "SupplyDemand_officeId_workspaceId_dueAt_status_idx" ON "SupplyDemand"("officeId", "workspaceId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "SupplyDemand_snapshotId_locationId_idx" ON "SupplyDemand"("snapshotId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyDemand_snapshotId_demandKey_key" ON "SupplyDemand"("snapshotId", "demandKey");

-- CreateIndex
CREATE INDEX "SupplyMediaAsset_officeId_workspaceId_kind_idx" ON "SupplyMediaAsset"("officeId", "workspaceId", "kind");

-- CreateIndex
CREATE INDEX "SupplyMediaAsset_officeId_itemId_isPrimary_idx" ON "SupplyMediaAsset"("officeId", "itemId", "isPrimary");

-- CreateIndex
CREATE INDEX "SupplyMediaAsset_officeId_locationId_isPrimary_idx" ON "SupplyMediaAsset"("officeId", "locationId", "isPrimary");

-- CreateIndex
CREATE INDEX "SupplyMediaAsset_snapshotId_idx" ON "SupplyMediaAsset"("snapshotId");

-- AddForeignKey
ALTER TABLE "SupplyWorkspace" ADD CONSTRAINT "SupplyWorkspace_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWorkspace" ADD CONSTRAINT "SupplyWorkspace_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWorkspace" ADD CONSTRAINT "SupplyWorkspace_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWorkspaceMember" ADD CONSTRAINT "SupplyWorkspaceMember_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWorkspaceMember" ADD CONSTRAINT "SupplyWorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWorkspaceMember" ADD CONSTRAINT "SupplyWorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyImportRun" ADD CONSTRAINT "SupplyImportRun_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyImportRun" ADD CONSTRAINT "SupplyImportRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyImportRun" ADD CONSTRAINT "SupplyImportRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplySnapshot" ADD CONSTRAINT "SupplySnapshot_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplySnapshot" ADD CONSTRAINT "SupplySnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplySnapshot" ADD CONSTRAINT "SupplySnapshot_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "SupplyImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplySnapshot" ADD CONSTRAINT "SupplySnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyLocation" ADD CONSTRAINT "SupplyLocation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyLocation" ADD CONSTRAINT "SupplyLocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyLocation" ADD CONSTRAINT "SupplyLocation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItemAlias" ADD CONSTRAINT "SupplyItemAlias_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItemAlias" ADD CONSTRAINT "SupplyItemAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItemAlias" ADD CONSTRAINT "SupplyItemAlias_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomVersion" ADD CONSTRAINT "SupplyBomVersion_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomVersion" ADD CONSTRAINT "SupplyBomVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomVersion" ADD CONSTRAINT "SupplyBomVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomVersion" ADD CONSTRAINT "SupplyBomVersion_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "SupplyBomVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBomLine" ADD CONSTRAINT "SupplyBomLine_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryPosition" ADD CONSTRAINT "SupplyInventoryPosition_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryPosition" ADD CONSTRAINT "SupplyInventoryPosition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryPosition" ADD CONSTRAINT "SupplyInventoryPosition_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryPosition" ADD CONSTRAINT "SupplyInventoryPosition_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyInventoryPosition" ADD CONSTRAINT "SupplyInventoryPosition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "SupplyLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDemand" ADD CONSTRAINT "SupplyDemand_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDemand" ADD CONSTRAINT "SupplyDemand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDemand" ADD CONSTRAINT "SupplyDemand_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDemand" ADD CONSTRAINT "SupplyDemand_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDemand" ADD CONSTRAINT "SupplyDemand_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "SupplyLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMediaAsset" ADD CONSTRAINT "SupplyMediaAsset_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMediaAsset" ADD CONSTRAINT "SupplyMediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMediaAsset" ADD CONSTRAINT "SupplyMediaAsset_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMediaAsset" ADD CONSTRAINT "SupplyMediaAsset_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMediaAsset" ADD CONSTRAINT "SupplyMediaAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "SupplyLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supply OS integrity guards
ALTER TABLE "SupplyWorkspace"
ADD CONSTRAINT "SupplyWorkspace_version_check"
CHECK ("version" > 0);

ALTER TABLE "SupplySnapshot"
ADD CONSTRAINT "SupplySnapshot_version_check"
CHECK ("version" > 0 AND "schemaVersion" > 0),
ADD CONSTRAINT "SupplySnapshot_publish_state_check"
CHECK (
    ("status" = 'DRAFT' AND "publishedAt" IS NULL)
    OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
);

ALTER TABLE "SupplyItemAlias"
ADD CONSTRAINT "SupplyItemAlias_confidence_check"
CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "SupplyBomLine"
ADD CONSTRAINT "SupplyBomLine_quantity_check"
CHECK ("quantity" > 0),
ADD CONSTRAINT "SupplyBomLine_scrapRate_check"
CHECK ("scrapRate" >= 0 AND "scrapRate" <= 1),
ADD CONSTRAINT "SupplyBomLine_distinct_items_check"
CHECK ("parentItemId" <> "componentItemId");

ALTER TABLE "SupplyDemand"
ADD CONSTRAINT "SupplyDemand_quantity_check"
CHECK ("quantity" > 0);

ALTER TABLE "SupplyLocation"
ADD CONSTRAINT "SupplyLocation_coordinates_check"
CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR (
        "latitude" BETWEEN -90 AND 90
        AND "longitude" BETWEEN -180 AND 180
    )
);

-- Every workspace-owned row must agree with its workspace tenant.
CREATE FUNCTION supply_assert_workspace_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "SupplyWorkspace"
        WHERE "id" = NEW."workspaceId"
          AND "officeId" = NEW."officeId"
    ) THEN
        RAISE EXCEPTION 'Supply OS workspace and office scope do not match';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyWorkspaceMember_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyWorkspaceMember"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyImportRun_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyImportRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplySnapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplySnapshot"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyLocation_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyLocation"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyItem_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyItem"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyItemAlias_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyItemAlias"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyBomVersion_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomVersion"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyBomLine_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyInventoryPosition_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyInventoryPosition"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyDemand_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDemand"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyMediaAsset_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyMediaAsset"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

-- Snapshot-owned rows must point to a snapshot in the same office and workspace.
CREATE FUNCTION supply_assert_snapshot_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."snapshotId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "SupplySnapshot"
        WHERE "id" = NEW."snapshotId"
          AND "officeId" = NEW."officeId"
          AND "workspaceId" = NEW."workspaceId"
    ) THEN
        RAISE EXCEPTION 'Supply OS snapshot scope does not match its child row';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyLocation_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyLocation"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyItem_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyItem"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyBomVersion_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomVersion"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyBomLine_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyInventoryPosition_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyInventoryPosition"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyDemand_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDemand"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

CREATE TRIGGER "SupplyMediaAsset_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyMediaAsset"
FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();

-- A published snapshot and its children are append-closed. A maintenance
-- transaction may opt in to erasure by setting derya.allow_supply_snapshot_mutation.
CREATE FUNCTION supply_prevent_published_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_snapshot_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF OLD."status" = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Published Supply OS snapshots are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplySnapshot_immutable_guard"
BEFORE UPDATE OR DELETE ON "SupplySnapshot"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_snapshot_mutation();

CREATE FUNCTION supply_prevent_published_child_mutation()
RETURNS TRIGGER AS $$
DECLARE
    previous_snapshot_id TEXT;
    next_snapshot_id TEXT;
BEGIN
    IF current_setting('derya.allow_supply_snapshot_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        next_snapshot_id := NEW."snapshotId";
    ELSIF TG_OP = 'UPDATE' THEN
        previous_snapshot_id := OLD."snapshotId";
        next_snapshot_id := NEW."snapshotId";
    ELSE
        previous_snapshot_id := OLD."snapshotId";
    END IF;

    IF previous_snapshot_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM "SupplySnapshot"
        WHERE "id" = previous_snapshot_id AND "status" = 'PUBLISHED'
    ) THEN
        RAISE EXCEPTION 'Published Supply OS snapshot children are immutable';
    END IF;

    IF next_snapshot_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM "SupplySnapshot"
        WHERE "id" = next_snapshot_id AND "status" = 'PUBLISHED'
    ) THEN
        RAISE EXCEPTION 'Published Supply OS snapshots cannot accept new children';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyLocation_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyLocation"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyItem_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyItem"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyBomVersion_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyBomVersion"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyBomLine_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyInventoryPosition_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyInventoryPosition"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyDemand_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyDemand"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();

CREATE TRIGGER "SupplyMediaAsset_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyMediaAsset"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();
