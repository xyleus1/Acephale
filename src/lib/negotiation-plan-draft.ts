import type { CommercialStrategy } from "./commercial-strategy";

export type NegotiationPlanDraft = {
  status: "READY";
  title: string;
  subject: string;
  body: string;
  posture: CommercialStrategy["negotiation"]["posture"];
  customerTalkTrack: string;
  forwarderCounter: string;
  internalGuardrail: string;
  leverage: string[];
  decisionReasons: CommercialStrategy["decisionReasons"];
  topRisks: CommercialStrategy["riskAssessments"];
  guardrails: {
    quoteGate: CommercialStrategy["quoteGate"];
    operatorDecision: CommercialStrategy["operatorDecision"];
    targetPosture: CommercialStrategy["evidence"]["targetPosture"];
    coveragePosture: CommercialStrategy["evidence"]["coveragePosture"];
    buyCost: number | null;
    floorPrice: number | null;
    recommendedPrice: number | null;
    targetBuyLimit: number | null;
    currency: string;
    approvalRequired: boolean;
  };
};

type NegotiationPlanContext = {
  reference?: string | null;
  subject?: string | null;
  customerName?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
};

function money(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return "unknown";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function clean(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text && text !== "-" ? text : null;
}

function laneLabel(context: NegotiationPlanContext) {
  const route = [clean(context.origin), clean(context.destination)].filter(Boolean).join(" to ");
  return [route || clean(context.subject) || clean(context.reference) || "this load", clean(context.mode)].filter(Boolean).join(" - ");
}

export function buildNegotiationPlanDraft(
  context: NegotiationPlanContext,
  strategy: CommercialStrategy
): NegotiationPlanDraft {
  const currency = strategy.price.currency;
  const route = strategy.recommendedRoute;
  const topRisks = strategy.riskAssessments.slice(0, 5);
  const decisionReasons = strategy.decisionReasons.slice(0, 6);
  const customer = clean(context.customerName) ?? "customer";
  const lane = laneLabel(context);
  const title = `${strategy.negotiation.label} - ${context.reference ?? strategy.recommendationLabel}`;
  const subject = `Negotiation plan: ${context.reference ?? lane}`;
  const guardrailLines = [
    `Buy cost: ${money(strategy.price.buyCost, currency)}`,
    `Floor: ${money(strategy.price.floorPrice, currency)}`,
    `Recommended sell: ${money(strategy.price.recommendedPrice, currency)}`,
    `Target buy limit: ${money(strategy.negotiation.targetBuyLimit, currency)}`,
    `Quote gate: ${strategy.quoteGate.label}`,
    `Approval: ${strategy.negotiation.approvalRequired || strategy.quoteGate.requiresApproval ? "required" : "not required"}`,
  ];

  const body = [
    title,
    "",
    `Scope: ${lane}`,
    `Customer: ${customer}`,
    "",
    "Decision",
    `- ${strategy.operatorDecision.title}`,
    `- ${strategy.operatorDecision.command}`,
    "",
    "Customer talk track",
    `- ${strategy.negotiation.customerTalkTrack}`,
    "",
    "Forwarder counter",
    `- ${strategy.negotiation.forwarderCounter}`,
    "",
    "Internal guardrail",
    `- ${strategy.negotiation.internalGuardrail}`,
    "",
    "Numbers",
    ...guardrailLines.map((line) => `- ${line}`),
    "",
    "Leverage",
    ...(strategy.negotiation.leverage.length > 0
      ? strategy.negotiation.leverage.map((line) => `- ${line}`)
      : ["- No leverage item is strong enough yet."]),
    "",
    "Why this is the move",
    ...decisionReasons.map((reason) => `- ${reason.label}: ${reason.summary}. ${reason.detail}`),
    "",
    "Risks to watch",
    ...(topRisks.length > 0
      ? topRisks.map((risk) => `- ${risk.level}: ${risk.reason} Mitigation: ${risk.mitigation}`)
      : ["- No dominant risk currently overrides the plan."]),
    "",
    "Route posture",
    `- ${route ? `${route.label}: ${route.tradeoff}` : "No priced route option is available yet."}`,
  ].join("\n");

  return {
    status: "READY",
    title,
    subject,
    body,
    posture: strategy.negotiation.posture,
    customerTalkTrack: strategy.negotiation.customerTalkTrack,
    forwarderCounter: strategy.negotiation.forwarderCounter,
    internalGuardrail: strategy.negotiation.internalGuardrail,
    leverage: strategy.negotiation.leverage,
    decisionReasons,
    topRisks,
    guardrails: {
      quoteGate: strategy.quoteGate,
      operatorDecision: strategy.operatorDecision,
      targetPosture: strategy.evidence.targetPosture,
      coveragePosture: strategy.evidence.coveragePosture,
      buyCost: strategy.price.buyCost,
      floorPrice: strategy.price.floorPrice,
      recommendedPrice: strategy.price.recommendedPrice,
      targetBuyLimit: strategy.negotiation.targetBuyLimit,
      currency,
      approvalRequired: strategy.negotiation.approvalRequired || strategy.quoteGate.requiresApproval,
    },
  };
}
