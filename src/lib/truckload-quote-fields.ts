// Shared vocabulary + row shapes for the truckload quote flywheel
// (client + server safe, no runtime deps). Persistence helpers live in
// src/lib/truckload-quotes.ts.

export const CARRIER_BID_STATUSES = [
  ["REQUESTED", "Requested"],
  ["RECEIVED", "Received"],
  ["DECLINED", "Declined"],
  ["SELECTED", "Selected"],
  ["EXPIRED", "Expired"],
] as const;

export const CARRIER_BID_SOURCES = [
  ["MANUAL", "Manual"],
  ["EMAIL", "Email"],
  ["WHATSAPP", "WhatsApp"],
  ["PHONE", "Phone"],
  ["LOADBOARD", "Load board"],
  ["API", "API"],
] as const;

export const QUOTE_OUTCOMES = [
  ["PENDING", "Pending"],
  ["WON", "Won"],
  ["LOST", "Lost"],
  ["EXPIRED", "Expired"],
  ["NO_QUOTE", "No quote"],
] as const;

export const QUOTE_OUTCOME_REASONS = [
  ["price_too_high", "Price too high"],
  ["no_capacity", "No capacity"],
  ["too_slow", "Quoted too slow"],
  ["lane_not_served", "Lane not served"],
  ["customer_ghosted", "Customer ghosted"],
  ["lost_to_incumbent", "Lost to incumbent"],
  ["other", "Other"],
] as const;

export const CARRIER_BID_STATUS_VALUES = CARRIER_BID_STATUSES.map(([value]) => value);
export const CARRIER_BID_SOURCE_VALUES = CARRIER_BID_SOURCES.map(([value]) => value);
export const QUOTE_OUTCOME_VALUES = QUOTE_OUTCOMES.map(([value]) => value);
export const QUOTE_OUTCOME_REASON_VALUES = QUOTE_OUTCOME_REASONS.map(([value]) => value);

// Pure quote economics — shared by persistence and tests (DB-free).
export function quoteEconomics(input: {
  buyAmount?: number | null;
  sellAmount?: number | null;
  miles?: number | null;
}): { grossProfit: number | null; marginPct: number | null; ratePerMile: number | null } {
  const buy = typeof input.buyAmount === "number" && Number.isFinite(input.buyAmount) ? input.buyAmount : null;
  const sell = typeof input.sellAmount === "number" && Number.isFinite(input.sellAmount) ? input.sellAmount : null;
  const miles = typeof input.miles === "number" && input.miles > 0 ? input.miles : null;
  const grossProfit = buy != null && sell != null ? Number((sell - buy).toFixed(2)) : null;
  const marginPct = grossProfit != null && sell != null && sell > 0 ? Number(((grossProfit / sell) * 100).toFixed(1)) : null;
  const ratePerMile = sell != null && miles != null ? Number((sell / miles).toFixed(2)) : null;
  return { grossProfit, marginPct, ratePerMile };
}

// One row of the carrier-bid table on the RFQ detail page.
export type CarrierBidRow = {
  id: string;
  carrierId: string | null;
  carrierName: string;
  equipmentType: string | null;
  totalAmount: number | null;
  ratePerMile: number | null;
  transitDays: number | null;
  source: string;
  status: string;
  notes: string | null;
  createdAt: string;
  carrierVettingStatus: string | null;
};

export type CarrierBidRecord = {
  id: string;
  carrierId: string | null;
  carrierName: string;
  equipmentType: string | null;
  totalAmount: number | null;
  ratePerMile: number | null;
  transitDays: number | null;
  source: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  carrier: { vettingStatus: string } | null;
};

export function toCarrierBidRow(bid: CarrierBidRecord): CarrierBidRow {
  return {
    id: bid.id,
    carrierId: bid.carrierId,
    carrierName: bid.carrierName,
    equipmentType: bid.equipmentType,
    totalAmount: bid.totalAmount,
    ratePerMile: bid.ratePerMile,
    transitDays: bid.transitDays,
    source: bid.source,
    status: bid.status,
    notes: bid.notes,
    createdAt: bid.createdAt.toISOString(),
    carrierVettingStatus: bid.carrier?.vettingStatus ?? null,
  };
}
