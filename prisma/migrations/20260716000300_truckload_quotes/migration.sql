-- Quote flywheel: truckload buy-side bids (CarrierBid) and sell-side
-- quote+outcome rows (TruckloadQuote). Additive only — CarrierQuote stays
-- ocean-shaped for the international stack.

-- CreateTable
CREATE TABLE "CarrierBid" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "jobId" TEXT,
    "carrierId" TEXT,
    "carrierName" TEXT NOT NULL,
    "equipmentType" TEXT,
    "linehaulAmount" DOUBLE PRECISION,
    "fscAmount" DOUBLE PRECISION,
    "accessorialAmount" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "miles" DOUBLE PRECISION,
    "ratePerMile" DOUBLE PRECISION,
    "transitDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckloadQuote" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "jobId" TEXT,
    "companyId" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "originState" TEXT,
    "destState" TEXT,
    "miles" DOUBLE PRECISION,
    "mode" TEXT,
    "equipmentType" TEXT,
    "commodityCategory" TEXT,
    "securityTier" TEXT,
    "declaredValue" DOUBLE PRECISION,
    "buyAmount" DOUBLE PRECISION,
    "buySource" TEXT,
    "carrierBidId" TEXT,
    "carrierId" TEXT,
    "sellAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "marginPct" DOUBLE PRECISION,
    "grossProfit" DOUBLE PRECISION,
    "ratePerMile" DOUBLE PRECISION,
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "rfqReceivedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "outcomeReason" TEXT,
    "outcomeNote" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TruckloadQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarrierBid_officeId_inquiryId_idx" ON "CarrierBid"("officeId", "inquiryId");

-- CreateIndex
CREATE INDEX "CarrierBid_officeId_jobId_idx" ON "CarrierBid"("officeId", "jobId");

-- CreateIndex
CREATE INDEX "CarrierBid_officeId_carrierId_createdAt_idx" ON "CarrierBid"("officeId", "carrierId", "createdAt");

-- CreateIndex
CREATE INDEX "TruckloadQuote_officeId_outcome_createdAt_idx" ON "TruckloadQuote"("officeId", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "TruckloadQuote_officeId_originState_destState_equipmentType_idx" ON "TruckloadQuote"("officeId", "originState", "destState", "equipmentType");

-- CreateIndex
CREATE INDEX "TruckloadQuote_officeId_inquiryId_idx" ON "TruckloadQuote"("officeId", "inquiryId");

-- CreateIndex
CREATE INDEX "TruckloadQuote_officeId_companyId_createdAt_idx" ON "TruckloadQuote"("officeId", "companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "CarrierBid" ADD CONSTRAINT "CarrierBid_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierBid" ADD CONSTRAINT "CarrierBid_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierBid" ADD CONSTRAINT "CarrierBid_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierBid" ADD CONSTRAINT "CarrierBid_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckloadQuote" ADD CONSTRAINT "TruckloadQuote_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckloadQuote" ADD CONSTRAINT "TruckloadQuote_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckloadQuote" ADD CONSTRAINT "TruckloadQuote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckloadQuote" ADD CONSTRAINT "TruckloadQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
