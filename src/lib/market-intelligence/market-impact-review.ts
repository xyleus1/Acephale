import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toMemoryJson } from "@/lib/memory/record-event";
import type { MemoryEvidenceRef } from "@/lib/memory/evidence";

export const MARKET_IMPACT_REVIEW_STATUSES = ["pending", "acknowledged", "dismissed", "actioned", "expired"] as const;
export const MARKET_SIGNAL_FEEDBACK_KINDS = ["useful", "irrelevant", "wrong_link", "duplicate", "already_known", "severity_wrong", "source_low_quality"] as const;
export const MARKET_IMPACT_LEVELS = ["low", "medium", "high", "critical"] as const;

export type MarketImpactReviewStatus = typeof MARKET_IMPACT_REVIEW_STATUSES[number];
export type MarketSignalFeedbackKind = typeof MARKET_SIGNAL_FEEDBACK_KINDS[number];
export type MarketImpactLevel = typeof MARKET_IMPACT_LEVELS[number];

type ReviewWithRelations = Prisma.MarketImpactReviewGetPayload<{
  include: {
    marketSignal: {
      select: {
        id: true;
        category: true;
        severity: true;
        confidence: true;
        summary: true;
        operatorImplication: true;
        pricingImplication: true;
        customerImpact: true;
        sourceObjectId: true;
        sourceRefs: true;
        sourceObject: { select: { id: true; title: true; sourceType: true; sourceExternalId: true; canonicalType: true; occurredAt: true } };
      };
    };
    marketSignalLink: { select: { id: true; entityType: true; entityId: true; matchType: true; confidence: true; reason: true } };
    feedback: { orderBy: { createdAt: "desc" }; take: 5 };
  };
}>;

function strings(value: Prisma.JsonValue | unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function clampLimit(limit: number | null | undefined, fallback = 20) {
  return Math.max(1, Math.min(100, Math.floor(limit ?? fallback)));
}

function normalizeStatus(value: string | null | undefined): MarketImpactReviewStatus | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MARKET_IMPACT_REVIEW_STATUSES.includes(normalized as MarketImpactReviewStatus)
    ? normalized as MarketImpactReviewStatus
    : null;
}

function normalizeFeedbackKind(value: string | null | undefined): MarketSignalFeedbackKind | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MARKET_SIGNAL_FEEDBACK_KINDS.includes(normalized as MarketSignalFeedbackKind)
    ? normalized as MarketSignalFeedbackKind
    : null;
}

function levelRank(level: string | null | undefined) {
  const normalized = String(level ?? "").trim().toLowerCase();
  const index = MARKET_IMPACT_LEVELS.indexOf(normalized as MarketImpactLevel);
  return index >= 0 ? index : 1;
}

function impactLevel(severity: string, linkConfidence: number): MarketImpactLevel {
  const base = levelRank(severity);
  const adjusted = linkConfidence < 0.55 ? Math.max(0, base - 1) : base;
  return MARKET_IMPACT_LEVELS[adjusted] ?? "medium";
}

function recommendedAction(entityType: string, signal: { category: string; pricingImplication: string | null; operatorImplication: string | null }) {
  if (signal.category === "rate") {
    if (entityType === "inquiry") return "Refresh buy rates before sending or revising customer pricing.";
    if (entityType === "job") return "Check whether active pricing, ETA/ETD, or customer update needs review before the next touch.";
    if (entityType === "company") return "Review affected active RFQs/jobs before proactive customer follow-up.";
    return "Review open RFQs/jobs on this lane before committing pricing.";
  }
  if (signal.category === "port_disruption" || signal.category === "weather" || signal.category === "labor") {
    if (entityType === "job") return "Check route timing, milestones, and customer update language before the next operational update.";
    return "Review affected active work for delay, reroute, or validity exposure.";
  }
  if (signal.category === "customs" || signal.category === "compliance") {
    return "Check document and compliance requirements before quoting or confirming movement.";
  }
  return signal.pricingImplication ?? signal.operatorImplication ?? "Review affected active work and decide whether operator action is needed.";
}

function sourceRefs(signal: {
  id: string;
  sourceObjectId: string | null;
  sourceRefs: Prisma.JsonValue;
}, link: {
  id: string;
  entityType: string;
  entityId: string;
}) {
  return [...new Set([
    `MarketSignal:${signal.id}`,
    `MarketSignalLink:${link.id}`,
    signal.sourceObjectId ? `KnowledgeObject:${signal.sourceObjectId}` : null,
    ...strings(signal.sourceRefs),
    `${link.entityType}:${link.entityId}`,
  ].filter((item): item is string => Boolean(item)))];
}

function evidenceFromReview(review: ReviewWithRelations): MemoryEvidenceRef[] {
  const refs: MemoryEvidenceRef[] = [
    { refType: "entity", entityType: "market_impact_review", entityId: review.id },
    { refType: "entity", entityType: "market_signal", entityId: review.marketSignalId },
    { refType: "entity", entityType: review.linkedEntityType, entityId: review.linkedEntityId },
  ];
  if (review.marketSignal.sourceObject) {
    refs.push({
      refType: "knowledge_object",
      knowledgeObjectId: review.marketSignal.sourceObject.id,
      sourceType: review.marketSignal.sourceObject.sourceType,
      sourceExternalId: review.marketSignal.sourceObject.sourceExternalId,
      canonicalType: review.marketSignal.sourceObject.canonicalType,
      title: review.marketSignal.sourceObject.title,
      occurredAt: review.marketSignal.sourceObject.occurredAt,
    });
  } else if (review.marketSignal.sourceObjectId) {
    refs.push({ refType: "knowledge_object", knowledgeObjectId: review.marketSignal.sourceObjectId });
  }
  return refs;
}

function compactReview(review: ReviewWithRelations) {
  return {
    id: review.id,
    marketSignalId: review.marketSignalId,
    marketSignalLinkId: review.marketSignalLinkId,
    linkedEntityType: review.linkedEntityType,
    linkedEntityId: review.linkedEntityId,
    impactLevel: review.impactLevel,
    impactReason: review.impactReason,
    recommendedAction: review.recommendedAction,
    status: review.status,
    feedbackKind: review.feedbackKind,
    feedbackNote: review.feedbackNote,
    reviewedByUserId: review.reviewedByUserId,
    reviewedAt: review.reviewedAt,
    actionedAt: review.actionedAt,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    sourceRefs: strings(review.sourceRefs),
    signal: {
      id: review.marketSignal.id,
      category: review.marketSignal.category,
      severity: review.marketSignal.severity,
      confidence: review.marketSignal.confidence,
      summary: review.marketSignal.summary,
      operatorImplication: review.marketSignal.operatorImplication,
      pricingImplication: review.marketSignal.pricingImplication,
      customerImpact: review.marketSignal.customerImpact,
      sourceObject: review.marketSignal.sourceObject,
    },
    link: review.marketSignalLink,
    recentFeedback: review.feedback.map((feedback) => ({
      id: feedback.id,
      feedbackKind: feedback.feedbackKind,
      note: feedback.note,
      userId: feedback.userId,
      createdAt: feedback.createdAt,
    })),
    evidence: evidenceFromReview(review),
  };
}

export async function generateMarketImpactReviews(input: {
  officeId: string;
  marketSignalId?: string | null;
  strict?: boolean;
}) {
  try {
    const links = await prisma.marketSignalLink.findMany({
      where: {
        officeId: input.officeId,
        ...(input.marketSignalId ? { signalId: input.marketSignalId } : {}),
      },
      include: {
        signal: {
          select: {
            id: true,
            officeId: true,
            category: true,
            severity: true,
            confidence: true,
            summary: true,
            operatorImplication: true,
            pricingImplication: true,
            customerImpact: true,
            sourceObjectId: true,
            sourceRefs: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const provenance = {
      source: "market_intelligence",
      operation: "generate_market_impact_review",
      path: "src/lib/market-intelligence/market-impact-review.ts",
      function: "generateMarketImpactReviews",
    };
    const reviews = [];
    for (const link of links) {
      const level = impactLevel(link.signal.severity, link.confidence);
      const reason = [
        link.signal.summary,
        link.reason,
        link.signal.pricingImplication ?? link.signal.operatorImplication ?? link.signal.customerImpact,
      ].filter(Boolean).join(" ");
      reviews.push(await prisma.marketImpactReview.upsert({
        where: {
          officeId_marketSignalId_linkedEntityType_linkedEntityId: {
            officeId: input.officeId,
            marketSignalId: link.signalId,
            linkedEntityType: link.entityType,
            linkedEntityId: link.entityId,
          },
        },
        update: {
          marketSignalLinkId: link.id,
          impactLevel: level,
          impactReason: reason,
          recommendedAction: recommendedAction(link.entityType, link.signal),
          sourceRefs: toMemoryJson(sourceRefs(link.signal, link)),
          payloadVersion: 1,
          provenance: toMemoryJson({ ...provenance, marketSignalId: link.signalId, marketSignalLinkId: link.id }),
        },
        create: {
          officeId: input.officeId,
          marketSignalId: link.signalId,
          marketSignalLinkId: link.id,
          linkedEntityType: link.entityType,
          linkedEntityId: link.entityId,
          impactLevel: level,
          impactReason: reason,
          recommendedAction: recommendedAction(link.entityType, link.signal),
          status: "pending",
          sourceRefs: toMemoryJson(sourceRefs(link.signal, link)),
          payloadVersion: 1,
          provenance: toMemoryJson({ ...provenance, marketSignalId: link.signalId, marketSignalLinkId: link.id }),
        },
      }));
    }
    return reviews;
  } catch (error) {
    if (input.strict) throw error;
    return [];
  }
}

export async function listMarketImpactReviews(input: {
  officeId: string;
  status?: string | null;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
  marketSignalId?: string | null;
  minImpactLevel?: string | null;
  limit?: number | null;
}) {
  const status = normalizeStatus(input.status);
  const minRank = input.minImpactLevel ? levelRank(input.minImpactLevel) : null;
  const reviews = await prisma.marketImpactReview.findMany({
    where: {
      officeId: input.officeId,
      ...(status ? { status } : {}),
      ...(input.linkedEntityType ? { linkedEntityType: input.linkedEntityType } : {}),
      ...(input.linkedEntityId ? { linkedEntityId: input.linkedEntityId } : {}),
      ...(input.marketSignalId ? { marketSignalId: input.marketSignalId } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: clampLimit(input.limit),
    include: {
      marketSignal: {
        select: {
          id: true,
          category: true,
          severity: true,
          confidence: true,
          summary: true,
          operatorImplication: true,
          pricingImplication: true,
          customerImpact: true,
          sourceObjectId: true,
          sourceRefs: true,
          sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, canonicalType: true, occurredAt: true } },
        },
      },
      marketSignalLink: { select: { id: true, entityType: true, entityId: true, matchType: true, confidence: true, reason: true } },
      feedback: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  const filtered = minRank == null ? reviews : reviews.filter((review) => levelRank(review.impactLevel) >= minRank);
  return {
    reviews: filtered.map(compactReview),
    evidence: filtered.flatMap(evidenceFromReview),
  };
}

async function getScopedReview(officeId: string, reviewId: string) {
  return prisma.marketImpactReview.findFirst({
    where: { id: reviewId, officeId },
    include: {
      marketSignal: {
        select: {
          id: true,
          category: true,
          severity: true,
          confidence: true,
          summary: true,
          operatorImplication: true,
          pricingImplication: true,
          customerImpact: true,
          sourceObjectId: true,
          sourceRefs: true,
          sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, canonicalType: true, occurredAt: true } },
        },
      },
      marketSignalLink: { select: { id: true, entityType: true, entityId: true, matchType: true, confidence: true, reason: true } },
      feedback: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

async function updateReviewStatus(input: {
  officeId: string;
  reviewId: string;
  status: MarketImpactReviewStatus;
  userId?: string | null;
  feedbackKind?: MarketSignalFeedbackKind | null;
  feedbackNote?: string | null;
}) {
  const now = new Date();
  const updated = await prisma.marketImpactReview.updateMany({
    where: { id: input.reviewId, officeId: input.officeId },
    data: {
      status: input.status,
      reviewedByUserId: input.userId ?? undefined,
      reviewedAt: input.status === "pending" ? undefined : now,
      actionedAt: input.status === "actioned" ? now : undefined,
      feedbackKind: input.feedbackKind ?? undefined,
      feedbackNote: input.feedbackNote ?? undefined,
    },
  });
  if (updated.count === 0) return null;
  return getScopedReview(input.officeId, input.reviewId).then((review) => review ? compactReview(review) : null);
}

export function acknowledgeMarketImpactReview(input: {
  officeId: string;
  reviewId: string;
  userId?: string | null;
}) {
  return updateReviewStatus({ officeId: input.officeId, reviewId: input.reviewId, status: "acknowledged", userId: input.userId });
}

export function dismissMarketImpactReview(input: {
  officeId: string;
  reviewId: string;
  userId?: string | null;
  feedbackKind?: string | null;
  feedbackNote?: string | null;
}) {
  const feedbackKind = normalizeFeedbackKind(input.feedbackKind) ?? "irrelevant";
  return updateReviewStatus({
    officeId: input.officeId,
    reviewId: input.reviewId,
    status: "dismissed",
    userId: input.userId,
    feedbackKind,
    feedbackNote: input.feedbackNote,
  });
}

export function markMarketImpactActioned(input: {
  officeId: string;
  reviewId: string;
  userId?: string | null;
  feedbackNote?: string | null;
}) {
  return updateReviewStatus({
    officeId: input.officeId,
    reviewId: input.reviewId,
    status: "actioned",
    userId: input.userId,
    feedbackKind: "useful",
    feedbackNote: input.feedbackNote,
  });
}

export async function recordMarketSignalFeedback(input: {
  officeId: string;
  marketSignalId: string;
  marketImpactReviewId?: string | null;
  userId?: string | null;
  feedbackKind: string;
  note?: string | null;
}) {
  const feedbackKind = normalizeFeedbackKind(input.feedbackKind);
  if (!feedbackKind) throw new Error(`Unsupported market feedback kind: ${input.feedbackKind}`);
  const signal = await prisma.marketSignal.findFirst({
    where: { id: input.marketSignalId, officeId: input.officeId },
    select: { id: true },
  });
  if (!signal) return null;
  if (input.marketImpactReviewId) {
    const review = await prisma.marketImpactReview.findFirst({
      where: { id: input.marketImpactReviewId, officeId: input.officeId, marketSignalId: input.marketSignalId },
      select: { id: true },
    });
    if (!review) return null;
  }
  const feedback = await prisma.marketSignalFeedback.create({
    data: {
      officeId: input.officeId,
      marketSignalId: input.marketSignalId,
      marketImpactReviewId: input.marketImpactReviewId ?? null,
      userId: input.userId ?? null,
      feedbackKind,
      note: input.note ?? null,
    },
  });
  if (input.marketImpactReviewId) {
    await prisma.marketImpactReview.updateMany({
      where: { id: input.marketImpactReviewId, officeId: input.officeId },
      data: {
        feedbackKind,
        feedbackNote: input.note ?? undefined,
        reviewedByUserId: input.userId ?? undefined,
        reviewedAt: new Date(),
      },
    });
  }
  return feedback;
}
