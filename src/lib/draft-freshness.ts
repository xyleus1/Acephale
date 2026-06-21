import crypto from "crypto";

export type DraftFreshnessScope = "rfq" | "pricing" | "customer_quote";

export type DraftFreshnessCarrierQuote = {
  id?: string | null;
  carrier?: string | null;
  status?: string | null;
  total20?: number | null;
  total40?: number | null;
  total40HC?: number | null;
  transitDays?: number | null;
  service?: string | null;
  validity?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type DraftFreshnessInput = {
  reference?: string | null;
  title?: string | null;
  subject?: string | null;
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
  targetPrice?: number | null;
  targetCurrency?: string | null;
  targetPriceStatus?: string | null;
  cost?: number | null;
  revenue?: number | null;
  currency?: string | null;
  quoteLines?: string | null;
  carrierQuotes?: DraftFreshnessCarrierQuote[] | null;
};

function cleanString(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function cleanNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rfqSnapshot(input: DraftFreshnessInput) {
  return {
    reference: cleanString(input.reference),
    title: cleanString(input.title),
    subject: cleanString(input.subject),
    origin: cleanString(input.origin),
    destination: cleanString(input.destination),
    mode: cleanString(input.mode),
    commodity: cleanString(input.commodity),
    containerCount: cleanNumber(input.containerCount),
    containerType: cleanString(input.containerType),
    dimensions: cleanString(input.dimensions),
    stackable: cleanString(input.stackable),
    topLoad: cleanString(input.topLoad),
    dangerousGoods: cleanString(input.dangerousGoods),
    customsBy: cleanString(input.customsBy),
    incoterms: cleanString(input.incoterms),
    weight: cleanNumber(input.weight),
    volume: cleanNumber(input.volume),
    targetPrice: cleanNumber(input.targetPrice),
    targetCurrency: cleanString(input.targetCurrency),
    targetPriceStatus: cleanString(input.targetPriceStatus),
  };
}

function pricingSnapshot(input: DraftFreshnessInput) {
  return {
    ...rfqSnapshot(input),
    carrierQuotes: (input.carrierQuotes ?? [])
      .map((quote) => ({
        id: cleanString(quote.id),
        carrier: cleanString(quote.carrier),
        status: cleanString(quote.status),
        total20: cleanNumber(quote.total20),
        total40: cleanNumber(quote.total40),
        total40HC: cleanNumber(quote.total40HC),
        transitDays: cleanNumber(quote.transitDays),
        service: cleanString(quote.service),
        validity: cleanString(quote.validity),
        createdAt: cleanDate(quote.createdAt),
        updatedAt: cleanDate(quote.updatedAt),
      }))
      .sort((a, b) => [
        a.id ?? "",
        a.carrier ?? "",
        a.createdAt ?? "",
      ].join("|").localeCompare([
        b.id ?? "",
        b.carrier ?? "",
        b.createdAt ?? "",
      ].join("|"))),
  };
}

function customerQuoteSnapshot(input: DraftFreshnessInput) {
  return {
    ...pricingSnapshot(input),
    cost: cleanNumber(input.cost),
    revenue: cleanNumber(input.revenue),
    currency: cleanString(input.currency),
    quoteLines: cleanString(input.quoteLines),
  };
}

export function draftFreshnessKey(input: DraftFreshnessInput, scope: DraftFreshnessScope) {
  const snapshot =
    scope === "customer_quote" ? customerQuoteSnapshot(input) :
    scope === "pricing" ? pricingSnapshot(input) :
    rfqSnapshot(input);
  const hash = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return `${scope}:${hash}`;
}
