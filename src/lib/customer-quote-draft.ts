import type { CommercialStrategy, StrategyCarrierQuote } from "./commercial-strategy";

export type CustomerQuoteDraftContext = {
  reference?: string | null;
  subject?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  commodity?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  dimensions?: string | null;
  stackable?: string | null;
  topLoad?: string | null;
  dangerousGoods?: string | null;
  customsBy?: string | null;
  incoterms?: string | null;
  weight?: number | null;
  volume?: number | null;
  cargoReadyDate?: Date | string | null;
  carrierQuotes?: StrategyCarrierQuote[];
};

export type CustomerQuoteDraft = {
  status: "READY" | "BLOCKED";
  blockers: string[];
  subject: string | null;
  body: string | null;
  lineItems: Array<{ description: string; amount: number; currency: string }>;
  customerFacingAssumptions: string[];
  internalGuardrails: {
    quoteGate: CommercialStrategy["quoteGate"];
    operatorDecision: CommercialStrategy["operatorDecision"];
    buyCost: number | null;
    floorPrice: number | null;
    recommendedPrice: number | null;
    expectedMarginPct: number | null;
    expectedGrossProfit: number | null;
    selectedProvider: string | null;
    selectedTransitDays: number | null;
    selectedValidity: string | null;
    negotiationTalkTrack: string;
    internalGuardrail: string;
  };
};

function money(amount: number | null | undefined, currency: string) {
  if (amount == null || Number.isNaN(amount)) return null;
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.map((v) => v?.trim()).find(Boolean) ?? null;
}

function quoteTotal(q: StrategyCarrierQuote): number | null {
  const total = q.total40HC ?? q.total40 ?? q.total20 ?? null;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function findSelectedQuote(context: CustomerQuoteDraftContext, strategy: CommercialStrategy) {
  const routeQuoteId = strategy.recommendedRoute?.carrierQuoteId ?? null;
  const routeRateReliable = strategy.recommendedRoute?.evidence?.rateReliable;
  const quotes = context.carrierQuotes ?? [];
  if (!routeQuoteId || routeRateReliable === false) return null;
  return quotes.find((q) => q.id === routeQuoteId) ?? null;
}

function buildCargoSummary(context: CustomerQuoteDraftContext) {
  return [
    context.commodity ? `Commodity: ${context.commodity}` : null,
    context.mode === "SEA-FCL" && (context.containerCount || context.containerType)
      ? `Equipment: ${context.containerCount ?? "-"} x ${context.containerType ?? "-"}`
      : null,
    context.weight != null ? `Weight: ${context.weight.toLocaleString()} kg` : null,
    context.volume != null ? `Volume: ${context.volume.toLocaleString()} cbm` : null,
    context.incoterms ? `Incoterms: ${context.incoterms}` : null,
    context.cargoReadyDate ? `Cargo ready: ${dateLabel(context.cargoReadyDate)}` : null,
    context.dangerousGoods ? `Dangerous goods: ${context.dangerousGoods}` : null,
    context.customsBy ? `Customs responsibility: ${context.customsBy}` : null,
  ].filter((line): line is string => Boolean(line));
}

function buildAssumptions(context: CustomerQuoteDraftContext, selectedQuote: StrategyCarrierQuote | null) {
  const assumptions = [
    "Rate is subject to space, equipment availability, and carrier acceptance at booking.",
    "Duties, taxes, customs exams, storage, demurrage, detention, and insurance are excluded unless explicitly stated.",
  ];
  if (selectedQuote?.validity) assumptions.unshift(`Forwarder validity: ${selectedQuote.validity}.`);
  if (context.dangerousGoods === "YES") assumptions.push("Dangerous goods acceptance is subject to final MSDS and carrier approval.");
  if (context.stackable === "NO") assumptions.push("Non-stackable cargo may carry extra handling or space cost.");
  if (context.topLoad === "YES") assumptions.push("Top-load handling can be requested, but final acceptance depends on the carrier.");
  return assumptions;
}

export function buildCustomerQuoteDraft(
  context: CustomerQuoteDraftContext,
  strategy: CommercialStrategy
): CustomerQuoteDraft {
  const currency = strategy.price.currency;
  const recommendedPrice = strategy.price.recommendedPrice;
  const selectedQuote = findSelectedQuote(context, strategy);
  const blockers = [
    ...strategy.quoteGate.blockers,
    ...strategy.quoteGate.approvals,
  ];

  const internalGuardrails: CustomerQuoteDraft["internalGuardrails"] = {
    quoteGate: strategy.quoteGate,
    operatorDecision: strategy.operatorDecision,
    buyCost: strategy.price.buyCost,
    floorPrice: strategy.price.floorPrice,
    recommendedPrice,
    expectedMarginPct: strategy.price.expectedMarginPct,
    expectedGrossProfit: strategy.price.expectedGrossProfit,
    selectedProvider: firstNonEmpty(strategy.recommendedRoute?.provider, selectedQuote?.carrier),
    selectedTransitDays: strategy.recommendedRoute?.transitDays ?? selectedQuote?.transitDays ?? null,
    selectedValidity: selectedQuote?.validity ?? null,
    negotiationTalkTrack: strategy.negotiation.customerTalkTrack,
    internalGuardrail: strategy.negotiation.internalGuardrail,
  };

  if (!strategy.quoteGate.canQuoteCustomer || strategy.quoteGate.status !== "READY_TO_QUOTE" || recommendedPrice == null) {
    return {
      status: "BLOCKED",
      blockers: blockers.length ? blockers : ["Customer quote gate is not ready."],
      subject: null,
      body: null,
      lineItems: [],
      customerFacingAssumptions: [],
      internalGuardrails,
    };
  }

  // Hard floor: never draft a customer sell below the margin floor. This binds
  // the floor to the generated artifact (defense-in-depth vs a poisoned/outlier
  // buy that collapses the price); the operator must resolve it, not send it.
  const floorPrice = strategy.price.floorPrice;
  if (floorPrice != null && recommendedPrice < floorPrice) {
    return {
      status: "BLOCKED",
      blockers: [
        `Recommended price (${money(recommendedPrice, currency)}) is below the margin floor (${money(floorPrice, currency)}). Review the selected carrier rate before quoting.`,
        ...blockers,
      ],
      subject: null,
      body: null,
      lineItems: [],
      customerFacingAssumptions: [],
      internalGuardrails,
    };
  }

  const route = `${context.origin ?? "Origin"} to ${context.destination ?? "Destination"}`;
  const amount = money(recommendedPrice, currency) ?? `${currency} ${recommendedPrice}`;
  const customerName = firstNonEmpty(context.customerName, context.customerEmail, "there");
  const subject = `Quote - ${context.mode ?? "Freight"} - ${route}`;
  const cargoLines = buildCargoSummary(context);
  const assumptions = buildAssumptions(context, selectedQuote);
  const serviceLines = [
    `Route: ${route}`,
    `Mode: ${context.mode ?? "-"}`,
    selectedQuote?.carrier || strategy.recommendedRoute?.provider ? `Service basis: ${firstNonEmpty(selectedQuote?.carrier, strategy.recommendedRoute?.provider)}` : null,
    selectedQuote?.transitDays || strategy.recommendedRoute?.transitDays ? `Indicative transit: ${selectedQuote?.transitDays ?? strategy.recommendedRoute?.transitDays} days` : null,
    "",
    ...cargoLines,
  ].filter((line): line is string => line !== null);

  const body = [
    `Hello ${customerName},`,
    "",
    "Please find our freight quote below.",
    "",
    ...serviceLines,
    "",
    `Price: ${amount}`,
    "",
    "Assumptions and exclusions:",
    ...assumptions.map((item) => `- ${item}`),
    "",
    "Please confirm if you would like us to proceed with booking.",
    "",
    "Best,",
  ].join("\n");

  return {
    status: "READY",
    blockers: [],
    subject,
    body,
    lineItems: [{
      description: `Freight - ${context.mode ?? "mode"} - ${route}`,
      amount: recommendedPrice,
      currency,
    }],
    customerFacingAssumptions: assumptions,
    internalGuardrails,
  };
}
