ALTER TABLE "SupplyInventoryPosition"
ADD COLUMN "expectedReceiptAt" TIMESTAMP(3);

CREATE TABLE "SupplySupplierTerm" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "termKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "facilityId" TEXT,
    "supplierKey" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "unitOfMeasure" TEXT NOT NULL,
    "currency" TEXT,
    "unitPrice" DECIMAL(20,6),
    "modeledFreightPerUnit" DECIMAL(20,6),
    "evidencedDutyPerUnit" DECIMAL(20,6),
    "dutyEvidenceRefs" JSONB,
    "leadTimeMinDays" INTEGER,
    "leadTimeMaxDays" INTEGER,
    "availableQuantity" DECIMAL(20,6),
    "availableAt" TIMESTAMP(3),
    "evidenceRefs" JSONB,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplySupplierTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyEquivalenceRule" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fromItemKey" TEXT NOT NULL,
    "toItemKey" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "constraints" JSONB,
    "evidenceRefs" JSONB,
    "ruleHash" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyEquivalenceRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyFccProfile" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "moduleAuthorization" TEXT NOT NULL,
    "moduleAuthorizationEvidenceRefs" JSONB,
    "hostIntegrationConstraints" JSONB,
    "labeling" TEXT NOT NULL,
    "labelingEvidenceRefs" JSONB,
    "rfExposure" TEXT NOT NULL,
    "rfExposureEvidenceRefs" JSONB,
    "testing" TEXT NOT NULL,
    "testingEvidenceRefs" JSONB,
    "testingGaps" JSONB,
    "reviewRequirements" JSONB,
    "blockedReasons" JSONB,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyFccProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyPlanningResult" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "engineVersion" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "normalizedInputHash" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "unknowns" JSONB NOT NULL,
    "evidenceReferences" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "outputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyPlanningResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplySupplierTerm_snapshotId_termKey_key" ON "SupplySupplierTerm"("snapshotId", "termKey");
CREATE INDEX "SupplySupplierTerm_officeId_workspaceId_itemId_isCurrent_idx" ON "SupplySupplierTerm"("officeId", "workspaceId", "itemId", "isCurrent");
CREATE INDEX "SupplySupplierTerm_snapshotId_facilityId_idx" ON "SupplySupplierTerm"("snapshotId", "facilityId");
CREATE UNIQUE INDEX "SupplyEquivalenceRule_workspaceId_ruleKey_version_key" ON "SupplyEquivalenceRule"("workspaceId", "ruleKey", "version");
CREATE INDEX "SupplyEquivalenceRule_officeId_workspaceId_fromItemKey_status_idx" ON "SupplyEquivalenceRule"("officeId", "workspaceId", "fromItemKey", "status");
CREATE INDEX "SupplyEquivalenceRule_officeId_workspaceId_toItemKey_status_idx" ON "SupplyEquivalenceRule"("officeId", "workspaceId", "toItemKey", "status");
CREATE UNIQUE INDEX "SupplyFccProfile_itemId_key" ON "SupplyFccProfile"("itemId");
CREATE INDEX "SupplyFccProfile_officeId_workspaceId_moduleAuthorization_idx" ON "SupplyFccProfile"("officeId", "workspaceId", "moduleAuthorization");
CREATE UNIQUE INDEX "SupplyPlanningResult_workspaceId_normalizedInputHash_key" ON "SupplyPlanningResult"("workspaceId", "normalizedInputHash");
CREATE INDEX "SupplyPlanningResult_officeId_workspaceId_createdAt_idx" ON "SupplyPlanningResult"("officeId", "workspaceId", "createdAt");
CREATE INDEX "SupplyPlanningResult_snapshotId_engineVersion_idx" ON "SupplyPlanningResult"("snapshotId", "engineVersion");
CREATE INDEX "SupplyPlanningResult_outputHash_idx" ON "SupplyPlanningResult"("outputHash");

ALTER TABLE "SupplySupplierTerm"
ADD CONSTRAINT "SupplySupplierTerm_nonnegative_check" CHECK (
    ("unitPrice" IS NULL OR "unitPrice" >= 0)
    AND ("modeledFreightPerUnit" IS NULL OR "modeledFreightPerUnit" >= 0)
    AND ("evidencedDutyPerUnit" IS NULL OR "evidencedDutyPerUnit" >= 0)
    AND ("leadTimeMinDays" IS NULL OR "leadTimeMinDays" >= 0)
    AND ("leadTimeMaxDays" IS NULL OR "leadTimeMaxDays" >= 0)
    AND ("availableQuantity" IS NULL OR "availableQuantity" >= 0)
),
ADD CONSTRAINT "SupplySupplierTerm_lead_range_check" CHECK (
    "leadTimeMinDays" IS NULL OR "leadTimeMaxDays" IS NULL OR "leadTimeMinDays" <= "leadTimeMaxDays"
);

ALTER TABLE "SupplyEquivalenceRule"
ADD CONSTRAINT "SupplyEquivalenceRule_action_check" CHECK ("action" IN ('REPLACE', 'REMOVE')),
ADD CONSTRAINT "SupplyEquivalenceRule_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'REVOKED')),
ADD CONSTRAINT "SupplyEquivalenceRule_target_check" CHECK (
    ("action" = 'REMOVE' AND "toItemKey" IS NULL)
    OR ("action" = 'REPLACE' AND "toItemKey" IS NOT NULL AND "fromItemKey" <> "toItemKey")
),
ADD CONSTRAINT "SupplyEquivalenceRule_approval_check" CHECK (
    "status" <> 'APPROVED' OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
);

ALTER TABLE "SupplyFccProfile"
ADD CONSTRAINT "SupplyFccProfile_module_check" CHECK ("moduleAuthorization" IN ('EVIDENCED', 'MISSING', 'BLOCKED', 'NOT_APPLICABLE')),
ADD CONSTRAINT "SupplyFccProfile_labeling_check" CHECK ("labeling" IN ('EVIDENCED', 'MISSING', 'NOT_APPLICABLE')),
ADD CONSTRAINT "SupplyFccProfile_rf_exposure_check" CHECK ("rfExposure" IN ('EVIDENCED', 'MISSING', 'NOT_APPLICABLE')),
ADD CONSTRAINT "SupplyFccProfile_testing_check" CHECK ("testing" IN ('EVIDENCED', 'GAPS', 'NOT_APPLICABLE'));

ALTER TABLE "SupplySupplierTerm" ADD CONSTRAINT "SupplySupplierTerm_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierTerm" ADD CONSTRAINT "SupplySupplierTerm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierTerm" ADD CONSTRAINT "SupplySupplierTerm_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierTerm" ADD CONSTRAINT "SupplySupplierTerm_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierTerm" ADD CONSTRAINT "SupplySupplierTerm_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "SupplyLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyEquivalenceRule" ADD CONSTRAINT "SupplyEquivalenceRule_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyEquivalenceRule" ADD CONSTRAINT "SupplyEquivalenceRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyEquivalenceRule" ADD CONSTRAINT "SupplyEquivalenceRule_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyFccProfile" ADD CONSTRAINT "SupplyFccProfile_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyFccProfile" ADD CONSTRAINT "SupplyFccProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyFccProfile" ADD CONSTRAINT "SupplyFccProfile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyFccProfile" ADD CONSTRAINT "SupplyFccProfile_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPlanningResult" ADD CONSTRAINT "SupplyPlanningResult_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPlanningResult" ADD CONSTRAINT "SupplyPlanningResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPlanningResult" ADD CONSTRAINT "SupplyPlanningResult_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPlanningResult" ADD CONSTRAINT "SupplyPlanningResult_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER "SupplySupplierTerm_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierTerm" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyEquivalenceRule_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyEquivalenceRule" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyFccProfile_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyFccProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyPlanningResult_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPlanningResult" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplySupplierTerm_snapshot_scope_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierTerm" FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();
CREATE TRIGGER "SupplyFccProfile_snapshot_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyFccProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_snapshot_scope();
CREATE TRIGGER "SupplyPlanningResult_snapshot_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPlanningResult" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySnapshot', 'snapshotId');
CREATE TRIGGER "SupplyEquivalenceRule_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyEquivalenceRule" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('approvedByUserId');
CREATE TRIGGER "SupplyPlanningResult_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPlanningResult" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');

CREATE TRIGGER "SupplySupplierTerm_item_snapshot_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierTerm" FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'itemId');
CREATE TRIGGER "SupplySupplierTerm_facility_snapshot_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierTerm" FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyLocation', 'facilityId');
CREATE TRIGGER "SupplyFccProfile_item_snapshot_guard" BEFORE INSERT OR UPDATE ON "SupplyFccProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'itemId');

CREATE TRIGGER "SupplySupplierTerm_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupplySupplierTerm" FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();
CREATE TRIGGER "SupplyFccProfile_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupplyFccProfile" FOR EACH ROW EXECUTE FUNCTION supply_prevent_published_child_mutation();
CREATE TRIGGER "SupplyPlanningResult_append_only_guard" BEFORE UPDATE OR DELETE ON "SupplyPlanningResult" FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyEquivalenceRule_append_only_guard" BEFORE UPDATE OR DELETE ON "SupplyEquivalenceRule" FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
