-- Carrier bench: vetted trucking-carrier directory + vetting checklist
-- (CA tech-freight niche). Additive only — new tables, no existing-table changes.

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "mcNumber" TEXT,
    "dotNumber" TEXT,
    "scac" TEXT,
    "dispatchEmail" TEXT,
    "dispatchPhone" TEXT,
    "verifiedPhone" TEXT,
    "emailDomain" TEXT,
    "emailDomainVerified" BOOLEAN NOT NULL DEFAULT false,
    "factoringCompany" TEXT,
    "authorityFirstActive" TIMESTAMP(3),
    "fraudFlags" JSONB,
    "identityVerifiedAt" TIMESTAMP(3),
    "identityVerifiedBy" TEXT,
    "authorityStatus" TEXT,
    "insuranceProducer" TEXT,
    "autoLiabilityLimit" DOUBLE PRECISION,
    "cargoLimit" DOUBLE PRECISION,
    "autoInsuranceExpiry" TIMESTAMP(3),
    "cargoInsuranceExpiry" TIMESTAMP(3),
    "coiUrl" TEXT,
    "highValueApprovedLimit" DOUBLE PRECISION,
    "equipmentTypes" JSONB,
    "airRide" BOOLEAN NOT NULL DEFAULT false,
    "liftgate" BOOLEAN NOT NULL DEFAULT false,
    "blanketWrap" BOOLEAN NOT NULL DEFAULT false,
    "teamDrivers" BOOLEAN NOT NULL DEFAULT false,
    "hazmatCertified" BOOLEAN NOT NULL DEFAULT false,
    "lithiumCapable" BOOLEAN NOT NULL DEFAULT false,
    "reeferCapable" BOOLEAN NOT NULL DEFAULT false,
    "securityFeatures" JSONB,
    "serviceStates" JSONB,
    "homeBase" TEXT,
    "vettingStatus" TEXT NOT NULL DEFAULT 'prospect',
    "vettingNotes" TEXT,
    "vettedAt" TIMESTAMP(3),
    "vettedByUserId" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "loadsCompleted" INTEGER NOT NULL DEFAULT 0,
    "onTimePickupPct" DOUBLE PRECISION,
    "onTimeDeliveryPct" DOUBLE PRECISION,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "incidentCount" INTEGER NOT NULL DEFAULT 0,
    "scorecardScore" DOUBLE PRECISION,
    "scorecardAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierChecklistItem" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "evidenceUrl" TEXT,
    "checkedByUserId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_officeId_mcNumber_key" ON "Carrier"("officeId", "mcNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_officeId_dotNumber_key" ON "Carrier"("officeId", "dotNumber");

-- CreateIndex
CREATE INDEX "Carrier_officeId_vettingStatus_active_idx" ON "Carrier"("officeId", "vettingStatus", "active");

-- CreateIndex
CREATE INDEX "Carrier_officeId_name_idx" ON "Carrier"("officeId", "name");

-- CreateIndex
CREATE INDEX "Carrier_officeId_cargoInsuranceExpiry_idx" ON "Carrier"("officeId", "cargoInsuranceExpiry");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierChecklistItem_carrierId_key_key" ON "CarrierChecklistItem"("carrierId", "key");

-- CreateIndex
CREATE INDEX "CarrierChecklistItem_officeId_carrierId_status_idx" ON "CarrierChecklistItem"("officeId", "carrierId", "status");

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierChecklistItem" ADD CONSTRAINT "CarrierChecklistItem_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierChecklistItem" ADD CONSTRAINT "CarrierChecklistItem_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
