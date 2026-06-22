-- Additive logistics intelligence layer.
-- MarketSignal stores operational interpretations of external freight updates.
-- MarketSignalLink connects those signals to affected customers, jobs, RFQs,
-- and lane-like entities without overwriting operational truth.

CREATE TABLE "MarketSignal" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "sourceObjectId" TEXT,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "affectedModes" JSONB NOT NULL,
  "affectedOrigins" JSONB NOT NULL,
  "affectedDestinations" JSONB NOT NULL,
  "affectedPorts" JSONB NOT NULL,
  "affectedLanes" JSONB NOT NULL,
  "affectedCarriers" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "summary" TEXT NOT NULL,
  "operatorImplication" TEXT,
  "pricingImplication" TEXT,
  "customerImpact" TEXT,
  "recommendedActions" JSONB NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSignalLink" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "signalId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "matchType" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketSignalLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketSignal_officeId_dedupeKey_key" ON "MarketSignal"("officeId", "dedupeKey");
CREATE INDEX "MarketSignal_officeId_category_severity_createdAt_idx" ON "MarketSignal"("officeId", "category", "severity", "createdAt");
CREATE INDEX "MarketSignal_officeId_effectiveFrom_effectiveTo_idx" ON "MarketSignal"("officeId", "effectiveFrom", "effectiveTo");
CREATE INDEX "MarketSignal_officeId_sourceObjectId_idx" ON "MarketSignal"("officeId", "sourceObjectId");

CREATE UNIQUE INDEX "MarketSignalLink_signalId_entityType_entityId_key" ON "MarketSignalLink"("signalId", "entityType", "entityId");
CREATE INDEX "MarketSignalLink_officeId_entityType_entityId_idx" ON "MarketSignalLink"("officeId", "entityType", "entityId");
CREATE INDEX "MarketSignalLink_officeId_signalId_idx" ON "MarketSignalLink"("officeId", "signalId");

ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_sourceObjectId_fkey" FOREIGN KEY ("sourceObjectId") REFERENCES "KnowledgeObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketSignalLink" ADD CONSTRAINT "MarketSignalLink_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketSignalLink" ADD CONSTRAINT "MarketSignalLink_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
