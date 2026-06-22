-- Additive company-brain memory layer for the existing Derya Freight OS schema.
-- This migration assumes the current product tables, especially "Office",
-- already exist. The repository did not have a Prisma migration baseline before
-- this point.

CREATE TABLE "KnowledgeSource" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT,
  "externalId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "trustLevel" TEXT NOT NULL DEFAULT 'INTERNAL',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeObject" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "canonicalType" TEXT NOT NULL,
  "title" TEXT,
  "contentHash" TEXT,
  "rawRef" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "retentionPolicy" TEXT NOT NULL DEFAULT 'DEFAULT',
  "entityType" TEXT,
  "entityId" TEXT,
  "companyId" TEXT,
  "contactId" TEXT,
  "inquiryId" TEXT,
  "jobId" TEXT,
  "emailThreadId" TEXT,
  "emailMessageId" TEXT,
  "jobDocumentId" TEXT,
  "strategyAssessmentId" TEXT,
  "agentProposalId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'TEXT',
  "text" TEXT NOT NULL,
  "tokenCount" INTEGER,
  "sourceSpan" JSONB,
  "metadata" JSONB,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityMention" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "objectId" TEXT,
  "chunkId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "label" TEXT,
  "confidence" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'SYSTEM',
  "metadata" JSONB,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryEvent" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "sourceId" TEXT,
  "objectId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceExternalId" TEXT,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "actorType" TEXT,
  "actorId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MemoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentMemory" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "sourceId" TEXT,
  "objectId" TEXT,
  "eventId" TEXT,
  "agentName" TEXT NOT NULL,
  "memoryType" TEXT NOT NULL,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "companyId" TEXT,
  "jobId" TEXT,
  "inquiryId" TEXT,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "confidence" DOUBLE PRECISION,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB,
  "provenance" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeSource_officeId_type_externalId_key" ON "KnowledgeSource"("officeId", "type", "externalId");
CREATE INDEX "KnowledgeSource_officeId_type_status_idx" ON "KnowledgeSource"("officeId", "type", "status");

CREATE UNIQUE INDEX "KnowledgeObject_officeId_sourceType_sourceExternalId_key" ON "KnowledgeObject"("officeId", "sourceType", "sourceExternalId");
CREATE INDEX "KnowledgeObject_officeId_canonicalType_occurredAt_idx" ON "KnowledgeObject"("officeId", "canonicalType", "occurredAt");
CREATE INDEX "KnowledgeObject_officeId_entityType_entityId_idx" ON "KnowledgeObject"("officeId", "entityType", "entityId");
CREATE INDEX "KnowledgeObject_officeId_companyId_occurredAt_idx" ON "KnowledgeObject"("officeId", "companyId", "occurredAt");
CREATE INDEX "KnowledgeObject_officeId_jobId_occurredAt_idx" ON "KnowledgeObject"("officeId", "jobId", "occurredAt");
CREATE INDEX "KnowledgeObject_officeId_inquiryId_occurredAt_idx" ON "KnowledgeObject"("officeId", "inquiryId", "occurredAt");
CREATE INDEX "KnowledgeObject_officeId_emailThreadId_idx" ON "KnowledgeObject"("officeId", "emailThreadId");

CREATE UNIQUE INDEX "KnowledgeChunk_objectId_ordinal_key" ON "KnowledgeChunk"("objectId", "ordinal");
CREATE INDEX "KnowledgeChunk_officeId_objectId_idx" ON "KnowledgeChunk"("officeId", "objectId");

CREATE INDEX "EntityMention_officeId_entityType_entityId_idx" ON "EntityMention"("officeId", "entityType", "entityId");
CREATE INDEX "EntityMention_officeId_objectId_idx" ON "EntityMention"("officeId", "objectId");
CREATE INDEX "EntityMention_officeId_chunkId_idx" ON "EntityMention"("officeId", "chunkId");

CREATE UNIQUE INDEX "MemoryEvent_officeId_idempotencyKey_key" ON "MemoryEvent"("officeId", "idempotencyKey");
CREATE INDEX "MemoryEvent_officeId_eventType_occurredAt_idx" ON "MemoryEvent"("officeId", "eventType", "occurredAt");
CREATE INDEX "MemoryEvent_officeId_entityType_entityId_occurredAt_idx" ON "MemoryEvent"("officeId", "entityType", "entityId", "occurredAt");
CREATE INDEX "MemoryEvent_officeId_sourceType_sourceExternalId_idx" ON "MemoryEvent"("officeId", "sourceType", "sourceExternalId");

CREATE INDEX "AgentMemory_officeId_agentName_status_idx" ON "AgentMemory"("officeId", "agentName", "status");
CREATE INDEX "AgentMemory_officeId_memoryType_status_idx" ON "AgentMemory"("officeId", "memoryType", "status");
CREATE INDEX "AgentMemory_officeId_subjectType_subjectId_idx" ON "AgentMemory"("officeId", "subjectType", "subjectId");
CREATE INDEX "AgentMemory_officeId_companyId_idx" ON "AgentMemory"("officeId", "companyId");
CREATE INDEX "AgentMemory_officeId_jobId_idx" ON "AgentMemory"("officeId", "jobId");
CREATE INDEX "AgentMemory_officeId_inquiryId_idx" ON "AgentMemory"("officeId", "inquiryId");

ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeObject" ADD CONSTRAINT "KnowledgeObject_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeObject" ADD CONSTRAINT "KnowledgeObject_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "KnowledgeObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "KnowledgeObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MemoryEvent" ADD CONSTRAINT "MemoryEvent_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryEvent" ADD CONSTRAINT "MemoryEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemoryEvent" ADD CONSTRAINT "MemoryEvent_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "KnowledgeObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "KnowledgeObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MemoryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
