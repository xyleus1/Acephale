-- Phase 2D: provider-level observability for controlled Firecrawl market ingestion.

CREATE TABLE "MarketIngestionRun" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceId" TEXT,
    "query" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "objectCount" INTEGER NOT NULL DEFAULT 0,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketIngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketIngestionRun_officeId_provider_status_idx"
    ON "MarketIngestionRun"("officeId", "provider", "status");

CREATE INDEX "MarketIngestionRun_officeId_sourceId_createdAt_idx"
    ON "MarketIngestionRun"("officeId", "sourceId", "createdAt");

CREATE INDEX "MarketIngestionRun_officeId_status_createdAt_idx"
    ON "MarketIngestionRun"("officeId", "status", "createdAt");

ALTER TABLE "MarketIngestionRun"
    ADD CONSTRAINT "MarketIngestionRun_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
