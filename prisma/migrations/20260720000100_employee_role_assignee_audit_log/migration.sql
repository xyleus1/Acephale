-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'EMPLOYEE';

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'job',
    "entityId" TEXT,
    "entityRef" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_officeId_createdAt_idx" ON "AuditLog"("officeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_officeId_entityType_entityId_createdAt_idx" ON "AuditLog"("officeId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_officeId_actorUserId_createdAt_idx" ON "AuditLog"("officeId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_officeId_assignedToUserId_idx" ON "Job"("officeId", "assignedToUserId");

-- Job.assignedToUserId existed as a bare column before this migration; clear
-- any pointer that no longer matches a user so the new FK cannot fail.
UPDATE "Job" SET "assignedToUserId" = NULL
WHERE "assignedToUserId" IS NOT NULL
  AND "assignedToUserId" NOT IN (SELECT "id" FROM "User");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
