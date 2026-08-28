CREATE TABLE "LeadGenRun" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "profileSlug" TEXT NOT NULL,
  "campaignTag" TEXT NOT NULL,
  "workspaceId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "queriesUsed" INTEGER NOT NULL DEFAULT 0,
  "pagesFetched" INTEGER NOT NULL DEFAULT 0,
  "candidatesFound" INTEGER NOT NULL DEFAULT 0,
  "companiesCreated" INTEGER NOT NULL DEFAULT 0,
  "companiesUpdated" INTEGER NOT NULL DEFAULT 0,
  "contactsCreated" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "providerStats" JSONB NOT NULL,
  "error" TEXT,
  CONSTRAINT "LeadGenRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDiscovery" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "runId" TEXT,
  "companyId" TEXT,
  "companyName" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "engine" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "query" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "campaignTag" TEXT NOT NULL,
  "profileSlug" TEXT NOT NULL,
  "segmentKey" TEXT,
  "fitScore" INTEGER NOT NULL,
  "fitTier" TEXT NOT NULL,
  "emailsFound" INTEGER NOT NULL,
  "contactFound" BOOLEAN NOT NULL,
  "bestEmailVerdict" TEXT,
  "bestEmailConfidence" INTEGER,
  "persisted" BOOLEAN NOT NULL,
  "skipReason" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadDiscovery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadGenRun_officeId_startedAt_idx" ON "LeadGenRun"("officeId", "startedAt");
CREATE INDEX "LeadDiscovery_officeId_discoveredAt_idx" ON "LeadDiscovery"("officeId", "discoveredAt");
CREATE INDEX "LeadDiscovery_officeId_provider_discoveredAt_idx" ON "LeadDiscovery"("officeId", "provider", "discoveredAt");
CREATE INDEX "LeadDiscovery_officeId_campaignTag_idx" ON "LeadDiscovery"("officeId", "campaignTag");
CREATE INDEX "LeadDiscovery_officeId_profileSlug_idx" ON "LeadDiscovery"("officeId", "profileSlug");
CREATE INDEX "LeadDiscovery_runId_idx" ON "LeadDiscovery"("runId");

ALTER TABLE "LeadGenRun"
  ADD CONSTRAINT "LeadGenRun_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDiscovery"
  ADD CONSTRAINT "LeadDiscovery_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDiscovery"
  ADD CONSTRAINT "LeadDiscovery_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "LeadGenRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadDiscovery"
  ADD CONSTRAINT "LeadDiscovery_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
