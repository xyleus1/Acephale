import type { CommercialStrategy, StrategyEvidenceCheck, StrategyOperatorDecision } from "./commercial-strategy";
import { operatorMetricLabel } from "./operator-action-labels";

export type PricingCommandFactorTone = "ready" | "review" | "blocked" | "info";

export type PricingCommandFactor = {
  label: string;
  value: string;
  tone: PricingCommandFactorTone;
};

type PricingCommandPhase = StrategyOperatorDecision["phase"] | string | null | undefined;
type PricingGuardrailStatus = CommercialStrategy["price"]["guardrailStatus"] | string | null | undefined;
type PricingBand = CommercialStrategy["band"] | string | null | undefined;
type PricingConfidence = CommercialStrategy["confidence"] | string | null | undefined;
type PricingDecisionQuality = Pick<StrategyEvidenceCheck, "tone" | "metric"> | null | undefined;

export function prettyPricingCommandPhase(phase: PricingCommandPhase) {
  if (phase === "MATURE_RFQ") return "Mature RFQ";
  if (phase === "GET_RATES") return "Get rates";
  if (phase === "APPROVE_ECONOMICS") return "Review economics";
  if (phase === "QUOTE_CUSTOMER") return "Quote customer";
  if (phase === "PARK_DEAL") return "Park deal";
  return "Review";
}

export function prettyPricingGuardrail(value: PricingGuardrailStatus) {
  if (!value) return "needs cost";
  return value.toLowerCase().replace("_", " ");
}

function factorPhaseTone(phase: PricingCommandPhase): PricingCommandFactorTone {
  if (phase === "QUOTE_CUSTOMER") return "ready";
  if (phase === "APPROVE_ECONOMICS") return "review";
  if (phase === "PARK_DEAL") return "info";
  return "blocked";
}

function guardrailTone(value: PricingGuardrailStatus): PricingCommandFactorTone {
  if (value === "PASS") return "ready";
  if (value === "REVIEW") return "review";
  return "blocked";
}

function normalizeBand(value: PricingBand) {
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : "?";
}

function normalizeConfidence(value: PricingConfidence) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function decisionQualityFactor(decisionQuality: PricingDecisionQuality, band: string, confidence: string): PricingCommandFactor {
  if (decisionQuality) {
    return {
      label: "Decision quality",
      value: operatorMetricLabel(decisionQuality.metric, decisionQuality.tone),
      tone: decisionQuality.tone,
    };
  }

  return {
    label: "Decision quality",
    value: `No audit (${band}/${confidence})`,
    tone: "review",
  };
}

export function buildPricingCommandFactors(args: {
  phase: PricingCommandPhase;
  blockerCount?: number | null;
  guardrailStatus: PricingGuardrailStatus;
  receivedQuotes?: number | null;
  band: PricingBand;
  confidence: PricingConfidence;
  decisionQuality?: PricingDecisionQuality;
  stale?: boolean;
}): PricingCommandFactor[] {
  const blockerCount = Math.max(0, Math.floor(args.blockerCount ?? 0));
  const receivedQuotes = Math.max(0, Math.floor(args.receivedQuotes ?? 0));
  const band = normalizeBand(args.band);
  const confidence = normalizeConfidence(args.confidence);

  return [
    {
      label: "Phase",
      value: prettyPricingCommandPhase(args.phase),
      tone: factorPhaseTone(args.phase),
    },
    blockerCount > 0 ? {
      label: "Maturity",
      value: `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`,
      tone: "blocked",
    } : {
      label: "Maturity",
      value: "RFQ facts clear",
      tone: "ready",
    },
    decisionQualityFactor(args.decisionQuality, band, confidence),
    {
      label: "Guardrail",
      value: prettyPricingGuardrail(args.guardrailStatus),
      tone: guardrailTone(args.guardrailStatus),
    },
    {
      label: "Coverage",
      value: receivedQuotes > 0 ? `${receivedQuotes} live quote${receivedQuotes === 1 ? "" : "s"}` : "No live quotes",
      tone: receivedQuotes >= 2 ? "ready" : receivedQuotes === 1 ? "review" : "blocked",
    },
    args.stale ? {
      label: "Freshness",
      value: "Stale snapshot",
      tone: "review",
    } : null,
  ].filter((factor): factor is PricingCommandFactor => Boolean(factor));
}
