-- CreateTable
CREATE TABLE "SupplyEvidence" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "capabilityRunId" TEXT,
    "executionTaskId" TEXT,
    "createdByUserId" TEXT,
    "evidenceKey" TEXT,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "sourceRecordId" TEXT,
    "sourceVersion" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "payload" JSONB,
    "contentHash" TEXT,
    "confidence" DECIMAL(5,4),
    "observedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyCapabilityRun" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "executionTaskId" TEXT,
    "invokedByUserId" TEXT,
    "parentRunId" TEXT,
    "capabilityKey" TEXT NOT NULL,
    "capabilityVersion" TEXT NOT NULL,
    "dslName" TEXT,
    "dslVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "output" JSONB,
    "outputHash" TEXT,
    "error" JSONB,
    "traceId" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyCapabilityRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyDecision" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByRunId" TEXT,
    "supersedesDecisionId" TEXT,
    "decisionType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "proposal" JSONB NOT NULL,
    "proposalHash" TEXT,
    "rationale" TEXT,
    "constraints" JSONB,
    "idempotencyKey" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyScenario" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "createdByRunId" TEXT,
    "scenarioKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ALTERNATIVE',
    "summary" TEXT,
    "assumptions" JSONB NOT NULL,
    "measures" JSONB NOT NULL,
    "supplierPlan" JSONB,
    "logisticsPlan" JSONB,
    "compliancePlan" JSONB,
    "currency" TEXT,
    "expectedCost" DECIMAL(20,4),
    "expectedLeadTimeDays" INTEGER,
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "feasible" BOOLEAN,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyScenarioComparison" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "baselineScenarioId" TEXT NOT NULL,
    "candidateScenarioId" TEXT NOT NULL,
    "createdByRunId" TEXT,
    "measures" JSONB NOT NULL,
    "costDelta" DECIMAL(20,4),
    "leadTimeDeltaDays" INTEGER,
    "riskDelta" TEXT,
    "verdict" TEXT,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyScenarioComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyDecisionEvidence" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'SUPPORTS',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyDecisionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyScenarioEvidence" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'SUPPORTS',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyScenarioEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyApproval" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "decisionId" TEXT,
    "executionTaskId" TEXT,
    "requestedByUserId" TEXT,
    "decidedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requiredRole" TEXT,
    "scopeHash" TEXT NOT NULL,
    "requestReason" TEXT,
    "requestContext" JSONB,
    "decisionNote" TEXT,
    "idempotencyKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyExecutionTask" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "decisionId" TEXT,
    "scenarioId" TEXT,
    "createdByUserId" TEXT,
    "parentTaskId" TEXT,
    "taskKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB,
    "resultHash" TEXT,
    "error" JSONB,
    "externalSystem" TEXT,
    "externalRef" TEXT,
    "idempotencyKey" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyExecutionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyExecutionEvent" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "executionTaskId" TEXT NOT NULL,
    "capabilityRunId" TEXT,
    "actorUserId" TEXT,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT,
    "payload" JSONB,
    "payloadHash" TEXT,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyEvidence_officeId_workspaceId_kind_capturedAt_idx" ON "SupplyEvidence"("officeId", "workspaceId", "kind", "capturedAt");

-- CreateIndex
CREATE INDEX "SupplyEvidence_snapshotId_sourceType_idx" ON "SupplyEvidence"("snapshotId", "sourceType");

-- CreateIndex
CREATE INDEX "SupplyEvidence_capabilityRunId_idx" ON "SupplyEvidence"("capabilityRunId");

-- CreateIndex
CREATE INDEX "SupplyEvidence_executionTaskId_idx" ON "SupplyEvidence"("executionTaskId");

-- CreateIndex
CREATE INDEX "SupplyEvidence_contentHash_idx" ON "SupplyEvidence"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyEvidence_workspaceId_evidenceKey_key" ON "SupplyEvidence"("workspaceId", "evidenceKey");

-- CreateIndex
CREATE INDEX "SupplyCapabilityRun_officeId_workspaceId_capabilityKey_stat_idx" ON "SupplyCapabilityRun"("officeId", "workspaceId", "capabilityKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyCapabilityRun_snapshotId_capabilityKey_idx" ON "SupplyCapabilityRun"("snapshotId", "capabilityKey");

-- CreateIndex
CREATE INDEX "SupplyCapabilityRun_executionTaskId_status_idx" ON "SupplyCapabilityRun"("executionTaskId", "status");

-- CreateIndex
CREATE INDEX "SupplyCapabilityRun_parentRunId_idx" ON "SupplyCapabilityRun"("parentRunId");

-- CreateIndex
CREATE INDEX "SupplyCapabilityRun_traceId_idx" ON "SupplyCapabilityRun"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCapabilityRun_workspaceId_idempotencyKey_key" ON "SupplyCapabilityRun"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyDecision_officeId_workspaceId_status_createdAt_idx" ON "SupplyDecision"("officeId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyDecision_snapshotId_decisionType_idx" ON "SupplyDecision"("snapshotId", "decisionType");

-- CreateIndex
CREATE INDEX "SupplyDecision_subjectType_subjectRef_idx" ON "SupplyDecision"("subjectType", "subjectRef");

-- CreateIndex
CREATE INDEX "SupplyDecision_supersedesDecisionId_idx" ON "SupplyDecision"("supersedesDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyDecision_workspaceId_idempotencyKey_key" ON "SupplyDecision"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyScenario_officeId_workspaceId_decisionId_rank_idx" ON "SupplyScenario"("officeId", "workspaceId", "decisionId", "rank");

-- CreateIndex
CREATE INDEX "SupplyScenario_createdByRunId_idx" ON "SupplyScenario"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyScenario_decisionId_scenarioKey_key" ON "SupplyScenario"("decisionId", "scenarioKey");

-- CreateIndex
CREATE INDEX "SupplyScenarioComparison_officeId_workspaceId_decisionId_idx" ON "SupplyScenarioComparison"("officeId", "workspaceId", "decisionId");

-- CreateIndex
CREATE INDEX "SupplyScenarioComparison_createdByRunId_idx" ON "SupplyScenarioComparison"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyScenarioComparison_decisionId_baselineScenarioId_cand_key" ON "SupplyScenarioComparison"("decisionId", "baselineScenarioId", "candidateScenarioId");

-- CreateIndex
CREATE INDEX "SupplyDecisionEvidence_officeId_workspaceId_decisionId_idx" ON "SupplyDecisionEvidence"("officeId", "workspaceId", "decisionId");

-- CreateIndex
CREATE INDEX "SupplyDecisionEvidence_evidenceId_idx" ON "SupplyDecisionEvidence"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyDecisionEvidence_decisionId_evidenceId_usage_key" ON "SupplyDecisionEvidence"("decisionId", "evidenceId", "usage");

-- CreateIndex
CREATE INDEX "SupplyScenarioEvidence_officeId_workspaceId_scenarioId_idx" ON "SupplyScenarioEvidence"("officeId", "workspaceId", "scenarioId");

-- CreateIndex
CREATE INDEX "SupplyScenarioEvidence_evidenceId_idx" ON "SupplyScenarioEvidence"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyScenarioEvidence_scenarioId_evidenceId_usage_key" ON "SupplyScenarioEvidence"("scenarioId", "evidenceId", "usage");

-- CreateIndex
CREATE INDEX "SupplyApproval_officeId_workspaceId_status_requestedAt_idx" ON "SupplyApproval"("officeId", "workspaceId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "SupplyApproval_decisionId_status_idx" ON "SupplyApproval"("decisionId", "status");

-- CreateIndex
CREATE INDEX "SupplyApproval_executionTaskId_status_idx" ON "SupplyApproval"("executionTaskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyApproval_workspaceId_idempotencyKey_key" ON "SupplyApproval"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyExecutionTask_officeId_workspaceId_status_scheduledFo_idx" ON "SupplyExecutionTask"("officeId", "workspaceId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "SupplyExecutionTask_snapshotId_status_idx" ON "SupplyExecutionTask"("snapshotId", "status");

-- CreateIndex
CREATE INDEX "SupplyExecutionTask_decisionId_scenarioId_idx" ON "SupplyExecutionTask"("decisionId", "scenarioId");

-- CreateIndex
CREATE INDEX "SupplyExecutionTask_parentTaskId_idx" ON "SupplyExecutionTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "SupplyExecutionTask_externalSystem_externalRef_idx" ON "SupplyExecutionTask"("externalSystem", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyExecutionTask_workspaceId_taskKey_key" ON "SupplyExecutionTask"("workspaceId", "taskKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyExecutionTask_workspaceId_idempotencyKey_key" ON "SupplyExecutionTask"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyExecutionEvent_officeId_workspaceId_occurredAt_idx" ON "SupplyExecutionEvent"("officeId", "workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "SupplyExecutionEvent_capabilityRunId_idx" ON "SupplyExecutionEvent"("capabilityRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyExecutionEvent_executionTaskId_sequence_key" ON "SupplyExecutionEvent"("executionTaskId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyExecutionEvent_executionTaskId_idempotencyKey_key" ON "SupplyExecutionEvent"("executionTaskId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_capabilityRunId_fkey" FOREIGN KEY ("capabilityRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_executionTaskId_fkey" FOREIGN KEY ("executionTaskId") REFERENCES "SupplyExecutionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvidence" ADD CONSTRAINT "SupplyEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_executionTaskId_fkey" FOREIGN KEY ("executionTaskId") REFERENCES "SupplyExecutionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_invokedByUserId_fkey" FOREIGN KEY ("invokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCapabilityRun" ADD CONSTRAINT "SupplyCapabilityRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecision" ADD CONSTRAINT "SupplyDecision_supersedesDecisionId_fkey" FOREIGN KEY ("supersedesDecisionId") REFERENCES "SupplyDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenario" ADD CONSTRAINT "SupplyScenario_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenario" ADD CONSTRAINT "SupplyScenario_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenario" ADD CONSTRAINT "SupplyScenario_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "SupplyDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenario" ADD CONSTRAINT "SupplyScenario_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "SupplyDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_baselineScenarioId_fkey" FOREIGN KEY ("baselineScenarioId") REFERENCES "SupplyScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_candidateScenarioId_fkey" FOREIGN KEY ("candidateScenarioId") REFERENCES "SupplyScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioComparison" ADD CONSTRAINT "SupplyScenarioComparison_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecisionEvidence" ADD CONSTRAINT "SupplyDecisionEvidence_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecisionEvidence" ADD CONSTRAINT "SupplyDecisionEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecisionEvidence" ADD CONSTRAINT "SupplyDecisionEvidence_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "SupplyDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyDecisionEvidence" ADD CONSTRAINT "SupplyDecisionEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplyEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioEvidence" ADD CONSTRAINT "SupplyScenarioEvidence_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioEvidence" ADD CONSTRAINT "SupplyScenarioEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioEvidence" ADD CONSTRAINT "SupplyScenarioEvidence_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "SupplyScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyScenarioEvidence" ADD CONSTRAINT "SupplyScenarioEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplyEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "SupplyDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_executionTaskId_fkey" FOREIGN KEY ("executionTaskId") REFERENCES "SupplyExecutionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyApproval" ADD CONSTRAINT "SupplyApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SupplySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "SupplyDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "SupplyScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionTask" ADD CONSTRAINT "SupplyExecutionTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "SupplyExecutionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionEvent" ADD CONSTRAINT "SupplyExecutionEvent_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionEvent" ADD CONSTRAINT "SupplyExecutionEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionEvent" ADD CONSTRAINT "SupplyExecutionEvent_executionTaskId_fkey" FOREIGN KEY ("executionTaskId") REFERENCES "SupplyExecutionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionEvent" ADD CONSTRAINT "SupplyExecutionEvent_capabilityRunId_fkey" FOREIGN KEY ("capabilityRunId") REFERENCES "SupplyCapabilityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyExecutionEvent" ADD CONSTRAINT "SupplyExecutionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain checks
ALTER TABLE "SupplyEvidence"
ADD CONSTRAINT "SupplyEvidence_confidence_check"
CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "SupplyCapabilityRun"
ADD CONSTRAINT "SupplyCapabilityRun_status_check"
CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
ADD CONSTRAINT "SupplyCapabilityRun_parent_check"
CHECK ("parentRunId" IS NULL OR "parentRunId" <> "id"),
ADD CONSTRAINT "SupplyCapabilityRun_state_time_check"
CHECK (
    ("status" = 'QUEUED' AND "startedAt" IS NULL AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'RUNNING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'FAILED' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NOT NULL)
);

ALTER TABLE "SupplyDecision"
ADD CONSTRAINT "SupplyDecision_status_check"
CHECK ("status" IN ('DRAFT', 'PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'CANCELLED')),
ADD CONSTRAINT "SupplyDecision_risk_check"
CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
ADD CONSTRAINT "SupplyDecision_supersedes_check"
CHECK ("supersedesDecisionId" IS NULL OR "supersedesDecisionId" <> "id"),
ADD CONSTRAINT "SupplyDecision_state_check"
CHECK (
    ("status" = 'DRAFT' AND "finalizedAt" IS NULL)
    OR ("status" = 'PROPOSED' AND "proposalHash" IS NOT NULL AND "finalizedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED', 'SUPERSEDED') AND "proposalHash" IS NOT NULL AND "finalizedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "finalizedAt" IS NOT NULL)
);

ALTER TABLE "SupplyScenario"
ADD CONSTRAINT "SupplyScenario_kind_check"
CHECK ("kind" IN ('BASELINE', 'PROPOSED', 'ALTERNATIVE')),
ADD CONSTRAINT "SupplyScenario_risk_check"
CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
ADD CONSTRAINT "SupplyScenario_cost_check"
CHECK ("expectedCost" IS NULL OR "expectedCost" >= 0),
ADD CONSTRAINT "SupplyScenario_lead_time_check"
CHECK ("expectedLeadTimeDays" IS NULL OR "expectedLeadTimeDays" >= 0),
ADD CONSTRAINT "SupplyScenario_rank_check"
CHECK ("rank" IS NULL OR "rank" > 0);

ALTER TABLE "SupplyScenarioComparison"
ADD CONSTRAINT "SupplyScenarioComparison_distinct_check"
CHECK ("baselineScenarioId" <> "candidateScenarioId");

ALTER TABLE "SupplyApproval"
ADD CONSTRAINT "SupplyApproval_status_check"
CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
ADD CONSTRAINT "SupplyApproval_target_check"
CHECK (("decisionId" IS NOT NULL)::INTEGER + ("executionTaskId" IS NOT NULL)::INTEGER = 1),
ADD CONSTRAINT "SupplyApproval_state_check"
CHECK (
    ("status" = 'PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL)
    OR ("status" IN ('CANCELLED', 'EXPIRED') AND "decidedAt" IS NOT NULL)
),
ADD CONSTRAINT "SupplyApproval_expiry_check"
CHECK ("expiresAt" IS NULL OR "expiresAt" > "requestedAt");

ALTER TABLE "SupplyExecutionTask"
ADD CONSTRAINT "SupplyExecutionTask_status_check"
CHECK ("status" IN ('PLANNED', 'BLOCKED', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
ADD CONSTRAINT "SupplyExecutionTask_parent_check"
CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id"),
ADD CONSTRAINT "SupplyExecutionTask_state_time_check"
CHECK (
    ("status" IN ('PLANNED', 'BLOCKED', 'READY') AND "startedAt" IS NULL AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'RUNNING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'FAILED' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "failedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "completedAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NOT NULL)
);

ALTER TABLE "SupplyExecutionEvent"
ADD CONSTRAINT "SupplyExecutionEvent_sequence_check"
CHECK ("sequence" > 0);

-- Reuse the workspace guard installed by the shared persistence migration.
CREATE TRIGGER "SupplyEvidence_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyCapabilityRun_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyDecision_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyScenario_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenario"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyScenarioComparison_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyDecisionEvidence_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecisionEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyScenarioEvidence_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyApproval_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyExecutionTask_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyExecutionEvent_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

-- Every cross-record reference must remain inside the same office and workspace.
CREATE FUNCTION supply_assert_reference_scope()
RETURNS TRIGGER AS $$
DECLARE
    reference_id TEXT;
    reference_matches BOOLEAN;
BEGIN
    reference_id := to_jsonb(NEW) ->> TG_ARGV[1];
    IF reference_id IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "officeId" = $2 AND "workspaceId" = $3)',
        TG_ARGV[0]
    ) INTO reference_matches USING reference_id, NEW."officeId", NEW."workspaceId";

    IF NOT reference_matches THEN
        RAISE EXCEPTION '% reference % is outside the Supply OS tenant scope', TG_TABLE_NAME, TG_ARGV[1];
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION supply_assert_user_office_scope()
RETURNS TRIGGER AS $$
DECLARE
    user_id TEXT;
BEGIN
    user_id := to_jsonb(NEW) ->> TG_ARGV[0];
    IF user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "User"
        WHERE "id" = user_id AND "officeId" = NEW."officeId"
    ) THEN
        RAISE EXCEPTION '% user reference % is outside the Supply OS office scope', TG_TABLE_NAME, TG_ARGV[0];
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyEvidence_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySnapshot', 'snapshotId');
CREATE TRIGGER "SupplyEvidence_run_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'capabilityRunId');
CREATE TRIGGER "SupplyEvidence_task_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyExecutionTask', 'executionTaskId');
CREATE TRIGGER "SupplyEvidence_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');

CREATE TRIGGER "SupplyCapabilityRun_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySnapshot', 'snapshotId');
CREATE TRIGGER "SupplyCapabilityRun_task_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyExecutionTask', 'executionTaskId');
CREATE TRIGGER "SupplyCapabilityRun_parent_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'parentRunId');
CREATE TRIGGER "SupplyCapabilityRun_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('invokedByUserId');

CREATE TRIGGER "SupplyDecision_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySnapshot', 'snapshotId');
CREATE TRIGGER "SupplyDecision_run_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'createdByRunId');
CREATE TRIGGER "SupplyDecision_supersedes_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'supersedesDecisionId');
CREATE TRIGGER "SupplyDecision_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');

CREATE TRIGGER "SupplyScenario_decision_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenario"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'decisionId');
CREATE TRIGGER "SupplyScenario_run_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenario"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'createdByRunId');

CREATE TRIGGER "SupplyScenarioComparison_decision_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'decisionId');
CREATE TRIGGER "SupplyScenarioComparison_baseline_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyScenario', 'baselineScenarioId');
CREATE TRIGGER "SupplyScenarioComparison_candidate_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyScenario', 'candidateScenarioId');
CREATE TRIGGER "SupplyScenarioComparison_run_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'createdByRunId');

CREATE TRIGGER "SupplyDecisionEvidence_decision_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecisionEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'decisionId');
CREATE TRIGGER "SupplyDecisionEvidence_evidence_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecisionEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyEvidence', 'evidenceId');

CREATE TRIGGER "SupplyScenarioEvidence_scenario_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyScenario', 'scenarioId');
CREATE TRIGGER "SupplyScenarioEvidence_evidence_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyEvidence', 'evidenceId');

CREATE TRIGGER "SupplyApproval_decision_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'decisionId');
CREATE TRIGGER "SupplyApproval_task_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyExecutionTask', 'executionTaskId');
CREATE TRIGGER "SupplyApproval_requested_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('requestedByUserId');
CREATE TRIGGER "SupplyApproval_decided_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('decidedByUserId');

CREATE TRIGGER "SupplyExecutionTask_snapshot_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplySnapshot', 'snapshotId');
CREATE TRIGGER "SupplyExecutionTask_decision_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyDecision', 'decisionId');
CREATE TRIGGER "SupplyExecutionTask_scenario_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyScenario', 'scenarioId');
CREATE TRIGGER "SupplyExecutionTask_parent_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyExecutionTask', 'parentTaskId');
CREATE TRIGGER "SupplyExecutionTask_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');

CREATE TRIGGER "SupplyExecutionEvent_task_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyExecutionTask', 'executionTaskId');
CREATE TRIGGER "SupplyExecutionEvent_run_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyCapabilityRun', 'capabilityRunId');
CREATE TRIGGER "SupplyExecutionEvent_user_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('actorUserId');

-- Scenario and evidence sets close when a decision leaves DRAFT.
CREATE FUNCTION supply_require_draft_decision()
RETURNS TRIGGER AS $$
DECLARE
    decision_id TEXT;
    decision_status TEXT;
BEGIN
    IF TG_TABLE_NAME = 'SupplyScenario' OR TG_TABLE_NAME = 'SupplyScenarioComparison' OR TG_TABLE_NAME = 'SupplyDecisionEvidence' THEN
        decision_id := to_jsonb(NEW) ->> 'decisionId';
    ELSIF TG_TABLE_NAME = 'SupplyScenarioEvidence' THEN
        SELECT "decisionId" INTO decision_id FROM "SupplyScenario" WHERE "id" = NEW."scenarioId";
    END IF;

    SELECT "status" INTO decision_status FROM "SupplyDecision" WHERE "id" = decision_id;
    IF decision_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Supply OS decision artifacts can only be added while the decision is DRAFT';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyScenario_draft_decision_guard"
BEFORE INSERT ON "SupplyScenario"
FOR EACH ROW EXECUTE FUNCTION supply_require_draft_decision();
CREATE TRIGGER "SupplyScenarioComparison_draft_decision_guard"
BEFORE INSERT ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_require_draft_decision();
CREATE TRIGGER "SupplyDecisionEvidence_draft_decision_guard"
BEFORE INSERT ON "SupplyDecisionEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_require_draft_decision();
CREATE TRIGGER "SupplyScenarioEvidence_draft_decision_guard"
BEFORE INSERT ON "SupplyScenarioEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_require_draft_decision();

CREATE FUNCTION supply_validate_scenario_comparison()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "SupplyScenario"
        WHERE "id" = NEW."baselineScenarioId" AND "decisionId" = NEW."decisionId"
    ) OR NOT EXISTS (
        SELECT 1 FROM "SupplyScenario"
        WHERE "id" = NEW."candidateScenarioId" AND "decisionId" = NEW."decisionId"
    ) THEN
        RAISE EXCEPTION 'Compared Supply OS scenarios must belong to the selected decision';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyScenarioComparison_decision_guard"
BEFORE INSERT OR UPDATE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_validate_scenario_comparison();

CREATE FUNCTION supply_validate_approval_scope()
RETURNS TRIGGER AS $$
DECLARE
    target_status TEXT;
    target_hash TEXT;
BEGIN
    IF TG_OP = 'INSERT' AND NEW."status" <> 'PENDING' THEN
        RAISE EXCEPTION 'Supply OS approvals must begin in PENDING status';
    END IF;

    IF NEW."decisionId" IS NOT NULL THEN
        SELECT "status", "proposalHash" INTO target_status, target_hash
        FROM "SupplyDecision" WHERE "id" = NEW."decisionId";
        IF target_status IS DISTINCT FROM 'PROPOSED' THEN
            RAISE EXCEPTION 'Only a PROPOSED Supply OS decision can be approved';
        END IF;
    ELSE
        SELECT "status", "inputHash" INTO target_status, target_hash
        FROM "SupplyExecutionTask" WHERE "id" = NEW."executionTaskId";
        IF target_status NOT IN ('PLANNED', 'BLOCKED') THEN
            RAISE EXCEPTION 'Only a planned or blocked Supply OS task can be approved';
        END IF;
    END IF;

    IF target_hash IS DISTINCT FROM NEW."scopeHash" THEN
        RAISE EXCEPTION 'Supply OS approval hash does not match its target';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyApproval_scope_hash_guard"
BEFORE INSERT OR UPDATE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_validate_approval_scope();

CREATE FUNCTION supply_guard_capability_run_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_provenance_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Supply OS capability runs cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'QUEUED' THEN
            RAISE EXCEPTION 'Supply OS capability runs must begin in QUEUED status';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal Supply OS capability runs are immutable';
    END IF;
    IF (OLD."officeId", OLD."workspaceId", OLD."snapshotId", OLD."executionTaskId", OLD."invokedByUserId", OLD."parentRunId", OLD."capabilityKey", OLD."capabilityVersion", OLD."dslName", OLD."dslVersion", OLD."input", OLD."inputHash", OLD."idempotencyKey", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."officeId", NEW."workspaceId", NEW."snapshotId", NEW."executionTaskId", NEW."invokedByUserId", NEW."parentRunId", NEW."capabilityKey", NEW."capabilityVersion", NEW."dslName", NEW."dslVersion", NEW."input", NEW."inputHash", NEW."idempotencyKey", NEW."createdAt") THEN
        RAISE EXCEPTION 'Supply OS capability run inputs are immutable';
    END IF;
    IF NOT (
        (OLD."status" = NEW."status")
        OR (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCELLED'))
        OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED'))
    ) THEN
        RAISE EXCEPTION 'Invalid Supply OS capability run status transition';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyCapabilityRun_state_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_guard_capability_run_state();

CREATE FUNCTION supply_guard_decision_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_provenance_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Supply OS decisions cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" NOT IN ('DRAFT', 'PROPOSED') THEN
            RAISE EXCEPTION 'Supply OS decisions must begin in DRAFT or PROPOSED status';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" IN ('REJECTED', 'SUPERSEDED', 'CANCELLED')
       OR (OLD."status" = 'APPROVED' AND NEW."status" <> 'SUPERSEDED') THEN
        RAISE EXCEPTION 'Terminal Supply OS decisions are immutable';
    END IF;
    IF (OLD."officeId", OLD."workspaceId", OLD."snapshotId", OLD."createdByUserId", OLD."createdByRunId", OLD."supersedesDecisionId", OLD."decisionType", OLD."subjectType", OLD."subjectRef", OLD."title", OLD."objective", OLD."riskLevel", OLD."proposal", OLD."rationale", OLD."constraints", OLD."idempotencyKey", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."officeId", NEW."workspaceId", NEW."snapshotId", NEW."createdByUserId", NEW."createdByRunId", NEW."supersedesDecisionId", NEW."decisionType", NEW."subjectType", NEW."subjectRef", NEW."title", NEW."objective", NEW."riskLevel", NEW."proposal", NEW."rationale", NEW."constraints", NEW."idempotencyKey", NEW."createdAt") THEN
        RAISE EXCEPTION 'Supply OS decision proposal inputs are immutable';
    END IF;
    IF OLD."proposalHash" IS DISTINCT FROM NEW."proposalHash"
       AND NOT (OLD."status" = 'DRAFT' AND NEW."status" = 'PROPOSED') THEN
        RAISE EXCEPTION 'Supply OS proposal hash can only be sealed when proposed';
    END IF;
    IF NOT (
        OLD."status" = NEW."status"
        OR (OLD."status" = 'DRAFT' AND NEW."status" IN ('PROPOSED', 'CANCELLED'))
        OR (OLD."status" = 'PROPOSED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'SUPERSEDED', 'CANCELLED'))
        OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')
    ) THEN
        RAISE EXCEPTION 'Invalid Supply OS decision status transition';
    END IF;
    IF NEW."status" = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM "SupplyApproval"
        WHERE "decisionId" = NEW."id"
          AND "status" = 'APPROVED'
          AND "scopeHash" = NEW."proposalHash"
    ) THEN
        RAISE EXCEPTION 'Supply OS decisions require matching human approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyDecision_state_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_guard_decision_state();

CREATE FUNCTION supply_guard_approval_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_provenance_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Supply OS approvals cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;
    IF OLD."status" <> 'PENDING' THEN
        RAISE EXCEPTION 'Terminal Supply OS approvals are immutable';
    END IF;
    IF (OLD."officeId", OLD."workspaceId", OLD."decisionId", OLD."executionTaskId", OLD."requestedByUserId", OLD."requiredRole", OLD."scopeHash", OLD."requestReason", OLD."requestContext", OLD."idempotencyKey", OLD."requestedAt", OLD."expiresAt", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."officeId", NEW."workspaceId", NEW."decisionId", NEW."executionTaskId", NEW."requestedByUserId", NEW."requiredRole", NEW."scopeHash", NEW."requestReason", NEW."requestContext", NEW."idempotencyKey", NEW."requestedAt", NEW."expiresAt", NEW."createdAt") THEN
        RAISE EXCEPTION 'Supply OS approval request fields are immutable';
    END IF;
    IF NEW."status" NOT IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'Invalid Supply OS approval status transition';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyApproval_state_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_guard_approval_state();

CREATE FUNCTION supply_validate_execution_task_links()
RETURNS TRIGGER AS $$
DECLARE
    decision_snapshot_id TEXT;
    scenario_decision_id TEXT;
BEGIN
    IF NEW."scenarioId" IS NOT NULL THEN
        SELECT "decisionId" INTO scenario_decision_id FROM "SupplyScenario" WHERE "id" = NEW."scenarioId";
        IF NEW."decisionId" IS NULL OR scenario_decision_id IS DISTINCT FROM NEW."decisionId" THEN
            RAISE EXCEPTION 'Supply OS execution scenario must belong to its decision';
        END IF;
    END IF;

    IF NEW."decisionId" IS NOT NULL THEN
        SELECT "snapshotId" INTO decision_snapshot_id FROM "SupplyDecision" WHERE "id" = NEW."decisionId";
        IF NEW."snapshotId" IS NULL OR decision_snapshot_id IS DISTINCT FROM NEW."snapshotId" THEN
            RAISE EXCEPTION 'Supply OS execution task must use its decision snapshot';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyExecutionTask_link_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_validate_execution_task_links();

CREATE FUNCTION supply_guard_execution_task_state()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_provenance_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Supply OS execution tasks cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'PLANNED' THEN
            RAISE EXCEPTION 'Supply OS execution tasks must begin in PLANNED status';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal Supply OS execution tasks are immutable';
    END IF;
    IF (OLD."officeId", OLD."workspaceId", OLD."snapshotId", OLD."decisionId", OLD."scenarioId", OLD."createdByUserId", OLD."parentTaskId", OLD."taskKey", OLD."taskType", OLD."capabilityKey", OLD."requiresApproval", OLD."input", OLD."inputHash", OLD."externalSystem", OLD."externalRef", OLD."idempotencyKey", OLD."scheduledFor", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."officeId", NEW."workspaceId", NEW."snapshotId", NEW."decisionId", NEW."scenarioId", NEW."createdByUserId", NEW."parentTaskId", NEW."taskKey", NEW."taskType", NEW."capabilityKey", NEW."requiresApproval", NEW."input", NEW."inputHash", NEW."externalSystem", NEW."externalRef", NEW."idempotencyKey", NEW."scheduledFor", NEW."createdAt") THEN
        RAISE EXCEPTION 'Supply OS execution task inputs are immutable';
    END IF;
    IF NOT (
        OLD."status" = NEW."status"
        OR (OLD."status" = 'PLANNED' AND NEW."status" IN ('BLOCKED', 'READY', 'CANCELLED'))
        OR (OLD."status" = 'BLOCKED' AND NEW."status" IN ('READY', 'CANCELLED'))
        OR (OLD."status" = 'READY' AND NEW."status" IN ('RUNNING', 'CANCELLED'))
        OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED'))
    ) THEN
        RAISE EXCEPTION 'Invalid Supply OS execution task status transition';
    END IF;
    IF NEW."status" IN ('READY', 'RUNNING', 'SUCCEEDED') THEN
        IF NEW."decisionId" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "SupplyDecision"
            WHERE "id" = NEW."decisionId" AND "status" = 'APPROVED'
        ) THEN
            RAISE EXCEPTION 'Supply OS execution requires an approved decision';
        END IF;
        IF NEW."requiresApproval" AND NOT EXISTS (
            SELECT 1 FROM "SupplyApproval"
            WHERE "executionTaskId" = NEW."id"
              AND "status" = 'APPROVED'
              AND "scopeHash" = NEW."inputHash"
        ) THEN
            RAISE EXCEPTION 'Supply OS execution requires matching human approval';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyExecutionTask_state_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_guard_execution_task_state();

CREATE FUNCTION supply_validate_execution_event_run()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."capabilityRunId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "SupplyCapabilityRun"
        WHERE "id" = NEW."capabilityRunId"
          AND "executionTaskId" = NEW."executionTaskId"
    ) THEN
        RAISE EXCEPTION 'Supply OS execution event run must belong to its task';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyExecutionEvent_run_task_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_validate_execution_event_run();

-- Evidence, scenarios, comparisons, links, and events are append-only.
CREATE FUNCTION supply_prevent_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('derya.allow_supply_provenance_mutation', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyEvidence_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyScenario_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyScenario"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyScenarioComparison_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyScenarioComparison"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyDecisionEvidence_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyDecisionEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyScenarioEvidence_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyScenarioEvidence"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
CREATE TRIGGER "SupplyExecutionEvent_append_only_guard"
BEFORE UPDATE OR DELETE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_prevent_append_only_mutation();
