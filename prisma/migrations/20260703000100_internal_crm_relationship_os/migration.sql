-- Internal CRM / Relationship OS V1
-- Additive only: preserve existing Company/Contact/Activity/Task records.

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'NOTE';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MEETING';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SLACK';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'RFQ';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'QUOTE';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'WEB_INTEL';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TASK';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'AGENT_SUGGESTION';

-- Company account metadata
ALTER TABLE "Company" ADD COLUMN "domain" TEXT;
ALTER TABLE "Company" ADD COLUMN "website" TEXT;
ALTER TABLE "Company" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN "crmCategory" TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE "Company" ADD COLUMN "crmStage" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "Company" ADD COLUMN "crmPriority" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Company" ADD COLUMN "relationshipStrength" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Company" ADD COLUMN "crmSource" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Company" ADD COLUMN "sourceRefs" JSONB;
ALTER TABLE "Company" ADD COLUMN "brainSlug" TEXT;
ALTER TABLE "Company" ADD COLUMN "crmTags" JSONB;
ALTER TABLE "Company" ADD COLUMN "crmNotes" TEXT;
ALTER TABLE "Company" ADD COLUMN "lastTouchAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "nextActionAt" TIMESTAMP(3);

-- Contact relationship metadata
ALTER TABLE "Contact" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "Contact" ADD COLUMN "location" TEXT;
ALTER TABLE "Contact" ADD COLUMN "relationshipType" TEXT NOT NULL DEFAULT 'buyer';
ALTER TABLE "Contact" ADD COLUMN "leverageLevel" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Contact" ADD COLUMN "relationshipStrength" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Contact" ADD COLUMN "ownerLabel" TEXT;
ALTER TABLE "Contact" ADD COLUMN "sourceRefs" JSONB;
ALTER TABLE "Contact" ADD COLUMN "brainSlug" TEXT;
ALTER TABLE "Contact" ADD COLUMN "tags" JSONB;
ALTER TABLE "Contact" ADD COLUMN "lastTouchAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "nextActionAt" TIMESTAMP(3);

-- Timeline/follow-up links and provenance
ALTER TABLE "Activity" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "inquiryId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "opportunityId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "source" TEXT;
ALTER TABLE "Activity" ADD COLUMN "sourceRefs" JSONB;
ALTER TABLE "Activity" ADD COLUMN "provenance" JSONB;

ALTER TABLE "Task" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Task" ADD COLUMN "inquiryId" TEXT;
ALTER TABLE "Task" ADD COLUMN "opportunityId" TEXT;
ALTER TABLE "Task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Task" ADD COLUMN "source" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceRefs" JSONB;
ALTER TABLE "Task" ADD COLUMN "provenance" JSONB;

-- Generic relationship/opportunity object for prospects, partners, vendors,
-- investors, advisors, strategic relationships, and RFQ-linked leads.
CREATE TABLE "CrmOpportunity" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "inquiryId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'customer_lead',
    "stage" TEXT NOT NULL DEFAULT 'idea',
    "estimatedValue" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "likelihood" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRefs" JSONB,
    "brainSlug" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Company_officeId_crmCategory_idx" ON "Company"("officeId", "crmCategory");
CREATE INDEX "Company_officeId_crmStage_idx" ON "Company"("officeId", "crmStage");
CREATE INDEX "Company_officeId_crmPriority_idx" ON "Company"("officeId", "crmPriority");
CREATE INDEX "Company_officeId_nextActionAt_idx" ON "Company"("officeId", "nextActionAt");

CREATE INDEX "Contact_companyId_relationshipType_idx" ON "Contact"("companyId", "relationshipType");
CREATE INDEX "Contact_companyId_leverageLevel_idx" ON "Contact"("companyId", "leverageLevel");
CREATE INDEX "Contact_companyId_nextActionAt_idx" ON "Contact"("companyId", "nextActionAt");

CREATE INDEX "Activity_officeId_contactId_occurredAt_idx" ON "Activity"("officeId", "contactId", "occurredAt");
CREATE INDEX "Activity_officeId_opportunityId_occurredAt_idx" ON "Activity"("officeId", "opportunityId", "occurredAt");
CREATE INDEX "Activity_officeId_inquiryId_occurredAt_idx" ON "Activity"("officeId", "inquiryId", "occurredAt");

CREATE INDEX "Task_officeId_priority_dueAt_idx" ON "Task"("officeId", "priority", "dueAt");
CREATE INDEX "Task_officeId_contactId_status_idx" ON "Task"("officeId", "contactId", "status");
CREATE INDEX "Task_officeId_opportunityId_status_idx" ON "Task"("officeId", "opportunityId", "status");
CREATE INDEX "Task_officeId_inquiryId_status_idx" ON "Task"("officeId", "inquiryId", "status");

CREATE INDEX "CrmOpportunity_officeId_stage_priority_idx" ON "CrmOpportunity"("officeId", "stage", "priority");
CREATE INDEX "CrmOpportunity_officeId_type_stage_idx" ON "CrmOpportunity"("officeId", "type", "stage");
CREATE INDEX "CrmOpportunity_officeId_nextActionAt_idx" ON "CrmOpportunity"("officeId", "nextActionAt");
CREATE INDEX "CrmOpportunity_officeId_companyId_idx" ON "CrmOpportunity"("officeId", "companyId");
CREATE INDEX "CrmOpportunity_officeId_contactId_idx" ON "CrmOpportunity"("officeId", "contactId");
CREATE INDEX "CrmOpportunity_officeId_inquiryId_idx" ON "CrmOpportunity"("officeId", "inquiryId");

-- Foreign keys
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
