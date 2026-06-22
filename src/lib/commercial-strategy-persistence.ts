import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  assessCommercialStrategy,
  buildStrategyDecisionBrief,
  buildStrategyExecutionPacket,
  buildStrategyRouteDecision,
  type CommercialStrategy,
  type CommercialStrategyInput,
  type StrategyCustomerStats,
  type StrategyEvidenceCheck,
  type StrategyHistoricalJob,
  type StrategySourceEconomics,
} from "./commercial-strategy";
import { operatorMetricLabel } from "./operator-action-labels";
import { ingestKnowledgeObject } from "./memory/ingest-object";
import { recordMemoryEvent } from "./memory/record-event";
import { getMarketSignalsForStrategyContext } from "./market-intelligence/link-market-signals";

type PersistedStrategy = {
  strategy: CommercialStrategy;
  assessmentId: string | null;
  created: boolean;
};

function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cleanNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dayBucket(value?: Date | string | null) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function parseSourceEconomics(parsedData: string | null | undefined): StrategySourceEconomics | null {
  if (!parsedData) return null;
  try {
    const parsed = JSON.parse(parsedData) as {
      source?: string;
      sheet?: {
        contact?: string | null;
        contract?: string | null;
        status?: string | null;
        cadence?: string | null;
        contractValue?: number | null;
        contractCurrency?: string | null;
        profit?: number | null;
        profitCurrency?: string | null;
      };
    };
    if (parsed.source !== "reference-deal" || !parsed.sheet) return null;
    return {
      source: "reference-deal",
      contact: parsed.sheet.contact ?? null,
      contract: parsed.sheet.contract ?? null,
      status: parsed.sheet.status ?? null,
      cadence: parsed.sheet.cadence ?? null,
      contractValue: cleanNumber(parsed.sheet.contractValue ?? null),
      contractCurrency: parsed.sheet.contractCurrency ?? null,
      expectedProfit: cleanNumber(parsed.sheet.profit ?? null),
      profitCurrency: parsed.sheet.profitCurrency ?? null,
    };
  } catch {
    return null;
  }
}

async function loadMarginPolicy(officeId: string) {
  const profile = await prisma.marginProfile.findFirst({
    where: { officeId },
    orderBy: { marginPercent: "asc" },
    select: { marginPercent: true },
  });
  const target = profile?.marginPercent ?? 18;
  return {
    targetMarginPct: target,
    minMarginPct: Math.max(10, Math.min(14, target * 0.7)),
    stretchMarginPct: target + 7,
  };
}

async function loadCustomerStats(officeId: string, companyId: string | null | undefined): Promise<StrategyCustomerStats> {
  if (!companyId) {
    return { known: false, jobs: 0, quoted: 0, won: 0, lost: 0, avgMarginPct: null, avgProfit: null, totalRevenue: null };
  }
  const [jobs, quotes] = await Promise.all([
    prisma.job.findMany({
      where: { officeId, companyId },
      select: { revenue: true, cost: true },
      take: 80,
    }),
    prisma.quote.findMany({
      where: { officeId, companyId },
      select: { result: true },
      take: 120,
    }),
  ]);
  const margins = jobs
    .map((j) => (j.revenue && j.cost ? ((j.revenue - j.cost) / j.revenue) * 100 : null))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const profits = jobs
    .map((j) => (j.revenue != null && j.cost != null ? j.revenue - j.cost : null))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return {
    known: true,
    jobs: jobs.length,
    quoted: quotes.length,
    won: quotes.filter((q) => q.result === "WON").length,
    lost: quotes.filter((q) => q.result === "LOST").length,
    avgMarginPct: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
    avgProfit: profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : null,
    totalRevenue: jobs.reduce((sum, j) => sum + (j.revenue ?? 0), 0) || null,
  };
}

async function loadHistoricalJobs(officeId: string): Promise<StrategyHistoricalJob[]> {
  const [jobs, shipments] = await Promise.all([
    prisma.job.findMany({
      where: { officeId, cost: { not: null } },
      select: {
        id: true, reference: true, companyId: true, origin: true, destination: true, mode: true,
        revenue: true, cost: true, currency: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
    prisma.shipmentRecord.findMany({
      where: { officeId },
      select: {
        id: true, reference: true, companyId: true, origin: true, destination: true, mode: true,
        revenue: true, profit: true, currency: true, shipmentDate: true,
      },
      orderBy: { shipmentDate: "desc" },
      take: 120,
    }),
  ]);

  return [
    ...jobs.map((j) => ({
      id: j.id,
      reference: j.reference,
      companyId: j.companyId,
      origin: j.origin,
      destination: j.destination,
      mode: j.mode,
      revenue: j.revenue,
      cost: j.cost,
      currency: j.currency,
      createdAt: j.createdAt,
    })),
    ...shipments.map((s) => ({
      id: s.id,
      reference: s.reference,
      companyId: s.companyId,
      origin: s.origin,
      destination: s.destination,
      mode: s.mode,
      revenue: s.revenue,
      cost: s.revenue != null && s.profit != null ? s.revenue - s.profit : null,
      profit: s.profit,
      currency: s.currency,
      shipmentDate: s.shipmentDate,
    })),
  ];
}

async function loadSharedStrategyInputs(officeId: string, companyId: string | null | undefined) {
  const [laneRates, historicalJobs, customerStats, marginPolicy] = await Promise.all([
    prisma.laneRate.findMany({
      where: { officeId },
      select: { id: true, origin: true, destination: true, mode: true, baseAmount: true, currency: true, validFrom: true, validTo: true, notes: true },
      orderBy: { validFrom: "desc" },
      take: 120,
    }),
    loadHistoricalJobs(officeId),
    loadCustomerStats(officeId, companyId),
    loadMarginPolicy(officeId),
  ]);
  return { laneRates, historicalJobs, customerStats, marginPolicy };
}

function hashInput(input: CommercialStrategyInput) {
  return stableHash({
    entityType: input.entityType,
    id: input.id,
    type: input.type,
    status: input.status,
    companyId: input.companyId,
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    commodity: input.commodity,
    containerCount: input.containerCount,
    containerType: input.containerType,
    dimensions: input.dimensions,
    stackable: input.stackable,
    topLoad: input.topLoad,
    dangerousGoods: input.dangerousGoods,
    customsBy: input.customsBy,
    weight: input.weight,
    volume: input.volume,
    cargoReadyDate: input.cargoReadyDate,
    targetPrice: input.targetPrice,
    targetCurrency: input.targetCurrency,
    targetPriceStatus: input.targetPriceStatus,
    rateFreshnessDay: dayBucket(input.asOf),
    targetHistory: (input.targetHistory ?? []).map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      currency: entry.currency,
      status: entry.status,
      source: entry.source,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
    revenue: input.revenue,
    cost: input.cost,
    documents: (input.documents ?? []).map((doc) => ({
      id: doc.id,
      status: doc.status,
      docType: doc.docType ?? null,
      aiSummary: doc.aiSummary ?? null,
      aiFlags: doc.aiFlags ?? null,
      aiKeyFields: doc.aiKeyFields ?? null,
    })),
    carrierQuotes: (input.carrierQuotes ?? []).map((q) => ({
      id: q.id,
      status: q.status,
      total20: q.total20,
      total40: q.total40,
      total40HC: q.total40HC,
      transitDays: q.transitDays,
      validity: q.validity,
      createdAt: q.createdAt,
      transshipments: q.transshipments,
    })),
    laneRates: (input.laneRates ?? []).slice(0, 20).map((r) => [r.id, r.baseAmount, r.validTo]),
    customerStats: input.customerStats,
    marginPolicy: input.marginPolicy,
    marketSignals: (input.marketSignals ?? []).map((signal) => ({
      signalId: signal.signalId,
      category: signal.category,
      severity: signal.severity,
      confidence: signal.confidence,
      matchConfidence: signal.matchConfidence ?? null,
      summary: signal.summary,
      pricingImplication: signal.pricingImplication ?? null,
      affectedLanes: signal.affectedLanes ?? [],
      sourceRefs: signal.sourceRefs ?? [],
    })),
  });
}

async function recordStrategyAssessmentMemory(args: {
  officeId: string;
  inquiryId?: string | null;
  jobId?: string | null;
  input: CommercialStrategyInput;
  strategy: CommercialStrategy;
  assessmentId: string;
  decisionBrief: unknown;
  created: boolean;
}) {
  const title = args.input.subject ?? (args.jobId ? `Job strategy ${args.jobId}` : `RFQ strategy ${args.inquiryId ?? args.assessmentId}`);
  const sourceExternalId = `strategy:assessment:${args.assessmentId}`;
  const payload = {
    assessmentId: args.assessmentId,
    entityType: args.input.entityType ?? (args.jobId ? "JOB" : "INQUIRY"),
    inquiryId: args.inquiryId ?? null,
    jobId: args.jobId ?? null,
    companyId: args.input.companyId ?? null,
    subject: args.input.subject ?? null,
    recommendation: args.strategy.recommendation,
    recommendationLabel: args.strategy.recommendationLabel,
    score: args.strategy.score,
    band: args.strategy.band,
    confidence: args.strategy.confidence,
    price: args.strategy.price,
    quoteGate: args.strategy.quoteGate,
    operatorDecision: args.strategy.operatorDecision,
    recommendedRoute: args.strategy.recommendedRoute,
    riskAssessments: args.strategy.riskAssessments.slice(0, 8),
    actions: args.strategy.actions.slice(0, 8),
    decisionBrief: args.decisionBrief,
    createdSnapshot: args.created,
  };
  const provenance = {
    source: "commercial_strategy",
    operation: args.created ? "persist_strategy_assessment" : "reuse_strategy_assessment",
    path: "src/lib/commercial-strategy-persistence.ts",
    function: "persistStrategy",
    sourceRecordId: args.assessmentId,
  };
  const object = await ingestKnowledgeObject({
    officeId: args.officeId,
    sourceType: "STRATEGY",
    sourceExternalId,
    sourceLabel: "Commercial strategy assessment",
    canonicalType: "strategy_assessment",
    title,
    text: [
      title,
      args.strategy.recommendationLabel,
      args.strategy.strategyMemo,
      `Price: ${args.strategy.price.recommendedPrice ?? "unknown"} ${args.strategy.price.currency ?? ""}`,
      `Guardrail: ${args.strategy.price.guardrailStatus}`,
      `Quote gate: ${args.strategy.quoteGate.status}`,
      `Route: ${args.strategy.recommendedRoute?.label ?? "unpriced"}`,
      ...args.strategy.riskAssessments.slice(0, 3).map((risk) => `Risk ${risk.category}: ${risk.reason}`),
    ].filter(Boolean).join("\n"),
    entityType: "strategy_assessment",
    entityId: args.assessmentId,
    companyId: args.input.companyId ?? null,
    inquiryId: args.inquiryId ?? null,
    jobId: args.jobId ?? null,
    strategyAssessmentId: args.assessmentId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload,
    provenance,
  }).catch(() => null);

  await recordMemoryEvent({
    officeId: args.officeId,
    sourceType: "STRATEGY",
    sourceExternalId,
    sourceLabel: "Commercial strategy assessment",
    objectId: object?.id ?? null,
    eventType: args.created ? "strategy.assessment.created" : "strategy.assessment.reused",
    entityType: "strategy_assessment",
    entityId: args.assessmentId,
    actorType: "system",
    actorId: null,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload,
    provenance,
    idempotencyKey: `strategy:assessment:${args.assessmentId}:${args.created ? "created" : "reused"}`,
  }).catch(() => null);
}

async function persistStrategy(args: {
  officeId: string;
  inquiryId?: string | null;
  jobId?: string | null;
  input: CommercialStrategyInput;
  strategy: CommercialStrategy;
}): Promise<PersistedStrategy> {
  const inputHash = hashInput(args.input);
  const decisionBrief = buildStrategyDecisionBrief(args.strategy);
  const where = {
    officeId: args.officeId,
    status: "ACTIVE",
    ...(args.jobId ? { jobId: args.jobId } : { inquiryId: args.inquiryId ?? null }),
  };
  const latest = await prisma.strategyAssessment.findFirst({
    where,
    select: { id: true, inputHash: true, decisionBrief: true },
    orderBy: { createdAt: "desc" },
  });
  if (latest?.inputHash === inputHash) {
    if (!latest.decisionBrief) {
      await prisma.strategyAssessment.update({
        where: { id: latest.id },
        data: { decisionBrief: decisionBrief as Prisma.InputJsonValue },
      });
    }
    await recordStrategyAssessmentMemory({
      ...args,
      assessmentId: latest.id,
      decisionBrief,
      created: false,
    });
    return { strategy: args.strategy, assessmentId: latest.id, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.strategyAssessment.updateMany({
      where,
      data: { status: "SUPERSEDED" },
    });
    return tx.strategyAssessment.create({
      data: {
        officeId: args.officeId,
        inquiryId: args.inquiryId ?? null,
        jobId: args.jobId ?? null,
        entityType: args.input.entityType ?? (args.jobId ? "JOB" : "INQUIRY"),
        subject: args.input.subject ?? null,
        recommendation: args.strategy.recommendation,
        recommendationLabel: args.strategy.recommendationLabel,
        strategyMemo: args.strategy.strategyMemo,
        score: args.strategy.score,
        band: args.strategy.band,
        confidence: args.strategy.confidence,
        components: args.strategy.components as Prisma.InputJsonValue,
        evidence: args.strategy.evidence as Prisma.InputJsonValue,
        decisionBrief: decisionBrief as Prisma.InputJsonValue,
        inputHash,
        routeOptions: {
          create: args.strategy.routeOptions.map((option) => ({
            officeId: args.officeId,
            carrierQuoteId: option.carrierQuoteId ?? null,
            label: option.label,
            route: option.route,
            mode: option.mode,
            provider: option.provider,
            source: option.source,
            cost: cleanNumber(option.cost),
            currency: option.currency,
            transitDays: option.transitDays,
            reliabilityScore: option.reliabilityScore,
            riskScore: option.riskScore,
            confidence: option.confidence,
            tradeoff: option.tradeoff,
            ...(option.evidence ? { evidence: option.evidence as Prisma.InputJsonValue } : {}),
          })),
        },
        priceRecommendation: {
          create: {
            officeId: args.officeId,
            currency: args.strategy.price.currency,
            buyCost: cleanNumber(args.strategy.price.buyCost),
            costSource: args.strategy.price.costSource,
            floorPrice: cleanNumber(args.strategy.price.floorPrice),
            recommendedPrice: cleanNumber(args.strategy.price.recommendedPrice),
            stretchPrice: cleanNumber(args.strategy.price.stretchPrice),
            walkAwayPrice: cleanNumber(args.strategy.price.walkAwayPrice),
            expectedMarginPct: cleanNumber(args.strategy.price.expectedMarginPct),
            expectedGrossProfit: cleanNumber(args.strategy.price.expectedGrossProfit),
            winProbability: args.strategy.price.winProbability,
            guardrailStatus: args.strategy.price.guardrailStatus,
            rationale: args.strategy.price.rationale as Prisma.InputJsonValue,
          },
        },
        riskAssessments: {
          create: args.strategy.riskAssessments.map((risk) => ({
            officeId: args.officeId,
            category: risk.category,
            level: risk.level,
            score: risk.score,
            reason: risk.reason,
            mitigation: risk.mitigation,
            ...(risk.evidence ? { evidence: risk.evidence as Prisma.InputJsonValue } : {}),
          })),
        },
        actions: {
          create: args.strategy.actions.map((action) => ({
            officeId: args.officeId,
            actionType: action.actionType,
            priority: action.priority,
            title: action.title,
            rationale: action.rationale,
            payload: action.payload as Prisma.InputJsonValue,
            requiresApproval: action.requiresApproval,
          })),
        },
      },
      select: { id: true },
    });
  });

  await recordStrategyAssessmentMemory({
    ...args,
    assessmentId: created.id,
    decisionBrief,
    created: true,
  });

  return { strategy: args.strategy, assessmentId: created.id, created: true };
}

export async function loadInquiryStrategyInput(officeId: string, inquiryId: string): Promise<CommercialStrategyInput | null> {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId },
    include: {
      company: { select: { id: true, name: true } },
      carrierQuotes: { orderBy: { createdAt: "asc" } },
      targetPriceHistory: {
        select: { id: true, amount: true, currency: true, status: true, source: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
      job: {
        select: {
          id: true,
          revenue: true,
          cost: true,
          currency: true,
          targetPriceHistory: {
            select: { id: true, amount: true, currency: true, status: true, source: true, note: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 8,
          },
          documents: {
            select: {
              id: true,
              name: true,
              status: true,
              docType: true,
              aiSummary: true,
              aiFlags: true,
              aiKeyFields: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!inquiry) return null;
  const [shared, marketSignals] = await Promise.all([
    loadSharedStrategyInputs(officeId, inquiry.companyId),
    getMarketSignalsForStrategyContext({
      officeId,
      inquiryId: inquiry.id,
      jobId: inquiry.job?.id ?? null,
      companyId: inquiry.companyId,
      limit: 5,
    }),
  ]);
  const sourceEconomics = parseSourceEconomics(inquiry.parsedData);
  const input: CommercialStrategyInput = {
    id: inquiry.id,
    entityType: "INQUIRY",
    subject: inquiry.subject,
    type: inquiry.type,
    status: inquiry.status,
    companyId: inquiry.companyId,
    companyName: inquiry.company?.name ?? inquiry.fromCompany,
    fromEmail: inquiry.fromEmail,
    fromCompany: inquiry.fromCompany,
    origin: inquiry.origin,
    destination: inquiry.destination,
    mode: inquiry.mode,
    containerCount: inquiry.containerCount,
    containerType: inquiry.containerType,
    dimensions: inquiry.dimensions,
    stackable: inquiry.stackable,
    topLoad: inquiry.topLoad,
    dangerousGoods: inquiry.dangerousGoods,
    customsBy: inquiry.customsBy,
    incoterms: inquiry.incoterms,
    commodity: inquiry.commodity,
    weight: inquiry.weight,
    volume: inquiry.volume,
    cargoReadyDate: inquiry.cargoReadyDate,
    targetPrice: inquiry.targetPrice,
    targetCurrency: inquiry.targetCurrency,
    targetPriceStatus: inquiry.targetPriceStatus,
    targetPriceSource: inquiry.targetPriceSource,
    revenue: inquiry.job?.revenue ?? null,
    cost: inquiry.job?.cost ?? null,
    currency: inquiry.job?.currency ?? inquiry.targetCurrency,
    receivedAt: inquiry.receivedAt,
    rawEmailBody: inquiry.rawEmailBody,
    notes: inquiry.notes,
    sourceEconomics,
    documents: inquiry.job?.documents ?? [],
    targetHistory: [...inquiry.targetPriceHistory, ...(inquiry.job?.targetPriceHistory ?? [])],
    carrierQuotes: inquiry.carrierQuotes,
    marketSignals,
    ...shared,
  };
  return input;
}

export async function assessInquiryStrategy(officeId: string, inquiryId: string): Promise<PersistedStrategy | null> {
  const input = await loadInquiryStrategyInput(officeId, inquiryId);
  if (!input?.id) return null;
  const link = await prisma.inquiry.findFirst({
    where: { id: input.id, officeId },
    select: { job: { select: { id: true } } },
  });
  const strategy = assessCommercialStrategy(input);
  return persistStrategy({
    officeId,
    inquiryId: input.id,
    jobId: link?.job?.id ?? null,
    input,
    strategy,
  });
}

export async function loadJobStrategyInput(officeId: string, jobId: string): Promise<CommercialStrategyInput | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { id: true, name: true } },
      inquiry: {
        include: {
          carrierQuotes: { orderBy: { createdAt: "asc" } },
          targetPriceHistory: {
            select: { id: true, amount: true, currency: true, status: true, source: true, note: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 8,
          },
        },
      },
      targetPriceHistory: {
        select: { id: true, amount: true, currency: true, status: true, source: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
      documents: {
        select: {
          id: true,
          name: true,
          status: true,
          docType: true,
          aiSummary: true,
          aiFlags: true,
          aiKeyFields: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!job) return null;
  const [shared, marketSignals] = await Promise.all([
    loadSharedStrategyInputs(officeId, job.companyId),
    getMarketSignalsForStrategyContext({
      officeId,
      jobId: job.id,
      inquiryId: job.inquiryId,
      companyId: job.companyId,
      limit: 5,
    }),
  ]);
  const sourceEconomics = parseSourceEconomics(job.inquiry?.parsedData);
  const input: CommercialStrategyInput = {
    id: job.id,
    entityType: "JOB",
    subject: job.title ?? job.inquiry?.subject ?? job.reference,
    type: job.type,
    status: job.status,
    companyId: job.companyId,
    companyName: job.company?.name ?? job.inquiry?.fromCompany,
    fromEmail: job.inquiry?.fromEmail ?? null,
    fromCompany: job.inquiry?.fromCompany ?? null,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    containerCount: job.containerCount,
    containerType: job.containerType,
    dimensions: job.dimensions,
    stackable: job.stackable,
    topLoad: job.topLoad,
    dangerousGoods: job.dangerousGoods,
    customsBy: job.customsBy,
    incoterms: job.incoterms,
    commodity: job.commodity,
    weight: job.weight,
    volume: job.volume,
    cargoReadyDate: job.inquiry?.cargoReadyDate ?? null,
    targetPrice: job.targetPrice,
    targetCurrency: job.targetCurrency,
    targetPriceStatus: job.targetPriceStatus,
    targetPriceSource: job.targetPriceSource,
    revenue: job.revenue,
    cost: job.cost,
    currency: job.currency,
    receivedAt: job.inquiry?.receivedAt ?? job.createdAt,
    rawEmailBody: job.inquiry?.rawEmailBody ?? null,
    notes: job.notes,
    sourceEconomics,
    documents: job.documents,
    targetHistory: [...job.targetPriceHistory, ...(job.inquiry?.targetPriceHistory ?? [])],
    carrierQuotes: job.inquiry?.carrierQuotes ?? [],
    marketSignals,
    ...shared,
  };
  return input;
}

export async function assessJobStrategy(officeId: string, jobId: string): Promise<PersistedStrategy | null> {
  const input = await loadJobStrategyInput(officeId, jobId);
  if (!input?.id) return null;
  const link = await prisma.job.findFirst({
    where: { id: input.id, officeId },
    select: { inquiryId: true },
  });
  const strategy = assessCommercialStrategy(input);
  return persistStrategy({ officeId, inquiryId: link?.inquiryId ?? null, jobId: input.id, input, strategy });
}

export function compactStrategyForAgent(strategy: CommercialStrategy) {
  const displayEvidenceCheck = (check: StrategyEvidenceCheck | null | undefined) => check
    ? { ...check, metric: operatorMetricLabel(check.metric, check.tone) }
    : null;
  const decisionQuality = displayEvidenceCheck(strategy.evidenceChecks.find((check) => check.key === "decision_quality") ?? null);
  const decisionBrief = buildStrategyDecisionBrief(strategy);
  const { score: _score, ...decisionBriefWithoutScore } = decisionBrief;
  const displayDecisionBrief = {
    ...decisionBriefWithoutScore,
    strategyGrade: {
      band: strategy.band,
      confidence: strategy.confidence,
    },
    weakestEvidence: displayEvidenceCheck(decisionBrief.weakestEvidence),
    decisionQuality: displayEvidenceCheck(decisionBrief.decisionQuality),
  };
  const executionPacket = buildStrategyExecutionPacket(strategy);
  const displayExecutionPacket = {
    ...executionPacket,
    brief: displayDecisionBrief,
    evidence: {
      ...executionPacket.evidence,
      weakest: displayEvidenceCheck(executionPacket.evidence.weakest),
      checks: executionPacket.evidence.checks.map((check) => displayEvidenceCheck(check)).filter((check): check is StrategyEvidenceCheck => Boolean(check)),
    },
  };
  return {
    recommendation: strategy.recommendationLabel,
    strategy_grade: {
      band: strategy.band,
      confidence: strategy.confidence,
    },
    confidence: strategy.confidence,
    decision_quality: decisionQuality,
    memo: strategy.strategyMemo,
    decision_brief: displayDecisionBrief,
    commercial_priority: displayExecutionPacket.commercialPriority,
    execution_packet: displayExecutionPacket,
    decision_contract: displayExecutionPacket.contract,
    price: strategy.price,
    quote_gate: strategy.quoteGate,
    operator_decision: strategy.operatorDecision,
    decision_reasons: strategy.decisionReasons,
    evidence_checks: strategy.evidenceChecks.map((check) => displayEvidenceCheck(check)).filter((check): check is StrategyEvidenceCheck => Boolean(check)),
    document_readiness: strategy.evidence.documentReadiness,
    target_trail: strategy.evidence.targetTrail,
    maturity_checks: strategy.maturityChecks,
    blocker_resolution_plan: strategy.blockerResolutionPlan,
    negotiation: strategy.negotiation,
    recommended_route: strategy.recommendedRoute,
    route_decision: buildStrategyRouteDecision(strategy),
    top_risks: strategy.riskAssessments.slice(0, 5),
    actions: strategy.actions,
    evidence: strategy.evidence,
  };
}
