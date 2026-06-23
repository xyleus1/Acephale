-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'SALES');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('UNTOUCHED', 'IN_PROGRESS', 'WORKED', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('VISIT', 'CALL', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "QuoteResult" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('CLASS1', 'CLASS2', 'PRODUCT', 'LANE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PROPOSED', 'INQUIRY', 'QUOTED', 'BOOKED', 'IN_TRANSIT', 'CUSTOMS', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "Office" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryOption" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SALES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canViewWholeOffice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'UNTOUCHED',
    "class1" TEXT,
    "class2" TEXT,
    "product" TEXT,
    "lane" TEXT,
    "direction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isApprovedForInbox" BOOLEAN NOT NULL DEFAULT false,
    "approvedForInboxAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyOwner" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT,
    "body" TEXT,
    "audioUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "result" "QuoteResult" NOT NULL DEFAULT 'PENDING',
    "origin" TEXT,
    "destination" TEXT,
    "mode" TEXT,
    "value" DOUBLE PRECISION,
    "currency" TEXT,
    "notes" TEXT,
    "lostReason" TEXT,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentChange" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diff" JSONB NOT NULL,

    CONSTRAINT "AssignmentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAlert" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "docType" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaneRate" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaneRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginProfile" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "customerTier" TEXT,
    "urgency" TEXT,
    "marginPercent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT,
    "subject" TEXT NOT NULL,
    "fromEmail" TEXT,
    "fromCompany" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "mode" TEXT,
    "containerCount" INTEGER,
    "containerType" TEXT,
    "packages" INTEGER,
    "dimensions" TEXT,
    "stackable" TEXT,
    "topLoad" TEXT,
    "dangerousGoods" TEXT,
    "customsBy" TEXT,
    "commodity" TEXT,
    "weight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "incoterms" TEXT,
    "targetPrice" DOUBLE PRECISION,
    "targetCurrency" TEXT,
    "targetPriceStatus" TEXT,
    "targetPriceSource" TEXT,
    "cargoReadyDate" TIMESTAMP(3),
    "type" TEXT NOT NULL DEFAULT 'FORWARDING',
    "status" TEXT NOT NULL DEFAULT 'INGESTED',
    "rawEmailBody" TEXT,
    "parsedData" TEXT,
    "notes" TEXT,
    "summaryCache" TEXT,
    "summaryCacheAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetPriceHistory" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "jobId" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierQuote" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "quoteType" TEXT NOT NULL DEFAULT 'EMAIL',
    "rateName" TEXT,
    "total20" DOUBLE PRECISION,
    "total40" DOUBLE PRECISION,
    "total40HC" DOUBLE PRECISION,
    "transitDays" INTEGER,
    "service" TEXT,
    "validity" TEXT,
    "transshipments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forwarder" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "modeCoverage" TEXT,
    "apiType" TEXT NOT NULL DEFAULT 'EMAIL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Forwarder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwarderRequestDraft" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "forwarderId" TEXT,
    "forwarderName" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "senderAccountId" TEXT,
    "sentByEmail" TEXT,
    "sentAt" TIMESTAMP(3),
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForwarderRequestDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentRecord" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "mode" TEXT,
    "weight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "profit" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT,
    "assignedToUserId" TEXT,
    "inquiryId" TEXT,
    "reference" TEXT NOT NULL,
    "title" TEXT,
    "cadence" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'INQUIRY',
    "type" TEXT NOT NULL DEFAULT 'FORWARDING',
    "mode" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "commodity" TEXT,
    "incoterms" TEXT,
    "weight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "packages" INTEGER,
    "dimensions" TEXT,
    "stackable" TEXT,
    "topLoad" TEXT,
    "dangerousGoods" TEXT,
    "customsBy" TEXT,
    "containerCount" INTEGER,
    "containerType" TEXT,
    "quantity" DOUBLE PRECISION,
    "quantityUnit" TEXT,
    "targetPrice" DOUBLE PRECISION,
    "targetCurrency" TEXT,
    "targetPriceStatus" TEXT,
    "targetPriceSource" TEXT,
    "quoteLines" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "revenue" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "portalToken" TEXT,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "customerEmail" TEXT,
    "parentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "userId" TEXT,
    "jobId" TEXT,
    "inquiryId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "sourceType" TEXT,
    "sourcePreview" TEXT,
    "toolTrace" JSONB,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewDecision" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyAssessment" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "jobId" TEXT,
    "entityType" TEXT NOT NULL,
    "subject" TEXT,
    "recommendation" TEXT NOT NULL,
    "recommendationLabel" TEXT NOT NULL,
    "strategyMemo" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "decisionBrief" JSONB,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteOption" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "carrierQuoteId" TEXT,
    "label" TEXT NOT NULL,
    "route" TEXT,
    "mode" TEXT,
    "provider" TEXT,
    "source" TEXT NOT NULL,
    "cost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "transitDays" INTEGER,
    "reliabilityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "tradeoff" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRecommendation" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "buyCost" DOUBLE PRECISION,
    "costSource" TEXT,
    "floorPrice" DOUBLE PRECISION,
    "recommendedPrice" DOUBLE PRECISION,
    "stretchPrice" DOUBLE PRECISION,
    "walkAwayPrice" DOUBLE PRECISION,
    "expectedMarginPct" DOUBLE PRECISION,
    "expectedGrossProfit" DOUBLE PRECISION,
    "winProbability" INTEGER NOT NULL,
    "guardrailStatus" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyAction" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDocument" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "docType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedByUserId" TEXT,
    "aiSummary" TEXT,
    "aiFlags" TEXT,
    "aiKeyFields" TEXT,
    "aiAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMilestone" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3),
    "actualAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "jobId" TEXT,
    "inquiryId" TEXT,
    "subject" TEXT NOT NULL,
    "participants" TEXT NOT NULL,
    "externalThreadId" TEXT,
    "autoLinkedAt" TIMESTAMP(3),
    "autoLinkSkipReason" TEXT,
    "supplierOffer" TEXT,
    "supplierOfferAt" TIMESTAMP(3),
    "awardedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "accountId" TEXT,
    "externalId" TEXT,
    "gmailMessageId" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmails" TEXT NOT NULL,
    "ccEmails" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "attachments" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT,
    "classificationReason" TEXT,
    "classificationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Office_name_key" ON "Office"("name");

-- CreateIndex
CREATE INDEX "SavedView_officeId_userId_createdAt_idx" ON "SavedView"("officeId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_officeId_userId_name_key" ON "SavedView"("officeId", "userId", "name");

-- CreateIndex
CREATE INDEX "CategoryOption_officeId_type_isActive_idx" ON "CategoryOption"("officeId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryOption_officeId_type_value_key" ON "CategoryOption"("officeId", "type", "value");

-- CreateIndex
CREATE INDEX "User_officeId_role_idx" ON "User"("officeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_officeId_email_key" ON "User"("officeId", "email");

-- CreateIndex
CREATE INDEX "Company_officeId_status_idx" ON "Company"("officeId", "status");

-- CreateIndex
CREATE INDEX "Company_officeId_class1_idx" ON "Company"("officeId", "class1");

-- CreateIndex
CREATE INDEX "Company_officeId_class2_idx" ON "Company"("officeId", "class2");

-- CreateIndex
CREATE INDEX "Company_officeId_product_idx" ON "Company"("officeId", "product");

-- CreateIndex
CREATE INDEX "Company_officeId_lane_idx" ON "Company"("officeId", "lane");

-- CreateIndex
CREATE UNIQUE INDEX "Company_officeId_name_key" ON "Company"("officeId", "name");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "Contact_companyId_isApprovedForInbox_idx" ON "Contact"("companyId", "isApprovedForInbox");

-- CreateIndex
CREATE INDEX "CompanyOwner_userId_idx" ON "CompanyOwner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyOwner_companyId_userId_key" ON "CompanyOwner"("companyId", "userId");

-- CreateIndex
CREATE INDEX "Activity_officeId_companyId_occurredAt_idx" ON "Activity"("officeId", "companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_officeId_type_occurredAt_idx" ON "Activity"("officeId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "Quote_officeId_companyId_quotedAt_idx" ON "Quote"("officeId", "companyId", "quotedAt");

-- CreateIndex
CREATE INDEX "Quote_officeId_result_quotedAt_idx" ON "Quote"("officeId", "result", "quotedAt");

-- CreateIndex
CREATE INDEX "AssignmentChange_officeId_companyId_createdAt_idx" ON "AssignmentChange"("officeId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_officeId_type_createdAt_idx" ON "Event"("officeId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Event_officeId_entityType_entityId_idx" ON "Event"("officeId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "BackgroundJob_officeId_status_runAfter_idx" ON "BackgroundJob"("officeId", "status", "runAfter");

-- CreateIndex
CREATE INDEX "BackgroundJob_officeId_type_status_idx" ON "BackgroundJob"("officeId", "type", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_dedupeKey_status_idx" ON "BackgroundJob"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "Task_officeId_status_dueAt_idx" ON "Task"("officeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_companyId_status_idx" ON "Task"("companyId", "status");

-- CreateIndex
CREATE INDEX "RiskAlert_officeId_isOpen_level_createdAt_idx" ON "RiskAlert"("officeId", "isOpen", "level", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAlert_companyId_isOpen_idx" ON "RiskAlert"("companyId", "isOpen");

-- CreateIndex
CREATE INDEX "CompanyDocument_officeId_companyId_createdAt_idx" ON "CompanyDocument"("officeId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LaneRate_officeId_origin_destination_mode_idx" ON "LaneRate"("officeId", "origin", "destination", "mode");

-- CreateIndex
CREATE INDEX "MarginProfile_officeId_idx" ON "MarginProfile"("officeId");

-- CreateIndex
CREATE INDEX "Inquiry_officeId_status_receivedAt_idx" ON "Inquiry"("officeId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "Inquiry_officeId_companyId_idx" ON "Inquiry"("officeId", "companyId");

-- CreateIndex
CREATE INDEX "TargetPriceHistory_officeId_inquiryId_createdAt_idx" ON "TargetPriceHistory"("officeId", "inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "TargetPriceHistory_officeId_jobId_createdAt_idx" ON "TargetPriceHistory"("officeId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "CarrierQuote_inquiryId_idx" ON "CarrierQuote"("inquiryId");

-- CreateIndex
CREATE INDEX "Forwarder_officeId_active_idx" ON "Forwarder"("officeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Forwarder_officeId_email_key" ON "Forwarder"("officeId", "email");

-- CreateIndex
CREATE INDEX "ForwarderRequestDraft_officeId_inquiryId_status_idx" ON "ForwarderRequestDraft"("officeId", "inquiryId", "status");

-- CreateIndex
CREATE INDEX "ForwarderRequestDraft_officeId_forwarderId_idx" ON "ForwarderRequestDraft"("officeId", "forwarderId");

-- CreateIndex
CREATE INDEX "ShipmentRecord_officeId_companyId_shipmentDate_idx" ON "ShipmentRecord"("officeId", "companyId", "shipmentDate");

-- CreateIndex
CREATE INDEX "ShipmentRecord_officeId_shipmentDate_idx" ON "ShipmentRecord"("officeId", "shipmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "Job_inquiryId_key" ON "Job"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_portalToken_key" ON "Job"("portalToken");

-- CreateIndex
CREATE INDEX "Job_officeId_status_createdAt_idx" ON "Job"("officeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_officeId_companyId_idx" ON "Job"("officeId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_officeId_reference_key" ON "Job"("officeId", "reference");

-- CreateIndex
CREATE INDEX "AgentProposal_officeId_userId_status_createdAt_idx" ON "AgentProposal"("officeId", "userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_officeId_jobId_status_idx" ON "AgentProposal"("officeId", "jobId", "status");

-- CreateIndex
CREATE INDEX "AgentProposal_officeId_inquiryId_status_idx" ON "AgentProposal"("officeId", "inquiryId", "status");

-- CreateIndex
CREATE INDEX "AgentProposal_officeId_reviewedAt_idx" ON "AgentProposal"("officeId", "reviewedAt");

-- CreateIndex
CREATE INDEX "StrategyAssessment_officeId_status_createdAt_idx" ON "StrategyAssessment"("officeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyAssessment_officeId_inquiryId_status_createdAt_idx" ON "StrategyAssessment"("officeId", "inquiryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyAssessment_officeId_jobId_status_createdAt_idx" ON "StrategyAssessment"("officeId", "jobId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyAssessment_officeId_inputHash_idx" ON "StrategyAssessment"("officeId", "inputHash");

-- CreateIndex
CREATE INDEX "RouteOption_officeId_assessmentId_idx" ON "RouteOption"("officeId", "assessmentId");

-- CreateIndex
CREATE INDEX "RouteOption_officeId_carrierQuoteId_idx" ON "RouteOption"("officeId", "carrierQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRecommendation_assessmentId_key" ON "PriceRecommendation"("assessmentId");

-- CreateIndex
CREATE INDEX "PriceRecommendation_officeId_guardrailStatus_idx" ON "PriceRecommendation"("officeId", "guardrailStatus");

-- CreateIndex
CREATE INDEX "RiskAssessment_officeId_assessmentId_idx" ON "RiskAssessment"("officeId", "assessmentId");

-- CreateIndex
CREATE INDEX "RiskAssessment_officeId_level_category_idx" ON "RiskAssessment"("officeId", "level", "category");

-- CreateIndex
CREATE INDEX "StrategyAction_officeId_assessmentId_status_idx" ON "StrategyAction"("officeId", "assessmentId", "status");

-- CreateIndex
CREATE INDEX "StrategyAction_officeId_actionType_priority_status_idx" ON "StrategyAction"("officeId", "actionType", "priority", "status");

-- CreateIndex
CREATE INDEX "JobDocument_jobId_idx" ON "JobDocument"("jobId");

-- CreateIndex
CREATE INDEX "JobDocument_officeId_docType_idx" ON "JobDocument"("officeId", "docType");

-- CreateIndex
CREATE INDEX "JobMilestone_jobId_type_idx" ON "JobMilestone"("jobId", "type");

-- CreateIndex
CREATE INDEX "EmailAccount_officeId_idx" ON "EmailAccount"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_officeId_email_key" ON "EmailAccount"("officeId", "email");

-- CreateIndex
CREATE INDEX "EmailThread_officeId_jobId_idx" ON "EmailThread"("officeId", "jobId");

-- CreateIndex
CREATE INDEX "EmailThread_officeId_inquiryId_idx" ON "EmailThread"("officeId", "inquiryId");

-- CreateIndex
CREATE INDEX "EmailThread_officeId_lastMessageAt_idx" ON "EmailThread"("officeId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "EmailThread_officeId_externalThreadId_idx" ON "EmailThread"("officeId", "externalThreadId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_accountId_sentAt_idx" ON "EmailMessage"("accountId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_externalId_key" ON "EmailMessage"("externalId");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryOption" ADD CONSTRAINT "CategoryOption_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOwner" ADD CONSTRAINT "CompanyOwner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOwner" ADD CONSTRAINT "CompanyOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentChange" ADD CONSTRAINT "AssignmentChange_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentChange" ADD CONSTRAINT "AssignmentChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentChange" ADD CONSTRAINT "AssignmentChange_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaneRate" ADD CONSTRAINT "LaneRate_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginProfile" ADD CONSTRAINT "MarginProfile_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetPriceHistory" ADD CONSTRAINT "TargetPriceHistory_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetPriceHistory" ADD CONSTRAINT "TargetPriceHistory_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetPriceHistory" ADD CONSTRAINT "TargetPriceHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierQuote" ADD CONSTRAINT "CarrierQuote_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forwarder" ADD CONSTRAINT "Forwarder_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwarderRequestDraft" ADD CONSTRAINT "ForwarderRequestDraft_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwarderRequestDraft" ADD CONSTRAINT "ForwarderRequestDraft_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwarderRequestDraft" ADD CONSTRAINT "ForwarderRequestDraft_forwarderId_fkey" FOREIGN KEY ("forwarderId") REFERENCES "Forwarder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRecord" ADD CONSTRAINT "ShipmentRecord_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRecord" ADD CONSTRAINT "ShipmentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssessment" ADD CONSTRAINT "StrategyAssessment_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssessment" ADD CONSTRAINT "StrategyAssessment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAssessment" ADD CONSTRAINT "StrategyAssessment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteOption" ADD CONSTRAINT "RouteOption_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteOption" ADD CONSTRAINT "RouteOption_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "StrategyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecommendation" ADD CONSTRAINT "PriceRecommendation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecommendation" ADD CONSTRAINT "PriceRecommendation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "StrategyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "StrategyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAction" ADD CONSTRAINT "StrategyAction_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAction" ADD CONSTRAINT "StrategyAction_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "StrategyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDocument" ADD CONSTRAINT "JobDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDocument" ADD CONSTRAINT "JobDocument_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMilestone" ADD CONSTRAINT "JobMilestone_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

