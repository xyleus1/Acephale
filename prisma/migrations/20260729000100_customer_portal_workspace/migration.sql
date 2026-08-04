-- Customer portal workspace. External identities remain separate from
-- internal operators, company access is explicit, and customer actions remain
-- pending until an operator reviews them.

-- AlterTable
ALTER TABLE "JobDocument"
ADD COLUMN "uploadedByPortalUserId" TEXT,
ADD COLUMN "customerVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customerRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CustomerPortalUser" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalMembership" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalLoginCode" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPortalLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalAction" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobId" TEXT,
    "inquiryId" TEXT,
    "portalUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalUser_officeId_email_key"
ON "CustomerPortalUser"("officeId", "email");

CREATE INDEX "CustomerPortalUser_officeId_isActive_idx"
ON "CustomerPortalUser"("officeId", "isActive");

CREATE UNIQUE INDEX "CustomerPortalMembership_userId_companyId_key"
ON "CustomerPortalMembership"("userId", "companyId");

CREATE INDEX "CustomerPortalMembership_officeId_companyId_isActive_idx"
ON "CustomerPortalMembership"("officeId", "companyId", "isActive");

CREATE INDEX "CustomerPortalMembership_officeId_userId_isActive_idx"
ON "CustomerPortalMembership"("officeId", "userId", "isActive");

CREATE INDEX "CustomerPortalLoginCode_officeId_email_createdAt_idx"
ON "CustomerPortalLoginCode"("officeId", "email", "createdAt");

CREATE INDEX "CustomerPortalLoginCode_userId_createdAt_idx"
ON "CustomerPortalLoginCode"("userId", "createdAt");

CREATE INDEX "CustomerPortalAction_officeId_status_createdAt_idx"
ON "CustomerPortalAction"("officeId", "status", "createdAt");

CREATE INDEX "CustomerPortalAction_officeId_companyId_createdAt_idx"
ON "CustomerPortalAction"("officeId", "companyId", "createdAt");

CREATE INDEX "CustomerPortalAction_officeId_jobId_createdAt_idx"
ON "CustomerPortalAction"("officeId", "jobId", "createdAt");

CREATE INDEX "CustomerPortalAction_portalUserId_createdAt_idx"
ON "CustomerPortalAction"("portalUserId", "createdAt");

CREATE INDEX "JobDocument_portal_visibility_idx"
ON "JobDocument"("officeId", "customerVisible", "customerRequested", "status");

-- AddForeignKey
ALTER TABLE "CustomerPortalUser"
ADD CONSTRAINT "CustomerPortalUser_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalMembership"
ADD CONSTRAINT "CustomerPortalMembership_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalMembership"
ADD CONSTRAINT "CustomerPortalMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "CustomerPortalUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalMembership"
ADD CONSTRAINT "CustomerPortalMembership_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalLoginCode"
ADD CONSTRAINT "CustomerPortalLoginCode_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalLoginCode"
ADD CONSTRAINT "CustomerPortalLoginCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "CustomerPortalUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAction"
ADD CONSTRAINT "CustomerPortalAction_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAction"
ADD CONSTRAINT "CustomerPortalAction_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAction"
ADD CONSTRAINT "CustomerPortalAction_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "Job"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAction"
ADD CONSTRAINT "CustomerPortalAction_inquiryId_fkey"
FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAction"
ADD CONSTRAINT "CustomerPortalAction_portalUserId_fkey"
FOREIGN KEY ("portalUserId") REFERENCES "CustomerPortalUser"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobDocument"
ADD CONSTRAINT "JobDocument_uploadedByPortalUserId_fkey"
FOREIGN KEY ("uploadedByPortalUserId") REFERENCES "CustomerPortalUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
