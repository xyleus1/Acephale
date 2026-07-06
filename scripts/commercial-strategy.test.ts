import assert from "node:assert/strict";
import { assessCommercialStrategy, buildStrategyCommandLedger, buildStrategyDecisionBrief, buildStrategyExecutionPacket, buildStrategyRouteDecision } from "../src/lib/commercial-strategy";
import { dimensionCompleteness, totalChargeableCbm } from "../src/lib/cargo";
import { parsedCargoVolumeReview, parsedDimensionVolume, parsedDimensionsJson, parsedPackagesCount } from "../src/lib/agent-cargo-parse";
import { buildDecisionQueueBrief } from "../src/lib/decision-queue-brief";
import { buildCustomerQuoteDraft } from "../src/lib/customer-quote-draft";
import { buildForwarderDraft, coversForwarderMode, forwarderModeCoverageLabel } from "../src/lib/forwarder-draft-core";
import { buildMissingInfoDraft } from "../src/lib/missing-info-draft";
import { buildNegotiationPlanDraft } from "../src/lib/negotiation-plan-draft";
import { simulatePricingScenario } from "../src/lib/pricing-scenario";
import { buildPricingCommandFactors } from "../src/lib/pricing-command-factors";
import { buildRfqMaturityChecks, qualifyRfq } from "../src/lib/rfq-qualification";
import { commercialChecklistActionKind, commercialChecklistItemsWithActions } from "../src/lib/commercial-checklist-actions";
import { buildAgentProposalDecisionImpact } from "../src/lib/agent-proposal-impact";
import { buildReviewedFieldChanges, reviewedFieldTokenLabel } from "../src/lib/agent-proposal-review";
import { filterScopedProposalFields } from "../src/lib/agent-proposal-scope";
import type { DecisionQueueItem } from "../src/lib/decision-queue";
import {
  REFERENCE_DEALS,
  buildReferenceDealOperatorPlaybook,
  getReferenceDealDecisions,
  getReferenceDealSummary,
  referenceDealDecisionPlan,
  referenceDealToRfqDraft,
} from "../src/lib/reference-deals";

const base = {
  entityType: "INQUIRY" as const,
  subject: "Shanghai to Hamburg electronics",
  type: "FORWARDING",
  status: "PARSED",
  asOf: "2026-06-10T00:00:00Z",
  companyId: "c1",
  companyName: "Known Customer",
  origin: "Shanghai, CN",
  destination: "Hamburg, DE",
  mode: "SEA-FCL",
  containerCount: 1,
  containerType: "40HC",
  commodity: "Electronics",
  weight: 12000,
  dangerousGoods: "NO",
  customsBy: "CUSTOMER",
  targetCurrency: "USD",
  targetPriceStatus: "PROVIDED",
  customerStats: {
    known: true,
    jobs: 5,
    quoted: 8,
    won: 4,
    lost: 2,
    avgMarginPct: 18,
    avgProfit: 900,
    totalRevenue: 50000,
  },
  marginPolicy: { targetMarginPct: 18, minMarginPct: 12, stretchMarginPct: 25 },
};

{
  assert.equal(commercialChecklistActionKind("qualify"), "missing-info");
  assert.equal(commercialChecklistActionKind("target"), "missing-info");
  assert.equal(commercialChecklistActionKind("rates"), "forwarder-drafts");
  assert.equal(commercialChecklistActionKind("economics"), "negotiation-plan");
  assert.equal(commercialChecklistActionKind("approval"), "negotiation-plan");
  assert.equal(commercialChecklistActionKind("quote"), "customer-quote");

  const checklist = [
    { key: "qualify", label: "Qualify", owner: "CUSTOMER", action: "Ask facts.", why: "Missing cargo facts.", stopRule: "Wait for facts.", tone: "blocked", target: "source-rfq" },
    { key: "target", label: "Target", owner: "CUSTOMER", action: "Ask target.", why: "No target posture.", stopRule: "Wait for target posture.", tone: "review", target: "target-price" },
    { key: "rates", label: "Rates", owner: "FORWARDER", action: "Ask forwarder.", why: "Need live buy cost.", stopRule: "Wait for rates.", tone: "rates", target: "carrier-rates" },
    { key: "economics", label: "Economics", owner: "INTERNAL", action: "Review economics.", why: "Margin is weak.", stopRule: "Wait for approval.", tone: "blocked", target: "financials" },
    { key: "approval", label: "Approval", owner: "INTERNAL", action: "Approve.", why: "Approval required.", stopRule: "Wait for explicit approval.", tone: "review", target: "financials" },
    { key: "quote", label: "Quote", owner: "CUSTOMER", action: "Draft quote.", why: "Quote gate is ready.", stopRule: "Review before external send.", tone: "ready", target: "customer-quote" },
  ] as const;
  const items = commercialChecklistItemsWithActions([...checklist]);
  assert.deepEqual(items.map((item) => item.actionKind), [
    "missing-info",
    null,
    "forwarder-drafts",
    "negotiation-plan",
    null,
    "customer-quote",
  ]);
  assert.deepEqual(commercialChecklistItemsWithActions([...checklist], { limit: 3 }).map((item) => item.item.key), ["qualify", "target", "rates"]);
}

{
  const factors = buildPricingCommandFactors({
    phase: "GET_RATES",
    blockerCount: 0,
    guardrailStatus: "PASS",
    receivedQuotes: 2,
    band: "A",
    confidence: "high",
    decisionQuality: { tone: "blocked", metric: "31/100" },
  });
  const quality = factors.find((factor) => factor.label === "Decision quality");
  assert.equal(quality?.value, "Blocked");
  assert.equal(quality?.tone, "blocked");
  assert.equal(factors.some((factor) => factor.label === "Quality"), false);

  const fallback = buildPricingCommandFactors({
    phase: "QUOTE_CUSTOMER",
    blockerCount: 0,
    guardrailStatus: "PASS",
    receivedQuotes: 3,
    band: "A",
    confidence: "high",
  }).find((factor) => factor.label === "Decision quality");
  assert.equal(fallback?.tone, "review");
  assert.ok(fallback?.value.includes("No audit"));
}

function quote(id: string, total40HC: number, transitDays = 28) {
  return {
    id,
    carrier: `Forwarder ${id}`,
    status: "RECEIVED",
    total40HC,
    transitDays,
    validity: "7 days",
    createdAt: "2026-06-08T09:00:00Z",
  };
}

{
  const badTargetInput = {
    ...base,
    targetPrice: 1900,
    carrierQuotes: [quote("a", 2100)],
  };
  const s = assessCommercialStrategy(badTargetInput);
  assert.equal(s.price.guardrailStatus, "BLOCKED");
  assert.equal(s.evidence.coveragePosture.status, "THIN_LIVE");
  assert.equal(s.evidence.targetPosture.status, "BELOW_BUY");
  assert.equal(s.negotiation.posture, "COUNTER_COST");
  assert.equal(s.quoteGate.status, "REVIEW_REQUIRED");
  assert.equal(s.quoteGate.canQuoteCustomer, false);
  assert.ok(s.quoteGate.approvals.some((item) => item.includes("Below buy")));
  assert.equal(s.operatorDecision.phase, "APPROVE_ECONOMICS");
  assert.equal(s.operatorDecision.owner, "INTERNAL");
  assert.equal(s.operatorDecision.toolHint, "draft_negotiation_plan");
  const badTargetBrief = buildStrategyDecisionBrief(s);
  const badTargetPacket = buildStrategyExecutionPacket(s);
  const badTargetLedger = buildStrategyCommandLedger(s);
  assert.equal(badTargetBrief.operatorPlaybook.objective, "Fix economics before customer quote");
  assert.equal(badTargetBrief.decisionQuality?.tone, "blocked");
  assert.equal(badTargetBrief.decisionQuality?.key, "decision_quality");
  assert.equal(badTargetBrief.operatorPlaybook.toolHint, "draft_negotiation_plan");
  assert.ok(badTargetBrief.operatorPlaybook.exactAsk?.includes("Floor"));
  assert.ok(badTargetBrief.operatorPlaybook.safetyRule.includes("Do not quote the customer"));
  assert.ok(badTargetBrief.operatorPlaybook.stopCondition.includes("approval"));
  assert.equal(badTargetPacket.primary.toolHint, "draft_negotiation_plan");
  assert.equal(badTargetPacket.primary.reviewOnly, true);
  assert.equal(badTargetPacket.commercialPriority.tone, "blocked");
  assert.equal(badTargetPacket.commercialPriority.label, "Economics blocked");
  assert.ok(badTargetPacket.commercialPriority.economicUnlock.includes("Buy cost must move"));
  assert.ok(badTargetPacket.evidence.gaps.length > 0);
  assert.equal(badTargetPacket.evidence.gaps[0]?.tone, "blocked");
  assert.ok(badTargetPacket.evidence.gaps.every((gap) => gap.action.trim().length > 0));
  assert.equal(new Set(badTargetPacket.evidence.gaps.map((gap) => gap.key)).size, badTargetPacket.evidence.gaps.length);
  assert.ok(badTargetPacket.commercialPriority.rows.some((row) => row.key === "margin" && row.tone === "blocked"));
  assert.ok(badTargetPacket.commercialPriority.checklist.some((item) => item.key === "economics" && item.target === "financials"));
  assert.ok(badTargetPacket.commercialPriority.checklist.every((item) => item.why.trim().length > 0));
  assert.ok(badTargetPacket.commercialPriority.checklist.every((item) => !/^stop\b/i.test(item.stopRule.trim())));
  assert.ok(badTargetPacket.commercialPriority.checklist.some((item) => item.stopRule.includes("customer quote")));
  assert.equal(badTargetPacket.runway.length, 3);
  assert.equal(badTargetPacket.commandLedger.length, 5);
  assert.equal(badTargetPacket.contract.state, "blocked");
  assert.ok(badTargetPacket.contract.assumptions.some((item) => item.key === "target"));
  assert.ok(badTargetPacket.contract.forbidden.some((item) => item.includes("Do not quote")));
  assert.ok(badTargetPacket.contract.allowedAgentMoves.some((item) => item.includes("review")));
  assert.equal(badTargetPacket.commandLedger[1].key, "price_posture");
  assert.equal(badTargetPacket.commandLedger[1].tone, "blocked");
  assert.equal(badTargetPacket.runway[0].key, "evidence");
  assert.ok(badTargetPacket.safety.forbidden.some((item) => item.includes("Do not quote")));
  assert.equal(badTargetLedger.find((item) => item.key === "risk_approval")?.tone, "review");
  assert.ok(badTargetLedger.find((item) => item.key === "agent_artifact")?.toolHint === "draft_negotiation_plan");
  assert.ok(s.decisionReasons.some((reason) => reason.key === "target" && reason.tone === "blocker"));
  assert.ok(s.decisionReasons.some((reason) => reason.key === "economics" && reason.tone === "blocker"));
  assert.ok(s.decisionReasons.some((reason) => reason.key === "decision_quality" && reason.tone === "blocker"));
  assert.ok(s.strategyMemo.includes("Decision stack:"));
  assert.ok(s.strategyMemo.includes("Evidence map:"));
  assert.ok(s.strategyMemo.includes("Decision quality:"));
  assert.ok(s.evidenceChecks.some((check) => check.key === "target" && check.tone === "blocked"));
  assert.ok(s.evidenceChecks.some((check) => check.key === "economics" && check.tone === "blocked"));
  const badTargetQuality = s.evidenceChecks.find((check) => check.key === "decision_quality");
  assert.equal(badTargetQuality?.tone, "blocked");
  assert.ok(badTargetQuality?.detail.includes("score impersonate certainty"));
  assert.ok(s.negotiation.forwarderCounter.includes("Current buy"));
  assert.ok(["NEGOTIATE", "DECLINE"].includes(s.recommendation));
  assert.ok(s.riskAssessments.some((r) => r.category === "COMMERCIAL" && r.level === "CRITICAL"));

  const scenario = simulatePricingScenario(badTargetInput, {
    targetPrice: 3400,
    buyCost: 2000,
    assumeLiveBuyCost: true,
  });
  assert.equal(scenario.not_persisted, true);
  assert.equal(scenario.verdict.can_quote_customer, true);
  assert.equal(scenario.verdict.quote_gate, "Ready to quote");
  assert.equal(scenario.verdict.guardrail, "PASS");
  assert.equal(scenario.changed_decision.quote_gate_changed, true);
  assert.equal(scenario.deltas.band_changed || scenario.deltas.confidence_changed, true);
  assert.notEqual(scenario.scenario.strategy_grade.band, scenario.current.strategy_grade.band);
  assert.equal(scenario.safety.includes("No job"), true);

  const plan = buildNegotiationPlanDraft({
    reference: "JOB-NEG-1",
    customerName: "Known Customer",
    origin: base.origin,
    destination: base.destination,
    mode: base.mode,
  }, s);
  assert.equal(plan.status, "READY");
  assert.equal(plan.guardrails.approvalRequired, true);
  assert.ok(plan.body.includes("Forwarder counter"));
  assert.ok(plan.body.includes("Target buy limit"));
  assert.ok(plan.decisionReasons.some((reason) => reason.key === "target"));
  assert.ok(plan.topRisks.some((risk) => risk.category === "COMMERCIAL"));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 2300,
    carrierQuotes: [quote("a", 2100), quote("b", 2125)],
  });
  assert.equal(s.evidence.targetPosture.status, "BELOW_FLOOR");
  assert.equal(s.quoteGate.status, "REVIEW_REQUIRED");
  assert.equal(s.quoteGate.requiresApproval, true);
  assert.equal(s.operatorDecision.title, "Fix economics before customer quote");
  assert.ok((s.evidence.targetPosture.gapToFloorPct ?? 0) < 0);
  assert.ok(s.strategyMemo.includes("Target posture: Below floor."));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 3400,
    targetHistory: [
      { id: "target-old", amount: 3100, currency: "USD", status: "PROVIDED", source: "customer email", createdAt: "2026-06-01T10:00:00Z" },
      { id: "target-new", amount: 3400, currency: "USD", status: "PROVIDED", source: "customer follow-up", createdAt: "2026-06-05T10:00:00Z" },
    ],
    documents: [
      {
        id: "doc-1",
        name: "Commercial Invoice",
        docType: "INVOICE",
        status: "UPLOADED",
      },
    ],
    carrierQuotes: [quote("a", 2000), quote("b", 2050), quote("c", 2100)],
  });
  assert.equal(s.evidence.targetPosture.status, "GENEROUS");
  assert.equal(s.negotiation.posture, "SELL_CONFIDENTLY");
  assert.equal(s.negotiation.approvalRequired, false);
  assert.equal(s.quoteGate.status, "READY_TO_QUOTE");
  assert.equal(s.quoteGate.canSendToForwarders, true);
  assert.equal(s.quoteGate.canQuoteCustomer, true);
  assert.equal(s.operatorDecision.phase, "QUOTE_CUSTOMER");
  assert.equal(s.operatorDecision.requiresApproval, false);
  assert.equal(s.operatorDecision.toolHint, "draft_customer_quote");
  const quoteReadyLedger = buildStrategyCommandLedger(s);
  assert.equal(quoteReadyLedger.find((item) => item.key === "rfq_gate")?.tone, "ready");
  assert.equal(quoteReadyLedger.find((item) => item.key === "price_posture")?.tone, "ready");
  assert.equal(quoteReadyLedger.find((item) => item.key === "agent_artifact")?.toolHint, "draft_customer_quote");
  assert.equal(quoteReadyLedger.find((item) => item.key === "agent_artifact")?.tone, "ready");
  assert.ok(s.decisionReasons.some((reason) => reason.key === "economics" && reason.tone === "support"));
  assert.ok(s.decisionReasons.some((reason) => reason.key === "agent" && reason.summary === "Prepare customer quote"));
  assert.ok(s.evidenceChecks.some((check) => check.key === "coverage" && check.tone === "ready"));
  assert.equal(s.evidence.rateFreshness?.tone, "ready");
  assert.ok(s.evidenceChecks.some((check) => check.key === "rate_freshness" && check.tone === "ready"));
  assert.ok(s.evidenceChecks.some((check) => check.key === "risk" && check.tone === "ready"));
  assert.equal(s.evidence.targetTrail?.direction, "RAISED");
  assert.ok(s.evidenceChecks.some((check) => check.key === "target_trail" && check.tone === "ready"));
  assert.ok(s.evidenceChecks.some((check) => check.key === "documents" && check.tone === "review"));
  const quoteReadyQuality = s.evidenceChecks.find((check) => check.key === "decision_quality");
  assert.equal(quoteReadyQuality?.tone, "review");
  assert.ok(quoteReadyQuality?.detail.includes("document proof"));
  assert.equal(s.evidence.documentReadiness?.label, "Documents need approval");
  assert.ok(s.maturityChecks.filter((check) => check.status !== "not_applicable").every((check) => check.status === "ready"));
  assert.equal(s.blockerResolutionPlan.length, 0);
  assert.ok(s.strategyMemo.includes("Operator decision: Prepare customer quote."));
  assert.ok(s.strategyMemo.includes("Maturity checklist:"));
  assert.ok(s.strategyMemo.includes("Target trail: Target improved."));
  assert.ok(s.strategyMemo.includes("Document proof: Documents need approval."));
  assert.ok((s.evidence.targetPosture.marginAtTargetPct ?? 0) > 30);
  assert.ok(s.strengths.some((item) => item.includes("Customer target leaves room")));
  assert.ok(s.strengths.some((item) => item.includes("Target trail improved")));

  const packetWithDocs = buildStrategyExecutionPacket(s);
  assert.equal(packetWithDocs.evidence.weakest?.key, "documents");
  assert.equal(packetWithDocs.commercialPriority.tone, "review");
  assert.equal(packetWithDocs.commercialPriority.label, "Review before quote");
  assert.ok(packetWithDocs.evidence.gaps.some((gap) => gap.key === "documents" && gap.tone === "review"));
  assert.ok(packetWithDocs.evidence.gaps.every((gap) => gap.action.trim().length > 0));
  assert.ok(packetWithDocs.commercialPriority.whyNow.includes("Expected gross profit"));
  assert.ok(packetWithDocs.commercialPriority.rows.some((row) => row.key === "target" && row.detail.includes("improved target")));
  assert.ok(packetWithDocs.commercialPriority.checklist.every((item) => item.why.trim().length > 0));
  assert.ok(packetWithDocs.commercialPriority.checklist.every((item) => !/^stop\b/i.test(item.stopRule.trim())));
  assert.ok(packetWithDocs.commercialPriority.checklist.some((item) => item.key === "approval" || item.key === "quote"));
  assert.equal(packetWithDocs.brief.decisionQuality?.key, "decision_quality");
  assert.equal(packetWithDocs.brief.decisionQuality?.tone, "review");
  assert.equal(packetWithDocs.contract.state, "review");
  assert.ok(packetWithDocs.contract.summary.includes("Prepare customer quote"));
  assert.ok(packetWithDocs.contract.proven.some((item) => item.key === "quote_gate" && item.tone === "ready"));
  assert.ok(packetWithDocs.contract.assumptions.some((item) => item.key === "documents"));
  assert.ok(packetWithDocs.contract.allowedAgentMoves.some((item) => item.includes("review artifact")));
  assert.equal(packetWithDocs.runway[0].title, "Document proof");
  assert.ok(packetWithDocs.runway[0].detail.includes("approve"));
}

{
  const s = assessCommercialStrategy({
    ...base,
    asOf: "2026-06-20T00:00:00Z",
    targetPrice: 3400,
    carrierQuotes: [
      { ...quote("old-a", 2000), createdAt: "2026-06-01T09:00:00Z", validity: "7 days" },
      { ...quote("old-b", 2050), createdAt: "2026-06-01T09:00:00Z", validity: "7 days" },
      { ...quote("old-c", 2100), createdAt: "2026-06-01T09:00:00Z", validity: "7 days" },
    ],
  });
  assert.equal(s.evidence.rateFreshness?.tone, "blocked");
  assert.equal(s.evidence.rateFreshness?.reliableLiveQuotes, 0);
  assert.equal(s.evidence.coveragePosture.status, "STALE_LIVE");
  assert.equal(s.recommendedRoute?.confidence, "low");
  assert.equal(s.recommendedRoute?.evidence?.rateFreshnessStatus, "expired");
  assert.equal(s.recommendation, "REQUEST_RATES");
  assert.equal(s.quoteGate.status, "NEEDS_RATES");
  assert.equal(s.quoteGate.canQuoteCustomer, false);
  assert.ok(s.quoteGate.blockers.some((blocker) => blocker.includes("current forwarder quote")));
  assert.ok(s.evidenceChecks.some((check) => check.key === "rate_freshness" && check.tone === "blocked"));
  assert.ok(s.actions.some((action) => action.title === "Refresh unusable forwarder rates"));
  assert.ok(s.strategyMemo.includes("Rate freshness: Refresh rates."));
}

{
  const s = assessCommercialStrategy({
    ...base,
    asOf: "2026-06-20T00:00:00Z",
    targetPrice: 4200,
    carrierQuotes: [
      { ...quote("cheap-expired", 1800), carrier: "Cheap expired", createdAt: "2026-06-01T09:00:00Z", validity: "7 days" },
      { ...quote("valid", 2400), carrier: "Valid carrier", createdAt: "2026-06-19T09:00:00Z", validity: "7 days" },
    ],
  });
  assert.equal(s.evidence.rateFreshness?.tone, "review");
  assert.equal(s.evidence.rateFreshness?.reliableLiveQuotes, 1);
  assert.equal(s.evidence.coveragePosture.status, "THIN_LIVE");
  assert.equal(s.recommendedRoute?.provider, "Valid carrier");
  assert.equal(s.recommendedRoute?.confidence, "high");
  assert.equal(s.recommendedRoute?.evidence?.rateFreshnessStatus, "valid");
  assert.ok(s.routeOptions.some((route) => route.provider === "Cheap expired" && route.confidence === "low"));
  assert.equal(s.quoteGate.status, "REVIEW_REQUIRED");
  assert.ok(s.quoteGate.approvals.includes("Rate validity mixed"));
  const routeDecision = buildStrategyRouteDecision(s);
  assert.equal(routeDecision.selected?.provider, "Valid carrier");
  assert.equal(routeDecision.selected?.rateReliable, true);
  assert.equal(routeDecision.alternatives.some((route) => route.provider === "Cheap expired" && route.rateReliable === false), true);
  assert.equal(routeDecision.canQuoteCustomer, false);
  assert.ok(routeDecision.summary.includes("quote gate"));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 2500,
    targetHistory: [
      { id: "target-high", amount: 3300, currency: "USD", status: "PROVIDED", source: "customer first ask", createdAt: "2026-06-01T10:00:00Z" },
      { id: "target-low", amount: 2500, currency: "USD", status: "PROVIDED", source: "customer revision", createdAt: "2026-06-06T10:00:00Z" },
    ],
    carrierQuotes: [quote("a", 2000), quote("b", 2050)],
  });
  assert.equal(s.evidence.targetTrail?.direction, "LOWERED");
  assert.equal(s.evidence.targetTrail?.tone, "review");
  assert.ok(s.evidenceChecks.some((check) => check.key === "target_trail" && check.tone === "review"));
  assert.ok(s.decisionReasons.some((reason) => reason.key === "target_trail" && reason.tone === "review"));
  assert.ok(s.risks.some((risk) => risk.includes("Customer target moved down")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 3400,
    carrierQuotes: [
      { ...quote("a", 2000, 24), carrier: "DSV", validity: "7 days" },
      quote("b", 2050),
      quote("c", 2100),
    ],
  });
  const draft = buildCustomerQuoteDraft({
    subject: base.subject,
    customerName: "Known Customer",
    origin: base.origin,
    destination: base.destination,
    mode: base.mode,
    commodity: base.commodity,
    containerCount: base.containerCount,
    containerType: base.containerType,
    weight: base.weight,
    incoterms: "FOB",
    dangerousGoods: base.dangerousGoods,
    customsBy: base.customsBy,
    carrierQuotes: [
      { ...quote("a", 2000, 24), carrier: "DSV", validity: "7 days" },
      quote("b", 2050),
      quote("c", 2100),
    ],
  }, s);
  assert.equal(draft.status, "READY");
  assert.ok(draft.subject?.includes("Shanghai, CN to Hamburg, DE"));
  assert.ok(draft.body?.includes("Price: USD"));
  assert.ok(draft.body?.includes("Service basis: DSV"));
  assert.ok(draft.body?.includes("Please confirm if you would like us to proceed with booking."));
  assert.equal(draft.lineItems.length, 1);
  assert.equal(draft.internalGuardrails.selectedProvider, "DSV");
  assert.ok(!draft.body?.includes("floor"));
}

{
  const quotes = [
    { ...quote("cheapest-unselected", 1800, 22), carrier: "Cheapest unselected", createdAt: "2026-06-08T09:00:00Z", validity: "7 days" },
    { ...quote("valid", 2400, 24), carrier: "Valid carrier", createdAt: "2026-06-08T09:00:00Z", validity: "7 days" },
    { ...quote("backup", 2450, 28), carrier: "Backup carrier", createdAt: "2026-06-08T09:00:00Z", validity: "7 days" },
  ];
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 3400,
    carrierQuotes: quotes,
  });
  const benchmarkStrategy = {
    ...s,
    recommendedRoute: s.recommendedRoute ? {
      ...s.recommendedRoute,
      label: "Internal benchmark",
      provider: "Internal benchmark",
      source: "LANE_RATE" as const,
      carrierQuoteId: null,
      evidence: { laneRateId: "lr-test" },
    } : null,
  };
  const draft = buildCustomerQuoteDraft({
    subject: base.subject,
    customerName: "Known Customer",
    origin: base.origin,
    destination: base.destination,
    mode: base.mode,
    commodity: base.commodity,
    containerCount: base.containerCount,
    containerType: base.containerType,
    weight: base.weight,
    incoterms: "FOB",
    dangerousGoods: base.dangerousGoods,
    customsBy: base.customsBy,
    carrierQuotes: quotes,
  }, benchmarkStrategy);
  assert.equal(draft.status, "READY");
  assert.equal(draft.internalGuardrails.selectedProvider, "Internal benchmark");
  assert.equal(draft.internalGuardrails.selectedValidity, null);
  assert.ok(draft.body?.includes("Service basis: Internal benchmark"));
  assert.ok(!draft.body?.includes("Cheapest unselected"));
  assert.ok(!draft.customerFacingAssumptions.some((item) => item.includes("Forwarder validity")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    origin: null,
    targetPrice: 3500,
    carrierQuotes: [quote("a", 2400), quote("b", 2500), quote("c", 2600)],
  });
  const draft = buildCustomerQuoteDraft({
    subject: base.subject,
    origin: null,
    destination: base.destination,
    mode: base.mode,
    carrierQuotes: [quote("a", 2400), quote("b", 2500), quote("c", 2600)],
  }, s);
  assert.equal(draft.status, "BLOCKED");
  assert.equal(draft.body, null);
  assert.ok(draft.blockers.some((item) => item.toLowerCase().includes("origin")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    origin: null,
    targetPrice: 3500,
    carrierQuotes: [quote("a", 2400), quote("b", 2500), quote("c", 2600)],
  });
  assert.equal(s.recommendation, "ASK_CUSTOMER");
  assert.equal(s.negotiation.posture, "MATURE_FIRST");
  assert.equal(s.quoteGate.status, "BLOCKED");
  assert.equal(s.quoteGate.canSendToForwarders, false);
  assert.equal(s.quoteGate.canQuoteCustomer, false);
  assert.ok(s.quoteGate.blockers.some((m) => m.toLowerCase().includes("origin")));
  assert.equal(s.operatorDecision.phase, "MATURE_RFQ");
  assert.equal(s.operatorDecision.actionType, "ASK_CUSTOMER");
  assert.equal(s.operatorDecision.surfaceHint, "rfq_missing_info");
  const immatureLedger = buildStrategyCommandLedger(s);
  assert.equal(immatureLedger[0].key, "rfq_gate");
  assert.equal(immatureLedger[0].tone, "blocked");
  assert.equal(immatureLedger[0].owner, "CUSTOMER");
  assert.ok(immatureLedger[0].stopRule.includes("forwarder"));
  assert.equal(immatureLedger.find((item) => item.key === "agent_artifact")?.toolHint, "draft_missing_info_request");
  assert.equal(s.decisionReasons[0].key, "maturity");
  assert.equal(s.decisionReasons[0].tone, "blocker");
  assert.equal(s.maturityChecks.find((check) => check.key === "origin")?.status, "missing");
  assert.equal(s.maturityChecks.find((check) => check.key === "target_price")?.status, "ready");
  assert.equal(s.blockerResolutionPlan[0]?.key, "origin");
  assert.equal(s.blockerResolutionPlan[0]?.priority, "critical");
  assert.ok(s.blockerResolutionPlan[0]?.ask.toLowerCase().includes("origin"));
  assert.ok(s.strategyMemo.includes("Clear first: Origin."));
  assert.ok(s.evidenceChecks.some((check) => check.key === "rfq" && check.tone === "blocked"));
  assert.equal(s.evidenceChecks.find((check) => check.key === "decision_quality")?.tone, "blocked");
  assert.ok(s.negotiation.customerTalkTrack.includes("Origin"));
  assert.notEqual(s.confidence, "high");
  assert.ok(s.missing.some((m) => m.toLowerCase().includes("origin")));
}

{
  const one = assessCommercialStrategy({ ...base, targetPrice: 3400, carrierQuotes: [quote("a", 2400)] });
  const three = assessCommercialStrategy({ ...base, targetPrice: 3400, carrierQuotes: [quote("a", 2400), quote("b", 2500), quote("c", 2600)] });
  assert.ok(three.components.confidence > one.components.confidence);
  assert.equal(one.evidence.coveragePosture.status, "THIN_LIVE");
  assert.equal(three.evidence.coveragePosture.status, "STRONG_LIVE");
  assert.ok(one.riskAssessments.some((r) => r.reason.includes("Only one received")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 3300,
    carrierQuotes: [quote("a", 2400), quote("b", 2450)],
  });
  assert.equal(s.evidence.coveragePosture.status, "WORKABLE_LIVE");
  assert.ok(["SELL_CONFIDENTLY", "PROTECT_FLOOR"].includes(s.negotiation.posture));
  assert.ok(s.strategyMemo.includes("Coverage posture: Workable live coverage."));
}

{
  const s = assessCommercialStrategy({
    ...base,
    dangerousGoods: "YES",
    targetPrice: 3600,
    carrierQuotes: [quote("a", 2500), quote("b", 2600), quote("c", 2700)],
  });
  assert.ok(s.riskAssessments.some((r) => r.category === "CARGO" && r.reason.includes("Dangerous goods")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: 3600,
    carrierQuotes: [],
    historicalJobs: [{
      id: "h1",
      reference: "JOB-HIST-1",
      origin: "Shanghai",
      destination: "Hamburg",
      mode: "SEA-FCL",
      cost: 2200,
      revenue: 3100,
      currency: "USD",
    }],
  });
  assert.equal(s.recommendedRoute?.source, "HISTORY");
  assert.equal(s.evidence.coveragePosture.status, "HISTORY_ONLY");
  assert.equal(s.quoteGate.status, "NEEDS_RATES");
  assert.equal(s.quoteGate.canSendToForwarders, true);
  assert.equal(s.quoteGate.canQuoteCustomer, false);
  assert.equal(s.operatorDecision.phase, "GET_RATES");
  assert.equal(s.operatorDecision.surfaceHint, "pricing_forwarder_drafts");
  assert.equal(s.operatorDecision.toolHint, "create_forwarder_drafts");
  assert.ok(s.operatorDecision.command.includes("Request live forwarder rates"));
  assert.notEqual(s.price.guardrailStatus, "NEEDS_COST");
  assert.ok(s.evidence.historicalLaneJobs > 0);
}

{
  const s = assessCommercialStrategy({
    ...base,
    targetPrice: null,
    targetPriceStatus: "UNKNOWN",
    carrierQuotes: [],
    sourceEconomics: {
      source: "reference-deal",
      contact: "Pinar Hn",
      contract: "Soybean Meal",
      status: "Pricing/Chasing",
      cadence: "Monthly",
      contractValue: 227000,
      contractCurrency: "USD",
      expectedProfit: 15000,
      profitCurrency: "USD",
    },
  });
  assert.equal(s.evidence.targetPrice, null);
  assert.equal(s.evidence.sourceEconomics?.expectedProfit, 15000);
  assert.ok(s.strengths.some((item) => item.includes("Control sheet profit context")));
  assert.ok(s.strategyMemo.includes("context, not a confirmed target price"));
  assert.ok(s.missing.includes("Target price or no-target confirmation"));
  const sourceBrief = buildStrategyDecisionBrief(s);
  assert.equal(sourceBrief.operatorPlaybook.toolHint, "draft_missing_info_request");
  assert.ok(sourceBrief.operatorPlaybook.exactAsk?.includes("target price"));
  assert.ok(sourceBrief.operatorPlaybook.evidenceGap?.includes("RFQ facts"));
  assert.ok(sourceBrief.operatorPlaybook.safetyRule.includes("Do not send to forwarders"));
}

{
  const summary = getReferenceDealSummary();
  const decisions = getReferenceDealDecisions(undefined, 4);
  assert.ok(summary.activeRows > 0);
  assert.ok(summary.knownContractUsd > 0);
  assert.ok(summary.topDeals.some((deal) => deal.contract === "Soybean Meal"));
  assert.equal(decisions.length, 4);
  assert.ok(decisions.every((decision) => decision.nextAction.length > 0));
  assert.ok(decisions.every((decision) => decision.priorityFactors.length > 0));
  assert.ok(decisions.every((decision) => decision.score <= 100));
  assert.ok(decisions.some((decision) => decision.priorityFactors.some((factor) => factor.label === "Profit")));
  assert.ok(decisions.every((decision) => decision.decision.stopRule.length > 0));
  assert.ok(decisions.every((decision) => decision.priorityFactors.some((factor) => factor.label === "Decision")));
  assert.ok(decisions.some((decision) => decision.title.startsWith("Qualify sheet lead:")));
  assert.ok(decisions.every((decision) => decision.dealId && !decision.dealId.startsWith("reference-deal-")));

  const soybean = REFERENCE_DEALS.find((deal) => deal.contract === "Soybean Meal");
  assert.ok(soybean);
  const soybeanDecision = referenceDealDecisionPlan(soybean);
  assert.equal(soybeanDecision.stage, "QUALIFY_LEAD");
  assert.equal(soybeanDecision.canCreateRfq, true);
  assert.ok(soybeanDecision.evidenceGaps.includes("target price or no-target confirmation"));
  assert.ok(soybeanDecision.stopRule.includes("Do not forward or quote"));

  const financing = REFERENCE_DEALS.find((deal) => deal.contract === "Malaysia");
  assert.ok(financing);
  const financingDecision = referenceDealDecisionPlan(financing);
  assert.equal(financingDecision.stage, "NON_RFQ");
  assert.equal(financingDecision.canCreateRfq, false);
  assert.ok(financingDecision.stopRule.includes("freight RFQ workflow"));

  const booked = REFERENCE_DEALS.find((deal) => deal.contract === "Sudan-Adana");
  assert.ok(booked);
  const bookedDecision = referenceDealDecisionPlan(booked);
  assert.equal(bookedDecision.stage, "MARGIN_PROOF");
  assert.equal(bookedDecision.canCreateRfq, false);

  const playbook = buildReferenceDealOperatorPlaybook(decisions, summary);
  assert.equal(playbook.visualTarget, "reference-deal-top");
  assert.equal(playbook.reviewHref, "/dashboard#reference-deals");
  assert.ok(playbook.headline.startsWith("Qualify first: Qualify sheet lead: Soybean Meal"));
  assert.ok(playbook.firstMove.includes("Clear product first"));
  assert.ok(playbook.safetyRule.includes("Do not forward or quote"));
  assert.equal(playbook.topDecision?.canCreateRfq, true);
  assert.ok(playbook.topDecision?.evidenceGaps.includes("target price or no-target confirmation"));
  assert.ok(playbook.decisionCounts.rfqCandidates > 0);
  assert.ok(playbook.decisionCounts.nonRfqContext > 0);
  assert.ok(playbook.answerRules.some((rule) => rule.includes("not customer target price")));
}

{
  const queueItems: DecisionQueueItem[] = [
    {
      key: "lead-soybean",
      tone: "critical",
      category: "LEAD",
      entityType: "lead",
      entityId: "reference-deal-soybean",
      title: "Qualify sheet lead: Soybean Meal",
      meta: "Pinar Hn · Supply + Freight",
      reason: "Control-sheet opportunity ranks high enough to deserve operator attention.",
      actionLabel: "Create RFQ",
      href: "/dashboard?lead=reference-deal-soybean#reference-deals",
      score: 97,
      priorityFactors: [
        { label: "Value", value: "$227,000", tone: "strong" },
        { label: "Profit", value: "$15,000 profit", tone: "strong" },
        { label: "Missing", value: "1", tone: "weak" },
      ],
      gateChecks: [
        {
          label: "Lead facts",
          status: "blocked",
          metric: "1 missing",
          detail: "Confirm product/commodity before pricing or forwarding this lead.",
        },
        {
          label: "Economics",
          status: "ready",
          metric: "$15,000 profit",
          detail: "Sheet economics are useful context, not confirmed target price.",
        },
      ],
      rankReasons: [
        {
          label: "Small blocker",
          summary: "1 missing",
          detail: "One product fact unlocks the RFQ.",
          tone: "blocker",
        },
        {
          label: "Profit context",
          summary: "$15,000 profit",
          detail: "Known profit context makes this worth ranking first.",
          tone: "support",
        },
      ],
      blockers: [
        {
          label: "Product",
          ask: "Confirm product/commodity before pricing or forwarding this lead.",
          owner: "CUSTOMER",
          priority: "high",
        },
      ],
      decisionMove: {
        phase: "QUALIFY_LEAD",
        label: "Clear lead facts",
        owner: "CUSTOMER",
        command: "Confirm product/commodity before pricing or forwarding this lead.",
        toolHint: "prepare_control_sheet_rfq",
        canRunNow: true,
        requiresApproval: true,
      },
    },
    {
      key: "rfq-missing-1",
      tone: "critical",
      category: "RFQ",
      entityType: "inquiry",
      entityId: "inq_1",
      title: "Complete RFQ: Texas chemicals",
      meta: "Missing weight, dangerous goods",
      reason: "Pricing before RFQ maturity is fake precision.",
      actionLabel: "Fill gaps",
      href: "/dashboard/rfq/inq_1",
      score: 91,
    },
    {
      key: "pricing-1",
      tone: "high",
      category: "PRICING",
      entityType: "inquiry",
      entityId: "inq_2",
      title: "Create forwarder drafts: China Spare Parts",
      meta: "Shanghai to Ambarli",
      reason: "No carrier cost means no defensible customer price.",
      actionLabel: "Create drafts",
      href: "/dashboard/pricing?inquiry=inq_2",
      score: 82,
    },
  ];
  const brief = buildDecisionQueueBrief(queueItems);
  assert.equal(brief.focus?.category, "LEAD");
  assert.equal(brief.top_action, "Create RFQ from sheet lead");
  assert.ok(brief.operator_summary?.startsWith("Start with Create RFQ from sheet lead"));
  assert.ok(brief.operator_summary?.includes("Priority factors: Value: $227,000; Profit: $15,000 profit; Missing: 1."));
  assert.equal(brief.top_priority_factors, "Value: $227,000; Profit: $15,000 profit; Missing: 1");
  assert.equal(brief.execution_brief?.action, "Create RFQ");
  assert.equal(brief.execution_brief?.safe_action_label, "Create RFQ from sheet lead");
  assert.equal(brief.execution_brief?.next_step, "Confirm product/commodity before pricing or forwarding this lead.");
  assert.ok(brief.execution_brief?.safety.includes("not treat it as a customer target price"));
  assert.equal(brief.execution_brief?.evidence[0]?.label, "Value");
  assert.equal(brief.execution_brief?.evidence[1]?.value, "$15,000 profit");
  assert.equal(brief.execution_brief?.blockers[0]?.label, "Product");
  assert.ok(brief.execution_brief?.blockers[0]?.ask.includes("Confirm product"));
  assert.equal(brief.execution_brief?.gate_checks[0]?.label, "Lead facts");
  assert.equal(brief.execution_brief?.gate_checks[0]?.status, "blocked");
  assert.equal(brief.execution_brief?.rank_reasons[0]?.label, "Small blocker");
  assert.equal(brief.execution_brief?.rank_reasons[1]?.summary, "$15,000 profit");
  assert.equal(brief.execution_brief?.decision_move?.label, "Clear lead facts");
  assert.equal(brief.execution_brief?.decision_move?.owner, "CUSTOMER");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.label, "Lead facts");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.target, "blocker-resolution");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.owner, "CUSTOMER");
  assert.ok(brief.execution_brief?.proof_gaps[0]?.action.includes("Confirm product"));
  assert.equal(brief.execution_brief?.visual_target, "reference-deal-top");
  assert.equal(brief.execution_brief?.visual_target_label, "Lead row");
  assert.ok(brief.operator_summary?.includes("Proof gap: Lead facts"));
  assert.ok(brief.operator_summary?.includes("Move: Clear lead facts"));
  assert.ok(brief.operator_summary?.includes("Gate: Lead facts: 1 missing"));
  assert.ok(brief.operator_summary?.includes("Ranked because: Small blocker: 1 missing"));
  assert.equal(brief.top_move?.priority_factors?.[0]?.label, "Value");
  assert.equal(brief.top_move?.gate_checks?.[0]?.metric, "1 missing");
  assert.equal(brief.top_move?.rank_reasons?.[0]?.summary, "1 missing");
  assert.equal(brief.top_move?.blockers?.[0]?.owner, "CUSTOMER");
  assert.equal(brief.top_move?.decision_move?.toolHint, "prepare_control_sheet_rfq");
  assert.equal(brief.top_move?.proof_gaps?.[0]?.label, "Lead facts");
  assert.equal(brief.top_move?.visual_target, "reference-deal-top");
  assert.equal(brief.top_move?.visual_target_label, "Lead row");
  assert.equal(brief.categories.LEAD, 1);
  assert.equal(brief.categoryBreakdown[0].label, "Lead intake");
  assert.equal(brief.next_moves[0].entity_id, "reference-deal-soybean");
  assert.equal(brief.quick_actions[0]?.action, "Create RFQ from sheet lead");
  assert.ok(brief.quick_actions.every((action) => action.requires_human_approval));
  assert.ok(brief.focus?.operator_mode.includes("sheet leads"));
}

{
  const brief = buildDecisionQueueBrief([
    {
      key: "pricing-quality",
      tone: "high",
      category: "PRICING",
      entityType: "inquiry",
      entityId: "inq_quality",
      title: "Create forwarder drafts: Izmir to Jeddah",
      meta: "Izmir to Jeddah · SEA-FCL",
      reason: "The route needs market coverage before customer pricing.",
      actionLabel: "Create drafts",
      href: "/dashboard/pricing?inquiry=inq_quality",
      score: 88,
      priorityFactors: [
        { label: "Gross profit", value: "USD 2,000", tone: "watch" },
        { label: "Maturity", value: "76/100", tone: "watch" },
        { label: "Decision quality", value: "34/100", tone: "weak" },
      ],
      gateChecks: [
        {
          label: "Decision quality",
          status: "blocked",
          metric: "34/100",
          detail: "Current recommendation can change if RFQ facts are missing.",
        },
      ],
    },
  ]);
  assert.ok(brief.operator_summary?.includes("Decision quality Blocked"));
  assert.ok(brief.top_priority_factors?.includes("Maturity: Needs proof"));
  assert.ok(brief.top_priority_factors?.includes("Decision quality: Blocked"));
  assert.equal(brief.execution_brief?.evidence[2]?.label, "Decision quality");
  assert.equal(brief.execution_brief?.evidence[1]?.value, "Needs proof");
  assert.equal(brief.execution_brief?.evidence[2]?.value, "Blocked");
  assert.equal(brief.execution_brief?.gate_checks[0]?.label, "Decision quality");
  assert.equal(brief.execution_brief?.gate_checks[0]?.metric, "Blocked");
  assert.equal(brief.execution_brief?.decision_quality?.metric, "Blocked");
  assert.equal(brief.execution_brief?.decision_quality?.tone, "blocked");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.label, "Decision quality");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.metric, "Blocked");
  assert.equal(brief.execution_brief?.proof_gaps[0]?.target, "decision-quality");
}

{
  const leadDecisionBrief = buildDecisionQueueBrief([
    {
      key: "lead-decision-soybean",
      tone: "critical",
      category: "LEAD",
      entityType: "lead",
      entityId: "pinar-hn-supply-freight-soybean-meal",
      title: "Qualify sheet lead: Soybean Meal",
      meta: "Pinar Hn · Supply + Freight · $227,000 · $15,000 profit · missing product",
      reason: "$15,000 profit makes this worth fast qualification; still not a customer target price.",
      actionLabel: "Draft RFQ",
      href: "/dashboard?lead=pinar-hn-supply-freight-soybean-meal#reference-deals",
      score: 100,
      gateChecks: [
        {
          label: "Lead decision",
          status: "blocked",
          metric: "Qualify first",
          detail: "Do not forward or quote this row until the missing lane/cargo facts and target posture are explicit.",
        },
      ],
      decisionMove: {
        phase: "QUALIFY_LEAD",
        label: "Qualify first",
        owner: "CUSTOMER",
        command: "Clear product first, then create the RFQ with target/no-target, DG, and customs explicitly marked.",
        toolHint: "prepare_control_sheet_rfq",
        canRunNow: true,
        requiresApproval: true,
      },
    },
  ]);
  assert.equal(leadDecisionBrief.execution_brief?.next_step, "Clear product first, then create the RFQ with target/no-target, DG, and customs explicitly marked.");
  assert.equal(leadDecisionBrief.execution_brief?.safety, "Do not forward or quote this row until the missing lane/cargo facts and target posture are explicit.");
  assert.equal(leadDecisionBrief.execution_brief?.visual_target, "reference-deal-top");
  assert.equal(leadDecisionBrief.execution_brief?.visual_target_label, "Lead row");
  assert.equal(leadDecisionBrief.top_action, "Create RFQ from sheet lead");
}

{
  const soybean = REFERENCE_DEALS.find((deal) => deal.contract === "Soybean Meal");
  assert.ok(soybean);
  const draft = referenceDealToRfqDraft(soybean);
  assert.equal(draft.origin, "Mersin");
  assert.equal(draft.destination, "Ashgabat");
  assert.equal(draft.weight, 350000);
  assert.equal(draft.targetPriceStatus, "UNKNOWN");
  assert.ok(draft.notes.includes("Do not treat sheet contract value as target price"));

  const china = REFERENCE_DEALS.find((deal) => deal.contract === "China Spare Parts");
  assert.ok(china);
  const chinaDraft = referenceDealToRfqDraft(china);
  assert.equal(chinaDraft.mode, "SEA-FCL");
  assert.equal(chinaDraft.containerCount, 3);
  assert.equal(chinaDraft.containerType, "20DC");
}

{
  const strategy = assessCommercialStrategy({
    ...base,
    subject: "Sheet lead - Soybean Meal",
    origin: "Mersin",
    destination: "Ashgabat",
    mode: "SEA-FCL",
    commodity: "Soybean Meal",
    containerCount: null,
    containerType: null,
    weight: 350000,
    dangerousGoods: "UNKNOWN",
    customsBy: "UNKNOWN",
    targetPrice: null,
    targetPriceStatus: "UNKNOWN",
  });
  const qualification = qualifyRfq({
    origin: "Mersin",
    destination: "Ashgabat",
    mode: "SEA-FCL",
    commodity: "Soybean Meal",
    containerCount: null,
    containerType: null,
    weight: 350000,
    dangerousGoods: "UNKNOWN",
    customsBy: "UNKNOWN",
    targetPrice: null,
    targetPriceStatus: "UNKNOWN",
  });
  const draft = buildMissingInfoDraft({
    subject: "Sheet lead - Soybean Meal",
    fromEmail: "customer@example.com",
    origin: "Mersin",
    destination: "Ashgabat",
    mode: "SEA-FCL",
    commodity: "Soybean Meal",
    weight: 350000,
    incoterms: "DDP",
    parsedData: JSON.stringify({
      source: "reference-deal",
      sheet: {
        contact: "Pinar Hn",
        contract: "Soybean Meal",
        quantity: "350",
        unit: "TONS",
        contractValue: 227000,
        profit: 15000,
      },
    }),
    qualification,
    blockerResolutionPlan: strategy.blockerResolutionPlan,
  });
  assert.ok(draft.body.includes("I currently have this noted as: Soybean Meal"));
  assert.ok(draft.body.includes("Mersin to Ashgabat"));
  assert.ok(draft.body.includes("350 TONS"));
  assert.ok(draft.body.includes("The most important items to clear first are: FCL equipment, Dangerous goods, Customs."));
  assert.equal(draft.blockerResolutionPlan[0]?.key, "fcl_equipment");
  assert.ok(draft.questions[0].includes("container count and size/type"));
  assert.ok(draft.body.includes("Please confirm whether the cargo is dangerous goods."));
  assert.ok(draft.body.includes("Please confirm who will handle customs work."));
  assert.ok(draft.body.includes("If you have a target price, it helps us leverage agencies better; if not, no problem."));
  assert.ok(!draft.body.includes("15000"));
  assert.ok(!draft.body.includes("227000"));
}

{
  const partialDimensions = JSON.stringify([{ qty: 2, length: 120, width: 80, height: 0 }]);
  const lclInput = {
    origin: "Texas",
    destination: "Ambarli",
    mode: "SEA-LCL",
    commodity: "Chemicals",
    dimensions: partialDimensions,
    volume: null,
    stackable: "NO",
    topLoad: "YES",
    weight: 1200,
    dangerousGoods: "NO",
    customsBy: "CUSTOMER",
    targetPriceStatus: "NO_TARGET",
  };
  const qualification = qualifyRfq(lclInput);
  const maturityChecks = buildRfqMaturityChecks(lclInput);
  const strategy = assessCommercialStrategy({
    ...base,
    ...lclInput,
    targetPrice: null,
    carrierQuotes: [quote("a", 2100), quote("b", 2200)],
  });
  assert.equal(qualification.isMature, false);
  assert.ok(qualification.missing.includes("complete LCL dimensions"));
  assert.equal(maturityChecks.find((check) => check.key === "lcl_dimensions")?.status, "missing");
  assert.equal(maturityChecks.find((check) => check.key === "top_load")?.status, "ready");

  const draft = buildMissingInfoDraft({
    subject: "Texas chemicals",
    fromEmail: "customer@example.com",
    origin: "Texas",
    destination: "Ambarli",
    mode: "SEA-LCL",
    commodity: "Chemicals",
    weight: 1200,
    dimensions: partialDimensions,
    stackable: "NO",
    topLoad: "YES",
    targetPriceStatus: "NO_TARGET",
    parsedData: null,
    qualification,
    blockerResolutionPlan: strategy.blockerResolutionPlan,
  });
  assert.ok(draft.body.includes("Please send LCL dimensions per pallet/package"));
  assert.equal(draft.blockerResolutionPlan[0]?.key, "lcl_dimensions");
  assert.ok(draft.body.includes("The most important items to clear first are: LCL dimensions."));
}

{
  const rows = [{ qty: "2", length: "120", width: "80", height: "50" }];
  const completeness = dimensionCompleteness(rows);
  assert.equal(completeness.hasCompleteDimensions, true);
  assert.equal(totalChargeableCbm(rows, "YES"), 0.96);
  assert.equal(totalChargeableCbm(rows, "NO"), 4.589);
}

{
  const s = assessCommercialStrategy({
    ...base,
    mode: "SEA-LCL",
    dimensions: JSON.stringify([{ qty: 2, length: 120, width: 80, height: 50 }]),
    stackable: "NO",
    topLoad: "YES",
    targetPrice: 3600,
    carrierQuotes: [quote("a", 2100), quote("b", 2200)],
  });
  assert.equal(s.evidence.cargoMath?.physicalCbm, 0.96);
  assert.equal(s.evidence.cargoMath?.chargeableCbm, 4.589);
  assert.equal(s.evidence.cargoMath?.source, "DIMENSIONS");
  assert.ok(s.strategyMemo.includes("Cargo math: 4.589 chargeable CBM vs 0.960 physical CBM"));
  assert.ok(s.strengths.some((item) => item.includes("Chargeable CBM is explicit")));
}

{
  const s = assessCommercialStrategy({
    ...base,
    mode: "SEA-LCL",
    dimensions: JSON.stringify([{ qty: 2, length: 120, width: 80, height: "" }]),
    stackable: "NO",
    topLoad: "YES",
    targetPriceStatus: "NO_TARGET",
    targetPrice: null,
    carrierQuotes: [quote("a", 2100), quote("b", 2200)],
  });
  assert.equal(s.evidence.cargoMath?.dimensionsPartial, true);
  assert.equal(s.evidence.cargoMath?.source, "PARTIAL_DIMENSIONS");
  assert.equal(s.evidence.cargoMath?.chargeableCbm, null);
  assert.ok(s.evidenceChecks.some((check) => check.key === "cargo" && check.tone === "blocked"));
  assert.equal(s.maturityChecks.find((check) => check.key === "lcl_dimensions")?.status, "missing");
  assert.equal(s.blockerResolutionPlan[0]?.key, "lcl_dimensions");
  assert.ok(s.blockerResolutionPlan[0]?.why.includes("chargeable CBM"));
  assert.equal(s.quoteGate.status, "BLOCKED");
  assert.ok(s.quoteGate.blockers.includes("Complete cargo dimensions"));
  assert.equal(s.operatorDecision.phase, "MATURE_RFQ");
  assert.ok(s.operatorDecision.blockers.includes("Complete cargo dimensions"));
  assert.ok(s.risks.some((risk) => risk.includes("incomplete dimensions")));
}

{
  assert.equal(coversForwarderMode({ modeCoverage: "SEA-FCL AIR" }, "SEA-FCL"), true);
  assert.equal(coversForwarderMode({ modeCoverage: "AIR" }, "SEA-FCL"), false);
  assert.equal(coversForwarderMode({ modeCoverage: null }, "SEA-LCL"), true);
  assert.equal(forwarderModeCoverageLabel("SEA-FCL,SEA-LCL"), "SEA-FCL, SEA-LCL");

  const draft = buildForwarderDraft({
    subject: "Shanghai to Ambarli spare parts",
    origin: "Shanghai",
    destination: "Ambarli",
    mode: "SEA-FCL",
    containerCount: 3,
    containerType: "20DC",
    dimensions: null,
    stackable: null,
    topLoad: null,
    dangerousGoods: "NO",
    customsBy: "CUSTOMER",
    commodity: "Spare parts",
    weight: 12000,
    volume: null,
    incoterms: "FOB",
    cargoReadyDate: new Date("2026-07-01T00:00:00Z"),
  }, { name: "DSV", email: "dsv@example.com" });
  assert.equal(draft.subject, "RFQ - SEA-FCL - Shanghai to Ambarli");
  assert.ok(draft.body.includes("Equipment: 3 x 20DC"));
  assert.ok(draft.body.includes("Dangerous goods: NO"));
  assert.ok(!draft.body.includes("undefined"));
}

{
  const parsed = {
    dimensions: [{ qty: 2, length: 120, width: 80, height: 50 }],
    stackable: "NO",
    volume: 0.96,
  };
  const review = parsedCargoVolumeReview(parsed);
  assert.equal(parsedDimensionsJson(parsed), JSON.stringify([{ qty: "2", length: "120", width: "80", height: "50" }]));
  assert.equal(parsedPackagesCount(parsed), 2);
  assert.equal(parsedDimensionVolume(parsed), 4.589);
  assert.equal(review?.label, "Volume basis review");
  assert.equal(review?.explicitVolume, 0.96);
  assert.equal(review?.computedVolume, 4.589);
  assert.equal(review?.basis, "chargeable_non_stackable");

  assert.equal(parsedCargoVolumeReview({
    dimensions: [{ qty: 2, length: 120, width: 80, height: 50 }],
    stackable: "YES",
    volume: 0.98,
  }), null);
}

{
  const scoped = filterScopedProposalFields({
    update: { origin: "Izmir", weight: 1200 },
    inquiryUpdate: { origin: "RFQ Izmir", weight: 1300, targetPriceStatus: "NO_TARGET" },
    acceptedFields: ["job:origin", "rfq:targetPriceStatus"],
  });
  assert.deepEqual(scoped.update, { origin: "Izmir" });
  assert.deepEqual(scoped.inquiryUpdate, { targetPriceStatus: "NO_TARGET" });

  const legacy = filterScopedProposalFields({
    update: { origin: "Izmir", weight: 1200 },
    inquiryUpdate: { origin: "RFQ Izmir", weight: 1300 },
    acceptedFields: ["origin"],
  });
  assert.deepEqual(legacy.update, { origin: "Izmir" });
  assert.deepEqual(legacy.inquiryUpdate, { origin: "RFQ Izmir" });

  const empty = filterScopedProposalFields({
    update: { origin: "Izmir" },
    inquiryUpdate: { origin: "RFQ Izmir" },
    acceptedFields: [],
  });
  assert.deepEqual(empty.update, {});
  assert.deepEqual(empty.inquiryUpdate, {});
}

{
  const changes = buildReviewedFieldChanges({
    jobBefore: { origin: "Shanghai", weight: 900 },
    inquiryBefore: { targetPriceStatus: "UNKNOWN" },
    update: { origin: "Izmir" },
    inquiryUpdate: { targetPriceStatus: "NO_TARGET" },
    fieldLabels: { origin: "Origin", targetPriceStatus: "Target status" },
  });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], {
    scope: "job",
    field: "origin",
    label: "Origin",
    before: "Shanghai",
    after: "Izmir",
  });
  assert.deepEqual(changes[1], {
    scope: "rfq",
    field: "targetPriceStatus",
    label: "Target status",
    before: "UNKNOWN",
    after: "NO_TARGET",
  });
  assert.equal(reviewedFieldTokenLabel("job:origin", { origin: "Origin" }), "Job Origin");
  assert.equal(reviewedFieldTokenLabel("rfq:targetPriceStatus", { targetPriceStatus: "Target status" }), "RFQ Target status");
}

{
  const impact = buildAgentProposalDecisionImpact({
    current: {
      origin: "Shanghai",
      mode: "SEA-FCL",
      containerType: "40HC",
      commodity: "Electronics",
      targetCurrency: "USD",
      targetPriceStatus: "UNKNOWN",
      documents: [
        { id: "doc-ok", name: "Invoice", status: "APPROVED", aiKeyFields: JSON.stringify({ invoiceNo: "INV-1", weight: "12000kg" }) },
        { id: "doc-review", name: "Packing list", status: "UPLOADED" },
      ],
    },
    update: {
      destination: "Hamburg",
      containerCount: 1,
      weight: 12000,
      dangerousGoods: "NO",
      customsBy: "CUSTOMER",
      targetPrice: 3400,
      targetPriceStatus: "PROVIDED",
      targetCurrency: "USD",
    },
  });

  assert.equal(impact.before.mature, false);
  assert.equal(impact.after.mature, true);
  assert.ok(impact.before.missingCount > impact.after.missingCount);
  assert.equal(impact.after.missingCount, 0);
  assert.equal(impact.target.changed, true);
  assert.equal(impact.target.currentStatus, "UNKNOWN");
  assert.equal(impact.target.proposedStatus, "PROVIDED");
  assert.equal(impact.target.proposedAmount, 3400);
  assert.deepEqual(impact.proposedGroups.route, ["destination"]);
  assert.deepEqual(impact.proposedGroups.commercial, ["targetPrice", "targetCurrency", "targetPriceStatus"]);
  assert.equal(impact.proposedGroups.cargo.includes("dangerousGoods"), true);
  assert.equal(impact.documents.approved, 1);
  assert.equal(impact.documents.uploaded, 1);
  assert.equal(impact.documents.extractedFields, 2);
  assert.equal(impact.strategy.before.quoteGate.status, "BLOCKED");
  assert.equal(impact.strategy.after.quoteGate.status, "NEEDS_RATES");
  assert.equal(impact.strategy.after.nextMove.phase, "GET_RATES");
  assert.equal(impact.strategy.after.firstStop.key, "price_posture");
  assert.equal(impact.strategy.delta.gateChanged, true);
  assert.ok(impact.strategy.delta.missingCount < 0);
  assert.ok(impact.safeAction.includes("Stop"));
}

{
  const impact = buildAgentProposalDecisionImpact({
    current: {
      origin: "Izmir",
      destination: "Jeddah",
      mode: "SEA-FCL",
      containerType: "20DC",
      containerCount: 2,
      commodity: "Machinery",
      weight: 8000,
      dangerousGoods: "NO",
      customsBy: "CUSTOMER",
      targetCurrency: "USD",
      targetPriceStatus: "UNKNOWN",
    },
    inquiryUpdate: {
      targetPriceStatus: "NO_TARGET",
    },
  });

  assert.equal(impact.before.mature, false);
  assert.equal(impact.after.mature, true);
  assert.equal(impact.target.currentStatus, "UNKNOWN");
  assert.equal(impact.target.proposedStatus, "NO_TARGET");
  assert.equal(impact.target.currentAmount, null);
  assert.equal(impact.target.proposedAmount, null);
  assert.deepEqual(impact.proposedGroups.commercial, ["targetPriceStatus"]);
  assert.equal(impact.documents.label, "No document pack");
  assert.equal(impact.strategy.before.quoteGate.status, "BLOCKED");
  assert.equal(impact.strategy.after.quoteGate.status, "NEEDS_RATES");
  assert.equal(impact.strategy.delta.gateChanged, true);
  assert.equal(impact.strategy.after.nextMove.toolHint, "create_forwarder_drafts");
}

{
  const impact = buildAgentProposalDecisionImpact({
    current: {
      origin: "Texas",
      destination: "Ambarli",
      mode: "SEA-LCL",
      commodity: "Chemicals",
      dangerousGoods: "NO",
      customsBy: "CUSTOMER",
      stackable: "NO",
      topLoad: "YES",
      targetPriceStatus: "NO_TARGET",
    },
    update: {
      packages: 2,
      dimensions: JSON.stringify([{ qty: "2", length: "120", width: "80", height: "50" }]),
      volume: 4.589,
      weight: 1200,
    },
  });

  assert.equal(impact.before.mature, false);
  assert.equal(impact.after.mature, true);
  assert.deepEqual(impact.proposedGroups.cargo, ["packages", "dimensions", "weight", "volume"]);
  assert.equal(impact.strategy.after.cargo.chargeableCbm, 4.589);
  assert.equal(impact.strategy.after.cargo.dimensionsComplete, true);
  assert.equal(impact.strategy.after.quoteGate.status, "NEEDS_RATES");
  assert.ok(impact.strategy.delta.missingCount < 0);
}

console.log("commercial strategy tests passed");
