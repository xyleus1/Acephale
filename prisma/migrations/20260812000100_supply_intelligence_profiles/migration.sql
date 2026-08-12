BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "SupplySupplierProfile" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "linkedCompanyId" TEXT,
    "lastResearchRunId" TEXT,
    "supplierKey" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "websiteDomain" TEXT,
    "roles" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplySupplierProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyProfileFact" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "capabilityRunId" TEXT,
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "contentHash" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyProfileFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyBenchmarkSeries" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "materialKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "delayMinutes" INTEGER,
    "currency" TEXT,
    "unitOfMeasure" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplyBenchmarkSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyPriceObservation" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierProfileId" TEXT,
    "benchmarkSeriesId" TEXT,
    "capabilityRunId" TEXT,
    "evidenceId" TEXT,
    "itemKey" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "minimumQuantity" DECIMAL(20,6),
    "availableQuantity" DECIMAL(20,6),
    "sourceUrl" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "contentHash" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplyPriceObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplySupplierProfile_workspaceId_supplierKey_key" ON "SupplySupplierProfile"("workspaceId", "supplierKey");
CREATE INDEX "SupplySupplierProfile_officeId_workspaceId_status_lastSeenAt_idx" ON "SupplySupplierProfile"("officeId", "workspaceId", "status", "lastSeenAt");
CREATE INDEX "SupplySupplierProfile_officeId_websiteDomain_idx" ON "SupplySupplierProfile"("officeId", "websiteDomain");
CREATE INDEX "SupplySupplierProfile_linkedCompanyId_idx" ON "SupplySupplierProfile"("linkedCompanyId");
CREATE INDEX "SupplySupplierProfile_lastResearchRunId_idx" ON "SupplySupplierProfile"("lastResearchRunId");

CREATE UNIQUE INDEX "SupplyProfileFact_workspaceId_contentHash_key" ON "SupplyProfileFact"("workspaceId", "contentHash");
CREATE INDEX "SupplyProfileFact_officeId_workspaceId_subjectType_subjectRef_capturedAt_idx" ON "SupplyProfileFact"("officeId", "workspaceId", "subjectType", "subjectRef", "capturedAt");
CREATE INDEX "SupplyProfileFact_capabilityRunId_idx" ON "SupplyProfileFact"("capabilityRunId");
CREATE INDEX "SupplyProfileFact_evidenceId_idx" ON "SupplyProfileFact"("evidenceId");

CREATE UNIQUE INDEX "SupplyBenchmarkSeries_workspaceId_seriesKey_key" ON "SupplyBenchmarkSeries"("workspaceId", "seriesKey");
CREATE INDEX "SupplyBenchmarkSeries_officeId_workspaceId_materialKey_status_idx" ON "SupplyBenchmarkSeries"("officeId", "workspaceId", "materialKey", "status");

CREATE UNIQUE INDEX "SupplyPriceObservation_workspaceId_contentHash_key" ON "SupplyPriceObservation"("workspaceId", "contentHash");
CREATE INDEX "SupplyPriceObservation_officeId_workspaceId_itemKey_observedAt_idx" ON "SupplyPriceObservation"("officeId", "workspaceId", "itemKey", "observedAt");
CREATE INDEX "SupplyPriceObservation_supplierProfileId_itemKey_observedAt_idx" ON "SupplyPriceObservation"("supplierProfileId", "itemKey", "observedAt");
CREATE INDEX "SupplyPriceObservation_benchmarkSeriesId_observedAt_idx" ON "SupplyPriceObservation"("benchmarkSeriesId", "observedAt");
CREATE INDEX "SupplyPriceObservation_capabilityRunId_idx" ON "SupplyPriceObservation"("capabilityRunId");
CREATE INDEX "SupplyPriceObservation_evidenceId_idx" ON "SupplyPriceObservation"("evidenceId");

ALTER TABLE "SupplySupplierProfile" ADD CONSTRAINT "SupplySupplierProfile_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierProfile" ADD CONSTRAINT "SupplySupplierProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierProfile" ADD CONSTRAINT "SupplySupplierProfile_linkedCompanyId_fkey" FOREIGN KEY ("linkedCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplySupplierProfile" ADD CONSTRAINT "SupplySupplierProfile_lastResearchRunId_fkey" FOREIGN KEY ("lastResearchRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_capabilityRunId_fkey" FOREIGN KEY ("capabilityRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplyBenchmarkSeries" ADD CONSTRAINT "SupplyBenchmarkSeries_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyBenchmarkSeries" ADD CONSTRAINT "SupplyBenchmarkSeries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplySupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_benchmarkSeriesId_fkey" FOREIGN KEY ("benchmarkSeriesId") REFERENCES "SupplyBenchmarkSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_capabilityRunId_fkey" FOREIGN KEY ("capabilityRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplySupplierProfile" ADD CONSTRAINT "SupplySupplierProfile_status_check" CHECK ("status" IN ('CANDIDATE', 'QUALIFIED', 'REJECTED', 'ARCHIVED'));
ALTER TABLE "SupplyProfileFact" ADD CONSTRAINT "SupplyProfileFact_subject_check" CHECK ("subjectType" IN ('CUSTOMER', 'SUPPLIER', 'ITEM'));
ALTER TABLE "SupplyBenchmarkSeries" ADD CONSTRAINT "SupplyBenchmarkSeries_cadence_check" CHECK ("cadence" IN ('REAL_TIME', 'DELAYED', 'DAILY', 'WEEKLY', 'MONTHLY'));
ALTER TABLE "SupplyBenchmarkSeries" ADD CONSTRAINT "SupplyBenchmarkSeries_status_check" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'RETIRED'));
ALTER TABLE "SupplyBenchmarkSeries" ADD CONSTRAINT "SupplyBenchmarkSeries_delay_check" CHECK ("delayMinutes" IS NULL OR "delayMinutes" >= 0);
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_value_check" CHECK ("amount" >= 0 AND ("minimumQuantity" IS NULL OR "minimumQuantity" >= 0) AND ("availableQuantity" IS NULL OR "availableQuantity" >= 0));
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_subject_check" CHECK ("supplierProfileId" IS NOT NULL OR "benchmarkSeriesId" IS NOT NULL);
ALTER TABLE "SupplyPriceObservation" ADD CONSTRAINT "SupplyPriceObservation_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" >= "observedAt");

CREATE TRIGGER "SupplySupplierProfile_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyProfileFact_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyProfileFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyBenchmarkSeries_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyBenchmarkSeries" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyPriceObservation_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplySupplierProfile_company_scope_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('Company', 'linkedCompanyId');
CREATE TRIGGER "SupplySupplierProfile_run_scope_guard" BEFORE INSERT OR UPDATE ON "SupplySupplierProfile" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'lastResearchRunId');
CREATE TRIGGER "SupplyProfileFact_run_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyProfileFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'capabilityRunId');
CREATE TRIGGER "SupplyProfileFact_evidence_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyProfileFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyEvidence', 'evidenceId');
CREATE TRIGGER "SupplyProfileFact_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyProfileFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');
CREATE TRIGGER "SupplyPriceObservation_supplier_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySupplierProfile', 'supplierProfileId');
CREATE TRIGGER "SupplyPriceObservation_benchmark_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyBenchmarkSeries', 'benchmarkSeriesId');
CREATE TRIGGER "SupplyPriceObservation_run_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'capabilityRunId');
CREATE TRIGGER "SupplyPriceObservation_evidence_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyEvidence', 'evidenceId');

CREATE TRIGGER "SupplyProfileFact_append_only_guard" BEFORE UPDATE OR DELETE ON "SupplyProfileFact" FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyPriceObservation_append_only_guard" BEFORE UPDATE OR DELETE ON "SupplyPriceObservation" FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();

COMMIT;
