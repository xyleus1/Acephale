-- CreateTable
CREATE TABLE "world_company" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "domain" TEXT,
    "lei" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "addressLine" TEXT,
    "legalIds" JSONB,
    "industryCodes" JSONB,
    "isManufacturer" BOOLEAN NOT NULL DEFAULT false,
    "manufacturerEvidence" JSONB,
    "sizeBand" TEXT,
    "foundedYear" INTEGER,
    "linkedinUrl" TEXT,
    "website" TEXT,
    "entityStatus" TEXT,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_source_record" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "loadRunId" TEXT,
    "companyId" TEXT,
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "domain" TEXT,
    "lei" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "addressLine" TEXT,
    "legalIds" JSONB,
    "industryCodes" JSONB,
    "isManufacturer" BOOLEAN NOT NULL DEFAULT false,
    "manufacturerEvidence" JSONB,
    "sizeBand" TEXT,
    "foundedYear" INTEGER,
    "linkedinUrl" TEXT,
    "website" TEXT,
    "entityStatus" TEXT,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_source_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailStatus" TEXT,
    "fullName" TEXT,
    "title" TEXT,
    "role" TEXT,
    "source" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_load_run" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsMerged" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "world_load_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "world_company_domain_key" ON "world_company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "world_company_lei_key" ON "world_company"("lei");

-- CreateIndex
CREATE INDEX "world_company_country_nameNormalized_idx" ON "world_company"("country", "nameNormalized");

-- CreateIndex
CREATE INDEX "world_company_isManufacturer_country_idx" ON "world_company"("isManufacturer", "country");

-- CreateIndex
CREATE INDEX "world_company_nameNormalized_idx" ON "world_company"("nameNormalized");

-- CreateIndex
CREATE INDEX "world_source_record_merged_idx" ON "world_source_record"("merged");

-- CreateIndex
CREATE INDEX "world_source_record_companyId_idx" ON "world_source_record"("companyId");

-- CreateIndex
CREATE INDEX "world_source_record_lei_idx" ON "world_source_record"("lei");

-- CreateIndex
CREATE INDEX "world_source_record_domain_idx" ON "world_source_record"("domain");

-- CreateIndex
CREATE INDEX "world_source_record_country_nameNormalized_idx" ON "world_source_record"("country", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "world_source_record_source_sourceRecordId_key" ON "world_source_record"("source", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "world_contact_email_key" ON "world_contact"("email");

-- CreateIndex
CREATE INDEX "world_contact_companyId_idx" ON "world_contact"("companyId");

-- CreateIndex
CREATE INDEX "world_load_run_source_startedAt_idx" ON "world_load_run"("source", "startedAt");

-- AddForeignKey
ALTER TABLE "world_source_record" ADD CONSTRAINT "world_source_record_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "world_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_source_record" ADD CONSTRAINT "world_source_record_loadRunId_fkey" FOREIGN KEY ("loadRunId") REFERENCES "world_load_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_contact" ADD CONSTRAINT "world_contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "world_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
