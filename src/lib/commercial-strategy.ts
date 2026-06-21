import { dimensionCompleteness, parseDimensions, totalCbm, totalChargeableCbm } from "./cargo";
import { buildDocumentReadiness, type DocumentReadiness, type DocumentReadinessDoc } from "./document-readiness";
import { operatorMetricLabel } from "./operator-action-labels";
import { buildRfqMaturityChecks, qualifyRfq, type RfqMaturityCheck, type RfqMaturityCheckKey } from "./rfq-qualification";

export type StrategyRecommendation =
  | "QUOTE"
  | "NEGOTIATE"
  | "REQUEST_RATES"
  | "ASK_CUSTOMER"
  | "ESCALATE"
  | "DECLINE";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type StrategyCarrierQuote = {
  id?: string | null;
  carrier?: string | null;
  quoteType?: string | null;
  rateName?: string | null;
  status?: string | null;
  total20?: number | null;
  total40?: number | null;
  total40HC?: number | null;
  transitDays?: number | null;
  service?: string | null;
  validity?: string | null;
  transshipments?: string | null;
  createdAt?: Date | string | null;
};

export type StrategyLaneRate = {
  id?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  baseAmount?: number | null;
  currency?: string | null;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
  notes?: string | null;
};

export type StrategyHistoricalJob = {
  id?: string | null;
  reference?: string | null;
  companyId?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  revenue?: number | null;
  cost?: number | null;
  profit?: number | null;
  currency?: string | null;
  shipmentDate?: Date | string | null;
  createdAt?: Date | string | null;
};

export type StrategyCustomerStats = {
  known: boolean;
  jobs: number;
  quoted: number;
  won: number;
  lost: number;
  avgMarginPct: number | null;
  avgProfit: number | null;
  totalRevenue: number | null;
};

export type StrategySourceEconomics = {
  source: "reference-deal" | "google-sheet" | "manual" | string;
  contact?: string | null;
  contract?: string | null;
  status?: string | null;
  cadence?: string | null;
  contractValue?: number | null;
  contractCurrency?: string | null;
  expectedProfit?: number | null;
  profitCurrency?: string | null;
};

export type StrategyCargoMath = {
  physicalCbm: number | null;
  chargeableCbm: number | null;
  storedVolume: number | null;
  stackable: string | null;
  topLoad: string | null;
  dimensionsComplete: boolean;
  dimensionsPartial: boolean;
  completeRows: number;
  enteredRows: number;
  source: "DIMENSIONS" | "PARTIAL_DIMENSIONS" | "STORED_VOLUME" | "STACKABILITY_ONLY";
};

export type StrategyTargetPosture = {
  status: "MISSING" | "NO_TARGET" | "UNPRICED" | "BELOW_BUY" | "BELOW_FLOOR" | "UNDER_RECOMMENDED" | "WITHIN_GUARDRAIL" | "GENEROUS";
  label: string;
  stance: string;
  target: number | null;
  currency: string;
  marginAtTargetPct: number | null;
  gapToBuyCostPct: number | null;
  gapToFloorPct: number | null;
  gapToRecommendedPct: number | null;
};

export type StrategyTargetHistoryEntry = {
  id?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  source?: string | null;
  note?: string | null;
  createdAt?: Date | string | null;
};

export type StrategyTargetTrail = {
  total: number;
  providedCount: number;
  noTargetCount: number;
  latest: StrategyTargetHistoryEntry | null;
  latestProvided: StrategyTargetHistoryEntry | null;
  previousProvided: StrategyTargetHistoryEntry | null;
  direction: "NONE" | "NEW" | "RAISED" | "LOWERED" | "UNCHANGED" | "WITHDRAWN" | "MIXED_CURRENCY" | "STALE";
  movementAmount: number | null;
  movementPct: number | null;
  tone: "ready" | "review" | "blocked" | "info";
  label: string;
  metric: string;
  detail: string;
  leverage: string | null;
};

export type StrategyCoveragePosture = {
  status: "NONE" | "PENDING_ONLY" | "HISTORY_ONLY" | "BENCHMARK_ONLY" | "STALE_LIVE" | "THIN_LIVE" | "WORKABLE_LIVE" | "STRONG_LIVE";
  label: string;
  stance: string;
  receivedQuotes: number;
  reliableLiveQuotes: number;
  pendingQuotes: number;
  totalQuotes: number;
  laneRateMatches: number;
  historicalLaneJobs: number;
  primaryEvidence: "NONE" | "PENDING" | "HISTORY" | "LANE_RATE" | "STALE_QUOTES" | "LIVE_QUOTES";
};

export type StrategyRateFreshness = {
  receivedQuotes: number;
  reliableLiveQuotes: number;
  validQuotes: number;
  expiringQuotes: number;
  expiredQuotes: number;
  staleQuotes: number;
  unknownValidityQuotes: number;
  newestQuoteAt: string | null;
  oldestQuoteAgeDays: number | null;
  earliestExpiryAt: string | null;
  tone: "ready" | "review" | "blocked" | "info";
  label: string;
  metric: string;
  detail: string;
};

export type StrategyNegotiationPlan = {
  posture: "MATURE_FIRST" | "GET_RATES" | "COUNTER_COST" | "PROTECT_FLOOR" | "SELL_CONFIDENTLY" | "ESCALATE" | "DECLINE";
  label: string;
  customerTalkTrack: string;
  forwarderCounter: string;
  internalGuardrail: string;
  leverage: string[];
  approvalRequired: boolean;
  targetBuyLimit: number | null;
};

export type StrategyQuoteGate = {
  status: "BLOCKED" | "NEEDS_RATES" | "REVIEW_REQUIRED" | "READY_TO_QUOTE";
  label: string;
  decision: string;
  canSendToForwarders: boolean;
  canQuoteCustomer: boolean;
  requiresApproval: boolean;
  blockers: string[];
  approvals: string[];
  nextStep: string;
};

export type CommercialStrategyInput = {
  id?: string | null;
  entityType?: "INQUIRY" | "JOB";
  subject?: string | null;
  type?: string | null;
  status?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  fromEmail?: string | null;
  fromCompany?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  dimensions?: string | null;
  stackable?: string | null;
  topLoad?: string | null;
  dangerousGoods?: string | null;
  customsBy?: string | null;
  incoterms?: string | null;
  commodity?: string | null;
  weight?: number | null;
  volume?: number | null;
  cargoReadyDate?: Date | string | null;
  targetPrice?: number | null;
  targetCurrency?: string | null;
  targetPriceStatus?: string | null;
  targetPriceSource?: string | null;
  revenue?: number | null;
  cost?: number | null;
  currency?: string | null;
  asOf?: Date | string | null;
  receivedAt?: Date | string | null;
  createdAt?: Date | string | null;
  rawEmailBody?: string | null;
  notes?: string | null;
  sourceEconomics?: StrategySourceEconomics | null;
  documents?: DocumentReadinessDoc[];
  targetHistory?: StrategyTargetHistoryEntry[];
  carrierQuotes?: StrategyCarrierQuote[];
  laneRates?: StrategyLaneRate[];
  historicalJobs?: StrategyHistoricalJob[];
  customerStats?: StrategyCustomerStats;
  marginPolicy?: {
    targetMarginPct?: number | null;
    minMarginPct?: number | null;
    stretchMarginPct?: number | null;
  };
};

export type StrategyRisk = {
  category: "CARGO" | "ROUTE" | "COMMERCIAL" | "CUSTOMER" | "CONFIDENCE" | "TIMING";
  level: RiskLevel;
  score: number;
  reason: string;
  mitigation: string;
  evidence?: Record<string, unknown>;
};

export type StrategyRouteOption = {
  label: string;
  route: string | null;
  mode: string | null;
  provider: string | null;
  source: "RECEIVED_QUOTE" | "LANE_RATE" | "HISTORY" | "FALLBACK";
  carrierQuoteId?: string | null;
  cost: number | null;
  currency: string;
  transitDays: number | null;
  reliabilityScore: number;
  riskScore: number;
  confidence: "low" | "medium" | "high";
  tradeoff: string;
  evidence?: Record<string, unknown>;
};

export type StrategyAction = {
  actionType: "ASK_CUSTOMER" | "REQUEST_RATES" | "COUNTER_FORWARDER" | "QUOTE_CUSTOMER" | "ESCALATE" | "DECLINE";
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  rationale: string;
  requiresApproval: boolean;
  payload: Record<string, unknown>;
};

export type StrategyOperatorDecision = {
  phase: "MATURE_RFQ" | "GET_RATES" | "APPROVE_ECONOMICS" | "QUOTE_CUSTOMER" | "PARK_DEAL";
  actionType: StrategyAction["actionType"];
  priority: StrategyAction["priority"];
  owner: "CUSTOMER" | "FORWARDER" | "INTERNAL";
  title: string;
  command: string;
  rationale: string;
  ctaLabel: string;
  toolHint: "draft_missing_info_request" | "create_forwarder_drafts" | "draft_customer_quote" | "draft_negotiation_plan" | "recommend_price" | "assess_strategy" | "none";
  surfaceHint: "rfq_missing_info" | "pricing_forwarder_drafts" | "pricing_review" | "customer_quote" | "deal_parking";
  canRunNow: boolean;
  requiresApproval: boolean;
  blockers: string[];
  approvals: string[];
  payload: Record<string, unknown>;
};

export type StrategyDecisionReason = {
  key: "maturity" | "coverage" | "rates" | "target" | "target_trail" | "economics" | "risk" | "decision_quality" | "agent";
  label: string;
  tone: "blocker" | "review" | "support" | "info";
  summary: string;
  detail: string;
};

export type StrategyEvidenceCheck = {
  key: "rfq" | "cargo" | "target" | "target_trail" | "coverage" | "rate_freshness" | "economics" | "risk" | "decision_quality" | "documents";
  label: string;
  tone: "ready" | "review" | "blocked" | "info";
  metric: string;
  detail: string;
};

export type StrategyBlockerResolution = {
  key: RfqMaturityCheckKey;
  label: string;
  priority: "critical" | "high" | "medium";
  owner: "CUSTOMER" | "INTERNAL";
  ask: string;
  why: string;
  score: number;
};

export type CommercialStrategy = {
  score: number;
  band: "A" | "B" | "C" | "D";
  label: string;
  recommendation: StrategyRecommendation;
  recommendationLabel: string;
  action: string;
  strategyMemo: string;
  confidence: "low" | "medium" | "high";
  missing: string[];
  maturityChecks: RfqMaturityCheck[];
  strengths: string[];
  risks: string[];
  routeOptions: StrategyRouteOption[];
  recommendedRoute: StrategyRouteOption | null;
  riskAssessments: StrategyRisk[];
  actions: StrategyAction[];
  negotiation: StrategyNegotiationPlan;
  quoteGate: StrategyQuoteGate;
  operatorDecision: StrategyOperatorDecision;
  decisionReasons: StrategyDecisionReason[];
  evidenceChecks: StrategyEvidenceCheck[];
  blockerResolutionPlan: StrategyBlockerResolution[];
  price: {
    currency: string;
    buyCost: number | null;
    costSource: string | null;
    floorPrice: number | null;
    recommendedPrice: number | null;
    stretchPrice: number | null;
    walkAwayPrice: number | null;
    expectedMarginPct: number | null;
    expectedGrossProfit: number | null;
    winProbability: number;
    guardrailStatus: "PASS" | "REVIEW" | "BLOCKED" | "NEEDS_COST";
    rationale: string[];
  };
  components: {
    maturity: number;
    pricePower: number;
    routeQuality: number;
    riskControl: number;
    customerValue: number;
    confidence: number;
  };
  evidence: {
    receivedQuotes: number;
    pendingQuotes: number;
    laneRateMatches: number;
    historicalLaneJobs: number;
    customerJobs: number;
    targetPrice: number | null;
    targetCurrency: string | null;
    targetPosture: StrategyTargetPosture;
    targetTrail: StrategyTargetTrail | null;
    coveragePosture: StrategyCoveragePosture;
    rateFreshness: StrategyRateFreshness | null;
    quoteCoverage: string;
    cargoMath: StrategyCargoMath | null;
    documentReadiness: DocumentReadiness | null;
    sourceEconomics?: StrategySourceEconomics | null;
  };
  details: {
    receivedQuotes: number;
    pendingQuotes: number;
    bestCost: number | null;
    marginPct: number | null;
    hardCap: number | null;
  };
};

export type StrategyDecisionBrief = {
  phase: StrategyOperatorDecision["phase"];
  gateStatus: StrategyQuoteGate["status"];
  verdict: string;
  score: number;
  band: CommercialStrategy["band"];
  confidence: CommercialStrategy["confidence"];
  nextCommand: string;
  nextAction: {
    label: string;
    owner: StrategyOperatorDecision["owner"];
    actionType: StrategyOperatorDecision["actionType"];
    priority: StrategyOperatorDecision["priority"];
    toolHint: StrategyOperatorDecision["toolHint"];
    canRunNow: boolean;
    requiresApproval: boolean;
  };
  weakestEvidence: StrategyEvidenceCheck | null;
  decisionQuality: StrategyEvidenceCheck | null;
  blockerCount: number;
  blockingQuestions: Array<Pick<StrategyBlockerResolution, "key" | "label" | "priority" | "owner" | "ask" | "why">>;
  operatorPlaybook: {
    objective: string;
    firstMove: string;
    exactAsk: string | null;
    evidenceGap: string | null;
    safetyRule: string;
    stopCondition: string;
    toolHint: StrategyOperatorDecision["toolHint"];
  };
  economics: {
    guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
    buyCost: number | null;
    floorPrice: number | null;
    recommendedPrice: number | null;
    currency: string;
  };
  route: {
    label: string | null;
    confidence: StrategyRouteOption["confidence"] | null;
    tradeoff: string | null;
  };
};

export type StrategyExecutionPacket = {
  brief: StrategyDecisionBrief;
  commercialPriority: StrategyCommercialPriority;
  runway: Array<{
    key: "evidence" | "decision" | "agent";
    label: string;
    title: string;
    detail: string;
    tone: StrategyEvidenceCheck["tone"] | "rates";
  }>;
  primary: {
    label: string;
    command: string;
    owner: StrategyOperatorDecision["owner"];
    toolHint: StrategyOperatorDecision["toolHint"];
    canRunNow: boolean;
    requiresApproval: boolean;
    reviewOnly: boolean;
  };
  safety: {
    rule: string;
    stopCondition: string;
    forbidden: string[];
  };
  evidence: {
    weakest: StrategyEvidenceCheck | null;
    checks: StrategyEvidenceCheck[];
    gaps: StrategyProofGap[];
  };
  commandLedger: StrategyCommandLedgerItem[];
  contract: StrategyDecisionContract;
};

export type StrategyProofGap = {
  key: StrategyEvidenceCheck["key"];
  label: string;
  tone: StrategyEvidenceCheck["tone"];
  metric: string;
  detail: string;
  action: string;
  owner: StrategyOperatorDecision["owner"];
  target: "blocker-resolution" | "target-price" | "carrier-rates" | "movement" | "financials" | "decision-quality" | "documents" | "strategy-evidence";
};

export type StrategyCommercialPriority = {
  tone: StrategyEvidenceCheck["tone"] | "rates";
  label: string;
  headline: string;
  whyNow: string;
  valueSignal: string;
  economicUnlock: string;
  nextProof: string;
  riskTradeoff: string;
  rows: Array<{
    key: "value" | "target" | "margin" | "route" | "risk" | "proof";
    label: string;
    value: string;
    detail: string;
    tone: StrategyEvidenceCheck["tone"] | "rates";
  }>;
  checklist: StrategyCommercialChecklistItem[];
};

export type StrategyCommercialChecklistItem = {
  key: "qualify" | "target" | "rates" | "economics" | "approval" | "quote" | "agent";
  label: string;
  owner: StrategyOperatorDecision["owner"];
  action: string;
  why: string;
  stopRule: string;
  target: "blocker-resolution" | "target-price" | "movement" | "financials" | "decision-contract" | "customer-quote" | "agent-action";
  tone: StrategyEvidenceCheck["tone"] | "rates";
  done: boolean;
};

export type StrategyDecisionContractItem = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: StrategyEvidenceCheck["tone"] | "rates";
};

export type StrategyDecisionContract = {
  state: "blocked" | "review" | "ready";
  title: string;
  summary: string;
  proven: StrategyDecisionContractItem[];
  assumptions: StrategyDecisionContractItem[];
  allowedAgentMoves: string[];
  forbidden: string[];
  nextHumanQuestion: string | null;
};

export type StrategyCommandLedgerItem = {
  key: "rfq_gate" | "price_posture" | "route_proof" | "risk_approval" | "agent_artifact";
  label: string;
  owner: StrategyOperatorDecision["owner"];
  priority: StrategyAction["priority"];
  tone: StrategyEvidenceCheck["tone"] | "rates";
  command: string;
  evidence: string;
  stopRule: string;
  toolHint?: StrategyOperatorDecision["toolHint"];
};

export type StrategyRouteDecisionRow = {
  rank: number;
  label: string;
  provider: string | null;
  source: StrategyRouteOption["source"];
  cost: number | null;
  currency: string;
  costLabel: string;
  transitDays: number | null;
  confidence: StrategyRouteOption["confidence"];
  reliabilityScore: number;
  riskScore: number;
  rateFreshnessStatus: string | null;
  rateReliable: boolean | null;
  tradeoff: string;
};

export type StrategyRouteDecision = {
  selected: StrategyRouteDecisionRow | null;
  alternatives: StrategyRouteDecisionRow[];
  quoteGateStatus: StrategyQuoteGate["status"];
  canQuoteCustomer: boolean;
  summary: string;
  selectionRule: string;
};

function findWeakestEvidence(checks: StrategyEvidenceCheck[]) {
  return checks.find((check) => check.tone === "blocked")
    ?? checks.find((check) => check.tone === "review")
    ?? checks.find((check) => check.tone === "info")
    ?? null;
}

function proofGapRank(tone: StrategyEvidenceCheck["tone"]) {
  if (tone === "blocked") return 0;
  if (tone === "review") return 1;
  if (tone === "info") return 2;
  return 3;
}

function proofGapOwner(key: StrategyEvidenceCheck["key"]): StrategyOperatorDecision["owner"] {
  if (key === "rfq" || key === "cargo" || key === "target") return "CUSTOMER";
  if (key === "coverage" || key === "rate_freshness") return "FORWARDER";
  return "INTERNAL";
}

function proofGapTarget(key: StrategyEvidenceCheck["key"]): StrategyProofGap["target"] {
  if (key === "rfq" || key === "cargo") return "blocker-resolution";
  if (key === "target" || key === "target_trail") return "target-price";
  if (key === "coverage") return "carrier-rates";
  if (key === "rate_freshness") return "movement";
  if (key === "economics") return "financials";
  if (key === "risk") return "decision-quality";
  if (key === "documents") return "documents";
  if (key === "decision_quality") return "decision-quality";
  return "strategy-evidence";
}

function proofGapAction(check: StrategyEvidenceCheck): string {
  switch (check.key) {
    case "rfq":
    case "cargo":
      return "Ask only for the missing RFQ or cargo facts; do not infer them.";
    case "target":
      return "Capture target price or explicit no-target confirmation.";
    case "target_trail":
      return "Confirm which target price is current before using it as leverage.";
    case "coverage":
      return "Get enough active forwarder coverage for this mode and lane.";
    case "rate_freshness":
      return "Refresh or confirm validity on stale or expiring rates.";
    case "economics":
      return "Resolve buy cost, floor, margin, and approval before customer quote.";
    case "risk":
      return "Resolve the top risk or record why it is acceptable before quoting.";
    case "documents":
      return "Review document gaps and contradictions before using them as proof.";
    case "decision_quality":
      return "Rerun or strengthen the weak inputs behind this recommendation.";
    default:
      return "Resolve this proof gap before the next external-facing move.";
  }
}

export function buildStrategyProofGaps(
  checks: StrategyEvidenceCheck[],
  options: { limit?: number } = {}
): StrategyProofGap[] {
  const weakChecks = checks
    .filter((check) => check.tone !== "ready")
    .sort((a, b) => proofGapRank(a.tone) - proofGapRank(b.tone))
    .reduce<StrategyEvidenceCheck[]>((items, check) => {
      if (!items.some((item) => item.key === check.key)) items.push(check);
      return items;
    }, [])
    .slice(0, options.limit ?? 5);
  return weakChecks.map((check) => ({
    key: check.key,
    label: check.label,
    tone: check.tone,
    metric: operatorMetricLabel(check.metric, check.tone),
    detail: check.detail,
    action: proofGapAction(check),
    owner: proofGapOwner(check.key),
    target: proofGapTarget(check.key),
  }));
}

function buildOperatorPlaybook(strategy: CommercialStrategy, weakestEvidence: StrategyEvidenceCheck | null) {
  const firstBlocker = strategy.blockerResolutionPlan[0] ?? null;
  const exactAsk =
    firstBlocker?.ask
    ?? (strategy.operatorDecision.phase === "APPROVE_ECONOMICS" ? strategy.negotiation.internalGuardrail : null)
    ?? (strategy.operatorDecision.phase === "QUOTE_CUSTOMER" && strategy.price.recommendedPrice != null
      ? `Draft the customer quote around ${money(strategy.price.recommendedPrice, strategy.price.currency)} and keep the floor at ${money(strategy.price.floorPrice, strategy.price.currency)}.`
      : null)
    ?? (strategy.operatorDecision.phase === "GET_RATES" ? strategy.quoteGate.nextStep : null);

  const safetyRule =
    strategy.quoteGate.status === "BLOCKED"
      ? "Do not send to forwarders or quote the customer until these RFQ facts are explicit."
      : strategy.quoteGate.status === "NEEDS_RATES"
        ? "Create drafts only; do not externally send rate requests without operator approval."
        : strategy.quoteGate.status === "REVIEW_REQUIRED"
          ? "Do not quote the customer until the margin or risk exception is approved."
          : "Draft the customer quote for review; never send externally without user approval.";

  const stopCondition =
    strategy.operatorDecision.requiresApproval
      ? "Stop after preparing the artifact and wait for approval."
      : strategy.operatorDecision.canRunNow
        ? "Stop after creating the review draft; no external side effects."
        : `Stop until ${strategy.operatorDecision.blockers.slice(0, 3).join(", ") || "the listed blockers"} are cleared.`;

  return {
    objective: strategy.operatorDecision.title,
    firstMove: strategy.operatorDecision.command,
    exactAsk,
    evidenceGap: weakestEvidence ? `${weakestEvidence.label}: ${weakestEvidence.detail}` : null,
    safetyRule,
    stopCondition,
    toolHint: strategy.operatorDecision.toolHint,
  };
}

function combineEvidenceChecks(strategy: CommercialStrategy, extraEvidenceChecks: StrategyEvidenceCheck[] = []) {
  const byKey = new Map<string, StrategyEvidenceCheck>();
  for (const check of strategy.evidenceChecks) byKey.set(check.key, check);
  for (const check of extraEvidenceChecks) byKey.set(check.key, check);
  return Array.from(byKey.values());
}

function contractState(strategy: CommercialStrategy, weakestEvidence: StrategyEvidenceCheck | null): StrategyDecisionContract["state"] {
  if (
    strategy.quoteGate.status === "BLOCKED" ||
    strategy.price.guardrailStatus === "BLOCKED" ||
    weakestEvidence?.tone === "blocked" ||
    !strategy.operatorDecision.canRunNow ||
    strategy.operatorDecision.blockers.length > 0
  ) {
    return "blocked";
  }
  if (
    strategy.quoteGate.status === "REVIEW_REQUIRED" ||
    strategy.price.guardrailStatus === "REVIEW" ||
    strategy.operatorDecision.requiresApproval ||
    weakestEvidence?.tone === "review" ||
    strategy.confidence !== "high"
  ) {
    return "review";
  }
  return "ready";
}

function evidenceContractItem(check: StrategyEvidenceCheck): StrategyDecisionContractItem {
  return {
    key: check.key,
    label: check.label,
    value: operatorMetricLabel(check.metric, check.tone),
    detail: check.detail,
    tone: check.tone,
  };
}

function buildForbiddenRules(strategy: CommercialStrategy, reviewOnly: boolean) {
  return [
    strategy.quoteGate.canSendToForwarders ? null : "Do not send to forwarders.",
    strategy.quoteGate.canQuoteCustomer ? null : "Do not quote the customer.",
    reviewOnly ? "Do not send external messages from the agent without operator approval." : null,
    strategy.operatorDecision.requiresApproval ? "Do not execute past the review artifact until approval is recorded." : null,
  ].filter((item): item is string => !!item);
}

export function buildStrategyDecisionContract(
  strategy: CommercialStrategy,
  extraEvidenceChecks: StrategyEvidenceCheck[] = []
): StrategyDecisionContract {
  const evidenceChecks = combineEvidenceChecks(strategy, extraEvidenceChecks);
  const weakestEvidence = findWeakestEvidence(evidenceChecks);
  const state = contractState(strategy, weakestEvidence);
  const reviewOnly = strategy.operatorDecision.toolHint !== "none";
  const readyChecks = evidenceChecks.filter((check) => check.tone === "ready");
  const weakChecks = evidenceChecks.filter((check) => check.tone === "blocked" || check.tone === "review");
  const proven = [
    {
      key: "quote_gate",
      label: "Quote gate",
      value: strategy.quoteGate.label,
      detail: strategy.quoteGate.decision,
      tone: strategy.quoteGate.status === "READY_TO_QUOTE" ? "ready" :
        strategy.quoteGate.status === "NEEDS_RATES" ? "rates" :
        strategy.quoteGate.status === "REVIEW_REQUIRED" ? "review" :
        "blocked",
    } satisfies StrategyDecisionContractItem,
    ...readyChecks.map(evidenceContractItem),
  ].slice(0, 5);
  const assumptions = weakChecks.length > 0
    ? weakChecks.map((check) => ({
      ...evidenceContractItem(check),
      detail: `${check.detail} If this is wrong or changes, rerun the strategy before acting.`,
    })).slice(0, 5)
    : [
      {
        key: "decision_quality",
        label: "Decision quality",
        value: operatorMetricLabel(`${strategy.components.confidence}/100`, "info"),
        detail: "No blocked or review inputs are currently driving the recommendation. Still treat outbound work as review-only.",
        tone: "info" as const,
      },
    ];
  const allowedAgentMoves = strategy.operatorDecision.canRunNow && strategy.operatorDecision.blockers.length === 0
    ? [
      `Prepare ${strategy.operatorDecision.ctaLabel.toLowerCase()}.`,
      strategy.operatorDecision.requiresApproval
        ? "Stop at reviewed draft or plan until approval is recorded."
        : "Stop at review artifact; no external send from the agent.",
    ]
    : [
      `No agent execution until ${strategy.operatorDecision.blockers.slice(0, 3).join(", ") || strategy.quoteGate.blockers.slice(0, 3).join(", ") || "the listed blockers"} clear.`,
    ];
  const nextHumanQuestion =
    strategy.blockerResolutionPlan[0]?.ask ??
    (strategy.quoteGate.approvals.length > 0 ? `Approve or resolve: ${strategy.quoteGate.approvals.slice(0, 2).join(", ")}.` : null);
  const title =
    state === "blocked" ? "Contract blocks execution" :
    state === "review" ? "Contract allows review only" :
    "Contract ready for reviewed action";
  const summary =
    state === "blocked"
      ? `Weakest evidence: ${weakestEvidence?.label ?? strategy.quoteGate.label}. ${strategy.quoteGate.nextStep}`
      : state === "review"
        ? `${strategy.operatorDecision.ctaLabel} is allowed as a review artifact; approval or stronger proof may still be required.`
        : `${strategy.operatorDecision.ctaLabel} can be prepared from current RFQ, rate, margin, and risk evidence.`;

  return {
    state,
    title,
    summary,
    proven,
    assumptions,
    allowedAgentMoves,
    forbidden: buildForbiddenRules(strategy, reviewOnly),
    nextHumanQuestion,
  };
}

export function buildStrategyDecisionBrief(strategy: CommercialStrategy, extraEvidenceChecks: StrategyEvidenceCheck[] = []): StrategyDecisionBrief {
  const evidenceChecks = combineEvidenceChecks(strategy, extraEvidenceChecks);
  const weakestEvidence = findWeakestEvidence(evidenceChecks);
  const decisionQuality = evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
  return {
    phase: strategy.operatorDecision.phase,
    gateStatus: strategy.quoteGate.status,
    verdict: strategy.quoteGate.label,
    score: strategy.score,
    band: strategy.band,
    confidence: strategy.confidence,
    nextCommand: strategy.operatorDecision.command,
    nextAction: {
      label: strategy.operatorDecision.ctaLabel,
      owner: strategy.operatorDecision.owner,
      actionType: strategy.operatorDecision.actionType,
      priority: strategy.operatorDecision.priority,
      toolHint: strategy.operatorDecision.toolHint,
      canRunNow: strategy.operatorDecision.canRunNow,
      requiresApproval: strategy.operatorDecision.requiresApproval,
    },
    weakestEvidence,
    decisionQuality,
    blockerCount: strategy.blockerResolutionPlan.length,
    blockingQuestions: strategy.blockerResolutionPlan.slice(0, 5).map((item) => ({
      key: item.key,
      label: item.label,
      priority: item.priority,
      owner: item.owner,
      ask: item.ask,
      why: item.why,
    })),
    operatorPlaybook: buildOperatorPlaybook(strategy, weakestEvidence),
    economics: {
      guardrailStatus: strategy.price.guardrailStatus,
      buyCost: strategy.price.buyCost,
      floorPrice: strategy.price.floorPrice,
      recommendedPrice: strategy.price.recommendedPrice,
      currency: strategy.price.currency,
    },
    route: {
      label: strategy.recommendedRoute?.label ?? null,
      confidence: strategy.recommendedRoute?.confidence ?? null,
      tradeoff: strategy.recommendedRoute?.tradeoff ?? null,
    },
  };
}

function priceCommand(strategy: CommercialStrategy) {
  if (strategy.quoteGate.status === "BLOCKED") return `Do not price yet; clear RFQ gate first: ${strategy.quoteGate.blockers.slice(0, 4).join(", ")}.`;
  if (strategy.price.buyCost == null) return strategy.quoteGate.nextStep;
  if (strategy.price.guardrailStatus === "BLOCKED" || strategy.price.guardrailStatus === "REVIEW") {
    return strategy.negotiation.internalGuardrail;
  }
  if (strategy.price.recommendedPrice != null) {
    return `Use ${money(strategy.price.recommendedPrice, strategy.price.currency)} as the working sell price; floor is ${money(strategy.price.floorPrice, strategy.price.currency)}.`;
  }
  return strategy.evidence.targetPosture.stance;
}

function priceLedgerTone(status: CommercialStrategy["price"]["guardrailStatus"]): StrategyCommandLedgerItem["tone"] {
  if (status === "PASS") return "ready";
  if (status === "REVIEW") return "review";
  return "blocked";
}

function routeLedgerTone(strategy: CommercialStrategy): StrategyCommandLedgerItem["tone"] {
  if (strategy.quoteGate.status === "BLOCKED") return "blocked";
  if (strategy.evidence.rateFreshness?.tone === "blocked") return "blocked";
  if (strategy.quoteGate.status === "NEEDS_RATES") return "rates";
  if (strategy.evidence.coveragePosture.status === "STRONG_LIVE" || strategy.evidence.coveragePosture.status === "WORKABLE_LIVE") {
    return strategy.evidence.rateFreshness?.tone === "review" ? "review" : "ready";
  }
  if (strategy.evidence.coveragePosture.status === "NONE") return "blocked";
  return "review";
}

function approvalLedgerTone(strategy: CommercialStrategy): StrategyCommandLedgerItem["tone"] {
  const topRisk = strategy.riskAssessments[0] ?? null;
  if (strategy.quoteGate.requiresApproval) return "review";
  if (topRisk && topRisk.score >= 82) return "blocked";
  if (topRisk && topRisk.score >= 62) return "review";
  return "ready";
}

function agentLedgerTone(strategy: CommercialStrategy): StrategyCommandLedgerItem["tone"] {
  if (!strategy.operatorDecision.canRunNow || strategy.operatorDecision.blockers.length > 0) return "blocked";
  if (strategy.operatorDecision.requiresApproval) return "review";
  return "ready";
}

export function buildStrategyCommandLedger(strategy: CommercialStrategy): StrategyCommandLedgerItem[] {
  const routeDecision = buildStrategyRouteDecision(strategy);
  const applicableMaturity = strategy.maturityChecks.filter((check) => check.status !== "not_applicable");
  const readyMaturity = applicableMaturity.filter((check) => check.status === "ready");
  const firstBlocker = strategy.blockerResolutionPlan[0] ?? null;
  const topRisk = strategy.riskAssessments[0] ?? null;
  const route = routeDecision.selected;
  const routeCost = route ? `${route.costLabel}${route.provider ? ` via ${route.provider}` : ""}` : "No route cost";
  const approvalEvidence = strategy.quoteGate.approvals.length > 0
    ? strategy.quoteGate.approvals.slice(0, 3).join(", ")
    : topRisk
      ? `${topRisk.level}: ${topRisk.reason}`
      : "No approval gate currently overrides the strategy.";

  return [
    {
      key: "rfq_gate",
      label: "RFQ gate",
      owner: strategy.quoteGate.status === "BLOCKED" ? "CUSTOMER" : "INTERNAL",
      priority: strategy.quoteGate.status === "BLOCKED" ? "critical" : "medium",
      tone: strategy.quoteGate.status === "BLOCKED" ? "blocked" : "ready",
      command: firstBlocker?.ask ?? strategy.quoteGate.nextStep,
      evidence: `${readyMaturity.length}/${applicableMaturity.length || 1} maturity checks ready. ${strategy.quoteGate.label}.`,
      stopRule: strategy.quoteGate.status === "BLOCKED"
        ? "Stop before forwarder send or customer quote."
        : "RFQ facts can move to the current commercial step.",
    },
    {
      key: "price_posture",
      label: "Price posture",
      owner: "INTERNAL",
      priority: strategy.price.guardrailStatus === "BLOCKED" ? "critical" : strategy.price.guardrailStatus === "REVIEW" ? "high" : "medium",
      tone: priceLedgerTone(strategy.price.guardrailStatus),
      command: priceCommand(strategy),
      evidence: `${strategy.evidence.targetPosture.label}; buy ${money(strategy.price.buyCost, strategy.price.currency)}, floor ${money(strategy.price.floorPrice, strategy.price.currency)}, recommended ${money(strategy.price.recommendedPrice, strategy.price.currency)}.`,
      stopRule: strategy.price.guardrailStatus === "PASS"
        ? "Do not discount below floor."
        : "Stop before customer quote until economics are reviewed.",
    },
    {
      key: "route_proof",
      label: "Route proof",
      owner: "FORWARDER",
      priority: strategy.quoteGate.status === "NEEDS_RATES" ? "high" : routeLedgerTone(strategy) === "blocked" ? "high" : "medium",
      tone: routeLedgerTone(strategy),
      command: strategy.quoteGate.status === "BLOCKED"
        ? "Do not request rates yet; clear RFQ gate before forwarding this load."
        : strategy.quoteGate.status === "NEEDS_RATES" ? strategy.quoteGate.nextStep : routeDecision.summary,
      evidence: `${strategy.evidence.coveragePosture.label}; selected ${route?.label ?? "none"} at ${routeCost}.`,
      stopRule: strategy.quoteGate.status === "BLOCKED"
        ? "Stop before forwarder send until RFQ gate clears."
        : strategy.quoteGate.canQuoteCustomer
        ? "Route evidence can support a reviewed customer quote."
        : "Do not quote customer from benchmark, stale, or thin route proof.",
    },
    {
      key: "risk_approval",
      label: "Risk and approval",
      owner: "INTERNAL",
      priority: topRisk && topRisk.score >= 82 ? "critical" : strategy.quoteGate.requiresApproval || (topRisk && topRisk.score >= 70) ? "high" : "low",
      tone: approvalLedgerTone(strategy),
      command: strategy.quoteGate.requiresApproval
        ? `Resolve approval: ${strategy.quoteGate.approvals.slice(0, 3).join(", ")}.`
        : topRisk
          ? topRisk.mitigation
          : "No approval required before preparing the review artifact.",
      evidence: approvalEvidence,
      stopRule: strategy.quoteGate.requiresApproval
        ? "Stop after draft/plan creation until approval is recorded."
        : topRisk && topRisk.score >= 82
          ? "Stop downstream action until this critical risk is mitigated."
          : topRisk && topRisk.score >= 62
            ? "Review risk before using any customer-facing quote."
        : "Keep normal review-only agent safety.",
    },
    {
      key: "agent_artifact",
      label: "Agent artifact",
      owner: strategy.operatorDecision.owner,
      priority: strategy.operatorDecision.priority,
      tone: agentLedgerTone(strategy),
      command: strategy.operatorDecision.command,
      evidence: `${strategy.operatorDecision.ctaLabel}; ${strategy.operatorDecision.surfaceHint.replace(/_/g, " ")}.`,
      stopRule: strategy.operatorDecision.requiresApproval
        ? "Create a review artifact only; external send still needs approval."
        : "Create review output only; never send externally without operator action.",
      toolHint: strategy.operatorDecision.toolHint,
    },
  ];
}

function pctLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "unknown";
  return `${value.toFixed(1)}%`;
}

function commercialPriorityTone(strategy: CommercialStrategy, weakestEvidence: StrategyEvidenceCheck | null): StrategyCommercialPriority["tone"] {
  if (
    strategy.quoteGate.status === "BLOCKED" ||
    strategy.price.guardrailStatus === "BLOCKED" ||
    weakestEvidence?.tone === "blocked"
  ) {
    return "blocked";
  }
  if (strategy.quoteGate.status === "NEEDS_RATES") return "rates";
  if (
    strategy.quoteGate.status === "REVIEW_REQUIRED" ||
    strategy.price.guardrailStatus === "REVIEW" ||
    weakestEvidence?.tone === "review" ||
    strategy.operatorDecision.requiresApproval
  ) {
    return "review";
  }
  return "ready";
}

function commercialPriorityLabel(strategy: CommercialStrategy, tone: StrategyCommercialPriority["tone"]) {
  if (strategy.quoteGate.status === "BLOCKED") return "Qualify before pricing";
  if (strategy.price.guardrailStatus === "BLOCKED") return "Economics blocked";
  if (strategy.quoteGate.status === "NEEDS_RATES") return "Get live coverage";
  if (strategy.quoteGate.status === "REVIEW_REQUIRED" || tone === "review") return "Review before quote";
  return "Quote-ready priority";
}

function commercialValueSignal(strategy: CommercialStrategy) {
  const source = strategy.evidence.sourceEconomics;
  if (strategy.price.expectedGrossProfit != null) {
    return `Expected gross profit ${money(strategy.price.expectedGrossProfit, strategy.price.currency)}`;
  }
  if (source?.expectedProfit != null) {
    return `Sheet profit context ${money(source.expectedProfit, source.profitCurrency ?? strategy.price.currency)}`;
  }
  if (source?.contractValue != null) {
    return `Sheet value context ${money(source.contractValue, source.contractCurrency ?? strategy.price.currency)}`;
  }
  if (strategy.price.recommendedPrice != null) {
    return `Recommended sell ${money(strategy.price.recommendedPrice, strategy.price.currency)}`;
  }
  if (strategy.evidence.targetPosture.target != null) {
    return `Customer target ${money(strategy.evidence.targetPosture.target, strategy.evidence.targetPosture.currency)}`;
  }
  return "Commercial value unknown until target or live rates are captured";
}

function commercialWhyNow(strategy: CommercialStrategy, valueSignal: string) {
  const targetTrail = strategy.evidence.targetTrail;
  if (targetTrail?.direction === "RAISED") return `${valueSignal}; target moved up, so protect the new anchor instead of discounting blindly.`;
  if (targetTrail?.direction === "LOWERED") return `${valueSignal}; target moved down, so the floor and buy cost need attention before quoting.`;
  if (strategy.quoteGate.status === "BLOCKED") return `${valueSignal}; the next useful move is qualification, not fake pricing.`;
  if (strategy.quoteGate.status === "NEEDS_RATES") return `${valueSignal}; mature RFQ is waiting on route proof before customer pricing.`;
  if (strategy.price.guardrailStatus === "BLOCKED" || strategy.price.guardrailStatus === "REVIEW") {
    return `${valueSignal}; margin or target pressure can change the quote decision, so handle economics before customer output.`;
  }
  return `${valueSignal}; the next commercial move is explicit: ${strategy.operatorDecision.ctaLabel}.`;
}

function commercialEconomicUnlock(strategy: CommercialStrategy) {
  const firstBlocker = strategy.blockerResolutionPlan[0] ?? null;
  const targetPosture = strategy.evidence.targetPosture;
  if (firstBlocker && strategy.quoteGate.status === "BLOCKED") return firstBlocker.ask;
  if (targetPosture.status === "MISSING") {
    return "Capture target price or explicit no-target confirmation before treating the quote as commercially mature.";
  }
  if (strategy.price.buyCost == null) {
    return "Get a live buy cost, validity, service, and constraints; target alone is not a quote.";
  }
  if (
    strategy.negotiation.targetBuyLimit != null &&
    (targetPosture.status === "BELOW_BUY" || targetPosture.status === "BELOW_FLOOR")
  ) {
    return `Buy cost must move to about ${money(strategy.negotiation.targetBuyLimit, strategy.price.currency)} or the customer target must reset. Current buy is ${money(strategy.price.buyCost, strategy.price.currency)}.`;
  }
  if (strategy.price.guardrailStatus === "REVIEW") {
    return `Protect the floor at ${money(strategy.price.floorPrice, strategy.price.currency)}; quoting below it needs approval.`;
  }
  if (strategy.quoteGate.canQuoteCustomer) {
    return `Quote around ${money(strategy.price.recommendedPrice, strategy.price.currency)} and do not discount below ${money(strategy.price.floorPrice, strategy.price.currency)}.`;
  }
  return strategy.quoteGate.nextStep;
}

function pushCommercialChecklistItem(
  items: StrategyCommercialChecklistItem[],
  item: StrategyCommercialChecklistItem
) {
  if (items.some((existing) => existing.key === item.key && existing.target === item.target)) return;
  items.push(item);
}

function buildCommercialPriorityChecklist(
  strategy: CommercialStrategy,
  weakestEvidence: StrategyEvidenceCheck | null
): StrategyCommercialChecklistItem[] {
  const items: StrategyCommercialChecklistItem[] = [];
  const firstBlocker = strategy.blockerResolutionPlan[0] ?? null;
  const targetPosture = strategy.evidence.targetPosture;
  const ratesUsable = strategy.evidence.rateFreshness?.tone === "ready" || strategy.evidence.coveragePosture.reliableLiveQuotes >= 2;
  const needsRates = strategy.quoteGate.status === "NEEDS_RATES" || strategy.price.buyCost == null || strategy.evidence.coveragePosture.primaryEvidence !== "LIVE_QUOTES";

  if (strategy.quoteGate.status === "BLOCKED" || firstBlocker) {
    pushCommercialChecklistItem(items, {
      key: "qualify",
      label: "Clear RFQ blocker",
      owner: firstBlocker?.owner ?? "CUSTOMER",
      action: firstBlocker?.ask ?? strategy.quoteGate.nextStep,
      why: firstBlocker?.why ?? strategy.quoteGate.decision,
      stopRule: "Do not request rates or quote until this is explicit.",
      target: "blocker-resolution",
      tone: "blocked",
      done: false,
    });
  }

  if (targetPosture.status === "MISSING" || targetPosture.status === "UNPRICED") {
    pushCommercialChecklistItem(items, {
      key: "target",
      label: targetPosture.status === "MISSING" ? "Get target posture" : "Price target posture",
      owner: targetPosture.status === "MISSING" ? "CUSTOMER" : "INTERNAL",
      action: targetPosture.status === "MISSING"
        ? "Ask for target price or explicit no-target confirmation."
        : "Turn the captured target into floor/recommended/walk-away economics.",
      why: targetPosture.stance,
      stopRule: "Do not let a blank target become an invented budget.",
      target: "target-price",
      tone: targetPosture.status === "MISSING" ? "blocked" : "review",
      done: false,
    });
  }

  if (needsRates && strategy.quoteGate.status !== "BLOCKED") {
    pushCommercialChecklistItem(items, {
      key: "rates",
      label: "Get live route proof",
      owner: "FORWARDER",
      action: strategy.quoteGate.status === "NEEDS_RATES" ? strategy.quoteGate.nextStep : strategy.negotiation.forwarderCounter,
      why: strategy.evidence.coveragePosture.stance,
      stopRule: "Do not quote customer from stale, benchmark-only, or missing buy cost.",
      target: "movement",
      tone: ratesUsable ? "review" : "rates",
      done: false,
    });
  }

  if (strategy.price.guardrailStatus === "BLOCKED" || strategy.price.guardrailStatus === "REVIEW") {
    pushCommercialChecklistItem(items, {
      key: "economics",
      label: strategy.price.guardrailStatus === "BLOCKED" ? "Fix blocked economics" : "Approve economics",
      owner: "INTERNAL",
      action: commercialEconomicUnlock(strategy),
      why: strategy.negotiation.internalGuardrail,
      stopRule: "Wait before customer quote until the floor/target exception is resolved.",
      target: "financials",
      tone: strategy.price.guardrailStatus === "BLOCKED" ? "blocked" : "review",
      done: false,
    });
  }

  if (strategy.quoteGate.requiresApproval || strategy.operatorDecision.requiresApproval) {
    pushCommercialChecklistItem(items, {
      key: "approval",
      label: "Record approval",
      owner: "INTERNAL",
      action: strategy.quoteGate.approvals.length > 0
        ? `Approve or resolve: ${strategy.quoteGate.approvals.slice(0, 3).join(", ")}.`
        : strategy.operatorDecision.rationale,
      why: strategy.quoteGate.requiresApproval ? strategy.quoteGate.decision : strategy.operatorDecision.rationale,
      stopRule: "Stay at review artifact until approval is explicit.",
      target: "decision-contract",
      tone: "review",
      done: false,
    });
  }

  if (strategy.quoteGate.canQuoteCustomer) {
    pushCommercialChecklistItem(items, {
      key: "quote",
      label: "Prepare customer quote",
      owner: "INTERNAL",
      action: `Draft quote around ${money(strategy.price.recommendedPrice, strategy.price.currency)}.`,
      why: `Floor is ${money(strategy.price.floorPrice, strategy.price.currency)}; target posture is ${strategy.evidence.targetPosture.label}.`,
      stopRule: "Review the draft before any external send.",
      target: "customer-quote",
      tone: strategy.operatorDecision.requiresApproval ? "review" : "ready",
      done: false,
    });
  }

  if (items.length === 0) {
    pushCommercialChecklistItem(items, {
      key: "agent",
      label: "Run reviewed agent artifact",
      owner: strategy.operatorDecision.owner,
      action: strategy.operatorDecision.command,
      why: weakestEvidence ? weakestEvidence.detail : strategy.operatorDecision.rationale,
      stopRule: strategy.operatorDecision.requiresApproval
        ? "Stay at reviewed artifact until approval is recorded."
        : "Keep this at review output; external sends stay operator-controlled.",
      target: "agent-action",
      tone: strategy.operatorDecision.canRunNow ? "ready" : "review",
      done: false,
    });
  }

  return items.slice(0, 4);
}

export function buildStrategyCommercialPriority(
  strategy: CommercialStrategy,
  extraEvidenceChecks: StrategyEvidenceCheck[] = []
): StrategyCommercialPriority {
  const evidenceChecks = combineEvidenceChecks(strategy, extraEvidenceChecks);
  const weakestEvidence = findWeakestEvidence(evidenceChecks);
  const tone = commercialPriorityTone(strategy, weakestEvidence);
  const routeDecision = buildStrategyRouteDecision(strategy);
  const route = routeDecision.selected;
  const topRisk = strategy.riskAssessments[0] ?? null;
  const valueSignal = commercialValueSignal(strategy);
  const targetMetric = strategy.evidence.targetPosture.target == null
    ? strategy.evidence.targetPosture.label
    : money(strategy.evidence.targetPosture.target, strategy.evidence.targetPosture.currency);
  const marginDetail = [
    `buy ${money(strategy.price.buyCost, strategy.price.currency)}`,
    `floor ${money(strategy.price.floorPrice, strategy.price.currency)}`,
    `recommended ${money(strategy.price.recommendedPrice, strategy.price.currency)}`,
    `margin ${pctLabel(strategy.price.expectedMarginPct)}`,
  ].join(" · ");
  const routeDetail = route
    ? `${route.label}; ${route.costLabel}; ${routeDecision.summary}`
    : routeDecision.summary;
  const riskTradeoff = topRisk
    ? `${topRisk.reason} Mitigation: ${topRisk.mitigation}`
    : route?.tradeoff ?? strategy.evidence.coveragePosture.stance;
  const nextProof = weakestEvidence
    ? `${weakestEvidence.label}: ${weakestEvidence.detail}`
    : "No blocked proof item is currently holding the commercial move.";

  return {
    tone,
    label: commercialPriorityLabel(strategy, tone),
    headline: strategy.operatorDecision.title,
    whyNow: commercialWhyNow(strategy, valueSignal),
    valueSignal,
    economicUnlock: commercialEconomicUnlock(strategy),
    nextProof,
    riskTradeoff,
    checklist: buildCommercialPriorityChecklist(strategy, weakestEvidence),
    rows: [
      {
        key: "value",
        label: "Money at stake",
        value: valueSignal,
        detail: `Win probability ${strategy.price.winProbability}%; source value is context until confirmed by RFQ or quote evidence.`,
        tone: strategy.price.expectedGrossProfit != null || strategy.evidence.sourceEconomics?.expectedProfit != null ? "ready" : "info",
      },
      {
        key: "target",
        label: "Target leverage",
        value: targetMetric,
        detail: strategy.evidence.targetTrail?.leverage ?? strategy.evidence.targetPosture.stance,
        tone: strategy.evidence.targetPosture.status === "MISSING" || strategy.evidence.targetPosture.status === "BELOW_BUY"
          ? "blocked"
          : ["BELOW_FLOOR", "UNDER_RECOMMENDED", "UNPRICED"].includes(strategy.evidence.targetPosture.status)
            ? "review"
            : strategy.evidence.targetPosture.status === "NO_TARGET"
              ? "info"
              : "ready",
      },
      {
        key: "margin",
        label: "Margin unlock",
        value: strategy.price.guardrailStatus.toLowerCase().replace(/_/g, " "),
        detail: marginDetail,
        tone: strategy.price.guardrailStatus === "PASS"
          ? "ready"
          : strategy.price.guardrailStatus === "NEEDS_COST"
            ? "rates"
            : strategy.price.guardrailStatus === "REVIEW"
              ? "review"
              : "blocked",
      },
      {
        key: "route",
        label: "Route proof",
        value: strategy.evidence.coveragePosture.label,
        detail: routeDetail,
        tone: strategy.quoteGate.status === "NEEDS_RATES"
          ? "rates"
          : strategy.evidence.rateFreshness?.tone ?? (strategy.evidence.coveragePosture.reliableLiveQuotes > 0 ? "review" : "blocked"),
      },
      {
        key: topRisk ? "risk" : "proof",
        label: topRisk ? "Risk tradeoff" : "Next proof",
        value: topRisk ? `${topRisk.level} risk` : weakestEvidence?.label ?? "Proof covered",
        detail: topRisk ? riskTradeoff : nextProof,
        tone: topRisk
          ? topRisk.score >= 82 ? "blocked" : topRisk.score >= 62 ? "review" : "ready"
          : weakestEvidence?.tone ?? "ready",
      },
    ],
  };
}

export function buildStrategyExecutionPacket(strategy: CommercialStrategy, extraEvidenceChecks: StrategyEvidenceCheck[] = []): StrategyExecutionPacket {
  const evidenceChecks = combineEvidenceChecks(strategy, extraEvidenceChecks);
  const weakestEvidence = findWeakestEvidence(evidenceChecks);
  const brief = buildStrategyDecisionBrief(strategy, extraEvidenceChecks);
  const reviewOnly = strategy.operatorDecision.toolHint !== "none";
  const forbidden = buildForbiddenRules(strategy, reviewOnly);
  const contract = buildStrategyDecisionContract(strategy, extraEvidenceChecks);
  const proofGaps = buildStrategyProofGaps(evidenceChecks);

  return {
    brief,
    commercialPriority: buildStrategyCommercialPriority(strategy, extraEvidenceChecks),
    runway: [
      {
        key: "evidence",
        label: "1. Evidence",
        title: weakestEvidence ? weakestEvidence.label : "Inputs covered",
        detail: weakestEvidence ? weakestEvidence.detail : "No blocked or review evidence is holding the next action.",
        tone: weakestEvidence?.tone ?? "ready",
      },
      {
        key: "decision",
        label: "2. Decision",
        title: strategy.quoteGate.label,
        detail: strategy.quoteGate.nextStep,
        tone: strategy.quoteGate.status === "BLOCKED"
          ? "blocked"
          : strategy.quoteGate.status === "REVIEW_REQUIRED"
            ? "review"
            : strategy.quoteGate.status === "NEEDS_RATES"
              ? "rates"
              : "ready",
      },
      {
        key: "agent",
        label: "3. Agent",
        title: strategy.operatorDecision.ctaLabel,
        detail: brief.blockingQuestions[0]?.ask ?? strategy.operatorDecision.rationale,
        tone: strategy.operatorDecision.canRunNow && strategy.operatorDecision.blockers.length === 0 ? "ready" : "blocked",
      },
    ],
    primary: {
      label: strategy.operatorDecision.ctaLabel,
      command: strategy.operatorDecision.command,
      owner: strategy.operatorDecision.owner,
      toolHint: strategy.operatorDecision.toolHint,
      canRunNow: strategy.operatorDecision.canRunNow,
      requiresApproval: strategy.operatorDecision.requiresApproval,
      reviewOnly,
    },
    safety: {
      rule: brief.operatorPlaybook.safetyRule,
      stopCondition: brief.operatorPlaybook.stopCondition,
      forbidden,
    },
    evidence: {
      weakest: weakestEvidence,
      checks: evidenceChecks,
      gaps: proofGaps,
    },
    commandLedger: buildStrategyCommandLedger(strategy),
    contract,
  };
}

function routeEvidenceString(option: StrategyRouteOption, key: string) {
  const value = option.evidence?.[key];
  return typeof value === "string" ? value : null;
}

function routeEvidenceBoolean(option: StrategyRouteOption, key: string) {
  const value = option.evidence?.[key];
  return typeof value === "boolean" ? value : null;
}

function routeDecisionRow(option: StrategyRouteOption, index: number): StrategyRouteDecisionRow {
  return {
    rank: index + 1,
    label: option.label,
    provider: option.provider,
    source: option.source,
    cost: option.cost,
    currency: option.currency,
    costLabel: option.cost == null ? "unknown" : money(option.cost, option.currency),
    transitDays: option.transitDays,
    confidence: option.confidence,
    reliabilityScore: option.reliabilityScore,
    riskScore: option.riskScore,
    rateFreshnessStatus: routeEvidenceString(option, "rateFreshnessStatus"),
    rateReliable: routeEvidenceBoolean(option, "rateReliable"),
    tradeoff: option.tradeoff,
  };
}

export function buildStrategyRouteDecision(strategy: CommercialStrategy): StrategyRouteDecision {
  const rows = strategy.routeOptions.slice(0, 6).map(routeDecisionRow);
  const selected = rows[0] ?? null;
  const liveSelected = selected?.source === "RECEIVED_QUOTE" && selected.rateReliable === true;
  const summary =
    !selected
      ? "No priced route exists; request current forwarder rates."
      : !strategy.quoteGate.canQuoteCustomer
        ? `${selected.label} is the current best route evidence, but the quote gate says: ${strategy.quoteGate.nextStep}`
        : liveSelected
          ? `${selected.label} is selected because it is a usable received forwarder quote.`
          : `${selected.label} is selected as context only; verify a live forwarder quote before customer-facing use.`;

  return {
    selected,
    alternatives: rows.slice(1),
    quoteGateStatus: strategy.quoteGate.status,
    canQuoteCustomer: strategy.quoteGate.canQuoteCustomer,
    summary,
    selectionRule: "Rank current reliable received quotes first, then lane benchmarks, then historical costs, then stale or unverified quotes.",
  };
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function money(n: number | null | undefined, currency: string) {
  if (n == null || !Number.isFinite(n)) return "unknown";
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

function pctGap(reference: number | null | undefined, value: number | null | undefined) {
  if (reference == null || value == null || !Number.isFinite(reference) || !Number.isFinite(value) || reference <= 0) return null;
  return ((value - reference) / reference) * 100;
}

function historyTime(entry: StrategyTargetHistoryEntry) {
  const value = entry.createdAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function targetHistoryAmount(entry: StrategyTargetHistoryEntry | null | undefined) {
  const amount = entry?.amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;
}

function targetHistoryCurrency(entry: StrategyTargetHistoryEntry | null | undefined, fallback: string) {
  return (entry?.currency || fallback || "USD").toUpperCase();
}

function isNoTargetEntry(entry: StrategyTargetHistoryEntry) {
  return (entry.status ?? "").toUpperCase() === "NO_TARGET";
}

function buildTargetTrail(args: {
  history?: StrategyTargetHistoryEntry[];
  currentTarget: number | null;
  currentCurrency: string;
  currentStatus?: string | null;
  currentSource?: string | null;
}): StrategyTargetTrail | null {
  const rows = [...(args.history ?? [])]
    .filter((entry) => targetHistoryAmount(entry) != null || entry.status || entry.source || entry.note)
    .sort((a, b) => historyTime(b) - historyTime(a));
  if (rows.length === 0) return null;

  const provided = rows.filter((entry) => targetHistoryAmount(entry) != null);
  const latest = rows[0] ?? null;
  const latestProvided = provided[0] ?? null;
  const latestProvidedCurrency = targetHistoryCurrency(latestProvided, args.currentCurrency);
  const previousProvided = latestProvided
    ? provided.slice(1).find((entry) => targetHistoryCurrency(entry, args.currentCurrency) === latestProvidedCurrency) ?? provided[1] ?? null
    : null;
  const noTargetCount = rows.filter(isNoTargetEntry).length;
  const currencies = new Set(provided.map((entry) => targetHistoryCurrency(entry, args.currentCurrency)));
  const mixedCurrency = currencies.size > 1;
  const latestAmount = targetHistoryAmount(latestProvided);
  const previousAmount = targetHistoryAmount(previousProvided);
  const movementAmount = latestAmount != null && previousAmount != null ? latestAmount - previousAmount : null;
  const movementPct = previousAmount != null && previousAmount > 0 && movementAmount != null
    ? (movementAmount / previousAmount) * 100
    : null;

  const currentStatus = (args.currentStatus ?? "").toUpperCase();
  const currentCurrency = args.currentCurrency.toUpperCase();
  const latestIsNoTarget = latest ? isNoTargetEntry(latest) : false;
  const latestRecordMismatch =
    latestIsNoTarget && (args.currentTarget != null || currentStatus !== "NO_TARGET")
      ? true
      : latestAmount != null && args.currentTarget != null
        ? Math.abs(latestAmount - args.currentTarget) > 1 || latestProvidedCurrency !== currentCurrency
        : latestAmount != null && args.currentTarget == null;

  let direction: StrategyTargetTrail["direction"] = "NONE";
  if (latestRecordMismatch) direction = "STALE";
  else if (mixedCurrency) direction = "MIXED_CURRENCY";
  else if (latestIsNoTarget && provided.length > 0) direction = "WITHDRAWN";
  else if (latestIsNoTarget) direction = "NONE";
  else if (latestAmount != null && previousAmount == null) direction = "NEW";
  else if (movementAmount != null && Math.abs(movementAmount) <= 1) direction = "UNCHANGED";
  else if (movementAmount != null && movementAmount > 0) direction = "RAISED";
  else if (movementAmount != null && movementAmount < 0) direction = "LOWERED";

  const latestMoney = latestAmount != null ? money(latestAmount, latestProvidedCurrency) : null;
  const movementText = movementPct == null
    ? null
    : `${movementPct > 0 ? "+" : ""}${movementPct.toFixed(1)}%`;
  const source = latest?.source || args.currentSource;
  const sourceText = source ? ` Source: ${source}.` : "";

  if (direction === "STALE") {
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "review",
      label: "Target trail mismatch",
      metric: latestMoney ?? "Mismatch",
      detail: `The latest target history does not match the current target field. Verify before using this as negotiation leverage.${sourceText}`,
      leverage: null,
    };
  }

  if (direction === "MIXED_CURRENCY") {
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "review",
      label: "Mixed target currencies",
      metric: `${currencies.size} currencies`,
      detail: `Target history uses multiple currencies. Normalize before comparing movement.${sourceText}`,
      leverage: null,
    };
  }

  if (direction === "WITHDRAWN") {
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "review",
      label: "Target withdrawn",
      metric: "No target",
      detail: `Customer moved from a target into no-target posture. Use market pricing, but do not pretend the old target is still live.${sourceText}`,
      leverage: "Old targets are context only; ask again before anchoring a quote on them.",
    };
  }

  if (direction === "LOWERED") {
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "review",
      label: "Target moved down",
      metric: `${latestMoney}${movementText ? ` ${movementText}` : ""}`,
      detail: `Customer target moved down from ${money(previousAmount, latestProvidedCurrency)} to ${latestMoney}. Re-check margin before treating this as quote-ready.${sourceText}`,
      leverage: "Push buy cost down or reset customer expectation before giving away margin.",
    };
  }

  if (direction === "RAISED") {
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "ready",
      label: "Target improved",
      metric: `${latestMoney}${movementText ? ` ${movementText}` : ""}`,
      detail: `Customer target moved up from ${money(previousAmount, latestProvidedCurrency)} to ${latestMoney}. Protect the new anchor; do not over-discount.${sourceText}`,
      leverage: "Use the improved target as proof that the customer has budget flexibility.",
    };
  }

  if (latestAmount != null) {
    const safeLatestMoney = latestMoney ?? "unknown";
    return {
      total: rows.length,
      providedCount: provided.length,
      noTargetCount,
      latest,
      latestProvided,
      previousProvided,
      direction,
      movementAmount,
      movementPct,
      tone: "ready",
      label: direction === "UNCHANGED" ? "Target stable" : "Target captured",
      metric: safeLatestMoney,
      detail: direction === "UNCHANGED"
        ? `Repeated target entries are stable at ${safeLatestMoney}.${sourceText}`
        : `Target history has ${provided.length} provided target${provided.length === 1 ? "" : "s"}; latest is ${safeLatestMoney}.${sourceText}`,
      leverage: "Use the latest explicit customer target; older entries are audit context.",
    };
  }

  return {
    total: rows.length,
    providedCount: provided.length,
    noTargetCount,
    latest,
    latestProvided,
    previousProvided,
    direction,
    movementAmount,
    movementPct,
    tone: "info",
    label: "No target trail",
    metric: noTargetCount > 0 ? "No target" : `${rows.length} entries`,
    detail: noTargetCount > 0
      ? `No-target confirmation is recorded. Price from market evidence instead of inventing a budget.${sourceText}`
      : `Target history exists, but no usable numeric target was recorded.${sourceText}`,
    leverage: null,
  };
}

function buildTargetPosture(args: {
  target: number | null;
  currency: string;
  targetPriceStatus?: string | null;
  buyCost: number | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  stretchPrice: number | null;
  marginAtTarget: number | null;
}): StrategyTargetPosture {
  const base = {
    target: args.target,
    currency: args.currency,
    marginAtTargetPct: args.marginAtTarget,
    gapToBuyCostPct: pctGap(args.buyCost, args.target),
    gapToFloorPct: pctGap(args.floorPrice, args.target),
    gapToRecommendedPct: pctGap(args.recommendedPrice, args.target),
  };

  if (args.target == null && args.targetPriceStatus === "NO_TARGET") {
    return {
      ...base,
      status: "NO_TARGET",
      label: "No target confirmed",
      stance: "Use market-led pricing; do not invent a customer budget.",
    };
  }
  if (args.target == null) {
    return {
      ...base,
      status: "MISSING",
      label: "Ask target",
      stance: "Ask for target price or explicit no-target confirmation before forwarding.",
    };
  }
  if (args.buyCost == null || args.floorPrice == null || args.recommendedPrice == null) {
    return {
      ...base,
      status: "UNPRICED",
      label: "Target captured",
      stance: "Target exists, but buy cost is missing; get rates before judging it.",
    };
  }
  if (args.target <= args.buyCost) {
    return {
      ...base,
      status: "BELOW_BUY",
      label: "Below buy cost",
      stance: "Do not quote at target. Negotiate buy cost or reset customer expectations.",
    };
  }
  if (args.target < args.floorPrice) {
    return {
      ...base,
      status: "BELOW_FLOOR",
      label: "Below floor",
      stance: "Counter before quoting; target does not clear minimum margin.",
    };
  }
  if (args.target < args.recommendedPrice) {
    return {
      ...base,
      status: "UNDER_RECOMMENDED",
      label: "Under recommended",
      stance: "Workable only if coverage is strong or forwarder cost can move down.",
    };
  }
  if (args.stretchPrice != null && args.target >= args.stretchPrice) {
    return {
      ...base,
      status: "GENEROUS",
      label: "Target has room",
      stance: "Customer target supports margin; protect service quality and avoid over-discounting.",
    };
  }
  return {
    ...base,
    status: "WITHIN_GUARDRAIL",
    label: "Target clears guardrail",
    stance: "Quote near recommendation; floor is protected.",
  };
}

function buildCoveragePosture(args: {
  receivedQuotes: number;
  reliableLiveQuotes: number;
  pendingQuotes: number;
  totalQuotes: number;
  laneRateMatches: number;
  historicalLaneJobs: number;
}): StrategyCoveragePosture {
  const base = {
    receivedQuotes: args.receivedQuotes,
    reliableLiveQuotes: args.reliableLiveQuotes,
    pendingQuotes: args.pendingQuotes,
    totalQuotes: args.totalQuotes,
    laneRateMatches: args.laneRateMatches,
    historicalLaneJobs: args.historicalLaneJobs,
  };
  if (args.reliableLiveQuotes >= 3) {
    return {
      ...base,
      status: "STRONG_LIVE",
      label: "Strong live coverage",
      stance: "Enough live quotes to compare price and route tradeoffs; protect validity and service terms.",
      primaryEvidence: "LIVE_QUOTES",
    };
  }
  if (args.reliableLiveQuotes === 2) {
    return {
      ...base,
      status: "WORKABLE_LIVE",
      label: "Workable live coverage",
      stance: "Two live quotes are usable, but a third quote still improves leverage.",
      primaryEvidence: "LIVE_QUOTES",
    };
  }
  if (args.reliableLiveQuotes === 1) {
    return {
      ...base,
      status: "THIN_LIVE",
      label: "Thin live coverage",
      stance: "One live quote is a weak basis for customer pricing; use it tactically or get more coverage.",
      primaryEvidence: "LIVE_QUOTES",
    };
  }
  if (args.receivedQuotes > 0) {
    return {
      ...base,
      status: "STALE_LIVE",
      label: "Refresh rates",
      stance: "Received forwarder prices exist, but their age or validity is not reliable enough for a customer quote.",
      primaryEvidence: "STALE_QUOTES",
    };
  }
  if (args.pendingQuotes > 0) {
    return {
      ...base,
      status: "PENDING_ONLY",
      label: "Waiting on rates",
      stance: "Forwarder requests are out, but no live buy cost has landed yet.",
      primaryEvidence: "PENDING",
    };
  }
  if (args.laneRateMatches > 0) {
    return {
      ...base,
      status: "BENCHMARK_ONLY",
      label: "Benchmark only",
      stance: "Lane rates can frame the price, but they are not a live forwarder quote.",
      primaryEvidence: "LANE_RATE",
    };
  }
  if (args.historicalLaneJobs > 0) {
    return {
      ...base,
      status: "HISTORY_ONLY",
      label: "History only",
      stance: "Internal history is better than guessing, but it may be stale. Get a live rate before committing.",
      primaryEvidence: "HISTORY",
    };
  }
  return {
    ...base,
    status: "NONE",
    label: "No coverage",
    stance: "No quote, lane rate, or history supports this price yet. Pricing now is fake precision.",
    primaryEvidence: "NONE",
  };
}

function buildNegotiationPlan(args: {
  recommendation: StrategyRecommendation;
  missing: string[];
  currency: string;
  target: number | null;
  minMargin: number;
  buyCost: number | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  targetPosture: StrategyTargetPosture;
  coveragePosture: StrategyCoveragePosture;
  cargoMath: StrategyCargoMath | null;
  topRisk: string | null;
}): StrategyNegotiationPlan {
  const targetBuyLimit = args.target != null
    ? Math.round(args.target * (1 - Math.max(0, Math.min(85, args.minMargin)) / 100))
    : null;
  const leverage = [
    args.coveragePosture.status === "STRONG_LIVE" ? "Three or more live quotes support market comparison." : null,
    args.coveragePosture.status === "WORKABLE_LIVE" ? "Two live quotes create a workable pricing basis." : null,
    args.targetPosture.status === "GENEROUS" ? "Customer target leaves room above stretch margin." : null,
    args.targetPosture.status === "WITHIN_GUARDRAIL" ? "Customer target clears the floor." : null,
    args.cargoMath?.chargeableCbm != null && args.cargoMath.physicalCbm != null && args.cargoMath.chargeableCbm > args.cargoMath.physicalCbm
      ? "Chargeable CBM is explicit, so do not let non-stackable cargo be priced like raw CBM."
      : null,
  ].filter((item): item is string => Boolean(item));
  const recommended = money(args.recommendedPrice, args.currency);
  const floor = money(args.floorPrice, args.currency);
  const buy = money(args.buyCost, args.currency);
  const targetText = money(args.target, args.currency);
  const limitText = targetBuyLimit != null ? money(targetBuyLimit, args.currency) : "unknown";

  if (args.missing.length > 0 || args.recommendation === "ASK_CUSTOMER") {
    return {
      posture: "MATURE_FIRST",
      label: "Mature RFQ first",
      customerTalkTrack: `Before pricing, ask only for: ${args.missing.slice(0, 5).join(", ")}.`,
      forwarderCounter: "Do not send this to forwarders until the RFQ is mature.",
      internalGuardrail: "Missing RFQ facts make any price fake precision.",
      leverage,
      approvalRequired: false,
      targetBuyLimit,
    };
  }
  if (args.recommendation === "REQUEST_RATES" || args.buyCost == null) {
    return {
      posture: "GET_RATES",
      label: "Get live rates",
      customerTalkTrack: "Tell the customer we are checking agencies before committing a price.",
      forwarderCounter: "Request live buy rate, validity, service/transit, free time, and any cargo constraints.",
      internalGuardrail: `${args.coveragePosture.label}: ${args.coveragePosture.stance}`,
      leverage,
      approvalRequired: false,
      targetBuyLimit,
    };
  }
  if (args.recommendation === "ESCALATE") {
    return {
      posture: "ESCALATE",
      label: "Manager review",
      customerTalkTrack: `Do not commit price until risk is reviewed. Working quote is around ${recommended}.`,
      forwarderCounter: `Confirm the buy at ${buy}, service terms, and risk items before escalation closes.`,
      internalGuardrail: args.topRisk ?? "Risk is high enough to need review.",
      leverage,
      approvalRequired: true,
      targetBuyLimit,
    };
  }
  if (args.targetPosture.status === "BELOW_BUY" || args.targetPosture.status === "BELOW_FLOOR") {
    return {
      posture: "COUNTER_COST",
      label: "Counter cost or reset target",
      customerTalkTrack: `Target ${targetText} does not clear the floor. Workable quote is around ${recommended}; do not go below ${floor}.`,
      forwarderCounter: `To meet customer target with minimum margin, buy cost needs to be about ${limitText} or better. Current buy is ${buy}.`,
      internalGuardrail: `Floor is ${floor}; quoting below it destroys the margin guardrail.`,
      leverage,
      approvalRequired: true,
      targetBuyLimit,
    };
  }
  if (args.recommendation === "DECLINE") {
    return {
      posture: "DECLINE",
      label: "Park unless exception",
      customerTalkTrack: `Do not chase ${targetText}; it does not clear the economics.`,
      forwarderCounter: `Only reopen if buy cost can move near ${limitText} or service terms materially improve.`,
      internalGuardrail: args.topRisk ?? "Deal is below commercial guardrail.",
      leverage,
      approvalRequired: true,
      targetBuyLimit,
    };
  }
  if (args.targetPosture.status === "UNDER_RECOMMENDED" || args.coveragePosture.status === "THIN_LIVE") {
    return {
      posture: "PROTECT_FLOOR",
      label: "Protect floor",
      customerTalkTrack: `Quote near ${recommended}; if pressured, floor is ${floor} and needs approval.`,
      forwarderCounter: `Ask forwarder to sharpen below ${buy}, especially because coverage is ${args.coveragePosture.label.toLowerCase()}.`,
      internalGuardrail: `Do not discount below ${floor}; coverage or target pressure is not strong enough.`,
      leverage,
      approvalRequired: true,
      targetBuyLimit,
    };
  }
  return {
    posture: "SELL_CONFIDENTLY",
    label: "Sell confidently",
    customerTalkTrack: `Quote around ${recommended}; target and coverage support the posture. Avoid discounting below ${floor}.`,
    forwarderCounter: `Confirm validity/service at ${buy}; ask for improvement, but do not delay a customer quote if timing matters.`,
    internalGuardrail: `Floor is ${floor}; target posture is ${args.targetPosture.label}.`,
    leverage,
    approvalRequired: false,
    targetBuyLimit,
  };
}

function buildQuoteGate(args: {
  missing: string[];
  cargoMath: StrategyCargoMath | null;
  coveragePosture: StrategyCoveragePosture;
  rateFreshness: StrategyRateFreshness | null;
  targetPosture: StrategyTargetPosture;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  buyCost: number | null;
  highRisk: boolean;
  topRisk: string | null;
  negotiation: StrategyNegotiationPlan;
}): StrategyQuoteGate {
  const blockers = [...args.missing];
  if (args.cargoMath?.dimensionsPartial) blockers.push("Complete cargo dimensions");
  if (blockers.length > 0) {
    return {
      status: "BLOCKED",
      label: "Mature RFQ first",
      decision: "Do not send this to forwarders or quote the customer yet.",
      canSendToForwarders: false,
      canQuoteCustomer: false,
      requiresApproval: false,
      blockers,
      approvals: [],
      nextStep: `Ask customer for: ${blockers.slice(0, 5).join(", ")}.`,
    };
  }

  const hasLiveCost = args.buyCost != null && args.coveragePosture.primaryEvidence === "LIVE_QUOTES";
  if (args.buyCost == null || args.guardrailStatus === "NEEDS_COST" || !hasLiveCost) {
    const benchmarkOnly = args.coveragePosture.primaryEvidence === "LANE_RATE" || args.coveragePosture.primaryEvidence === "HISTORY";
    const staleQuotes = args.coveragePosture.primaryEvidence === "STALE_QUOTES";
    return {
      status: "NEEDS_RATES",
      label: staleQuotes ? "Refresh rates" : benchmarkOnly ? "Benchmark only" : "Need live rates",
      decision: "Mature enough to request rates, not mature enough to quote the customer.",
      canSendToForwarders: true,
      canQuoteCustomer: false,
      requiresApproval: false,
      blockers: staleQuotes ? ["No usable current forwarder quote"] : benchmarkOnly ? ["No live forwarder quote"] : ["No reliable live buy cost"],
      approvals: [],
      nextStep: staleQuotes
        ? "Refresh expired, stale, or unverified forwarder rates before customer quote."
        : benchmarkOnly
        ? "Request live forwarder rates before customer quote."
        : "Send mature RFQ to forwarders and wait for buy cost.",
    };
  }

  const approvals: string[] = [];
  if (args.guardrailStatus === "BLOCKED") approvals.push("Economics below floor");
  if (args.guardrailStatus === "REVIEW") approvals.push("Margin or coverage review");
  if (args.coveragePosture.status === "THIN_LIVE") approvals.push("Only one live quote");
  if (args.rateFreshness?.tone === "review") approvals.push(args.rateFreshness.label);
  if (args.targetPosture.status === "BELOW_BUY" || args.targetPosture.status === "BELOW_FLOOR") approvals.push(args.targetPosture.label);
  if (args.highRisk && args.topRisk) approvals.push(args.topRisk);
  if (args.negotiation.approvalRequired && approvals.length === 0) approvals.push("Negotiation approval required");

  if (approvals.length > 0) {
    return {
      status: "REVIEW_REQUIRED",
      label: "Review before quote",
      decision: "Do not send the customer quote without approval.",
      canSendToForwarders: true,
      canQuoteCustomer: false,
      requiresApproval: true,
      blockers: [],
      approvals: [...new Set(approvals)].slice(0, 5),
      nextStep: args.negotiation.internalGuardrail,
    };
  }

  return {
    status: "READY_TO_QUOTE",
    label: "Ready to quote",
    decision: "Customer quote can be prepared from the recommended price.",
    canSendToForwarders: true,
    canQuoteCustomer: true,
    requiresApproval: false,
    blockers: [],
    approvals: [],
    nextStep: args.negotiation.customerTalkTrack,
  };
}

function buildCargoMath(input: CommercialStrategyInput): StrategyCargoMath | null {
  const rows = parseDimensions(input.dimensions);
  const completeness = dimensionCompleteness(rows);
  const physicalCbm = totalCbm(rows);
  const chargeableCbm = totalChargeableCbm(rows, input.stackable);
  const storedVolume = typeof input.volume === "number" && Number.isFinite(input.volume) && input.volume > 0
    ? input.volume
    : null;
  const hasStackability = Boolean(input.stackable || input.topLoad);
  if (!completeness.enteredRows && storedVolume == null && !hasStackability) return null;

  return {
    physicalCbm: physicalCbm > 0 ? physicalCbm : null,
    chargeableCbm: chargeableCbm > 0 ? chargeableCbm : null,
    storedVolume,
    stackable: input.stackable ?? null,
    topLoad: input.topLoad ?? null,
    dimensionsComplete: completeness.hasCompleteDimensions,
    dimensionsPartial: completeness.hasPartialDimensions,
    completeRows: completeness.completeRows,
    enteredRows: completeness.enteredRows,
    source: completeness.hasCompleteDimensions
      ? "DIMENSIONS"
      : completeness.hasPartialDimensions
        ? "PARTIAL_DIMENSIONS"
        : storedVolume != null
          ? "STORED_VOLUME"
          : "STACKABILITY_ONLY",
  };
}

function quoteTotal(q: StrategyCarrierQuote): number | null {
  const n = q.total40HC ?? q.total40 ?? q.total20 ?? null;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

const DAY_MS = 86_400_000;

function asDate(input?: Date | string | null): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? new Date(input) : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function strategyAsOf(input: CommercialStrategyInput) {
  return asDate(input.asOf) ?? new Date();
}

function daysFromNow(input?: Date | string | null, asOf = new Date()): number | null {
  const d = asDate(input);
  if (!d) return null;
  return daysBetween(asOf, d);
}

function parseQuoteValidityTo(q: StrategyCarrierQuote, createdAt: Date | null) {
  const raw = q.validity?.trim();
  if (!raw) return null;

  const dayMatch = raw.match(/\b(\d{1,3})\s*(?:day|days|d)\b/i);
  if (dayMatch && createdAt) return addDays(createdAt, Number(dayMatch[1]));

  const untilMatch = raw.match(/\b(?:until|valid\s*(?:to|through)?|expires?)\s*:?\s*(.+)$/i);
  const candidate = untilMatch?.[1]?.trim() || raw;
  const parsed = asDate(candidate);
  return parsed;
}

function quoteFreshness(q: StrategyCarrierQuote, asOf: Date) {
  const createdAt = asDate(q.createdAt);
  const validTo = parseQuoteValidityTo(q, createdAt);
  const ageDays = createdAt ? Math.max(0, daysBetween(createdAt, asOf)) : null;
  const daysToExpiry = validTo ? daysBetween(asOf, validTo) : null;

  if (validTo && daysToExpiry != null) {
    if (daysToExpiry < 0) return { status: "expired" as const, createdAt, validTo, ageDays, daysToExpiry, reliable: false };
    if (daysToExpiry <= 3) return { status: "expiring" as const, createdAt, validTo, ageDays, daysToExpiry, reliable: true };
    return { status: "valid" as const, createdAt, validTo, ageDays, daysToExpiry, reliable: true };
  }

  if (ageDays != null && ageDays > 14) return { status: "stale" as const, createdAt, validTo, ageDays, daysToExpiry, reliable: false };
  return { status: "unknown" as const, createdAt, validTo, ageDays, daysToExpiry, reliable: ageDays != null && ageDays <= 3 };
}

function buildRateFreshness(quotes: StrategyCarrierQuote[], asOf: Date): StrategyRateFreshness | null {
  const received = quotes.filter((q) => q.status === "RECEIVED" && quoteTotal(q) != null);
  if (received.length === 0) return null;

  const statuses = received.map((quote) => quoteFreshness(quote, asOf));
  const validQuotes = statuses.filter((item) => item.status === "valid").length;
  const expiringQuotes = statuses.filter((item) => item.status === "expiring").length;
  const expiredQuotes = statuses.filter((item) => item.status === "expired").length;
  const staleQuotes = statuses.filter((item) => item.status === "stale").length;
  const unknownValidityQuotes = statuses.filter((item) => item.status === "unknown").length;
  const reliableLiveQuotes = statuses.filter((item) => item.reliable).length;
  const quoteDates = statuses.map((item) => item.createdAt).filter((date): date is Date => !!date);
  const expiries = statuses.map((item) => item.validTo).filter((date): date is Date => !!date);
  const ages = statuses.map((item) => item.ageDays).filter((age): age is number => age != null);
  const newestQuoteAt = quoteDates.length
    ? new Date(Math.max(...quoteDates.map((date) => date.getTime()))).toISOString()
    : null;
  const earliestExpiryAt = expiries.length
    ? new Date(Math.min(...expiries.map((date) => date.getTime()))).toISOString()
    : null;
  const oldestQuoteAgeDays = ages.length ? Math.max(...ages) : null;

  const metric = `${reliableLiveQuotes}/${received.length} usable`;
  if (reliableLiveQuotes === 0) {
    return {
      receivedQuotes: received.length,
      reliableLiveQuotes,
      validQuotes,
      expiringQuotes,
      expiredQuotes,
      staleQuotes,
      unknownValidityQuotes,
      newestQuoteAt,
      oldestQuoteAgeDays,
      earliestExpiryAt,
      tone: "blocked",
      label: "Refresh rates",
      metric,
      detail: expiredQuotes > 0 || staleQuotes > 0
        ? `${expiredQuotes} expired and ${staleQuotes} stale quote${expiredQuotes + staleQuotes === 1 ? "" : "s"} cannot support a customer quote.`
        : "Received quotes have no usable validity or quote date; treat them as untrusted until refreshed.",
    };
  }

  if (expiredQuotes > 0 || staleQuotes > 0 || expiringQuotes > 0 || unknownValidityQuotes > 0) {
    return {
      receivedQuotes: received.length,
      reliableLiveQuotes,
      validQuotes,
      expiringQuotes,
      expiredQuotes,
      staleQuotes,
      unknownValidityQuotes,
      newestQuoteAt,
      oldestQuoteAgeDays,
      earliestExpiryAt,
      tone: "review",
      label: expiringQuotes > 0 ? "Rates expiring" : "Rate validity mixed",
      metric,
      detail: `${validQuotes} valid, ${expiringQuotes} expiring, ${expiredQuotes} expired, ${staleQuotes} stale, ${unknownValidityQuotes} missing validity.`,
    };
  }

  return {
    receivedQuotes: received.length,
    reliableLiveQuotes,
    validQuotes,
    expiringQuotes,
    expiredQuotes,
    staleQuotes,
    unknownValidityQuotes,
    newestQuoteAt,
    oldestQuoteAgeDays,
    earliestExpiryAt,
    tone: "ready",
    label: "Rates current",
    metric,
    detail: "Received forwarder rates have usable validity for pricing.",
  };
}

function norm(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isSameLane(a: { origin?: string | null; destination?: string | null; mode?: string | null }, b: { origin?: string | null; destination?: string | null; mode?: string | null }) {
  const modeOk = !a.mode || !b.mode || norm(a.mode) === norm(b.mode);
  const originOk = !!a.origin && !!b.origin && (norm(a.origin).includes(norm(b.origin)) || norm(b.origin).includes(norm(a.origin)));
  const destOk = !!a.destination && !!b.destination && (norm(a.destination).includes(norm(b.destination)) || norm(b.destination).includes(norm(a.destination)));
  return modeOk && originOk && destOk;
}

function marginPct(revenue: number | null, cost: number | null) {
  if (!revenue || !cost || revenue <= 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

function priceForMargin(cost: number, margin: number) {
  const safeMargin = Math.max(1, Math.min(85, margin));
  return cost / (1 - safeMargin / 100);
}

function riskLevel(score: number): RiskLevel {
  if (score >= 82) return "CRITICAL";
  if (score >= 62) return "HIGH";
  if (score >= 36) return "MEDIUM";
  return "LOW";
}

export function requiredRfqMissing(input: CommercialStrategyInput) {
  const qualification = qualifyRfq({
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
    targetPrice: input.targetPrice,
    targetPriceStatus: input.targetPriceStatus,
  });
  return [
    ...qualification.missing.map((m) => m[0]?.toUpperCase() + m.slice(1)),
    ...(qualification.targetPriceQuestion ? ["Target price or no-target confirmation"] : []),
  ];
}

function buildRouteOptions(input: CommercialStrategyInput, currency: string): StrategyRouteOption[] {
  const route = input.origin || input.destination ? `${input.origin ?? "?"} to ${input.destination ?? "?"}` : null;
  const asOf = strategyAsOf(input);
  const received = (input.carrierQuotes ?? [])
    .filter((q) => q.status === "RECEIVED" && quoteTotal(q) != null)
    .map((q): StrategyRouteOption => {
      const cost = quoteTotal(q);
      const freshness = quoteFreshness(q, asOf);
      const transitPenalty = q.transitDays == null ? 10 : q.transitDays > 35 ? 22 : q.transitDays > 21 ? 12 : 4;
      const transshipPenalty = q.transshipments ? 10 : 0;
      const freshnessRisk =
        freshness.status === "expired" || freshness.status === "stale" ? 36 :
        freshness.status === "unknown" ? 14 :
        freshness.status === "expiring" ? 10 :
        0;
      const risk = clamp(18 + transitPenalty + transshipPenalty + freshnessRisk);
      const reliability = clamp(84 - transitPenalty - transshipPenalty + (q.service ? 4 : 0) - freshnessRisk);
      const confidence: StrategyRouteOption["confidence"] =
        freshness.status === "expired" || freshness.status === "stale" ? "low" :
        freshness.status === "unknown" || freshness.status === "expiring" ? "medium" :
        "high";
      const tradeoff =
        freshness.status === "expired" ? "Received price is expired; use as context only and refresh before customer quote." :
        freshness.status === "stale" ? "Received price is stale; use as context only and refresh before customer quote." :
        freshness.status === "unknown" ? "Received price lacks clear validity; confirm before relying on it." :
        freshness.status === "expiring" ? "Received price is usable but expiring soon; quote only after validity review." :
        risk >= 48 ? "Priced option, but transit/service risk needs review." :
        "Best evidence because this is a current received forwarder price.";
      return {
        label: q.carrier ?? q.rateName ?? "Forwarder quote",
        route,
        mode: input.mode ?? null,
        provider: q.carrier ?? null,
        source: "RECEIVED_QUOTE",
        carrierQuoteId: q.id ?? null,
        cost,
        currency,
        transitDays: q.transitDays ?? null,
        reliabilityScore: reliability,
        riskScore: risk,
        confidence,
        tradeoff,
        evidence: {
          service: q.service,
          validity: q.validity,
          transshipments: q.transshipments,
          rateFreshnessStatus: freshness.status,
          rateReliable: freshness.reliable,
          daysToExpiry: freshness.daysToExpiry,
          quoteAgeDays: freshness.ageDays,
          validTo: freshness.validTo?.toISOString() ?? null,
        },
      };
    });

  const laneMatches = (input.laneRates ?? [])
    .filter((r) => isSameLane(input, r) && typeof r.baseAmount === "number" && r.baseAmount > 0)
    .map((r): StrategyRouteOption => ({
      label: `Lane rate${r.notes ? ` - ${r.notes.slice(0, 40)}` : ""}`,
      route,
      mode: r.mode ?? input.mode ?? null,
      provider: null,
      source: "LANE_RATE",
      cost: r.baseAmount ?? null,
      currency: r.currency ?? currency,
      transitDays: null,
      reliabilityScore: 62,
      riskScore: 42,
      confidence: "medium",
      tradeoff: "Useful benchmark, but it is not a live forwarder quote.",
      evidence: { laneRateId: r.id, validTo: r.validTo },
    }));

  const history = (input.historicalJobs ?? [])
    .filter((j) => isSameLane(input, j) && typeof j.cost === "number" && j.cost > 0)
    .slice(0, 5)
    .map((j): StrategyRouteOption => ({
      label: j.reference ? `Historical job ${j.reference}` : "Historical lane cost",
      route,
      mode: j.mode ?? input.mode ?? null,
      provider: null,
      source: "HISTORY",
      cost: j.cost ?? null,
      currency: j.currency ?? currency,
      transitDays: null,
      reliabilityScore: 58,
      riskScore: 46,
      confidence: "medium",
      tradeoff: "Internal history is better than guessing, but it may be stale.",
      evidence: { historicalJobId: j.id, revenue: j.revenue, marginPct: marginPct(j.revenue ?? null, j.cost ?? null) },
    }));

  const options = [...received, ...laneMatches, ...history];
  if (options.length > 0) {
    return options.sort((a, b) => {
      const priority = (option: StrategyRouteOption) => {
        if (option.source === "RECEIVED_QUOTE") return option.evidence?.rateReliable === true ? 0 : 3;
        if (option.source === "LANE_RATE") return 1;
        if (option.source === "HISTORY") return 2;
        return 4;
      };
      const priorityDiff = priority(a) - priority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const aCost = a.cost ?? Infinity;
      const bCost = b.cost ?? Infinity;
      const aAdj = aCost * (1 + a.riskScore / 500) - a.reliabilityScore * 2;
      const bAdj = bCost * (1 + b.riskScore / 500) - b.reliabilityScore * 2;
      return aAdj - bAdj;
    });
  }

  return [{
    label: "No priced route yet",
    route,
    mode: input.mode ?? null,
    provider: null,
    source: "FALLBACK",
    cost: null,
    currency,
    transitDays: null,
    reliabilityScore: 20,
    riskScore: 78,
    confidence: "low",
    tradeoff: "No received quote, lane rate, or historical cost. Any customer price would be a guess.",
  }];
}

function buildRisks(input: CommercialStrategyInput, args: {
  missing: string[];
  receivedQuotes: number;
  rateFreshness: StrategyRateFreshness | null;
  laneRateMatches: number;
  historicalLaneJobs: number;
  target: number | null;
  floorPrice: number | null;
  buyCost: number | null;
  marginAtTarget: number | null;
}): StrategyRisk[] {
  const risks: StrategyRisk[] = [];
  const push = (category: StrategyRisk["category"], score: number, reason: string, mitigation: string, evidence?: Record<string, unknown>) => {
    risks.push({ category, score: clamp(score), level: riskLevel(score), reason, mitigation, evidence });
  };

  if (args.missing.length > 0) {
    push("CONFIDENCE", Math.min(96, 52 + args.missing.length * 8), `Missing pricing-critical facts: ${args.missing.slice(0, 4).join(", ")}.`, "Ask the customer for the missing facts before quoting or forwarding.", { missing: args.missing });
  }
  if (input.dangerousGoods === "YES") {
    push("CARGO", 72, "Dangerous goods cargo adds compliance, carrier acceptance, and documentation risk.", "Confirm UN/class/MSDS and quote with DG-capable forwarders only.");
  }
  if (input.stackable === "NO") {
    const rows = parseDimensions(input.dimensions);
    const completeness = dimensionCompleteness(rows);
    const cbm = totalChargeableCbm(rows, input.stackable);
    push(
      "CARGO",
      completeness.hasPartialDimensions ? 68 : 55,
      completeness.hasPartialDimensions
        ? "Non-stackable cargo has incomplete dimensions, so chargeable CBM is not reliable."
        : "Non-stackable cargo can price like floor-space, not raw CBM.",
      completeness.hasPartialDimensions
        ? "Get complete quantity, length, width, and height before using chargeable CBM."
        : "Use chargeable CBM and confirm top-load constraints before quoting.",
      cbm ? { chargeableCbm: cbm, ...completeness } : completeness
    );
  }
  if (input.customsBy === "US") {
    push("ROUTE", 46, "Derya owns customs responsibility on this deal.", "Build customs time/cost risk into the quote and follow-up plan.");
  }
  if (input.customsBy === "UNKNOWN" || !input.customsBy) {
    push("CONFIDENCE", 52, "Customs responsibility is not confirmed.", "Ask who owns customs before quoting final terms.");
  }
  const readyIn = daysFromNow(input.cargoReadyDate);
  if (readyIn != null && readyIn >= 0 && readyIn <= 3) {
    push("TIMING", 66, "Cargo-ready timing is tight.", "Request expedited rates and warn the customer about capacity/validity risk.", { daysUntilReady: readyIn });
  }
  if (args.buyCost == null) {
    push("COMMERCIAL", 82, "No reliable buy cost is available.", "Get at least one live forwarder quote or matching lane benchmark before sending a customer price.");
  }
  if (args.receivedQuotes === 1) {
    push("CONFIDENCE", 48, "Only one received forwarder quote is available.", "Get at least two more quotes unless the customer deadline forces a tactical quote.");
  } else if (args.receivedQuotes === 0) {
    push("CONFIDENCE", 68, "No received forwarder quote is available.", "Request rates before quoting the customer.");
  }
  if (args.rateFreshness?.tone === "blocked") {
    push("CONFIDENCE", 74, args.rateFreshness.detail, "Refresh forwarder rates before using them as buy-cost evidence.", {
      reliableLiveQuotes: args.rateFreshness.reliableLiveQuotes,
      receivedQuotes: args.rateFreshness.receivedQuotes,
    });
  } else if (args.rateFreshness?.tone === "review") {
    push("CONFIDENCE", 54, args.rateFreshness.detail, "Confirm validity or refresh expiring/stale quotes before sending a customer quote.", {
      reliableLiveQuotes: args.rateFreshness.reliableLiveQuotes,
      receivedQuotes: args.rateFreshness.receivedQuotes,
    });
  }
  if (args.historicalLaneJobs === 0 && args.laneRateMatches === 0) {
    push("ROUTE", 44, "No internal lane history or lane rate matched this route.", "Treat this as an unknown lane and protect margin until real quotes arrive.");
  }
  if (args.target != null && args.buyCost != null && args.target <= args.buyCost) {
    push("COMMERCIAL", 92, "Customer target is at or below buy cost.", "Do not quote at target. Counter the forwarder or reset customer expectations.", { target: args.target, buyCost: args.buyCost });
  } else if (args.marginAtTarget != null && args.marginAtTarget < 8) {
    push("COMMERCIAL", 76, `Target margin is thin at ${args.marginAtTarget.toFixed(1)}%.`, "Negotiate cost or escalate before sending a customer quote.", { marginPct: args.marginAtTarget });
  }
  if (!input.companyId && !input.companyName && !input.fromCompany) {
    push("CUSTOMER", 40, "Customer is not identified.", "Link or create the customer before giving strategic pricing weight.");
  }
  if (input.customerStats?.known && input.customerStats.jobs >= 3 && (input.customerStats.avgMarginPct ?? 99) < 8) {
    push("CUSTOMER", 58, "Customer history shows low average margin.", "Use tighter guardrails and avoid discounting unless there is strategic upside.", { avgMarginPct: input.customerStats.avgMarginPct });
  }

  return risks.sort((a, b) => b.score - a.score);
}

function buildActions(strategy: {
  recommendation: StrategyRecommendation;
  missing: string[];
  receivedQuotes: number;
  pendingQuotes: number;
  rateFreshness: StrategyRateFreshness | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  target: number | null;
  currency: string;
  highRisk: boolean;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
}): StrategyAction[] {
  const actions: StrategyAction[] = [];
  if (strategy.missing.length > 0) {
    actions.push({
      actionType: "ASK_CUSTOMER",
      priority: "critical",
      title: "Ask customer for missing pricing facts",
      rationale: `The strategy is capped until these are confirmed: ${strategy.missing.slice(0, 5).join(", ")}.`,
      requiresApproval: true,
      payload: { missing: strategy.missing },
    });
  }
  if (strategy.receivedQuotes < 3) {
    actions.push({
      actionType: "REQUEST_RATES",
      priority: strategy.receivedQuotes === 0 ? "high" : "medium",
      title: strategy.receivedQuotes === 0 ? "Request live forwarder rates" : "Increase quote coverage",
      rationale: `${strategy.receivedQuotes} received quote${strategy.receivedQuotes === 1 ? "" : "s"} is not enough coverage for confident pricing.`,
      requiresApproval: true,
      payload: { currentReceivedQuotes: strategy.receivedQuotes, pendingQuotes: strategy.pendingQuotes },
    });
  }
  if (strategy.rateFreshness?.tone === "blocked") {
    actions.push({
      actionType: "REQUEST_RATES",
      priority: "high",
      title: "Refresh unusable forwarder rates",
      rationale: strategy.rateFreshness.detail,
      requiresApproval: true,
      payload: {
        reliableLiveQuotes: strategy.rateFreshness.reliableLiveQuotes,
        receivedQuotes: strategy.rateFreshness.receivedQuotes,
      },
    });
  } else if (strategy.rateFreshness?.tone === "review") {
    actions.push({
      actionType: "REQUEST_RATES",
      priority: "medium",
      title: "Confirm rate validity",
      rationale: strategy.rateFreshness.detail,
      requiresApproval: true,
      payload: {
        reliableLiveQuotes: strategy.rateFreshness.reliableLiveQuotes,
        receivedQuotes: strategy.rateFreshness.receivedQuotes,
      },
    });
  }
  if (strategy.guardrailStatus === "BLOCKED") {
    actions.push({
      actionType: "COUNTER_FORWARDER",
      priority: "critical",
      title: "Negotiate buy cost or reset customer target",
      rationale: `The current economics do not clear the floor price${strategy.floorPrice ? ` (${money(strategy.floorPrice, strategy.currency)})` : ""}.`,
      requiresApproval: true,
      payload: { target: strategy.target, floorPrice: strategy.floorPrice },
    });
  }
  if (strategy.highRisk) {
    actions.push({
      actionType: "ESCALATE",
      priority: "high",
      title: "Manager review before quote",
      rationale: "Risk is high enough that a normal quote workflow can hide bad economics or service exposure.",
      requiresApproval: true,
      payload: { reason: "high_strategy_risk" },
    });
  }
  if (strategy.recommendation === "QUOTE" && strategy.recommendedPrice != null) {
    actions.push({
      actionType: "QUOTE_CUSTOMER",
      priority: "high",
      title: "Prepare customer quote",
      rationale: `Recommended customer price is ${money(strategy.recommendedPrice, strategy.currency)}.`,
      requiresApproval: true,
      payload: { recommendedPrice: strategy.recommendedPrice, currency: strategy.currency },
    });
  }
  if (strategy.recommendation === "DECLINE") {
    actions.push({
      actionType: "DECLINE",
      priority: "critical",
      title: "Decline or park the deal",
      rationale: "The deal is below guardrail and too risky to chase without a strategic exception.",
      requiresApproval: true,
      payload: { target: strategy.target, floorPrice: strategy.floorPrice },
    });
  }
  return actions.slice(0, 6);
}

function buildOperatorDecision(args: {
  quoteGate: StrategyQuoteGate;
  negotiation: StrategyNegotiationPlan;
  actions: StrategyAction[];
  recommendation: StrategyRecommendation;
  currency: string;
  buyCost: number | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  target: number | null;
  targetPosture: StrategyTargetPosture;
  coveragePosture: StrategyCoveragePosture;
  topRisk: string | null;
}): StrategyOperatorDecision {
  const primaryAction = args.actions[0] ?? null;
  const commonPayload = {
    quoteGate: args.quoteGate.status,
    target: args.target,
    targetPosture: args.targetPosture.status,
    coveragePosture: args.coveragePosture.status,
    buyCost: args.buyCost,
    floorPrice: args.floorPrice,
    recommendedPrice: args.recommendedPrice,
    currency: args.currency,
  };

  if (args.quoteGate.status === "BLOCKED") {
    const missing = args.quoteGate.blockers.slice(0, 6);
    return {
      phase: "MATURE_RFQ",
      actionType: "ASK_CUSTOMER",
      priority: "critical",
      owner: "CUSTOMER",
      title: "Mature the RFQ",
      command: `Ask the customer for ${missing.join(", ")} before pricing or forwarding this load.`,
      rationale: "Pricing before RFQ maturity is fake precision; the agent must not invent missing cargo or route facts.",
      ctaLabel: "Draft missing-info request",
      toolHint: "draft_missing_info_request",
      surfaceHint: "rfq_missing_info",
      canRunNow: true,
      requiresApproval: true,
      blockers: missing,
      approvals: [],
      payload: { ...commonPayload, missingFields: args.quoteGate.blockers },
    };
  }

  if (args.quoteGate.status === "NEEDS_RATES") {
    return {
      phase: "GET_RATES",
      actionType: "REQUEST_RATES",
      priority: args.coveragePosture.primaryEvidence === "LIVE_QUOTES" ? "medium" : "high",
      owner: "FORWARDER",
      title: args.quoteGate.label === "Benchmark only" ? "Convert benchmark into live rates" : "Get live forwarder rates",
      command: args.quoteGate.nextStep,
      rationale: "Benchmarks and history can frame the lane, but the customer quote needs a live buy cost.",
      ctaLabel: "Create forwarder drafts",
      toolHint: "create_forwarder_drafts",
      surfaceHint: "pricing_forwarder_drafts",
      canRunNow: true,
      requiresApproval: true,
      blockers: args.quoteGate.blockers,
      approvals: [],
      payload: { ...commonPayload, pendingQuotes: args.coveragePosture.pendingQuotes },
    };
  }

  if (args.quoteGate.status === "REVIEW_REQUIRED") {
    const reviewReason = args.quoteGate.approvals[0] ?? args.topRisk ?? "Strategy review required";
    const title =
      args.targetPosture.status === "BELOW_BUY" || args.targetPosture.status === "BELOW_FLOOR"
        ? "Fix economics before customer quote"
        : "Approve quote guardrail";
    return {
      phase: "APPROVE_ECONOMICS",
      actionType: primaryAction?.actionType === "COUNTER_FORWARDER" ? "COUNTER_FORWARDER" : "ESCALATE",
      priority: primaryAction?.priority === "critical" ? "critical" : "high",
      owner: "INTERNAL",
      title,
      command: args.negotiation.internalGuardrail,
      rationale: reviewReason,
      ctaLabel: "Draft negotiation plan",
      toolHint: "draft_negotiation_plan",
      surfaceHint: "pricing_review",
      canRunNow: true,
      requiresApproval: true,
      blockers: [],
      approvals: args.quoteGate.approvals,
      payload: { ...commonPayload, reviewReason, forwarderCounter: args.negotiation.forwarderCounter },
    };
  }

  if (args.recommendation === "DECLINE") {
    return {
      phase: "PARK_DEAL",
      actionType: "DECLINE",
      priority: "critical",
      owner: "INTERNAL",
      title: "Park the deal",
      command: "Do not chase this unless there is a deliberate strategic exception.",
      rationale: args.topRisk ?? "The strategy is below guardrail.",
      ctaLabel: "Record decline reason",
      toolHint: "draft_negotiation_plan",
      surfaceHint: "deal_parking",
      canRunNow: true,
      requiresApproval: true,
      blockers: [],
      approvals: ["Strategic exception needed"],
      payload: commonPayload,
    };
  }

  const quotedPrice = args.recommendedPrice != null ? money(args.recommendedPrice, args.currency) : "the recommended price";
  return {
    phase: "QUOTE_CUSTOMER",
    actionType: "QUOTE_CUSTOMER",
    priority: "high",
    owner: "CUSTOMER",
    title: "Prepare customer quote",
    command: `Quote the customer around ${quotedPrice} and protect the floor.`,
    rationale: args.quoteGate.decision,
    ctaLabel: "Prepare customer quote",
    toolHint: "draft_customer_quote",
    surfaceHint: "customer_quote",
    canRunNow: true,
    requiresApproval: false,
    blockers: [],
    approvals: [],
    payload: commonPayload,
  };
}

function buildDecisionReasons(args: {
  quoteGate: StrategyQuoteGate;
  operatorDecision: StrategyOperatorDecision;
  coveragePosture: StrategyCoveragePosture;
  rateFreshness: StrategyRateFreshness | null;
  targetPosture: StrategyTargetPosture;
  targetTrail: StrategyTargetTrail | null;
  decisionQuality: StrategyEvidenceCheck;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  buyCost: number | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  currency: string;
  topRisk: StrategyRisk | null;
}): StrategyDecisionReason[] {
  const reasons: StrategyDecisionReason[] = [];
  const push = (reason: StrategyDecisionReason) => reasons.push(reason);
  const priceDetail = args.buyCost == null
    ? "No dependable buy cost is available."
    : `Buy ${money(args.buyCost, args.currency)}, floor ${money(args.floorPrice, args.currency)}, recommended ${money(args.recommendedPrice, args.currency)}.`;

  push({
    key: "maturity",
    label: "RFQ gate",
    tone: args.quoteGate.status === "BLOCKED" ? "blocker" : "support",
    summary: args.quoteGate.label,
    detail: args.quoteGate.status === "BLOCKED"
      ? `Blocks forwarders and customer quote: ${args.quoteGate.blockers.slice(0, 4).join(", ")}.`
      : "RFQ facts are mature enough for the current next step.",
  });

  const coverageTone =
    args.coveragePosture.status === "NONE" ? "blocker" :
    ["PENDING_ONLY", "HISTORY_ONLY", "BENCHMARK_ONLY", "STALE_LIVE", "THIN_LIVE"].includes(args.coveragePosture.status) ? "review" :
    "support";
  push({
    key: "coverage",
    label: "Market evidence",
    tone: coverageTone,
    summary: args.coveragePosture.label,
    detail: args.coveragePosture.stance,
  });

  if (args.rateFreshness) {
    push({
      key: "rates",
      label: "Rate freshness",
      tone: args.rateFreshness.tone === "blocked" ? "blocker" : args.rateFreshness.tone === "review" ? "review" : args.rateFreshness.tone === "ready" ? "support" : "info",
      summary: args.rateFreshness.label,
      detail: args.rateFreshness.detail,
    });
  }

  const targetTone =
    args.targetPosture.status === "MISSING" || args.targetPosture.status === "BELOW_BUY" || args.targetPosture.status === "BELOW_FLOOR" ? "blocker" :
    args.targetPosture.status === "UNDER_RECOMMENDED" || args.targetPosture.status === "UNPRICED" ? "review" :
    args.targetPosture.status === "NO_TARGET" ? "info" :
    "support";
  push({
    key: "target",
    label: "Target price",
    tone: targetTone,
    summary: args.targetPosture.label,
    detail: args.targetPosture.stance,
  });

  const economicsTone =
    args.guardrailStatus === "BLOCKED" || args.guardrailStatus === "NEEDS_COST" ? "blocker" :
    args.guardrailStatus === "REVIEW" ? "review" :
    "support";
  push({
    key: "economics",
    label: "Margin guardrail",
    tone: economicsTone,
    summary: args.guardrailStatus.toLowerCase().replace("_", " "),
    detail: priceDetail,
  });

  if (args.topRisk) {
    push({
      key: "risk",
      label: "Top risk",
      tone: args.topRisk.score >= 70 ? "blocker" : args.topRisk.score >= 45 ? "review" : "info",
      summary: args.topRisk.level.toLowerCase(),
      detail: `${args.topRisk.reason} ${args.topRisk.mitigation}`,
    });
  } else {
    push({
      key: "risk",
      label: "Top risk",
      tone: "support",
      summary: "No dominant risk",
      detail: "No risk item currently overrides the commercial decision.",
    });
  }

  push({
    key: "decision_quality",
    label: "Decision quality",
    tone: args.decisionQuality.tone === "blocked"
      ? "blocker"
      : args.decisionQuality.tone === "review"
        ? "review"
        : args.decisionQuality.tone === "info"
          ? "info"
          : "support",
    summary: operatorMetricLabel(args.decisionQuality.metric, args.decisionQuality.tone),
    detail: args.decisionQuality.detail,
  });

  push({
    key: "agent",
    label: "Agent move",
    tone: args.operatorDecision.blockers.length > 0 ? "blocker" : args.operatorDecision.requiresApproval ? "review" : "support",
    summary: args.operatorDecision.ctaLabel,
    detail: `${args.operatorDecision.owner.toLowerCase()} owned - ${args.operatorDecision.rationale}`,
  });

  if (args.targetTrail && args.targetTrail.tone !== "info") {
    push({
      key: "target_trail",
      label: "Target trail",
      tone: args.targetTrail.tone === "blocked" ? "blocker" : args.targetTrail.tone === "review" ? "review" : "support",
      summary: args.targetTrail.label,
      detail: args.targetTrail.detail,
    });
  }

  const priority = { blocker: 0, review: 1, support: 2, info: 3 };
  return reasons
    .sort((a, b) => priority[a.tone] - priority[b.tone])
    .slice(0, 7);
}

function cbm(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "No CBM";
  return `${value.toFixed(3)} CBM`;
}

function buildDecisionQualityCheck(args: {
  quoteGate: StrategyQuoteGate;
  confidenceComponent: number;
  missing: string[];
  coveragePosture: StrategyCoveragePosture;
  rateFreshness: StrategyRateFreshness | null;
  targetPosture: StrategyTargetPosture;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  topRisk: StrategyRisk | null;
  documentReadiness: DocumentReadiness | null;
}): StrategyEvidenceCheck {
  const levers = [
    args.missing.length > 0 ? `RFQ facts are missing (${args.missing.slice(0, 3).join(", ")})` : null,
    ["NONE", "PENDING_ONLY", "HISTORY_ONLY", "BENCHMARK_ONLY", "STALE_LIVE", "THIN_LIVE"].includes(args.coveragePosture.status)
      ? `market evidence is ${args.coveragePosture.label.toLowerCase()}`
      : null,
    args.rateFreshness && args.rateFreshness.tone !== "ready"
      ? `rate freshness is ${args.rateFreshness.label.toLowerCase()}`
      : null,
    ["MISSING", "BELOW_BUY", "BELOW_FLOOR", "UNDER_RECOMMENDED", "UNPRICED"].includes(args.targetPosture.status)
      ? `target posture is ${args.targetPosture.label.toLowerCase()}`
      : null,
    args.guardrailStatus !== "PASS"
      ? `margin guardrail is ${args.guardrailStatus.toLowerCase().replace("_", " ")}`
      : null,
    args.topRisk && args.topRisk.score >= 45
      ? `top risk is ${args.topRisk.level.toLowerCase()}`
      : null,
    args.documentReadiness && args.documentReadiness.tone !== "ready"
      ? `document proof is ${args.documentReadiness.label.toLowerCase()}`
      : null,
  ].filter((item): item is string => Boolean(item));

  const confidence = clamp(args.confidenceComponent);
  const quoteBlocked = args.quoteGate.status === "BLOCKED";
  const tone: StrategyEvidenceCheck["tone"] =
    quoteBlocked || confidence < 40
      ? "blocked"
      : args.quoteGate.requiresApproval || confidence < 68 || levers.length > 0
        ? "review"
        : "ready";
  const label =
    tone === "blocked"
      ? "Decision not defensible"
      : tone === "review"
        ? "Decision needs proof"
        : "Decision defensible";
  const detail =
    levers.length > 0
      ? `Current recommendation can change if ${levers.slice(0, 4).join("; ")}. Do not let the score impersonate certainty.`
      : "Current recommendation is supported by RFQ facts, live coverage, margin, risk, and proof checks.";

  return {
    key: "decision_quality",
    label: "Decision quality",
    tone,
    metric: `${confidence}/100`,
    detail,
  };
}

function buildEvidenceChecks(args: {
  missing: string[];
  maturity: number;
  mode?: string | null;
  cargoMath: StrategyCargoMath | null;
  targetPosture: StrategyTargetPosture;
  targetTrail: StrategyTargetTrail | null;
  coveragePosture: StrategyCoveragePosture;
  rateFreshness: StrategyRateFreshness | null;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  buyCost: number | null;
  recommendedPrice: number | null;
  currency: string;
  topRisk: StrategyRisk | null;
  documentReadiness: DocumentReadiness | null;
  decisionQuality: StrategyEvidenceCheck;
}): StrategyEvidenceCheck[] {
  const mode = (args.mode ?? "").toUpperCase();
  const cargoNeedsCbm = mode.includes("LCL") || mode.includes("AIR") || mode.includes("ROAD") || mode.includes("TRUCK");
  const cargoMetric = args.cargoMath
    ? cbm(args.cargoMath.chargeableCbm ?? args.cargoMath.storedVolume ?? args.cargoMath.physicalCbm)
    : cargoNeedsCbm ? "No cargo math" : "Container basis";
  const cargoTone: StrategyEvidenceCheck["tone"] =
    args.cargoMath?.dimensionsPartial ? "blocked" :
    args.cargoMath?.dimensionsComplete || args.cargoMath?.chargeableCbm != null ? "ready" :
    args.cargoMath?.storedVolume != null ? "review" :
    cargoNeedsCbm ? "review" : "info";
  const targetTone: StrategyEvidenceCheck["tone"] =
    args.targetPosture.status === "MISSING" || args.targetPosture.status === "BELOW_BUY" ? "blocked" :
    ["BELOW_FLOOR", "UNDER_RECOMMENDED", "UNPRICED"].includes(args.targetPosture.status) ? "review" :
    args.targetPosture.status === "NO_TARGET" ? "info" :
    "ready";
  const coverageTone: StrategyEvidenceCheck["tone"] =
    args.coveragePosture.status === "NONE" ? "blocked" :
    ["PENDING_ONLY", "HISTORY_ONLY", "BENCHMARK_ONLY", "THIN_LIVE"].includes(args.coveragePosture.status) ? "review" :
    "ready";
  const economicsTone: StrategyEvidenceCheck["tone"] =
    args.guardrailStatus === "PASS" ? "ready" :
    args.guardrailStatus === "REVIEW" ? "review" :
    "blocked";
  const riskTone: StrategyEvidenceCheck["tone"] =
    !args.topRisk ? "ready" :
    args.topRisk.score >= 70 ? "blocked" :
    args.topRisk.score >= 45 ? "review" :
    "ready";

  const checks: StrategyEvidenceCheck[] = [
    {
      key: "rfq",
      label: "RFQ facts",
      tone: args.missing.length > 0 ? "blocked" : "ready",
      metric: `${args.maturity}/100`,
      detail: args.missing.length > 0
        ? `Missing ${args.missing.slice(0, 4).join(", ")}${args.missing.length > 4 ? "..." : ""}.`
        : "Origin, destination, cargo, DG, customs, and target posture are usable.",
    },
    {
      key: "cargo",
      label: "Cargo math",
      tone: cargoTone,
      metric: cargoMetric,
      detail: args.cargoMath?.dimensionsPartial
        ? "Partial dimensions block chargeable CBM; do not price this as complete."
        : args.cargoMath?.chargeableCbm != null
          ? `Source ${args.cargoMath.source.toLowerCase().replace(/_/g, " ")}; stackable ${args.cargoMath.stackable ?? "unknown"}.`
          : cargoNeedsCbm
            ? "Mode needs chargeable cargo math before pricing gets serious."
            : "FCL can proceed from equipment count, but weight still matters.",
    },
    {
      key: "target",
      label: "Customer target",
      tone: targetTone,
      metric: args.targetPosture.target == null ? args.targetPosture.label : money(args.targetPosture.target, args.targetPosture.currency),
      detail: args.targetPosture.stance,
    },
    ...(args.targetTrail ? [{
      key: "target_trail" as const,
      label: "Target trail",
      tone: args.targetTrail.tone,
      metric: args.targetTrail.metric,
      detail: args.targetTrail.detail,
    }] : []),
    {
      key: "coverage",
      label: "Market coverage",
      tone: coverageTone,
      metric: `${args.coveragePosture.reliableLiveQuotes}/${args.coveragePosture.receivedQuotes} usable / ${args.coveragePosture.pendingQuotes} pending`,
      detail: args.coveragePosture.stance,
    },
    ...(args.rateFreshness ? [{
      key: "rate_freshness" as const,
      label: "Rate freshness",
      tone: args.rateFreshness.tone,
      metric: args.rateFreshness.metric,
      detail: args.rateFreshness.detail,
    }] : []),
    {
      key: "economics",
      label: "Margin guardrail",
      tone: economicsTone,
      metric: args.buyCost == null ? "No buy cost" : money(args.recommendedPrice, args.currency),
      detail: args.buyCost == null
        ? "No dependable cost source; any customer quote would be theater."
        : `Guardrail is ${args.guardrailStatus.toLowerCase().replace("_", " ")}.`,
    },
    {
      key: "risk",
      label: "Risk control",
      tone: riskTone,
      metric: args.topRisk ? `${args.topRisk.level.toLowerCase()} ${args.topRisk.score}` : "Low",
      detail: args.topRisk
        ? `${args.topRisk.reason} ${args.topRisk.mitigation}`
        : "No risk item currently overrides the commercial action.",
    },
  ];

  if (args.documentReadiness) {
    checks.push({
      key: "documents",
      label: "Document proof",
      tone: args.documentReadiness.tone,
      metric: args.documentReadiness.metric,
      detail: args.documentReadiness.detail,
    });
  }

  checks.push(args.decisionQuality);

  return checks;
}

const BLOCKER_RESOLUTION_GUIDANCE: Record<RfqMaturityCheckKey, {
  score: number;
  owner: StrategyBlockerResolution["owner"];
  ask: string;
  why: string;
}> = {
  mode: {
    score: 100,
    owner: "CUSTOMER",
    ask: "Please confirm whether this is FCL, LCL, air, road, or courier.",
    why: "Mode decides which pricing logic, forwarders, and cargo questions apply.",
  },
  origin: {
    score: 96,
    owner: "CUSTOMER",
    ask: "Please confirm the pickup/origin location.",
    why: "No lane can be priced without the origin.",
  },
  destination: {
    score: 95,
    owner: "CUSTOMER",
    ask: "Please confirm the delivery/destination location.",
    why: "No lane can be priced without the destination.",
  },
  weight: {
    score: 90,
    owner: "CUSTOMER",
    ask: "Please confirm the gross weight in kg.",
    why: "Weight changes carrier acceptance, surcharges, and chargeable pricing.",
  },
  lcl_dimensions: {
    score: 89,
    owner: "CUSTOMER",
    ask: "Please send LCL dimensions per pallet/package, including quantity and L x W x H.",
    why: "LCL pricing is fake without complete chargeable CBM.",
  },
  cargo_dimensions: {
    score: 88,
    owner: "CUSTOMER",
    ask: "Please send dimensions or confirmed CBM.",
    why: "This mode needs cargo size before pricing is dependable.",
  },
  fcl_equipment: {
    score: 87,
    owner: "CUSTOMER",
    ask: "Please confirm the container count and size/type.",
    why: "FCL pricing needs equipment count and container type.",
  },
  dangerous_goods: {
    score: 84,
    owner: "CUSTOMER",
    ask: "Please confirm whether the cargo is dangerous goods. If yes, share UN/class/MSDS.",
    why: "DG status changes eligibility, cost, routing, and paperwork risk.",
  },
  customs: {
    score: 80,
    owner: "CUSTOMER",
    ask: "Please confirm who will handle customs work.",
    why: "Customs responsibility changes scope, price, and service commitment.",
  },
  target_price: {
    score: 76,
    owner: "CUSTOMER",
    ask: "If you have a target price, it helps us leverage agencies better; if not, no problem.",
    why: "Target posture decides whether we chase buy cost, counter, or price from market.",
  },
  commodity: {
    score: 72,
    owner: "CUSTOMER",
    ask: "Please confirm the product or commodity.",
    why: "Commodity affects carrier acceptance, risk, and whether the lane is worth chasing.",
  },
  stackability: {
    score: 68,
    owner: "CUSTOMER",
    ask: "Please confirm whether the cargo is stackable.",
    why: "Stackability changes chargeable CBM and LCL cost.",
  },
  top_load: {
    score: 62,
    owner: "CUSTOMER",
    ask: "For non-stackable LCL, can this be top-loaded? It cannot be guaranteed, but it affects cost.",
    why: "Top-load preference changes how conservatively we price non-stackable cargo.",
  },
};

function blockerPriority(score: number): StrategyBlockerResolution["priority"] {
  if (score >= 90) return "critical";
  if (score >= 76) return "high";
  return "medium";
}

function buildBlockerResolutionPlan(checks: RfqMaturityCheck[]): StrategyBlockerResolution[] {
  return checks
    .filter((check) => check.status === "missing")
    .map((check): StrategyBlockerResolution => {
      const guidance = BLOCKER_RESOLUTION_GUIDANCE[check.key];
      return {
        key: check.key,
        label: check.label,
        priority: blockerPriority(guidance.score),
        owner: guidance.owner,
        ask: guidance.ask,
        why: guidance.why,
        score: guidance.score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function assessCommercialStrategy(input: CommercialStrategyInput): CommercialStrategy {
  const asOf = strategyAsOf(input);
  const currency = input.targetCurrency ?? input.currency ?? "USD";
  const target = input.targetPrice ?? input.revenue ?? null;
  const missing = requiredRfqMissing(input);
  const maturityChecks = buildRfqMaturityChecks({
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
    targetPrice: input.targetPrice,
    targetPriceStatus: input.targetPriceStatus,
  });
  const applicableMaturityChecks = maturityChecks.filter((check) => check.status !== "not_applicable");
  const readyMaturityChecks = applicableMaturityChecks.filter((check) => check.status === "ready");
  const blockerResolutionPlan = buildBlockerResolutionPlan(maturityChecks);
  const cargoMath = buildCargoMath(input);
  const quotes = input.carrierQuotes ?? [];
  const received = quotes.filter((q) => q.status === "RECEIVED" && quoteTotal(q) != null);
  const rateFreshness = buildRateFreshness(quotes, asOf);
  const pending = quotes.filter((q) => q.status !== "RECEIVED");
  const routeOptions = buildRouteOptions(input, currency);
  const recommendedRoute = routeOptions[0] ?? null;
  const laneRateMatches = (input.laneRates ?? []).filter((r) => isSameLane(input, r)).length;
  const historicalLaneJobs = (input.historicalJobs ?? []).filter((j) => isSameLane(input, j)).length;
  const coveragePosture = buildCoveragePosture({
    receivedQuotes: received.length,
    reliableLiveQuotes: rateFreshness?.reliableLiveQuotes ?? received.length,
    pendingQuotes: pending.length,
    totalQuotes: quotes.length,
    laneRateMatches,
    historicalLaneJobs,
  });
  const sourceEconomics = input.sourceEconomics ?? null;
  const documentReadiness = input.documents ? buildDocumentReadiness(input.documents) : null;

  const buyCost =
    input.cost && input.cost > 0 ? input.cost :
    recommendedRoute?.cost ?? null;
  const costSource =
    input.cost && input.cost > 0 ? "SELECTED_JOB_COST" :
    recommendedRoute?.source ?? null;

  const policyTarget = input.marginPolicy?.targetMarginPct ?? 18;
  const minMargin = input.marginPolicy?.minMarginPct ?? Math.max(10, Math.min(14, policyTarget * 0.7));
  const stretchMargin = input.marginPolicy?.stretchMarginPct ?? policyTarget + 7;

  const floorPrice = buyCost != null ? priceForMargin(buyCost, minMargin) : null;
  const recommendedPrice = buyCost != null ? priceForMargin(buyCost, policyTarget) : target;
  const stretchPrice = buyCost != null ? priceForMargin(buyCost, stretchMargin) : null;
  const walkAwayPrice = floorPrice;
  const marginAtTarget = target != null && buyCost != null ? marginPct(target, buyCost) : null;
  const expectedMarginPct = recommendedPrice != null && buyCost != null ? marginPct(recommendedPrice, buyCost) : null;
  const expectedGrossProfit = recommendedPrice != null && buyCost != null ? recommendedPrice - buyCost : null;
  const targetPosture = buildTargetPosture({
    target,
    currency,
    targetPriceStatus: input.targetPriceStatus,
    buyCost,
    floorPrice,
    recommendedPrice,
    stretchPrice,
    marginAtTarget,
  });
  const targetTrail = buildTargetTrail({
    history: input.targetHistory,
    currentTarget: target,
    currentCurrency: currency,
    currentStatus: input.targetPriceStatus,
    currentSource: input.targetPriceSource,
  });

  let guardrailStatus: CommercialStrategy["price"]["guardrailStatus"] = "PASS";
  if (buyCost == null) guardrailStatus = "NEEDS_COST";
  else if (target != null && floorPrice != null && target < floorPrice) guardrailStatus = "BLOCKED";
  else if ((marginAtTarget != null && marginAtTarget < minMargin) || received.length < 2) guardrailStatus = "REVIEW";

  let winProbability = 42;
  if (target != null && recommendedPrice != null) {
    const gap = (target - recommendedPrice) / Math.max(recommendedPrice, 1);
    winProbability = gap >= 0.12 ? 78 : gap >= 0 ? 66 : gap >= -0.08 ? 48 : gap >= -0.18 ? 31 : 18;
  } else if (input.targetPriceStatus === "NO_TARGET" && buyCost != null) {
    winProbability = 54;
  } else if (target != null) {
    winProbability = 46;
  }
  if (input.customerStats?.known && input.customerStats.jobs > 0) winProbability += 5;
  if (input.customerStats?.won && input.customerStats.quoted) winProbability += Math.min(10, Math.round((input.customerStats.won / Math.max(1, input.customerStats.quoted)) * 10));
  if (received.length >= 3) winProbability += 5;
  if (targetTrail?.direction === "RAISED") winProbability += Math.min(8, Math.max(3, Math.round(Math.abs(targetTrail.movementPct ?? 0) / 3)));
  if (targetTrail?.direction === "LOWERED") winProbability -= Math.min(9, Math.max(4, Math.round(Math.abs(targetTrail.movementPct ?? 0) / 3)));
  if (targetTrail?.direction === "WITHDRAWN" || targetTrail?.direction === "STALE" || targetTrail?.direction === "MIXED_CURRENCY") winProbability -= 4;
  if (rateFreshness?.tone === "blocked") winProbability -= 10;
  if (rateFreshness?.tone === "review") winProbability -= 4;
  if (missing.length > 0) winProbability -= 14;
  winProbability = clamp(winProbability);

  const riskAssessments = buildRisks(input, {
    missing,
    receivedQuotes: received.length,
    rateFreshness,
    laneRateMatches,
    historicalLaneJobs,
    target,
    floorPrice,
    buyCost,
    marginAtTarget,
  });
  const maxRisk = riskAssessments[0]?.score ?? 18;
  const highRisk = maxRisk >= 70 || riskAssessments.some((r) => r.level === "CRITICAL");

  const maturity = clamp(100 - missing.length * 13);
  let pricePower = clamp(
    buyCost == null ? 25 :
    guardrailStatus === "PASS" ? 84 :
    guardrailStatus === "REVIEW" ? 58 :
    22
  );
  if (targetTrail?.direction === "RAISED") pricePower = clamp(pricePower + 4);
  if (targetTrail?.direction === "LOWERED" || targetTrail?.direction === "WITHDRAWN" || targetTrail?.direction === "STALE" || targetTrail?.direction === "MIXED_CURRENCY") {
    pricePower = clamp(pricePower - 4);
  }
  if (rateFreshness?.tone === "blocked") pricePower = clamp(pricePower - 14);
  if (rateFreshness?.tone === "review") pricePower = clamp(pricePower - 5);
  const routeQuality = clamp(
    recommendedRoute
      ? recommendedRoute.reliabilityScore * 0.55 + (100 - recommendedRoute.riskScore) * 0.45
      : 20
  );
  const riskControl = clamp(100 - maxRisk);
  const customerValue = clamp(
    38 +
    (input.companyId || input.companyName || input.fromCompany ? 20 : 0) +
    Math.min(18, (input.customerStats?.jobs ?? 0) * 3) +
    Math.max(-16, Math.min(12, input.customerStats?.avgMarginPct ?? 0))
  );
  const confidenceComponent = clamp(
    20 +
    received.length * 18 +
    laneRateMatches * 8 +
    historicalLaneJobs * 5 -
    missing.length * 10
  );

  let raw =
    maturity * 0.18 +
    pricePower * 0.28 +
    routeQuality * 0.18 +
    riskControl * 0.16 +
    customerValue * 0.10 +
    confidenceComponent * 0.10;

  let hardCap: number | null = null;
  const cap = (n: number) => { hardCap = hardCap == null ? n : Math.min(hardCap, n); };
  if (missing.length > 0) cap(58);
  if (buyCost == null) cap(52);
  if (rateFreshness?.tone === "blocked") cap(52);
  if (guardrailStatus === "BLOCKED") cap(44);
  if (highRisk) cap(64);
  if (input.status === "LOST" || input.status === "CANCELLED") cap(8);
  if (hardCap != null) raw = Math.min(raw, hardCap);

  const score = clamp(raw);
  let recommendation: StrategyRecommendation;
  if (missing.length > 0) recommendation = "ASK_CUSTOMER";
  else if (guardrailStatus === "NEEDS_COST" || received.length === 0 || coveragePosture.primaryEvidence === "STALE_QUOTES") recommendation = "REQUEST_RATES";
  else if (guardrailStatus === "BLOCKED" && highRisk) recommendation = "DECLINE";
  else if (guardrailStatus === "BLOCKED" || guardrailStatus === "REVIEW") recommendation = "NEGOTIATE";
  else if (highRisk) recommendation = "ESCALATE";
  else recommendation = "QUOTE";

  const recommendationLabel: Record<StrategyRecommendation, string> = {
    QUOTE: "Quote customer",
    NEGOTIATE: "Negotiate first",
    REQUEST_RATES: "Request more rates",
    ASK_CUSTOMER: "Ask customer",
    ESCALATE: "Escalate",
    DECLINE: "Decline / park",
  };
  const band: CommercialStrategy["band"] = score >= 82 ? "A" : score >= 68 ? "B" : score >= 50 ? "C" : "D";
  const label =
    recommendation === "QUOTE" ? "Quote-ready" :
    recommendation === "NEGOTIATE" ? "Margin fight" :
    recommendation === "REQUEST_RATES" ? "Needs buy cost" :
    recommendation === "ASK_CUSTOMER" ? "Mature first" :
    recommendation === "ESCALATE" ? "Review required" :
    "Bad deal";

  const confidence: CommercialStrategy["confidence"] =
    missing.length === 0 && received.length >= 2 && buyCost != null ? "high" :
    missing.length <= 2 && (received.length > 0 || laneRateMatches > 0 || historicalLaneJobs > 0) ? "medium" :
    "low";

  const strengths: string[] = [];
  if (target != null) strengths.push("Customer target is captured");
  if (targetTrail?.direction === "RAISED") strengths.push(`Target trail improved: ${targetTrail.metric}`);
  if (targetPosture.status === "GENEROUS") strengths.push("Customer target leaves room above stretch margin");
  if (targetPosture.status === "WITHIN_GUARDRAIL") strengths.push("Customer target clears the commercial floor");
  if (expectedMarginPct != null && expectedMarginPct >= policyTarget) strengths.push(`Recommended price clears ${expectedMarginPct.toFixed(1)}% margin`);
  if (cargoMath?.chargeableCbm != null && cargoMath.physicalCbm != null && cargoMath.chargeableCbm > cargoMath.physicalCbm) {
    strengths.push(`Chargeable CBM is explicit: ${cargoMath.chargeableCbm.toFixed(3)} vs ${cargoMath.physicalCbm.toFixed(3)} physical`);
  }
  if (received.length >= 3) strengths.push("Forwarder coverage is strong");
  if (coveragePosture.status === "WORKABLE_LIVE") strengths.push("Two live quotes create a workable pricing basis");
  if (rateFreshness?.tone === "ready") strengths.push(`Rate validity is current: ${rateFreshness.metric}`);
  if (historicalLaneJobs > 0 || laneRateMatches > 0) strengths.push("Internal lane evidence exists");
  if (input.customerStats?.known) strengths.push("Customer history is available");
  if (sourceEconomics?.expectedProfit != null) {
    strengths.push(`Control sheet profit context: ${money(sourceEconomics.expectedProfit, sourceEconomics.profitCurrency ?? currency)}`);
  }
  if (documentReadiness?.tone === "ready") {
    strengths.push(`Document proof approved: ${documentReadiness.metric}`);
  }

  const risks = riskAssessments.slice(0, 5).map((r) => r.reason);
  if (targetTrail?.direction === "LOWERED" || targetTrail?.direction === "WITHDRAWN" || targetTrail?.direction === "STALE" || targetTrail?.direction === "MIXED_CURRENCY") {
    risks.push(targetTrail.detail);
  }
  const action =
    recommendation === "QUOTE" ? `Quote around ${money(recommendedPrice, currency)}; protect floor at ${money(floorPrice, currency)}.` :
    recommendation === "NEGOTIATE" ? `Do not quote yet. Floor is ${money(floorPrice, currency)} and target is ${money(target, currency)}.` :
    recommendation === "REQUEST_RATES" ? "Get live forwarder pricing before committing to the customer." :
    recommendation === "ASK_CUSTOMER" ? `Ask for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}.` :
    recommendation === "ESCALATE" ? "Review risk and margin with a manager before quoting." :
    "Park the deal unless there is a strategic reason to lose money.";
  const negotiation = buildNegotiationPlan({
    recommendation,
    missing,
    currency,
    target,
    minMargin,
    buyCost,
    floorPrice,
    recommendedPrice,
    targetPosture,
    coveragePosture,
    cargoMath,
    topRisk: risks[0] ?? null,
  });
  const quoteGate = buildQuoteGate({
    missing,
    cargoMath,
    coveragePosture,
    rateFreshness,
    targetPosture,
    guardrailStatus,
    buyCost,
    highRisk,
    topRisk: risks[0] ?? null,
    negotiation,
  });
  const actions = buildActions({
    recommendation,
    missing,
    receivedQuotes: received.length,
    pendingQuotes: pending.length,
    rateFreshness,
    floorPrice,
    recommendedPrice,
    target,
    currency,
    highRisk,
    guardrailStatus,
  });
  const operatorDecision = buildOperatorDecision({
    quoteGate,
    negotiation,
    actions,
    recommendation,
    currency,
    buyCost,
    floorPrice,
    recommendedPrice,
    target,
    targetPosture,
    coveragePosture,
    topRisk: risks[0] ?? null,
  });
  const decisionQuality = buildDecisionQualityCheck({
    quoteGate,
    confidenceComponent,
    missing,
    coveragePosture,
    rateFreshness,
    targetPosture,
    guardrailStatus,
    topRisk: riskAssessments[0] ?? null,
    documentReadiness,
  });
  const decisionReasons = buildDecisionReasons({
    quoteGate,
    operatorDecision,
    coveragePosture,
    rateFreshness,
    targetPosture,
    targetTrail,
    decisionQuality,
    guardrailStatus,
    buyCost,
    floorPrice,
    recommendedPrice,
    currency,
    topRisk: riskAssessments[0] ?? null,
  });
  const evidenceChecks = buildEvidenceChecks({
    missing,
    maturity,
    mode: input.mode,
    cargoMath,
    targetPosture,
    targetTrail,
    coveragePosture,
    rateFreshness,
    guardrailStatus,
    buyCost,
    recommendedPrice,
    currency,
    topRisk: riskAssessments[0] ?? null,
    documentReadiness,
    decisionQuality,
  });

  const strategyMemo = [
    `${recommendationLabel[recommendation]}: ${action}`,
    `Operator decision: ${operatorDecision.title}. ${operatorDecision.command}`,
    `Maturity checklist: ${readyMaturityChecks.length}/${applicableMaturityChecks.length} ready${missing.length > 0 ? `; missing ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}` : ""}.`,
    blockerResolutionPlan.length > 0 ? `Clear first: ${blockerResolutionPlan.slice(0, 3).map((item) => item.label).join(", ")}.` : null,
    `Decision stack: ${decisionReasons.slice(0, 3).map((reason) => `${reason.label} - ${reason.summary}`).join("; ")}.`,
    `Evidence map: ${evidenceChecks.map((check) => `${check.label} ${operatorMetricLabel(check.metric, check.tone)}`).join("; ")}.`,
    `Decision quality: ${operatorMetricLabel(decisionQuality.metric, decisionQuality.tone)}. ${decisionQuality.detail}`,
    recommendedRoute ? `Route: ${recommendedRoute.label} (${recommendedRoute.tradeoff})` : null,
    buyCost != null ? `Buy cost ${money(buyCost, currency)}; recommended sell ${money(recommendedPrice, currency)}; floor ${money(floorPrice, currency)}.` : "No dependable buy cost yet.",
    `Quote gate: ${quoteGate.label}. ${quoteGate.decision}`,
    `Negotiation posture: ${negotiation.label}. ${negotiation.internalGuardrail}`,
    `Coverage posture: ${coveragePosture.label}. ${coveragePosture.stance}`,
    rateFreshness ? `Rate freshness: ${rateFreshness.label}. ${rateFreshness.detail}` : null,
    `Target posture: ${targetPosture.label}. ${targetPosture.stance}`,
    targetTrail ? `Target trail: ${targetTrail.label}. ${targetTrail.detail}` : null,
    documentReadiness ? `Document proof: ${documentReadiness.label}. ${documentReadiness.detail}` : null,
    cargoMath?.chargeableCbm != null
      ? `Cargo math: ${cargoMath.chargeableCbm.toFixed(3)} chargeable CBM${cargoMath.physicalCbm != null ? ` vs ${cargoMath.physicalCbm.toFixed(3)} physical CBM` : ""}${cargoMath.stackable === "NO" ? " because cargo is non-stackable" : ""}.`
      : cargoMath?.dimensionsPartial
        ? "Cargo math is blocked by partial dimensions."
        : null,
    sourceEconomics?.contractValue != null ? `Sheet economics preserved: ${money(sourceEconomics.contractValue, sourceEconomics.contractCurrency ?? currency)} contract value is context, not a confirmed target price.` : null,
    risks[0] ? `Main risk: ${risks[0]}` : "No major risk dominates the decision.",
  ].filter(Boolean).join(" ");

  return {
    score,
    band,
    label,
    recommendation,
    recommendationLabel: recommendationLabel[recommendation],
    action,
    strategyMemo,
    confidence,
    missing,
    maturityChecks,
    strengths: strengths.slice(0, 5),
    risks,
    routeOptions: routeOptions.slice(0, 6),
    recommendedRoute,
    riskAssessments,
    actions,
    negotiation,
    quoteGate,
    operatorDecision,
    decisionReasons,
    evidenceChecks,
    blockerResolutionPlan,
    price: {
      currency,
      buyCost,
      costSource,
      floorPrice,
      recommendedPrice,
      stretchPrice,
      walkAwayPrice,
      expectedMarginPct,
      expectedGrossProfit,
      winProbability,
      guardrailStatus,
      rationale: [
        `Target margin ${policyTarget}% and minimum margin ${minMargin.toFixed(1)}%.`,
        buyCost != null ? `Buy cost source: ${costSource}.` : "No buy cost source available.",
        target != null ? `Customer target: ${money(target, currency)}.` : "Customer target not provided.",
        sourceEconomics?.contractValue != null ? `Sheet contract value ${money(sourceEconomics.contractValue, sourceEconomics.contractCurrency ?? currency)} is not used as target price until confirmed.` : null,
      ].filter((line): line is string => Boolean(line)),
    },
    components: {
      maturity,
      pricePower,
      routeQuality,
      riskControl,
      customerValue,
      confidence: confidenceComponent,
    },
    evidence: {
      receivedQuotes: received.length,
      pendingQuotes: pending.length,
      laneRateMatches,
      historicalLaneJobs,
      customerJobs: input.customerStats?.jobs ?? 0,
      targetPrice: target,
      targetCurrency: input.targetCurrency ?? null,
      targetPosture,
      targetTrail,
      coveragePosture,
      rateFreshness,
      quoteCoverage: `${received.length} received / ${quotes.length} total`,
      cargoMath,
      documentReadiness,
      sourceEconomics,
    },
    details: {
      receivedQuotes: received.length,
      pendingQuotes: pending.length,
      bestCost: buyCost,
      marginPct: expectedMarginPct,
      hardCap,
    },
  };
}

export function strategyTone(score: number) {
  if (score >= 82) return "good";
  if (score >= 68) return "info";
  if (score >= 50) return "warn";
  return "danger";
}
