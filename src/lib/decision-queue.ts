import "server-only";
import { prisma } from "./prisma";
import { openInquiryStatusFilter } from "./inquiry-status";
import { requiredRfqMissing } from "./opportunity-score";
import { assessInquiryStrategy, assessJobStrategy } from "./commercial-strategy-persistence";
import {
  buildStrategyCommandLedger,
  buildStrategyExecutionPacket,
  type CommercialStrategy,
  type StrategyCommandLedgerItem,
  type StrategyDecisionContract,
  type StrategyProofGap,
} from "./commercial-strategy";
import { buildDocumentReadiness, type DocumentReadinessDoc } from "./document-readiness";
import { getReferenceDealDecisions } from "./reference-deals";
import { operatorMaturityLabel, operatorMetricLabel } from "./operator-action-labels";
import { displayParty } from "./whatsapp-display";

export type DecisionQueueTone = "critical" | "high" | "normal";

export type DecisionQueuePriorityFactor = {
  label: string;
  value: string;
  tone: "strong" | "watch" | "weak";
};

export type DecisionQueueGateCheck = {
  label: string;
  status: "ready" | "review" | "blocked" | "info";
  metric: string;
  detail: string;
};

export type DecisionQueueRankReason = {
  label: string;
  summary: string;
  detail: string;
  tone: "blocker" | "review" | "support" | "info";
};

export type DecisionQueueBlocker = {
  label: string;
  ask: string;
  owner: "CUSTOMER" | "FORWARDER" | "INTERNAL" | "OPERATOR";
  priority: "critical" | "high" | "medium" | "normal";
};

export type DecisionQueueMove = {
  phase: string;
  label: string;
  owner: DecisionQueueBlocker["owner"];
  command: string;
  toolHint?: string | null;
  canRunNow: boolean;
  requiresApproval: boolean;
};

export type DecisionQueueItem = {
  key: string;
  tone: DecisionQueueTone;
  category: "LEAD" | "RFQ" | "PRICING" | "OUTCOME" | "REPLY" | "RISK" | "AGENT";
  entityType: "lead" | "inquiry" | "job" | "thread" | "agent_proposal" | "quote";
  entityId: string | null;
  title: string;
  meta: string;
  reason: string;
  actionLabel: string;
  href: string;
  score: number;
  ageHours?: number;
  priorityFactors?: DecisionQueuePriorityFactor[];
  gateChecks?: DecisionQueueGateCheck[];
  rankReasons?: DecisionQueueRankReason[];
  blockers?: DecisionQueueBlocker[];
  decisionMove?: DecisionQueueMove;
  decisionContract?: StrategyDecisionContract | null;
  commandLedger?: StrategyCommandLedgerItem[];
  proofGaps?: StrategyProofGap[];
  visualTarget?: string | null;
};

function hoursSince(date: Date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
}

function toneFromScore(score: number): DecisionQueueTone {
  if (score >= 90) return "critical";
  if (score >= 72) return "high";
  return "normal";
}

function money(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return null;
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(99, Math.round(score)));
}

function valueBoost(strategy: CommercialStrategy) {
  const profit = strategy.price.expectedGrossProfit
    ?? strategy.evidence.sourceEconomics?.expectedProfit
    ?? null;
  if (profit != null && profit > 0) {
    if (profit >= 15_000) return 18;
    if (profit >= 5_000) return 14;
    if (profit >= 1_500) return 10;
    if (profit >= 500) return 6;
    return 3;
  }

  const contractValue = strategy.evidence.sourceEconomics?.contractValue ?? strategy.price.recommendedPrice ?? null;
  if (contractValue != null && contractValue > 0) {
    if (contractValue >= 200_000) return 10;
    if (contractValue >= 70_000) return 7;
    if (contractValue >= 15_000) return 4;
    return 2;
  }

  return 0;
}

function targetPriorityBoost(strategy: CommercialStrategy) {
  let boost: number;
  switch (strategy.evidence.targetPosture.status) {
    case "WITHIN_GUARDRAIL":
    case "GENEROUS":
      boost = 7;
      break;
    case "UNDER_RECOMMENDED":
      boost = 5;
      break;
    case "NO_TARGET":
      boost = 3;
      break;
    case "MISSING":
      boost = 2;
      break;
    case "BELOW_BUY":
    case "BELOW_FLOOR":
      boost = 3;
      break;
    default:
      boost = 2;
  }

  const trail = strategy.evidence.targetTrail;
  if (trail?.direction === "RAISED") return boost + 3;
  if (trail?.direction === "LOWERED" || trail?.direction === "WITHDRAWN" || trail?.direction === "STALE" || trail?.direction === "MIXED_CURRENCY") {
    return boost + 1;
  }
  return boost;
}

function coveragePriorityBoost(strategy: CommercialStrategy) {
  switch (strategy.evidence.coveragePosture.status) {
    case "STRONG_LIVE":
      return 5;
    case "WORKABLE_LIVE":
      return 4;
    case "THIN_LIVE":
    case "PENDING_ONLY":
      return 4;
    case "STALE_LIVE":
      return 5;
    case "HISTORY_ONLY":
    case "BENCHMARK_ONLY":
      return 3;
    default:
      return 1;
  }
}

function quoteGateBase(strategy: CommercialStrategy) {
  switch (strategy.quoteGate.status) {
    case "READY_TO_QUOTE":
      return 66;
    case "REVIEW_REQUIRED":
      return 59;
    case "NEEDS_RATES":
      return 54;
    default:
      return 44;
  }
}

function actionPriorityBoost(strategy: CommercialStrategy) {
  switch (strategy.operatorDecision.actionType) {
    case "QUOTE_CUSTOMER":
      return 10;
    case "COUNTER_FORWARDER":
      return 7;
    case "REQUEST_RATES":
      return 6;
    case "ASK_CUSTOMER":
      return 5;
    case "ESCALATE":
      return 6;
    case "DECLINE":
      return -10;
    default:
      return 0;
  }
}

function priorityFactors(strategy: CommercialStrategy, ageHours: number): DecisionQueuePriorityFactor[] {
  const profit = strategy.price.expectedGrossProfit ?? strategy.evidence.sourceEconomics?.expectedProfit ?? null;
  const value = profit != null
    ? money(profit, strategy.price.currency)
    : money(strategy.evidence.sourceEconomics?.contractValue, strategy.evidence.sourceEconomics?.contractCurrency ?? strategy.price.currency);
  const decisionQuality = strategy.evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
  const maturityTone: DecisionQueuePriorityFactor["tone"] = strategy.quoteGate.status === "BLOCKED" || strategy.missing.length > 0
    ? "weak"
    : strategy.components.maturity >= 80
      ? "strong"
      : "watch";

  return [
    {
      label: profit != null ? "Gross profit" : "Value",
      value: value ?? "unknown",
      tone: profit != null && profit > 2500 ? "strong" : value ? "watch" : "weak",
    },
    {
      label: "Maturity",
      value: operatorMaturityLabel(maturityTone === "weak", strategy.components.maturity),
      tone: maturityTone,
    },
    {
      label: "Decision quality",
      value: operatorMetricLabel(decisionQuality?.metric ?? `${strategy.components.confidence}/100`, decisionQuality?.tone),
      tone: decisionQuality?.tone === "ready"
        ? "strong"
        : decisionQuality?.tone === "review" || decisionQuality?.tone === "info"
          ? "watch"
          : "weak",
    },
    {
      label: "Target",
      value: strategy.evidence.targetPosture.label,
      tone: ["WITHIN_GUARDRAIL", "GENEROUS", "UNDER_RECOMMENDED"].includes(strategy.evidence.targetPosture.status)
        ? "strong"
        : strategy.evidence.targetPosture.status === "MISSING"
          ? "weak"
          : "watch",
    },
    ...(strategy.evidence.targetTrail ? [{
      label: "Target trail",
      value: strategy.evidence.targetTrail.metric,
      tone: strategy.evidence.targetTrail.direction === "RAISED"
        ? "strong" as const
        : strategy.evidence.targetTrail.tone === "review"
          ? "watch" as const
          : "weak" as const,
    }] : []),
    {
      label: "Coverage",
      value: strategy.evidence.coveragePosture.label,
      tone: strategy.evidence.coveragePosture.reliableLiveQuotes >= 2 ? "strong" : strategy.evidence.coveragePosture.reliableLiveQuotes === 1 || strategy.evidence.coveragePosture.pendingQuotes > 0 ? "watch" : "weak",
    },
    ...(strategy.evidence.rateFreshness ? [{
      label: "Rates",
      value: strategy.evidence.rateFreshness.metric,
      tone: strategy.evidence.rateFreshness.tone === "ready"
        ? "strong" as const
        : strategy.evidence.rateFreshness.tone === "review"
          ? "watch" as const
          : "weak" as const,
    }] : []),
    {
      label: "Age",
      value: ageHours < 1 ? "<1h" : `${ageHours}h`,
      tone: ageHours >= 48 ? "strong" : ageHours >= 18 ? "watch" : "weak",
    },
  ];
}

function commercialPriority(strategy: CommercialStrategy, ageHours = 0) {
  const maturityBoost = strategy.components.maturity * 0.08;
  const customerBoost = strategy.components.customerValue * 0.04;
  const urgencyBoost = Math.min(6, Math.floor(ageHours / 12));
  const riskPenalty = Math.max(0, ((strategy.riskAssessments[0]?.score ?? 0) - 70) * 0.08);
  const score = clampScore(
    quoteGateBase(strategy)
    + actionPriorityBoost(strategy)
    + valueBoost(strategy)
    + targetPriorityBoost(strategy)
    + coveragePriorityBoost(strategy)
    + maturityBoost
    + customerBoost
    + urgencyBoost
    - riskPenalty
  );

  return { score, factors: priorityFactors(strategy, ageHours) };
}

function strategyMove(strategy: CommercialStrategy): DecisionQueueMove {
  const decision = strategy.operatorDecision;
  return {
    phase: decision.phase,
    label: decision.title,
    owner: decision.owner,
    command: decision.command,
    toolHint: decision.toolHint === "none" ? null : decision.toolHint,
    canRunNow: decision.canRunNow,
    requiresApproval: decision.requiresApproval,
  };
}

function strategyContract(strategy: CommercialStrategy): StrategyDecisionContract {
  return buildStrategyExecutionPacket(strategy).contract;
}

function strategyProofGaps(strategy: CommercialStrategy): StrategyProofGap[] {
  return buildStrategyExecutionPacket(strategy).evidence.gaps;
}

function strategyGateChecks(strategy: CommercialStrategy): DecisionQueueGateCheck[] {
  const order: Record<DecisionQueueGateCheck["status"], number> = {
    blocked: 0,
    review: 1,
    info: 2,
    ready: 3,
  };

  return strategy.evidenceChecks
    .map((check) => ({
      label: check.label,
      status: check.tone,
      metric: operatorMetricLabel(check.metric, check.tone),
      detail: check.detail,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label))
    .slice(0, 4);
}

function documentGateCheck(docs?: DocumentReadinessDoc[] | null): DecisionQueueGateCheck | null {
  if (!docs?.length) return null;
  const readiness = buildDocumentReadiness(docs);
  return {
    label: "Document proof",
    status: readiness.tone,
    metric: readiness.metric,
    detail: readiness.detail,
  };
}

function withDocumentGateChecks(
  checks: DecisionQueueGateCheck[],
  docs?: DocumentReadinessDoc[] | null
): DecisionQueueGateCheck[] {
  const documentCheck = documentGateCheck(docs);
  if (!documentCheck) return checks;
  if (checks.some((check) => check.label.toLowerCase().includes("document"))) return checks;

  const order: Record<DecisionQueueGateCheck["status"], number> = {
    blocked: 0,
    review: 1,
    info: 2,
    ready: 3,
  };

  return [...checks, documentCheck]
    .sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function documentPriorityFactor(docs?: DocumentReadinessDoc[] | null): DecisionQueuePriorityFactor | null {
  if (!docs?.length) return null;
  const readiness = buildDocumentReadiness(docs);
  return {
    label: "Docs",
    value: readiness.metric,
    tone: readiness.tone === "ready" ? "strong" : readiness.tone === "review" ? "watch" : "weak",
  };
}

function withDocumentPriorityFactors(
  factors?: DecisionQueuePriorityFactor[],
  docs?: DocumentReadinessDoc[] | null
): DecisionQueuePriorityFactor[] | undefined {
  const documentFactor = documentPriorityFactor(docs);
  if (!documentFactor) return factors;
  const base = factors ?? [];
  const coverageIndex = base.findIndex((factor) => factor.label === "Coverage");
  if (coverageIndex < 0) return [...base, documentFactor];
  return [
    ...base.slice(0, coverageIndex),
    documentFactor,
    ...base.slice(coverageIndex),
  ];
}

function strategyRankReasons(strategy: CommercialStrategy): DecisionQueueRankReason[] {
  return strategy.decisionReasons.slice(0, 4).map((reason) => ({
    label: reason.label,
    summary: reason.summary,
    detail: reason.detail,
    tone: reason.tone,
  }));
}

function manualMove(input: {
  phase: string;
  label: string;
  owner: DecisionQueueMove["owner"];
  command: string;
  toolHint?: string | null;
  canRunNow?: boolean;
  requiresApproval?: boolean;
}): DecisionQueueMove {
  return {
    phase: input.phase,
    label: input.label,
    owner: input.owner,
    command: input.command,
    toolHint: input.toolHint ?? null,
    canRunNow: input.canRunNow ?? true,
    requiresApproval: input.requiresApproval ?? true,
  };
}

function manualGateCheck(input: DecisionQueueGateCheck): DecisionQueueGateCheck {
  return input;
}

function manualRankReason(input: DecisionQueueRankReason): DecisionQueueRankReason {
  return input;
}

function leadRankReasons(input: {
  missingCount: number;
  profitFactor?: DecisionQueuePriorityFactor;
  valueFactor?: DecisionQueuePriorityFactor;
  statusFactor?: DecisionQueuePriorityFactor;
}): DecisionQueueRankReason[] {
  const reasons: DecisionQueueRankReason[] = [];
  if (input.missingCount > 0) {
    reasons.push(manualRankReason({
      label: "Small blocker",
      summary: `${input.missingCount} missing`,
      detail: "The lead is worth attention, but one explicit fact must be cleared before pricing.",
      tone: "blocker",
    }));
  }
  if (input.profitFactor && input.profitFactor.tone !== "weak") {
    reasons.push(manualRankReason({
      label: "Profit context",
      summary: input.profitFactor.value,
      detail: "Known profit context raises priority, but it is still not a customer target price.",
      tone: input.profitFactor.tone === "strong" ? "support" : "review",
    }));
  } else if (input.valueFactor && input.valueFactor.tone !== "weak") {
    reasons.push(manualRankReason({
      label: "Value context",
      summary: input.valueFactor.value,
      detail: "Known deal value raises priority, but needs commercial confirmation before quoting.",
      tone: input.valueFactor.tone === "strong" ? "support" : "review",
    }));
  }
  if (input.statusFactor?.tone === "strong") {
    reasons.push(manualRankReason({
      label: "Live cadence",
      summary: input.statusFactor.value,
      detail: "Pricing/monthly rows decay if they sit behind generic inbox work.",
      tone: "support",
    }));
  }
  return reasons.slice(0, 3);
}

function routeLabel(input: { origin?: string | null; destination?: string | null; mode?: string | null }) {
  const route = input.origin || input.destination
    ? `${input.origin ?? "?"} to ${input.destination ?? "?"}`
    : "Route TBD";
  return `${route} · ${input.mode ?? "mode TBD"}`;
}

function sheetLeadBlocker(field: string): DecisionQueueBlocker {
  const normalized = field.toLowerCase();
  if (normalized === "origin") {
    return { label: "Origin", ask: "Confirm origin city/port before creating the RFQ.", owner: "CUSTOMER", priority: "high" };
  }
  if (normalized === "destination") {
    return { label: "Destination", ask: "Confirm destination city/port before creating the RFQ.", owner: "CUSTOMER", priority: "high" };
  }
  if (normalized === "incoterms") {
    return { label: "Incoterms", ask: "Confirm Incoterms so scope and customs responsibility are not guessed.", owner: "CUSTOMER", priority: "high" };
  }
  if (normalized === "product") {
    return { label: "Product", ask: "Confirm product/commodity before pricing or forwarding this lead.", owner: "CUSTOMER", priority: "high" };
  }
  if (normalized === "profit") {
    return { label: "Profit", ask: "Confirm expected profit or margin target before spending pricing time.", owner: "INTERNAL", priority: "medium" };
  }
  if (normalized === "contract value") {
    return { label: "Contract value", ask: "Confirm deal value and whether it is a target, contract value, or rough context.", owner: "INTERNAL", priority: "medium" };
  }
  if (normalized.includes("target price") || normalized.includes("no-target")) {
    return { label: "Target posture", ask: "Confirm target price or explicit no-target before pricing this lead.", owner: "CUSTOMER", priority: "high" };
  }
  return { label: field, ask: `Confirm ${field} before moving this lead forward.`, owner: "OPERATOR", priority: "normal" };
}

function rfqBlockers(strategy: CommercialStrategy | null, missing: string[]): DecisionQueueBlocker[] {
  if (strategy?.blockerResolutionPlan.length) {
    return strategy.blockerResolutionPlan.slice(0, 5).map((item) => ({
      label: item.label,
      ask: item.ask,
      owner: item.owner,
      priority: item.priority,
    }));
  }

  return missing.slice(0, 5).map((label) => ({
    label,
    ask: `Ask the customer for ${label.toLowerCase()}.`,
    owner: "CUSTOMER" as const,
    priority: "high" as const,
  }));
}

const CATEGORY_QUEUE_LIMIT: Record<DecisionQueueItem["category"], number> = {
  LEAD: 2,
  RFQ: 3,
  PRICING: 4,
  OUTCOME: 2,
  REPLY: 2,
  RISK: 2,
  AGENT: 3,
};

function takeBalancedQueue(items: DecisionQueueItem[], limit: number) {
  const seen = new Set<string>();
  const deduped = items
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const dedupeKey = `${item.category}:${item.href}:${item.actionLabel}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });

  const picked: DecisionQueueItem[] = [];
  const counts = new Map<DecisionQueueItem["category"], number>();
  const pick = (item: DecisionQueueItem) => {
    if (picked.includes(item) || picked.length >= limit) return false;
    picked.push(item);
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return true;
  };

  for (const item of deduped) {
    const count = counts.get(item.category) ?? 0;
    if (count < CATEGORY_QUEUE_LIMIT[item.category]) pick(item);
    if (picked.length >= limit) return picked;
  }

  for (const item of deduped) {
    pick(item);
    if (picked.length >= limit) return picked;
  }

  return picked;
}

export async function listDecisionQueueItems(officeId: string, limit = 10): Promise<DecisionQueueItem[]> {
  const [inquiries, threads, proposals, pendingQuotes] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId, status: openInquiryStatusFilter() },
      include: {
        carrierQuotes: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        forwarderDrafts: {
          select: { id: true, status: true, createdAt: true },
          where: { status: { in: ["DRAFT", "SENT"] } },
          orderBy: { createdAt: "desc" },
        },
        job: {
          select: {
            id: true,
            reference: true,
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
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    prisma.emailThread.findMany({
      where: { officeId, hiddenAt: null },
      include: {
        messages: { orderBy: { sentAt: "desc" }, take: 1 },
        job: { select: { id: true, reference: true } },
        inquiry: { select: { id: true, subject: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 40,
    }),
    prisma.agentProposal.findMany({
      where: { officeId, status: "PENDING" },
      include: {
        job: { select: { id: true, reference: true } },
        inquiry: { select: { id: true, subject: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.quote.findMany({
      where: { officeId, result: "PENDING" },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { quotedAt: "asc" },
      take: 20,
    }),
  ]);

  const items: DecisionQueueItem[] = [];

  for (const lead of getReferenceDealDecisions(undefined, 4)) {
    const blockers = lead.missingFields.map(sheetLeadBlocker);
    const leadProfitFactor = lead.priorityFactors.find((factor) => factor.label === "Profit");
    const leadValueFactor = lead.priorityFactors.find((factor) => factor.label === "Value");
    const leadStatusFactor = lead.priorityFactors.find((factor) => factor.label === "Status");
    const leadEconomicsFactor = leadProfitFactor ?? leadValueFactor;
    items.push({
      key: lead.key,
      tone: lead.tone,
      category: "LEAD",
      entityType: "lead",
      entityId: lead.dealId,
      title: lead.title,
      meta: lead.meta,
      reason: `${lead.decision.stageLabel}: ${lead.decision.economicsPosture}`,
      actionLabel: lead.decision.actionLabel,
      href: `/dashboard?lead=${encodeURIComponent(lead.dealId)}#reference-deals`,
      score: Math.min(99, lead.score),
      priorityFactors: lead.priorityFactors,
      gateChecks: [
        manualGateCheck({
          label: "Lead decision",
          status: lead.decision.proofStatus,
          metric: lead.decision.stageLabel,
          detail: lead.decision.stopRule,
        }),
        manualGateCheck({
          label: "Economics",
          status: leadProfitFactor?.tone === "strong" ? "ready" : "review",
          metric: leadEconomicsFactor?.value ?? "context missing",
          detail: lead.decision.economicsPosture,
        }),
        manualGateCheck({
          label: "Proof gaps",
          status: lead.decision.evidenceGaps.length ? "review" : "ready",
          metric: lead.decision.evidenceGaps.length ? `${lead.decision.evidenceGaps.length} checks` : "clear",
          detail: lead.decision.evidenceGaps.slice(0, 3).join(", ") || "No immediate row-level proof gaps.",
        }),
      ],
      rankReasons: leadRankReasons({
        missingCount: blockers.length,
        profitFactor: leadProfitFactor,
        valueFactor: leadValueFactor,
        statusFactor: leadStatusFactor,
      }),
      blockers,
      decisionMove: manualMove({
        phase: lead.decision.stage,
        label: lead.decision.stageLabel,
        owner: lead.decision.owner,
        command: lead.decision.command,
        toolHint: lead.decision.canCreateRfq ? "prepare_control_sheet_rfq" : "inspect_control_sheet",
        canRunNow: lead.decision.canCreateRfq,
      }),
    });
  }

  for (const proposal of proposals) {
    const age = hoursSince(proposal.createdAt);
    const payload = proposal.payload && typeof proposal.payload === "object" && !Array.isArray(proposal.payload)
      ? proposal.payload as Record<string, unknown>
      : {};
    const isBulkProposal = payload.entity === "bulk";
    const titleTarget = proposal.job?.reference ?? proposal.inquiry?.subject ?? (isBulkProposal ? "Inbox bulk action" : proposal.id.slice(0, 8));
    items.push({
      key: `agent-proposal-${proposal.id}`,
      tone: toneFromScore(88 + Math.min(age, 12)),
      category: "AGENT",
      entityType: "agent_proposal",
      entityId: proposal.id,
      title: `${isBulkProposal ? "Review agent bulk action" : "Review agent update"}: ${titleTarget}`,
      meta: `${proposal.kind} · waiting ${age < 1 ? "less than 1h" : `${age}h`}`,
      reason: "The agent has proposed a mutation. Nothing should change until a human accepts or rejects the diff.",
      actionLabel: isBulkProposal ? "Review list" : "Review diff",
      href: proposal.job ? `/dashboard/jobs/${proposal.job.id}` : proposal.inquiry ? `/dashboard/rfq/${proposal.inquiry.id}` : "/dashboard/inbox",
      score: 88 + Math.min(age, 12),
      ageHours: age,
      gateChecks: [
        manualGateCheck({
          label: "Agent review",
          status: "review",
          metric: proposal.kind,
          detail: "A human needs to accept or reject the proposed mutation.",
        }),
      ],
      rankReasons: [
        manualRankReason({
          label: "Human approval",
          summary: "pending diff",
          detail: "Automation is waiting on review, so the queue should not hide it behind normal operations.",
          tone: "review",
        }),
      ],
      decisionMove: manualMove({
        phase: "REVIEW_AGENT",
        label: "Review proposed change",
        owner: "OPERATOR",
        command: "Open the proposed diff and accept or reject it. Automation should not mutate records invisibly.",
        toolHint: "none",
      }),
    });
  }

  const strategyRuns = await Promise.all(
    inquiries.slice(0, 16).map((inq) => (
      inq.job
        ? assessJobStrategy(officeId, inq.job.id)
        : assessInquiryStrategy(officeId, inq.id)
    ).then((run) => ({ inq, run })).catch(() => ({ inq, run: null })))
  );
  const strategyByInquiryId = new Map(strategyRuns.map(({ inq, run }) => [inq.id, run?.strategy ?? null]));

  for (const inq of inquiries) {
    const age = hoursSince(inq.receivedAt);
    const strategy = strategyByInquiryId.get(inq.id) ?? null;
    const priority = strategy ? commercialPriority(strategy, age) : null;
    const missing = strategy?.quoteGate.blockers.length ? strategy.quoteGate.blockers : requiredRfqMissing(inq);
    if (missing.length > 0) {
      const score = priority?.score ?? clampScore(64 + Math.min(age, 10) + Math.min(missing.length * 2, 10));
      items.push({
        key: `rfq-missing-${inq.id}`,
        tone: toneFromScore(score),
        category: "RFQ",
        entityType: "inquiry",
        entityId: inq.id,
        title: `Complete RFQ: ${inq.subject}`,
        meta: `Missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`,
        reason: strategy?.operatorDecision.command ?? "Pricing before RFQ maturity is fake precision. Fill the missing facts before asking forwarders or quoting the customer.",
        actionLabel: "Draft missing info",
        href: `/dashboard/rfq/${inq.id}`,
        score,
        ageHours: age,
        priorityFactors: withDocumentPriorityFactors(priority?.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(
          strategy
            ? strategyGateChecks(strategy)
            : [
                manualGateCheck({
                  label: "RFQ gate",
                  status: "blocked",
                  metric: `${missing.length} blocker${missing.length === 1 ? "" : "s"}`,
                  detail: `Missing ${missing.slice(0, 5).join(", ")}.`,
                }),
              ],
          inq.job?.documents
        ),
        rankReasons: strategy
          ? strategyRankReasons(strategy)
          : [
            manualRankReason({
              label: "RFQ maturity",
              summary: `${missing.length} blocker${missing.length === 1 ? "" : "s"}`,
              detail: "Forwarder outreach and customer pricing must wait until explicit RFQ facts are filled.",
              tone: "blocker",
            }),
          ],
        blockers: rfqBlockers(strategy, missing),
        decisionMove: strategy
          ? strategyMove(strategy)
          : manualMove({
            phase: "MATURE_RFQ",
            label: "Draft missing-info request",
            owner: "CUSTOMER",
            command: `Ask the customer for ${missing.slice(0, 5).join(", ")} before pricing or forwarding this RFQ.`,
            toolHint: "draft_missing_info_request",
          }),
        decisionContract: strategy ? strategyContract(strategy) : null,
        commandLedger: strategy ? buildStrategyCommandLedger(strategy) : undefined,
        proofGaps: strategy ? strategyProofGaps(strategy) : undefined,
      });
      continue;
    }

    const draftCount = inq.forwarderDrafts.filter((d) => d.status === "DRAFT").length;
    const sentCount = inq.forwarderDrafts.filter((d) => d.status === "SENT").length;
    const pendingQuotes = inq.carrierQuotes.filter((q) => q.status === "PENDING");
    const receivedQuotes = inq.carrierQuotes.filter((q) => q.status === "RECEIVED");

    if (draftCount > 0) {
      const score = clampScore((priority?.score ?? 82) + 4);
      items.push({
        key: `forwarder-drafts-${inq.id}`,
        tone: toneFromScore(score),
        category: "PRICING",
        entityType: "inquiry",
        entityId: inq.id,
        title: `Send reviewed forwarder drafts: ${inq.subject}`,
        meta: `${draftCount} draft${draftCount === 1 ? "" : "s"} ready · ${routeLabel(inq)}`,
        reason: "Drafts sitting unsent create no market signal. Review them and get rates moving.",
        actionLabel: "Send drafts",
        href: `/dashboard/pricing?inquiry=${inq.id}`,
        score,
        ageHours: age,
        priorityFactors: withDocumentPriorityFactors(priority?.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(
          strategy
            ? strategyGateChecks(strategy)
            : [
                manualGateCheck({
                  label: "Market coverage",
                  status: "review",
                  metric: `${draftCount} draft${draftCount === 1 ? "" : "s"}`,
                  detail: "Drafts need operator review before they create a market signal.",
                }),
              ],
          inq.job?.documents
        ),
        rankReasons: strategy
          ? strategyRankReasons(strategy)
          : [
            manualRankReason({
              label: "Market signal",
              summary: `${draftCount} draft${draftCount === 1 ? "" : "s"} ready`,
              detail: "Reviewed drafts sitting idle create no buy-cost evidence.",
              tone: "review",
            }),
          ],
        decisionMove: manualMove({
          phase: "SEND_REVIEWED_DRAFTS",
          label: "Send reviewed drafts",
          owner: "FORWARDER",
          command: "Review the queued forwarder drafts and send only the approved outbound requests.",
          toolHint: "create_forwarder_drafts",
        }),
        decisionContract: strategy ? strategyContract(strategy) : null,
        commandLedger: strategy ? buildStrategyCommandLedger(strategy) : undefined,
        proofGaps: strategy ? strategyProofGaps(strategy) : undefined,
      });
    } else if (inq.carrierQuotes.length === 0 && sentCount === 0) {
      const score = clampScore((priority?.score ?? 78) + 2);
      items.push({
        key: `create-forwarder-drafts-${inq.id}`,
        tone: toneFromScore(score),
        category: "PRICING",
        entityType: "inquiry",
        entityId: inq.id,
        title: `Create forwarder drafts: ${inq.subject}`,
        meta: routeLabel(inq),
        reason: "The RFQ is mature but has no procurement coverage yet. No carrier cost means no defensible customer price.",
        actionLabel: "Create drafts",
        href: `/dashboard/pricing?inquiry=${inq.id}`,
        score,
        ageHours: age,
        priorityFactors: withDocumentPriorityFactors(priority?.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(
          strategy
            ? strategyGateChecks(strategy)
            : [
                manualGateCheck({
                  label: "Market coverage",
                  status: "blocked",
                  metric: "no buy cost",
                  detail: "No live cost exists, so customer pricing would be invented.",
                }),
              ],
          inq.job?.documents
        ),
        rankReasons: strategy
          ? strategyRankReasons(strategy)
          : [
            manualRankReason({
              label: "Coverage",
              summary: "no buy cost",
              detail: "No carrier cost means customer price would be fake precision.",
              tone: "blocker",
            }),
          ],
        decisionMove: strategy
          ? strategyMove(strategy)
          : manualMove({
            phase: "GET_RATES",
            label: "Create forwarder drafts",
            owner: "FORWARDER",
            command: "Create reviewed forwarder requests so the quote has a live buy cost.",
            toolHint: "create_forwarder_drafts",
          }),
        decisionContract: strategy ? strategyContract(strategy) : null,
        commandLedger: strategy ? buildStrategyCommandLedger(strategy) : undefined,
        proofGaps: strategy ? strategyProofGaps(strategy) : undefined,
      });
    }

    const oldestPending = pendingQuotes[0];
    if (oldestPending && receivedQuotes.length === 0) {
      const quoteAge = hoursSince(oldestPending.createdAt);
      if (quoteAge >= 18) {
        const score = clampScore((priority?.score ?? 74) + Math.min(14, Math.floor(quoteAge / 6)));
        items.push({
          key: `chase-forwarder-${inq.id}`,
          tone: toneFromScore(score),
          category: "PRICING",
          entityType: "inquiry",
          entityId: inq.id,
          title: `Chase forwarder rates: ${inq.subject}`,
          meta: `${pendingQuotes.length} pending · oldest ${quoteAge}h · no received price`,
          reason: "The forwarder request is stale and still has no usable cost. Silence is now the bottleneck.",
          actionLabel: "Nudge forwarders",
          href: `/dashboard/pricing?inquiry=${inq.id}`,
          score,
          ageHours: quoteAge,
          priorityFactors: withDocumentPriorityFactors(priority?.factors, inq.job?.documents),
          gateChecks: withDocumentGateChecks(
            strategy
              ? strategyGateChecks(strategy)
              : [
                  manualGateCheck({
                    label: "Market coverage",
                    status: "blocked",
                    metric: `${quoteAge}h stale`,
                    detail: "Pending forwarder rates are old enough to block reliable customer pricing.",
                  }),
                ],
            inq.job?.documents
          ),
          rankReasons: strategy
            ? strategyRankReasons(strategy)
            : [
              manualRankReason({
                label: "Stale coverage",
                summary: `${quoteAge}h pending`,
                detail: "Old pending forwarder requests block a defensible customer price.",
                tone: "blocker",
              }),
            ],
          decisionMove: manualMove({
            phase: "CHASE_RATES",
            label: "Chase stale rates",
            owner: "FORWARDER",
            command: "Nudge pending forwarders and get a usable buy cost before customer pricing.",
            toolHint: "find_follow_up_targets",
          }),
          decisionContract: strategy ? strategyContract(strategy) : null,
          commandLedger: strategy ? buildStrategyCommandLedger(strategy) : undefined,
          proofGaps: strategy ? strategyProofGaps(strategy) : undefined,
        });
      }
    }
  }

  for (const { inq, run } of strategyRuns) {
    const strategy = run?.strategy;
    if (!strategy) continue;
    const href = inq.job ? `/dashboard/jobs/${inq.job.id}` : `/dashboard/rfq/${inq.id}`;
    const priority = commercialPriority(strategy, hoursSince(inq.receivedAt));
    if (strategy.price.guardrailStatus === "BLOCKED") {
      const score = clampScore(priority.score + 10);
      items.push({
        key: `strategy-blocked-${inq.id}`,
        tone: toneFromScore(score),
        category: "PRICING",
        entityType: inq.job ? "job" : "inquiry",
        entityId: inq.job?.id ?? inq.id,
        title: `Margin blocked: ${inq.subject}`,
        meta: strategy.action,
        reason: "The commercial strategy engine says the price violates guardrails. Do not quote until the floor or inputs are reviewed.",
        actionLabel: "Review floor",
        href,
        score,
        ageHours: hoursSince(inq.receivedAt),
        priorityFactors: withDocumentPriorityFactors(priority.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(strategyGateChecks(strategy), inq.job?.documents),
        rankReasons: strategyRankReasons(strategy),
        decisionMove: strategyMove(strategy),
        decisionContract: strategyContract(strategy),
        commandLedger: buildStrategyCommandLedger(strategy),
        proofGaps: strategyProofGaps(strategy),
      });
      continue;
    }

    if (strategy.recommendation === "QUOTE" && (strategy.price.expectedGrossProfit ?? 0) > 0) {
      const score = clampScore(priority.score + 12);
      const recommended = money(strategy.price.recommendedPrice, strategy.price.currency);
      const margin = strategy.price.expectedMarginPct != null
        ? `${strategy.price.expectedMarginPct.toFixed(1)}% margin`
        : "margin unknown";
      items.push({
        key: `strategy-quote-${inq.id}`,
        tone: "critical",
        category: "PRICING",
        entityType: inq.job ? "job" : "inquiry",
        entityId: inq.job?.id ?? inq.id,
        title: `Quote-ready: ${inq.subject}`,
        meta: `${recommended ?? "Price TBD"} · ${margin} · ${strategy.price.winProbability}% win probability`,
        reason: "Rates and margin are good enough to move. Delay now is commercial leakage, not caution.",
        actionLabel: "Quote customer",
        href,
        score,
        ageHours: hoursSince(inq.receivedAt),
        priorityFactors: withDocumentPriorityFactors(priority.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(strategyGateChecks(strategy), inq.job?.documents),
        rankReasons: strategyRankReasons(strategy),
        decisionMove: strategyMove(strategy),
        decisionContract: strategyContract(strategy),
        commandLedger: buildStrategyCommandLedger(strategy),
        proofGaps: strategyProofGaps(strategy),
      });
    }

    if (strategy.recommendation === "REQUEST_RATES") {
      const score = clampScore(priority.score + 4);
      items.push({
        key: `strategy-rates-${inq.id}`,
        tone: toneFromScore(score),
        category: "PRICING",
        entityType: inq.job ? "job" : "inquiry",
        entityId: inq.job?.id ?? inq.id,
        title: `Under-covered RFQ: ${inq.subject}`,
        meta: `${strategy.evidence.quoteCoverage} · ${strategy.price.guardrailStatus.toLowerCase()}`,
        reason: "The strategy engine lacks enough market coverage to price confidently. Get more rates before pretending this is priced.",
        actionLabel: "Request rates",
        href: `/dashboard/pricing?inquiry=${inq.id}`,
        score,
        ageHours: hoursSince(inq.receivedAt),
        priorityFactors: withDocumentPriorityFactors(priority.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(strategyGateChecks(strategy), inq.job?.documents),
        rankReasons: strategyRankReasons(strategy),
        decisionMove: strategyMove(strategy),
        decisionContract: strategyContract(strategy),
        commandLedger: buildStrategyCommandLedger(strategy),
        proofGaps: strategyProofGaps(strategy),
      });
    }

    const topRisk = strategy.riskAssessments[0];
    const riskIsAlreadyHandledByMaturityGate = strategy.quoteGate.status === "BLOCKED" && strategy.blockerResolutionPlan.length > 0;
    if (!riskIsAlreadyHandledByMaturityGate && topRisk && (topRisk.level === "HIGH" || topRisk.level === "CRITICAL")) {
      const score = clampScore(Math.max(priority.score, topRisk.level === "CRITICAL" ? 88 : 76));
      items.push({
        key: `strategy-risk-${inq.id}`,
        tone: toneFromScore(score),
        category: "RISK",
        entityType: inq.job ? "job" : "inquiry",
        entityId: inq.job?.id ?? inq.id,
        title: `Risk review: ${inq.subject}`,
        meta: topRisk.reason,
        reason: "The top risk signal is severe enough that pricing or execution should pause for review.",
        actionLabel: "Review risk",
        href,
        score,
        ageHours: hoursSince(inq.receivedAt),
        priorityFactors: withDocumentPriorityFactors(priority.factors, inq.job?.documents),
        gateChecks: withDocumentGateChecks(strategyGateChecks(strategy), inq.job?.documents),
        rankReasons: strategyRankReasons(strategy),
        decisionMove: strategyMove(strategy),
        decisionContract: strategyContract(strategy),
        commandLedger: buildStrategyCommandLedger(strategy),
        proofGaps: strategyProofGaps(strategy),
      });
    }
  }

  for (const quote of pendingQuotes) {
    const age = hoursSince(quote.quotedAt);
    if (age < 24) continue;

    const quoteValueBoost = quote.value != null ? Math.min(8, Math.floor(quote.value / 7500)) : 0;
    const score = clampScore((age >= 72 ? 76 : 68) + Math.min(8, Math.floor(age / 24)) + quoteValueBoost);
    const value = money(quote.value, quote.currency ?? "USD") ?? "value TBD";
    items.push({
      key: `quote-outcome-${quote.id}`,
      tone: toneFromScore(score),
      category: "OUTCOME",
      entityType: "quote",
      entityId: quote.id,
      title: age >= 72 ? `Resolve stale quote outcome: ${quote.company.name}` : `Follow up pending quote: ${quote.company.name}`,
      meta: `${routeLabel(quote)} · ${value} · pending ${age}h`,
      reason: "A customer quote that never becomes won/lost leaves pricing rules without outcome evidence and hides follow-up leakage.",
      actionLabel: age >= 72 ? "Mark won/lost" : "Follow up",
      href: `/dashboard/crm?q=${encodeURIComponent(quote.company.name)}`,
      score,
      ageHours: age,
      priorityFactors: [
        {
          label: "Quote value",
          value,
          tone: quote.value != null && quote.value >= 25_000 ? "strong" : quote.value != null ? "watch" : "weak",
        },
        {
          label: "Age",
          value: `${age}h`,
          tone: age >= 72 ? "strong" : "watch",
        },
      ],
      gateChecks: [
        manualGateCheck({
          label: "Outcome learning",
          status: age >= 72 ? "blocked" : "review",
          metric: `${age}h pending`,
          detail: "Pending quotes must become won/lost or follow-up debt hides commercial truth.",
        }),
        manualGateCheck({
          label: "Quote value",
          status: quote.value != null ? "ready" : "info",
          metric: value,
          detail: "Value helps rank follow-up, but outcome capture matters even when value is unknown.",
        }),
      ],
      rankReasons: [
        manualRankReason({
          label: "Outcome learning",
          summary: `${age}h pending`,
          detail: "The quote needs a customer answer or a won/lost mark so pricing quality improves.",
          tone: age >= 72 ? "blocker" : "review",
        }),
        manualRankReason({
          label: "Commercial value",
          summary: value,
          detail: "Higher-value pending quotes deserve earlier follow-up, but the outcome matters even when value is unknown.",
          tone: quote.value != null && quote.value >= 25_000 ? "support" : "info",
        }),
      ],
      decisionMove: manualMove({
        phase: "RESOLVE_QUOTE_OUTCOME",
        label: age >= 72 ? "Resolve stale outcome" : "Follow up quote",
        owner: "CUSTOMER",
        command: "Get a customer answer or mark the quote won/lost so pricing rules can use the outcome.",
        toolHint: "find_follow_up_targets",
      }),
    });
  }

  for (const thread of threads) {
    const last = thread.messages[0];
    if (!last || last.direction !== "INBOUND") continue;
    const age = hoursSince(last.sentAt);
    const score = 64 + Math.min(age, 36);
    items.push({
      key: `thread-${thread.id}`,
      tone: toneFromScore(score),
      category: "REPLY",
      entityType: "thread",
      entityId: thread.id,
      title: `Reply needed: ${thread.subject}`,
      meta: `${thread.job?.reference ?? thread.inquiry?.subject ?? "Unlinked"} · latest from ${displayParty(last.fromEmail, last.fromName)}`,
      reason: "The latest message is inbound. If this deal matters, the next move belongs to the operator.",
      actionLabel: "Open inbox",
      href: thread.job ? `/dashboard/inbox?job=${thread.job.id}` : thread.inquiry ? `/dashboard/inbox?inquiry=${thread.inquiry.id}` : "/dashboard/inbox?filter=_NEEDS_REPLY",
      score,
      ageHours: age,
      gateChecks: [
        manualGateCheck({
          label: "Inbox gate",
          status: thread.job || thread.inquiry ? "review" : "blocked",
          metric: thread.job || thread.inquiry ? "linked" : "unlinked",
          detail: thread.job || thread.inquiry
            ? "Inbound reply is attached to a deal and needs operator handling."
            : "Unlinked inbound mail must be linked or hidden before it pollutes the active workflow.",
        }),
      ],
      rankReasons: [
        manualRankReason({
          label: "Inbox ownership",
          summary: thread.job || thread.inquiry ? "deal reply" : "unlinked reply",
          detail: thread.job || thread.inquiry
            ? "The latest inbound message belongs to an active commercial thread."
            : "Unlinked inbound mail needs cleanup before it can be trusted in the workflow.",
          tone: thread.job || thread.inquiry ? "review" : "blocker",
        }),
      ],
      decisionMove: manualMove({
        phase: "ANSWER_INBOUND",
        label: "Answer latest inbound",
        owner: "OPERATOR",
        command: "Open the thread, reply or link it, then clear it from the active queue.",
        toolHint: "search_email_threads",
      }),
    });
  }

  return takeBalancedQueue(items, limit);
}
