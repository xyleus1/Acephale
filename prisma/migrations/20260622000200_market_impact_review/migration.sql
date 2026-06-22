-- Phase 2C: reviewable operational impacts for external market intelligence.
-- MarketSignals remain advisory; these rows are the human-review workflow layer.

CREATE TABLE "MarketImpactReview" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "marketSignalId" TEXT NOT NULL,
    "marketSignalLinkId" TEXT,
    "linkedEntityType" TEXT NOT NULL,
    "linkedEntityId" TEXT NOT NULL,
    "impactLevel" TEXT NOT NULL,
    "impactReason" TEXT NOT NULL,
    "recommendedAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "feedbackKind" TEXT,
    "feedbackNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "actionedAt" TIMESTAMP(3),
    "sourceRefs" JSONB NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketImpactReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSignalFeedback" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "marketSignalId" TEXT NOT NULL,
    "marketImpactReviewId" TEXT,
    "userId" TEXT,
    "feedbackKind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSignalFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketImpactReview_officeId_marketSignalId_linkedEntityType_key"
    ON "MarketImpactReview"("officeId", "marketSignalId", "linkedEntityType", "linkedEntityId");

CREATE INDEX "MarketImpactReview_officeId_status_idx"
    ON "MarketImpactReview"("officeId", "status");

CREATE INDEX "MarketImpactReview_marketSignalId_idx"
    ON "MarketImpactReview"("marketSignalId");

CREATE INDEX "MarketImpactReview_linkedEntityType_linkedEntityId_idx"
    ON "MarketImpactReview"("linkedEntityType", "linkedEntityId");

CREATE INDEX "MarketImpactReview_createdAt_idx"
    ON "MarketImpactReview"("createdAt");

CREATE INDEX "MarketSignalFeedback_officeId_feedbackKind_createdAt_idx"
    ON "MarketSignalFeedback"("officeId", "feedbackKind", "createdAt");

CREATE INDEX "MarketSignalFeedback_marketSignalId_idx"
    ON "MarketSignalFeedback"("marketSignalId");

CREATE INDEX "MarketSignalFeedback_marketImpactReviewId_idx"
    ON "MarketSignalFeedback"("marketImpactReviewId");

ALTER TABLE "MarketImpactReview"
    ADD CONSTRAINT "MarketImpactReview_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketImpactReview"
    ADD CONSTRAINT "MarketImpactReview_marketSignalId_fkey"
    FOREIGN KEY ("marketSignalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketImpactReview"
    ADD CONSTRAINT "MarketImpactReview_marketSignalLinkId_fkey"
    FOREIGN KEY ("marketSignalLinkId") REFERENCES "MarketSignalLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketSignalFeedback"
    ADD CONSTRAINT "MarketSignalFeedback_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketSignalFeedback"
    ADD CONSTRAINT "MarketSignalFeedback_marketSignalId_fkey"
    FOREIGN KEY ("marketSignalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketSignalFeedback"
    ADD CONSTRAINT "MarketSignalFeedback_marketImpactReviewId_fkey"
    FOREIGN KEY ("marketImpactReviewId") REFERENCES "MarketImpactReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
