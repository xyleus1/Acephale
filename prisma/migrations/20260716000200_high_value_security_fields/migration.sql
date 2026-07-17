-- High-value tech-freight security spine: declared value / security tier /
-- commodity taxonomy / tracking / first-class equipment on Inquiry + Job,
-- plus the per-load security SOP checklist. Additive + nullable only.

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN "declaredValue" DOUBLE PRECISION,
ADD COLUMN "declaredValueCurrency" TEXT,
ADD COLUMN "securityTier" TEXT,
ADD COLUMN "commodityCategory" TEXT,
ADD COLUMN "trackingType" TEXT,
ADD COLUMN "equipmentType" TEXT,
ADD COLUMN "teamDriversRequired" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "declaredValue" DOUBLE PRECISION,
ADD COLUMN "declaredValueCurrency" TEXT,
ADD COLUMN "securityTier" TEXT,
ADD COLUMN "commodityCategory" TEXT,
ADD COLUMN "trackingType" TEXT,
ADD COLUMN "equipmentType" TEXT,
ADD COLUMN "teamDriversRequired" TEXT;

-- CreateTable
CREATE TABLE "LoadSecurityCheck" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoadSecurityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoadSecurityCheck_jobId_key_key" ON "LoadSecurityCheck"("jobId", "key");

-- CreateIndex
CREATE INDEX "LoadSecurityCheck_officeId_jobId_status_idx" ON "LoadSecurityCheck"("officeId", "jobId", "status");

-- AddForeignKey
ALTER TABLE "LoadSecurityCheck" ADD CONSTRAINT "LoadSecurityCheck_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadSecurityCheck" ADD CONSTRAINT "LoadSecurityCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
