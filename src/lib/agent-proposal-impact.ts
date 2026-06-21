import { buildDocumentReadiness, type DocumentReadinessDoc } from "@/lib/document-readiness";
import { qualifyRfq } from "@/lib/rfq-qualification";
import {
  assessCommercialStrategy,
  buildStrategyCommandLedger,
  type CommercialStrategy,
  type CommercialStrategyInput,
  type StrategyCommandLedgerItem,
} from "@/lib/commercial-strategy";

export type ProposalImpactRecord = Record<string, unknown> & {
  inquiry?: Record<string, unknown> | null;
  documents?: DocumentReadinessDoc[];
};

export type AgentProposalDecisionImpact = {
  before: {
    mature: boolean;
    missingCount: number;
    missing: string[];
  };
  after: {
    mature: boolean;
    missingCount: number;
    missing: string[];
  };
  target: {
    currentStatus: string;
    proposedStatus: string;
    currentAmount: number | null;
    proposedAmount: number | null;
    currency: string;
    changed: boolean;
  };
  proposedGroups: {
    route: string[];
    cargo: string[];
    commercial: string[];
  };
  documents: {
    tone: string;
    label: string;
    metric: string;
    detail: string;
    approved: number;
    uploaded: number;
    pending: number;
    extractedFields: number;
    flags: number;
  };
  strategy: {
    before: ProposalStrategySnapshot;
    after: ProposalStrategySnapshot;
    delta: {
      missingCount: number;
      bandChanged: boolean;
      confidenceChanged: boolean;
      gateChanged: boolean;
      guardrailChanged: boolean;
      phaseChanged: boolean;
      recommendationChanged: boolean;
      commandChanged: boolean;
    };
  };
  safeAction: string;
};

type ProposalStrategySnapshot = {
  band: CommercialStrategy["band"];
  recommendation: CommercialStrategy["recommendationLabel"];
  confidence: CommercialStrategy["confidence"];
  missingCount: number;
  quoteGate: {
    status: CommercialStrategy["quoteGate"]["status"];
    label: string;
    canSendToForwarders: boolean;
    canQuoteCustomer: boolean;
    requiresApproval: boolean;
  };
  guardrail: {
    status: CommercialStrategy["price"]["guardrailStatus"];
    buyCost: number | null;
    floorPrice: number | null;
    recommendedPrice: number | null;
    currency: string;
  };
  cargo: {
    source: string | null;
    physicalCbm: number | null;
    chargeableCbm: number | null;
    stackable: string | null;
    topLoad: string | null;
    dimensionsComplete: boolean;
    dimensionsPartial: boolean;
  };
  nextMove: {
    phase: CommercialStrategy["operatorDecision"]["phase"];
    owner: CommercialStrategy["operatorDecision"]["owner"];
    title: string;
    command: string;
    toolHint: CommercialStrategy["operatorDecision"]["toolHint"];
    canRunNow: boolean;
    requiresApproval: boolean;
  };
  firstStop: Pick<StrategyCommandLedgerItem, "key" | "label" | "owner" | "tone" | "command" | "stopRule">;
};

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function qualifyRecord(record: Record<string, unknown>) {
  return qualifyRfq({
    origin: readString(record, "origin"),
    destination: readString(record, "destination"),
    mode: readString(record, "mode"),
    commodity: readString(record, "commodity"),
    containerCount: readNumber(record, "containerCount"),
    containerType: readString(record, "containerType"),
    dimensions: readString(record, "dimensions"),
    stackable: readString(record, "stackable"),
    topLoad: readString(record, "topLoad"),
    dangerousGoods: readString(record, "dangerousGoods"),
    customsBy: readString(record, "customsBy"),
    weight: readNumber(record, "weight"),
    volume: readNumber(record, "volume"),
    targetPrice: readNumber(record, "targetPrice"),
    targetPriceStatus: readString(record, "targetPriceStatus"),
  });
}

function proposedFieldGroups(update: Record<string, unknown>, inquiryUpdate: Record<string, unknown>) {
  const fields = new Set([...Object.keys(update), ...Object.keys(inquiryUpdate)]);
  const group = (keys: string[]) => keys.filter((key) => fields.has(key));
  return {
    route: group(["origin", "destination", "mode", "incoterms"]),
    cargo: group(["commodity", "containerCount", "containerType", "packages", "dimensions", "weight", "volume", "stackable", "topLoad", "dangerousGoods", "customsBy"]),
    commercial: group(["targetPrice", "targetCurrency", "targetPriceStatus", "targetPriceSource"]),
  };
}

function documentSnapshot(docs: DocumentReadinessDoc[]) {
  const readiness = buildDocumentReadiness(docs);
  return {
    tone: readiness.tone,
    label: readiness.label,
    metric: readiness.metric,
    detail: readiness.detail,
    approved: readiness.approved,
    uploaded: readiness.uploaded,
    pending: readiness.pending,
    extractedFields: readiness.extractedFields,
    flags: readiness.flags,
  };
}

function targetImpact(current: Record<string, unknown>, proposed: Record<string, unknown>) {
  const currentAmount = readNumber(current, "targetPrice");
  const proposedAmount = readNumber(proposed, "targetPrice");
  const currentStatus = readString(current, "targetPriceStatus") ?? "UNKNOWN";
  const proposedStatus = readString(proposed, "targetPriceStatus") ?? "UNKNOWN";
  return {
    currentStatus,
    proposedStatus,
    currentAmount,
    proposedAmount,
    currency: readString(proposed, "targetCurrency") ?? readString(current, "targetCurrency") ?? "USD",
    changed: currentAmount !== proposedAmount || currentStatus !== proposedStatus,
  };
}

function strategyNumber(record: Record<string, unknown>, key: string) {
  return readNumber(record, key);
}

function strategyDate(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildStrategyInput(record: Record<string, unknown>): CommercialStrategyInput {
  return {
    id: readString(record, "id"),
    entityType: readString(record, "reference") ? "JOB" : "INQUIRY",
    subject: readString(record, "subject") ?? readString(record, "title") ?? readString(record, "reference") ?? "Agent proposal",
    type: readString(record, "type"),
    status: readString(record, "status"),
    companyId: readString(record, "companyId"),
    companyName: readString(record, "companyName") ?? readString(record, "fromCompany"),
    fromEmail: readString(record, "fromEmail"),
    fromCompany: readString(record, "fromCompany"),
    origin: readString(record, "origin"),
    destination: readString(record, "destination"),
    mode: readString(record, "mode"),
    containerCount: strategyNumber(record, "containerCount"),
    containerType: readString(record, "containerType"),
    dimensions: readString(record, "dimensions"),
    stackable: readString(record, "stackable"),
    topLoad: readString(record, "topLoad"),
    dangerousGoods: readString(record, "dangerousGoods"),
    customsBy: readString(record, "customsBy"),
    incoterms: readString(record, "incoterms"),
    commodity: readString(record, "commodity"),
    weight: strategyNumber(record, "weight"),
    volume: strategyNumber(record, "volume"),
    cargoReadyDate: strategyDate(record, "cargoReadyDate"),
    targetPrice: strategyNumber(record, "targetPrice"),
    targetCurrency: readString(record, "targetCurrency"),
    targetPriceStatus: readString(record, "targetPriceStatus"),
    targetPriceSource: readString(record, "targetPriceSource"),
    revenue: strategyNumber(record, "revenue"),
    cost: strategyNumber(record, "cost"),
    currency: readString(record, "currency"),
    receivedAt: strategyDate(record, "receivedAt"),
    createdAt: strategyDate(record, "createdAt"),
    rawEmailBody: readString(record, "rawEmailBody"),
    notes: readString(record, "notes"),
    documents: Array.isArray(record.documents) ? record.documents as DocumentReadinessDoc[] : [],
    marginPolicy: { targetMarginPct: 18, minMarginPct: 12, stretchMarginPct: 25 },
  };
}

function strategySnapshot(strategy: CommercialStrategy): ProposalStrategySnapshot {
  const ledger = buildStrategyCommandLedger(strategy);
  const firstStop = ledger.find((item) => item.tone === "blocked" || item.tone === "review") ?? ledger[0];
  const cargo = strategy.evidence.cargoMath;
  return {
    band: strategy.band,
    recommendation: strategy.recommendationLabel,
    confidence: strategy.confidence,
    missingCount: strategy.missing.length,
    quoteGate: {
      status: strategy.quoteGate.status,
      label: strategy.quoteGate.label,
      canSendToForwarders: strategy.quoteGate.canSendToForwarders,
      canQuoteCustomer: strategy.quoteGate.canQuoteCustomer,
      requiresApproval: strategy.quoteGate.requiresApproval,
    },
    guardrail: {
      status: strategy.price.guardrailStatus,
      buyCost: strategy.price.buyCost,
      floorPrice: strategy.price.floorPrice,
      recommendedPrice: strategy.price.recommendedPrice,
      currency: strategy.price.currency,
    },
    cargo: {
      source: cargo?.source ?? null,
      physicalCbm: cargo?.physicalCbm ?? null,
      chargeableCbm: cargo?.chargeableCbm ?? cargo?.storedVolume ?? null,
      stackable: cargo?.stackable ?? null,
      topLoad: cargo?.topLoad ?? null,
      dimensionsComplete: cargo?.dimensionsComplete ?? false,
      dimensionsPartial: cargo?.dimensionsPartial ?? false,
    },
    nextMove: {
      phase: strategy.operatorDecision.phase,
      owner: strategy.operatorDecision.owner,
      title: strategy.operatorDecision.title,
      command: strategy.operatorDecision.command,
      toolHint: strategy.operatorDecision.toolHint,
      canRunNow: strategy.operatorDecision.canRunNow,
      requiresApproval: strategy.operatorDecision.requiresApproval,
    },
    firstStop: {
      key: firstStop.key,
      label: firstStop.label,
      owner: firstStop.owner,
      tone: firstStop.tone,
      command: firstStop.command,
      stopRule: firstStop.stopRule,
    },
  };
}

function strategyImpact(current: Record<string, unknown>, proposed: Record<string, unknown>) {
  const before = assessCommercialStrategy(buildStrategyInput(current));
  const after = assessCommercialStrategy(buildStrategyInput(proposed));
  return {
    before: strategySnapshot(before),
    after: strategySnapshot(after),
    delta: {
      missingCount: after.missing.length - before.missing.length,
      bandChanged: before.band !== after.band,
      confidenceChanged: before.confidence !== after.confidence,
      gateChanged: before.quoteGate.status !== after.quoteGate.status,
      guardrailChanged: before.price.guardrailStatus !== after.price.guardrailStatus,
      phaseChanged: before.operatorDecision.phase !== after.operatorDecision.phase,
      recommendationChanged: before.recommendation !== after.recommendation,
      commandChanged: before.operatorDecision.command !== after.operatorDecision.command,
    },
  };
}

export function buildAgentProposalDecisionImpact(args: {
  current: ProposalImpactRecord;
  update?: Record<string, unknown>;
  inquiryUpdate?: Record<string, unknown>;
}): AgentProposalDecisionImpact {
  const update = args.update ?? {};
  const inquiryUpdate = args.inquiryUpdate ?? {};
  const current = { ...(args.current.inquiry ?? {}), ...args.current };
  const proposed = { ...current, ...update, ...inquiryUpdate };
  const before = qualifyRecord(current);
  const after = qualifyRecord(proposed);
  const commercial = strategyImpact(current, proposed);

  return {
    before: {
      mature: before.isMature,
      missingCount: before.followUpQuestions.length,
      missing: before.followUpQuestions,
    },
    after: {
      mature: after.isMature,
      missingCount: after.followUpQuestions.length,
      missing: after.followUpQuestions,
    },
    target: targetImpact(current, proposed),
    proposedGroups: proposedFieldGroups(update, inquiryUpdate),
    documents: documentSnapshot(args.current.documents ?? []),
    strategy: commercial,
    safeAction: `${commercial.after.nextMove.command} ${commercial.after.firstStop.stopRule}`,
  };
}
