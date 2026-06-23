import { prisma } from "@/lib/prisma";
import {
  buildSourceQualityLookup,
  listSourceQualitySummaries,
  rankMarketImpactReviews,
  rankMarketSignals,
} from "@/lib/market-intelligence/source-quality";
import {
  getMarketSignalSuppressionReason,
  shouldShowMarketSignalInMorningBrief,
} from "@/lib/market-intelligence/signal-suppression";
import { normalizeMarketLane } from "@/lib/market-intelligence/lane-validation";

export type MorningBriefInput = {
  officeId: string;
  now?: Date;
  limit?: number;
};

function clampLimit(limit: number | null | undefined, fallback = 10) {
  return Math.max(1, Math.min(50, Math.floor(limit ?? fallback)));
}

function daysAgo(date: Date, now: Date) {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function inDays(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000);
}

function source(entityType: string, entityId: string | null | undefined, extra?: Record<string, unknown>) {
  return { entityType, entityId: entityId ?? null, ...extra };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function normalizedLanes(value: unknown) {
  return strings(value)
    .map(normalizeMarketLane)
    .filter((lane): lane is string => Boolean(lane))
    .filter((lane, index, array) => array.indexOf(lane) === index);
}

export async function generateMorningBrief(input: MorningBriefInput) {
  const now = input.now ?? new Date();
  const limit = clampLimit(input.limit);
  const staleJobCutoff = new Date(now.getTime() - 5 * 86_400_000);
  const staleRfqCutoff = new Date(now.getTime() - 3 * 86_400_000);
  const recentCutoff = new Date(now.getTime() - 2 * 86_400_000);
  const recentMarketCutoff = new Date(now.getTime() - 14 * 86_400_000);
  const upcomingCutoff = inDays(now, 10);

  const [
    threads,
    stuckJobs,
    supplierThreads,
    highRiskStrategies,
    missingDocuments,
    upcomingJobs,
    staleRfqs,
    customerRisks,
    marketImpactReviews,
    marketSignals,
    sourceQuality,
  ] = await Promise.all([
    prisma.emailThread.findMany({
      where: { officeId: input.officeId, hiddenAt: null },
      orderBy: { lastMessageAt: "desc" },
      take: Math.max(limit * 4, 30),
      select: {
        id: true, subject: true, jobId: true, inquiryId: true, lastMessageAt: true,
        job: { select: { reference: true, company: { select: { id: true, name: true } } } },
        inquiry: { select: { subject: true, company: { select: { id: true, name: true } }, fromEmail: true } },
        messages: { orderBy: { sentAt: "desc" }, take: 1, select: { id: true, direction: true, fromEmail: true, fromName: true, sentAt: true, classification: true } },
      },
    }),
    prisma.job.findMany({
      where: {
        officeId: input.officeId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        updatedAt: { lt: staleJobCutoff },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true, reference: true, title: true, status: true, type: true, origin: true, destination: true, updatedAt: true, company: { select: { id: true, name: true } } },
    }),
    prisma.emailThread.findMany({
      where: { officeId: input.officeId, supplierOfferAt: { gte: recentCutoff }, supplierOffer: { not: null } },
      orderBy: { supplierOfferAt: "desc" },
      take: limit,
      select: {
        id: true, subject: true, jobId: true, inquiryId: true, supplierOffer: true, supplierOfferAt: true,
        job: { select: { reference: true, company: { select: { id: true, name: true } } } },
        inquiry: { select: { subject: true, company: { select: { id: true, name: true } } } },
      },
    }),
    prisma.strategyAssessment.findMany({
      where: {
        officeId: input.officeId,
        status: "ACTIVE",
        riskAssessments: { some: { OR: [{ score: { gte: 70 } }, { level: { in: ["HIGH", "CRITICAL"] } }] } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, jobId: true, inquiryId: true, subject: true, recommendationLabel: true, band: true, confidence: true, createdAt: true,
        priceRecommendation: { select: { guardrailStatus: true, recommendedPrice: true, currency: true } },
        riskAssessments: { orderBy: { score: "desc" }, take: 2, select: { category: true, level: true, score: true, reason: true, mitigation: true } },
        job: { select: { reference: true, company: { select: { id: true, name: true } } } },
        inquiry: { select: { subject: true, company: { select: { id: true, name: true } } } },
      },
    }),
    prisma.jobDocument.findMany({
      where: { officeId: input.officeId, status: "PENDING", job: { status: { notIn: ["DELIVERED", "CANCELLED"] } } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true, jobId: true, name: true, docType: true, status: true, updatedAt: true, job: { select: { reference: true, company: { select: { id: true, name: true } } } } },
    }),
    prisma.job.findMany({
      where: {
        officeId: input.officeId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        OR: [
          { eta: { gte: now, lte: upcomingCutoff } },
          { etd: { gte: now, lte: upcomingCutoff } },
        ],
      },
      orderBy: [{ eta: "asc" }, { etd: "asc" }],
      take: limit,
      select: { id: true, reference: true, status: true, eta: true, etd: true, origin: true, destination: true, company: { select: { id: true, name: true } } },
    }),
    prisma.inquiry.findMany({
      where: { officeId: input.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] }, receivedAt: { lt: staleRfqCutoff } },
      orderBy: { receivedAt: "asc" },
      take: limit,
      select: { id: true, subject: true, status: true, type: true, origin: true, destination: true, receivedAt: true, company: { select: { id: true, name: true } }, fromEmail: true },
    }),
    prisma.riskAlert.findMany({
      where: { officeId: input.officeId, isOpen: true },
      orderBy: [{ level: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, companyId: true, level: true, reason: true, createdAt: true, company: { select: { name: true } } },
    }),
    prisma.marketImpactReview.findMany({
      where: {
        officeId: input.officeId,
        status: "pending",
        impactLevel: { in: ["high", "critical"] },
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      include: {
        marketSignal: {
          select: {
            id: true,
            category: true,
            severity: true,
            confidence: true,
            summary: true,
            sourceObjectId: true,
            sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, occurredAt: true, payload: true } },
            feedback: { select: { feedbackKind: true } },
          },
        },
        marketSignalLink: { select: { id: true, entityType: true, entityId: true, matchType: true, confidence: true, reason: true } },
      },
    }).catch(() => []),
    prisma.marketSignal.findMany({
      where: {
        officeId: input.officeId,
        severity: { in: ["high", "critical"] },
        createdAt: { gte: recentMarketCutoff },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        links: { orderBy: { confidence: "desc" }, take: 30 },
        impactReviews: { select: { status: true, feedbackKind: true } },
        feedback: { select: { feedbackKind: true } },
        sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, occurredAt: true, payload: true } },
      },
    }).catch(() => []),
    listSourceQualitySummaries({ officeId: input.officeId, now }).catch(() => []),
  ]);

  const unansweredInbound = threads
    .filter((thread) => thread.messages[0]?.direction === "INBOUND")
    .slice(0, limit)
    .map((thread) => ({
      threadId: thread.id,
      subject: thread.subject,
      from: thread.messages[0]?.fromName ?? thread.messages[0]?.fromEmail ?? null,
      ageDays: daysAgo(thread.messages[0]?.sentAt ?? thread.lastMessageAt, now),
      jobReference: thread.job?.reference ?? null,
      customer: thread.job?.company?.name ?? thread.inquiry?.company?.name ?? thread.inquiry?.fromEmail ?? null,
      classification: thread.messages[0]?.classification ?? null,
      sources: [source("email_thread", thread.id), source("email_message", thread.messages[0]?.id ?? null), source("job", thread.jobId), source("inquiry", thread.inquiryId)],
    }));

  const urgentCustomerFollowUps = unansweredInbound
    .filter((thread) => thread.ageDays >= 1 || thread.classification === "CUSTOMER_REPLY")
    .slice(0, limit);

  const newSupplierOffers = supplierThreads.map((thread) => {
    let parsed: Record<string, unknown> = {};
    try { parsed = thread.supplierOffer ? JSON.parse(thread.supplierOffer) : {}; } catch {}
    return {
      threadId: thread.id,
      subject: thread.subject,
      supplier: typeof parsed.supplierName === "string" ? parsed.supplierName : null,
      price: typeof parsed.pricePerUnit === "number" ? parsed.pricePerUnit : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      unit: typeof parsed.unit === "string" ? parsed.unit : null,
      receivedAt: thread.supplierOfferAt,
      jobReference: thread.job?.reference ?? null,
      customer: thread.job?.company?.name ?? thread.inquiry?.company?.name ?? null,
      sources: [source("email_thread", thread.id), source("job", thread.jobId), source("inquiry", thread.inquiryId)],
    };
  });
  const sourceQualityLookup = buildSourceQualityLookup(sourceQuality);
  const qualityForObject = (sourceObjectId: string | null | undefined) =>
    sourceObjectId ? sourceQualityLookup.bySourceObjectId.get(sourceObjectId) ?? null : null;
  const marketImpactReviewsEligibleForBrief = marketImpactReviews.filter((review) => !getMarketSignalSuppressionReason({
    signal: {
      ...review.marketSignal,
      impactReviews: [review],
      links: review.marketSignalLink ? [review.marketSignalLink] : [],
    },
    sourceQuality: qualityForObject(review.marketSignal.sourceObjectId),
    requirePendingReview: true,
  }));
  const marketSignalsEligibleForBrief = marketSignals.filter((signal) => shouldShowMarketSignalInMorningBrief({
    signal,
    sourceQuality: qualityForObject(signal.sourceObjectId),
  }));
  const prioritizedMarketImpactReviews = rankMarketImpactReviews(marketImpactReviewsEligibleForBrief, sourceQualityLookup, now)
    .slice(0, limit);
  const prioritizedMarketSignals = rankMarketSignals(marketSignalsEligibleForBrief, sourceQualityLookup, now)
    .slice(0, limit);

  const recommendedActions = [
    prioritizedMarketImpactReviews[0] ? {
      priority: prioritizedMarketImpactReviews[0].impactLevel === "critical" ? "critical" : "high",
      action: prioritizedMarketImpactReviews[0].recommendedAction ?? `Review market impact: ${prioritizedMarketImpactReviews[0].marketSignal.summary}`,
      why: prioritizedMarketImpactReviews[0].impactReason,
      sources: [
        source("market_impact_review", prioritizedMarketImpactReviews[0].id),
        source("market_signal", prioritizedMarketImpactReviews[0].marketSignalId),
        source(prioritizedMarketImpactReviews[0].linkedEntityType, prioritizedMarketImpactReviews[0].linkedEntityId),
        source("knowledge_object", prioritizedMarketImpactReviews[0].marketSignal.sourceObjectId),
      ],
    } : null,
    prioritizedMarketSignals[0] ? {
      priority: prioritizedMarketSignals[0].severity === "critical" ? "critical" : "high",
      action: prioritizedMarketSignals[0].recommendedActions && strings(prioritizedMarketSignals[0].recommendedActions)[0]
        ? strings(prioritizedMarketSignals[0].recommendedActions)[0]
        : `Review market signal: ${prioritizedMarketSignals[0].summary}`,
      why: prioritizedMarketSignals[0].pricingImplication ?? prioritizedMarketSignals[0].operatorImplication ?? prioritizedMarketSignals[0].summary,
      sources: [source("market_signal", prioritizedMarketSignals[0].id), source("knowledge_object", prioritizedMarketSignals[0].sourceObjectId)],
    } : null,
    urgentCustomerFollowUps[0] ? {
      priority: "critical",
      action: `Reply to ${urgentCustomerFollowUps[0].from ?? "latest inbound sender"} on "${urgentCustomerFollowUps[0].subject}".`,
      why: "Inbound message is waiting on the office.",
      sources: urgentCustomerFollowUps[0].sources,
    } : null,
    highRiskStrategies[0] ? {
      priority: "high",
      action: `Review high-risk strategy: ${highRiskStrategies[0].subject ?? highRiskStrategies[0].job?.reference ?? highRiskStrategies[0].id}.`,
      why: highRiskStrategies[0].riskAssessments[0]?.reason ?? "Strategy has a high risk score.",
      sources: [source("strategy_assessment", highRiskStrategies[0].id), source("job", highRiskStrategies[0].jobId), source("inquiry", highRiskStrategies[0].inquiryId)],
    } : null,
    stuckJobs[0] ? {
      priority: "high",
      action: `Move or update stuck job ${stuckJobs[0].reference}.`,
      why: `No update for ${daysAgo(stuckJobs[0].updatedAt, now)} days.`,
      sources: [source("job", stuckJobs[0].id)],
    } : null,
    missingDocuments[0] ? {
      priority: "medium",
      action: `Clear missing document ${missingDocuments[0].name} on ${missingDocuments[0].job.reference}.`,
      why: "Pending job documents block operational confidence and customer updates.",
      sources: [source("job_document", missingDocuments[0].id), source("job", missingDocuments[0].jobId)],
    } : null,
    staleRfqs[0] ? {
      priority: "medium",
      action: `Revive or close stale RFQ "${staleRfqs[0].subject}".`,
      why: `RFQ has been open for ${daysAgo(staleRfqs[0].receivedAt, now)} days.`,
      sources: [source("inquiry", staleRfqs[0].id)],
    } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    officeId: input.officeId,
    generatedAt: now,
    summary: {
      urgentCustomerFollowUps: urgentCustomerFollowUps.length,
      stuckJobs: stuckJobs.length,
      unansweredInboundMessages: unansweredInbound.length,
      newSupplierOffers: newSupplierOffers.length,
      highRiskStrategyAssessments: highRiskStrategies.length,
      missingDocuments: missingDocuments.length,
      upcomingEtaEtd: upcomingJobs.length,
      staleRfqs: staleRfqs.length,
      customerRisks: customerRisks.length,
      marketImpactReviews: prioritizedMarketImpactReviews.length,
      marketSignals: prioritizedMarketSignals.length,
      topAction: recommendedActions[0]?.action ?? null,
    },
    market_impact_reviews: prioritizedMarketImpactReviews.map((review) => ({
      id: review.id,
      status: review.status,
      impactLevel: review.impactLevel,
      impactReason: review.impactReason,
      recommendedAction: review.recommendedAction,
      linkedEntityType: review.linkedEntityType,
      linkedEntityId: review.linkedEntityId,
      createdAt: review.createdAt,
      marketSignal: {
        id: review.marketSignal.id,
        category: review.marketSignal.category,
        severity: review.marketSignal.severity,
        confidence: review.marketSignal.confidence,
        summary: review.marketSignal.summary,
      },
      sourceQuality: qualityForObject(review.marketSignal.sourceObjectId) ? {
        sourceId: qualityForObject(review.marketSignal.sourceObjectId)?.sourceId,
        name: qualityForObject(review.marketSignal.sourceObjectId)?.name,
        score: qualityForObject(review.marketSignal.sourceObjectId)?.score,
        scoreBand: qualityForObject(review.marketSignal.sourceObjectId)?.scoreBand,
      } : null,
      suppressionReason: getMarketSignalSuppressionReason({
        signal: { ...review.marketSignal, impactReviews: [review], links: review.marketSignalLink ? [review.marketSignalLink] : [] },
        sourceQuality: qualityForObject(review.marketSignal.sourceObjectId),
        requirePendingReview: true,
      }),
      link: review.marketSignalLink ? {
        id: review.marketSignalLink.id,
        entityType: review.marketSignalLink.entityType,
        entityId: review.marketSignalLink.entityId,
        matchType: review.marketSignalLink.matchType,
        confidence: review.marketSignalLink.confidence,
        reason: review.marketSignalLink.reason,
      } : null,
      sources: [
        source("market_impact_review", review.id),
        source("market_signal", review.marketSignalId),
        source("market_signal_link", review.marketSignalLinkId),
        source(review.linkedEntityType, review.linkedEntityId),
        source("knowledge_object", review.marketSignal.sourceObjectId, { title: review.marketSignal.sourceObject?.title ?? null }),
      ],
      researchHref: "/dashboard/intelligence",
    })),
    market_intelligence: prioritizedMarketSignals.map((signal) => {
      const links = signal.links;
      const affectedRfqs = links.filter((link) => link.entityType === "inquiry").length;
      const affectedJobs = links.filter((link) => link.entityType === "job").length;
      const affectedCustomers = links.filter((link) => link.entityType === "company").length;
      const signalSourceQuality = qualityForObject(signal.sourceObjectId);
      return {
        id: signal.id,
        category: signal.category,
        severity: signal.severity,
        confidence: signal.confidence,
        summary: signal.summary,
        affectedModes: strings(signal.affectedModes),
        affectedLanes: normalizedLanes(signal.affectedLanes),
        operatorImplication: signal.operatorImplication,
        pricingImplication: signal.pricingImplication,
        customerImpact: signal.customerImpact,
        recommendedActions: strings(signal.recommendedActions),
        sourceQuality: signalSourceQuality ? {
          sourceId: signalSourceQuality.sourceId,
          name: signalSourceQuality.name,
          score: signalSourceQuality.score,
          scoreBand: signalSourceQuality.scoreBand,
        } : null,
        suppressionReason: getMarketSignalSuppressionReason({
          signal,
          sourceQuality: signalSourceQuality,
          requirePendingReview: true,
        }),
        affected: {
          activeRfqs: affectedRfqs,
          activeJobs: affectedJobs,
          customers: affectedCustomers,
        },
        links: links.slice(0, 10).map((link) => ({
          entityType: link.entityType,
          entityId: link.entityId,
          matchType: link.matchType,
          confidence: link.confidence,
          reason: link.reason,
        })),
        sources: [
          source("market_signal", signal.id),
          source("knowledge_object", signal.sourceObjectId, { title: signal.sourceObject?.title ?? null }),
        ],
        researchHref: "/dashboard/intelligence",
      };
    }),
    urgent_customer_followups: urgentCustomerFollowUps,
    stuck_jobs: stuckJobs.map((job) => ({
      ...job,
      ageDays: daysAgo(job.updatedAt, now),
      sources: [source("job", job.id), source("company", job.company?.id ?? null)],
    })),
    unanswered_inbound_messages: unansweredInbound,
    new_supplier_offers: newSupplierOffers,
    high_risk_strategy_assessments: highRiskStrategies.map((assessment) => ({
      ...assessment,
      customer: assessment.job?.company?.name ?? assessment.inquiry?.company?.name ?? null,
      sources: [source("strategy_assessment", assessment.id), source("job", assessment.jobId), source("inquiry", assessment.inquiryId)],
    })),
    missing_documents: missingDocuments.map((doc) => ({
      ...doc,
      ageDays: daysAgo(doc.updatedAt, now),
      sources: [source("job_document", doc.id), source("job", doc.jobId), source("company", doc.job.company?.id ?? null)],
    })),
    upcoming_eta_etd: upcomingJobs.map((job) => ({
      ...job,
      sources: [source("job", job.id), source("company", job.company?.id ?? null)],
    })),
    stale_rfqs: staleRfqs.map((inquiry) => ({
      ...inquiry,
      ageDays: daysAgo(inquiry.receivedAt, now),
      sources: [source("inquiry", inquiry.id), source("company", inquiry.company?.id ?? null)],
    })),
    customer_risks: customerRisks.map((risk) => ({
      ...risk,
      sources: [source("company", risk.companyId)],
    })),
    recommended_actions: recommendedActions,
  };
}
