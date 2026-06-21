import {
  assessCommercialStrategy,
  buildStrategyExecutionPacket,
  type CommercialStrategy,
  type CommercialStrategyInput,
  type StrategyCarrierQuote,
  type StrategyEvidenceCheck,
} from "./commercial-strategy";
import { operatorMetricLabel } from "./operator-action-labels";

export type PricingScenarioOverrides = {
  targetPrice?: number | null;
  targetCurrency?: string | null;
  noTarget?: boolean;
  buyCost?: number | null;
  assumeLiveBuyCost?: boolean;
  replaceExistingQuotes?: boolean;
  transitDays?: number | null;
  targetMarginPct?: number | null;
  minMarginPct?: number | null;
  stretchMarginPct?: number | null;
};

function cleanNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return null;
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function delta(next: number | null | undefined, current: number | null | undefined) {
  if (next == null || current == null || !Number.isFinite(next) || !Number.isFinite(current)) return null;
  return Math.round((next - current) * 100) / 100;
}

function scenarioCarrierQuote(args: {
  buyCost: number;
  currency: string;
  transitDays?: number | null;
}): StrategyCarrierQuote {
  return {
    id: "scenario-buy-cost",
    carrier: "Scenario buy cost",
    quoteType: "SCENARIO",
    rateName: "What-if buy cost",
    status: "RECEIVED",
    total20: args.buyCost,
    total40: args.buyCost,
    total40HC: args.buyCost,
    transitDays: args.transitDays ?? null,
    service: "What-if",
    validity: "7 days",
    createdAt: new Date().toISOString(),
  };
}

function compactStrategyForScenario(strategy: CommercialStrategy) {
  const executionPacket = buildStrategyExecutionPacket(strategy);
  const displayEvidenceCheck = (check: StrategyEvidenceCheck) => ({
    ...check,
    metric: operatorMetricLabel(check.metric, check.tone),
  });
  return {
    recommendation: strategy.recommendationLabel,
    strategy_grade: {
      band: strategy.band,
      confidence: strategy.confidence,
    },
    confidence: strategy.confidence,
    memo: strategy.strategyMemo,
    execution_packet: {
      ...executionPacket,
      evidence: {
        ...executionPacket.evidence,
        weakest: executionPacket.evidence.weakest ? displayEvidenceCheck(executionPacket.evidence.weakest) : null,
        checks: executionPacket.evidence.checks.map(displayEvidenceCheck),
      },
    },
    decision_contract: executionPacket.contract,
    price: strategy.price,
    quote_gate: strategy.quoteGate,
    operator_decision: strategy.operatorDecision,
    decision_reasons: strategy.decisionReasons,
    evidence_checks: strategy.evidenceChecks.map(displayEvidenceCheck),
    negotiation: strategy.negotiation,
    recommended_route: strategy.recommendedRoute,
    top_risks: strategy.riskAssessments.slice(0, 5),
    actions: strategy.actions,
    evidence: strategy.evidence,
  };
}

export function buildPricingScenarioInput(
  baseInput: CommercialStrategyInput,
  overrides: PricingScenarioOverrides
): CommercialStrategyInput {
  const currency = overrides.targetCurrency ?? baseInput.targetCurrency ?? baseInput.currency ?? "USD";
  const scenario: CommercialStrategyInput = {
    ...baseInput,
    targetCurrency: currency,
    currency: baseInput.currency ?? currency,
    carrierQuotes: [...(baseInput.carrierQuotes ?? [])],
    marginPolicy: {
      ...baseInput.marginPolicy,
      ...(cleanNumber(overrides.targetMarginPct) != null ? { targetMarginPct: cleanNumber(overrides.targetMarginPct) } : {}),
      ...(cleanNumber(overrides.minMarginPct) != null ? { minMarginPct: cleanNumber(overrides.minMarginPct) } : {}),
      ...(cleanNumber(overrides.stretchMarginPct) != null ? { stretchMarginPct: cleanNumber(overrides.stretchMarginPct) } : {}),
    },
  };

  if (overrides.noTarget) {
    scenario.targetPrice = null;
    scenario.targetPriceStatus = "NO_TARGET";
    scenario.targetPriceSource = "what-if:no-target";
  } else if (overrides.targetPrice !== undefined) {
    scenario.targetPrice = cleanNumber(overrides.targetPrice);
    scenario.targetPriceStatus = scenario.targetPrice == null ? "UNKNOWN" : "PROVIDED";
    scenario.targetPriceSource = "what-if:customer-target";
  }

  const buyCost = cleanNumber(overrides.buyCost);
  if (buyCost != null) {
    scenario.cost = buyCost;
    scenario.carrierQuotes = overrides.replaceExistingQuotes
      ? []
      : [...(scenario.carrierQuotes ?? [])];
    if (overrides.assumeLiveBuyCost !== false) {
      scenario.carrierQuotes = [
        scenarioCarrierQuote({ buyCost, currency, transitDays: overrides.transitDays }),
        ...(scenario.carrierQuotes ?? []),
      ];
    }
  }

  return scenario;
}

export function simulatePricingScenario(
  baseInput: CommercialStrategyInput,
  overrides: PricingScenarioOverrides
) {
  const current = assessCommercialStrategy(baseInput);
  const scenarioInput = buildPricingScenarioInput(baseInput, overrides);
  const scenario = assessCommercialStrategy(scenarioInput);
  const currency = scenario.price.currency;
  const target = scenario.evidence.targetPosture.target;
  const neededBuyCost = scenario.negotiation.targetBuyLimit;

  return {
    not_persisted: true,
    assumptions: {
      target_price: target,
      target_currency: scenario.evidence.targetPosture.currency,
      no_target: scenario.evidence.targetPosture.status === "NO_TARGET",
      buy_cost: scenario.price.buyCost,
      assumed_live_buy_cost: overrides.buyCost != null && overrides.assumeLiveBuyCost !== false,
      replaced_existing_quotes: Boolean(overrides.replaceExistingQuotes),
      target_margin_pct: scenarioInput.marginPolicy?.targetMarginPct ?? null,
      min_margin_pct: scenarioInput.marginPolicy?.minMarginPct ?? null,
      stretch_margin_pct: scenarioInput.marginPolicy?.stretchMarginPct ?? null,
    },
    verdict: {
      recommendation: scenario.recommendationLabel,
      quote_gate: scenario.quoteGate.label,
      can_send_to_forwarders: scenario.quoteGate.canSendToForwarders,
      can_quote_customer: scenario.quoteGate.canQuoteCustomer,
      approval_required: scenario.quoteGate.requiresApproval,
      operator_action: scenario.operatorDecision.ctaLabel,
      target_posture: scenario.evidence.targetPosture.label,
      guardrail: scenario.price.guardrailStatus,
      coverage: scenario.evidence.coveragePosture.label,
    },
    deltas: {
      band_changed: current.band !== scenario.band,
      confidence_changed: current.confidence !== scenario.confidence,
      recommended_price: delta(scenario.price.recommendedPrice, current.price.recommendedPrice),
      floor_price: delta(scenario.price.floorPrice, current.price.floorPrice),
      win_probability: delta(scenario.price.winProbability, current.price.winProbability),
      expected_margin_pct: delta(scenario.price.expectedMarginPct, current.price.expectedMarginPct),
    },
    economics: {
      buy_cost: money(scenario.price.buyCost, currency),
      floor_price: money(scenario.price.floorPrice, currency),
      recommended_price: money(scenario.price.recommendedPrice, currency),
      stretch_price: money(scenario.price.stretchPrice, currency),
      walk_away_price: money(scenario.price.walkAwayPrice, currency),
      margin_at_target_pct: scenario.evidence.targetPosture.marginAtTargetPct,
      target_buy_limit: neededBuyCost,
      target_buy_limit_label: money(neededBuyCost, currency),
      gap_to_floor_pct: scenario.evidence.targetPosture.gapToFloorPct,
      gap_to_recommended_pct: scenario.evidence.targetPosture.gapToRecommendedPct,
    },
    changed_decision: {
      recommendation_changed: current.recommendation !== scenario.recommendation,
      quote_gate_changed: current.quoteGate.status !== scenario.quoteGate.status,
      operator_action_changed: current.operatorDecision.actionType !== scenario.operatorDecision.actionType,
      from: {
        recommendation: current.recommendationLabel,
        quote_gate: current.quoteGate.label,
        operator_action: current.operatorDecision.ctaLabel,
      },
      to: {
        recommendation: scenario.recommendationLabel,
        quote_gate: scenario.quoteGate.label,
        operator_action: scenario.operatorDecision.ctaLabel,
      },
    },
    current: compactStrategyForScenario(current),
    scenario: compactStrategyForScenario(scenario),
    safety: "What-if only. No job, RFQ, target price history, carrier quote, or strategy snapshot was written.",
  };
}

export type PricingScenarioResult = ReturnType<typeof simulatePricingScenario>;
