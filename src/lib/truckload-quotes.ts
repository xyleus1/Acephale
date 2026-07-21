import "server-only";

import { prisma } from "./prisma";
import { classifyDomesticLocation } from "./domestic-trucking-pricing";
import { quoteEconomics } from "./truckload-quote-fields";

// ── The quote flywheel ──────────────────────────────────────────────────────
// Every issued domestic quote persists as a TruckloadQuote row (normalized
// lane x equipment x tier + buy/sell economics + speed), every buy rate also
// lands in LaneRate, and inquiry status changes settle outcomes. All calls
// are cheap and callers wrap them best-effort - flywheel writes must never
// block operator flows.

export type RecordTruckloadQuoteInput = {
  officeId: string;
  inquiryId?: string | null;
  jobId?: string | null;
  companyId?: string | null;
  origin?: string | null;
  destination?: string | null;
  miles?: number | null;
  mode?: string | null;
  equipmentType?: string | null;
  commodityCategory?: string | null;
  securityTier?: string | null;
  declaredValue?: number | null;
  buyAmount?: number | null;
  buySource?: string | null;
  carrierBidId?: string | null;
  carrierId?: string | null;
  sellAmount?: number | null;
  currency?: string | null;
  sentVia?: string | null;
  sentAt?: Date | null;
  rfqReceivedAt?: Date | null;
};

export async function recordTruckloadQuote(input: RecordTruckloadQuoteInput): Promise<{ id: string }> {
  const originLocation = classifyDomesticLocation(input.origin);
  const destLocation = classifyDomesticLocation(input.destination);
  const economics = quoteEconomics(input);

  const quote = await prisma.truckloadQuote.create({
    data: {
      officeId: input.officeId,
      inquiryId: input.inquiryId ?? null,
      jobId: input.jobId ?? null,
      companyId: input.companyId ?? null,
      origin: input.origin ?? null,
      destination: input.destination ?? null,
      originState: originLocation.stateCode,
      destState: destLocation.stateCode,
      miles: input.miles ?? null,
      mode: input.mode ?? null,
      equipmentType: input.equipmentType ?? null,
      commodityCategory: input.commodityCategory ?? null,
      securityTier: input.securityTier ?? null,
      declaredValue: input.declaredValue ?? null,
      buyAmount: input.buyAmount ?? null,
      buySource: input.buySource ?? null,
      carrierBidId: input.carrierBidId ?? null,
      carrierId: input.carrierId ?? null,
      sellAmount: input.sellAmount ?? null,
      currency: input.currency ?? "USD",
      grossProfit: economics.grossProfit,
      marginPct: economics.marginPct,
      ratePerMile: economics.ratePerMile,
      sentVia: input.sentVia ?? null,
      sentAt: input.sentAt ?? null,
      rfqReceivedAt: input.rfqReceivedAt ?? null,
    },
    select: { id: true },
  });

  if (input.buyAmount != null && input.origin && input.destination && input.mode) {
    await upsertLaneRateFromBuy({
      officeId: input.officeId,
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
      amount: input.buyAmount,
      currency: input.currency ?? "USD",
      provenance: `truckload-quote:${quote.id}${input.buySource ? ` (${input.buySource})` : ""}`,
    }).catch(() => null);
  }

  return quote;
}

// Settle every PENDING quote on an inquiry. Fired by the RFQ status hooks
// (BOOKED => WON, MISSED => LOST) and by explicit outcome edits.
export async function applyQuoteOutcome(args: {
  officeId: string;
  inquiryId: string;
  outcome: "WON" | "LOST" | "EXPIRED" | "NO_QUOTE";
  reason?: string | null;
  note?: string | null;
  userId?: string | null;
}): Promise<number> {
  const updated = await prisma.truckloadQuote.updateMany({
    where: { officeId: args.officeId, inquiryId: args.inquiryId, outcome: "PENDING" },
    data: {
      outcome: args.outcome,
      outcomeReason: args.reason ?? null,
      outcomeNote: args.note ?? null,
      outcomeAt: new Date(),
      decidedByUserId: args.userId ?? null,
    },
  });
  return updated.count;
}

// Buy rates accrue as LaneRate history. Domestic mode strings (FTL/LTL/
// PARTIAL/DRAYAGE) are deliberately distinct from the intl ROAD mode, so the
// international strategy engine's lane matching never cross-contaminates.
export async function upsertLaneRateFromBuy(args: {
  officeId: string;
  origin: string;
  destination: string;
  mode: string;
  amount: number;
  currency?: string;
  provenance: string;
}): Promise<void> {
  const validTo = new Date();
  validTo.setDate(validTo.getDate() + 14);
  await prisma.laneRate.create({
    data: {
      officeId: args.officeId,
      origin: args.origin,
      destination: args.destination,
      mode: args.mode,
      baseAmount: args.amount,
      currency: args.currency ?? "USD",
      validTo,
      notes: args.provenance,
    },
  });
}
