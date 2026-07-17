"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { buildMissingInfoDraft } from "@/lib/missing-info-draft";
import { assessInquiryStrategy } from "@/lib/commercial-strategy-persistence";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { createLoadFromRfqReview } from "@/lib/rfq-load-review";
import { canonicalInquiryStatus } from "@/lib/inquiry-status";
import { assessDomesticTruckingPricing } from "@/lib/domestic-trucking-pricing";
import { applyQuoteOutcome, recordTruckloadQuote } from "@/lib/truckload-quotes";
import {
  CARRIER_BID_SOURCE_VALUES,
  CARRIER_BID_STATUS_VALUES,
  QUOTE_OUTCOME_REASON_VALUES,
  quoteEconomics,
  toCarrierBidRow,
  type CarrierBidRow,
} from "@/lib/truckload-quote-fields";
import Anthropic from "@anthropic-ai/sdk";

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function qualificationFor(input: {
  origin: string | null;
  destination: string | null;
  mode: string | null;
  commodity: string | null;
  containerCount: number | null;
  containerType: string | null;
  dimensions: string | null;
  stackable: string | null;
  topLoad: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  weight: number | null;
  volume: number | null;
  targetPrice: number | null;
  targetPriceStatus: string | null;
}) {
  return qualifyRfq(input);
}

export async function convertToJob(inquiryId: string, formData: FormData) {
  const result = await createLoadFromRfqReview(inquiryId, {
    companyId: emptyToNull(formData.get("companyId")),
    origin: emptyToNull(formData.get("origin")),
    destination: emptyToNull(formData.get("destination")),
    mode: emptyToNull(formData.get("mode")),
    incoterms: emptyToNull(formData.get("incoterms")),
    commodity: emptyToNull(formData.get("commodity")),
    weight: numberOrNull(formData.get("weight")),
    volume: numberOrNull(formData.get("volume")),
  });
  if ("error" in result) throw new Error(result.error);
  redirect(`/dashboard/jobs/${result.jobId}`);
}

export async function updateInquiryField(inquiryId: string, formData: FormData) {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry) throw new Error("Inquiry not found");

  const data = {
    origin: emptyToNull(formData.get("origin")),
    destination: emptyToNull(formData.get("destination")),
    mode: emptyToNull(formData.get("mode")),
    commodity: emptyToNull(formData.get("commodity")),
    incoterms: emptyToNull(formData.get("incoterms")),
    containerType: emptyToNull(formData.get("containerType")),
    containerCount: numberOrNull(formData.get("containerCount")),
    dimensions: emptyToNull(formData.get("dimensions")),
    stackable: String(formData.get("stackable") || "UNKNOWN"),
    topLoad: String(formData.get("topLoad") || "UNKNOWN"),
    dangerousGoods: String(formData.get("dangerousGoods") || "UNKNOWN"),
    customsBy: String(formData.get("customsBy") || "UNKNOWN"),
    weight: numberOrNull(formData.get("weight")),
    volume: numberOrNull(formData.get("volume")),
    targetPrice: numberOrNull(formData.get("targetPrice")),
    targetCurrency: String(formData.get("targetCurrency") || "USD"),
    targetPriceStatus: numberOrNull(formData.get("targetPrice")) != null
      ? "PROVIDED"
      : String(formData.get("targetPriceStatus") || "UNKNOWN"),
    targetPriceSource: emptyToNull(formData.get("targetPriceSource")),
    notes: String(formData.get("notes") || ""),
  };
  const qualification = qualificationFor(data);
  // Only auto-flip the legacy parse-maturity pair; a status the operator set
  // (canonical BOOKED/PRICING/… or a custom one) must survive field edits.
  const nextStatus = ["INGESTED", "PARSED"].includes(inquiry.status)
    ? qualification.isMature ? "PARSED" : "INGESTED"
    : inquiry.status;

  const updated = await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: { ...data, status: nextStatus },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "INQUIRY",
    sourceExternalId: `inquiry:${inquiryId}`,
    eventType: "inquiry.updated",
    entityType: "inquiry",
    entityId: inquiryId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: {
      inquiryId,
      changedFields: Object.keys(data),
      status: updated.status,
      qualification,
    },
    provenance: {
      source: "inquiry",
      operation: "manual_update",
      path: "src/app/dashboard/rfq/[inquiryId]/actions.ts",
      function: "updateInquiryField",
      sourceRecordId: inquiryId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiryId}:updated:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);

  if (targetPriceChanged(inquiry, data)) {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      createdByUserId: session.userId,
      amount: data.targetPrice,
      currency: data.targetCurrency,
      status: data.targetPriceStatus,
      source: data.targetPriceSource,
      note: "Manual RFQ field update.",
    });
  }

  revalidatePath(`/dashboard/rfq/${inquiryId}`);
}

export async function updateInquiryStatus(inquiryId: string, status: string) {
  const session = await requireSession();
  const updated = await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: { status },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "INQUIRY",
    sourceExternalId: `inquiry:${inquiryId}`,
    eventType: "inquiry.status_updated",
    entityType: "inquiry",
    entityId: inquiryId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: { inquiryId, status },
    provenance: {
      source: "inquiry",
      operation: "status_update",
      path: "src/app/dashboard/rfq/[inquiryId]/actions.ts",
      function: "updateInquiryStatus",
      sourceRecordId: inquiryId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiryId}:status:${status}:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);

  // Settle pending truckload quotes on terminal statuses — best-effort.
  const canonical = canonicalInquiryStatus(status);
  const outcome = canonical === "BOOKED" ? "WON" : canonical === "MISSED" ? "LOST" : null;
  if (outcome) {
    await applyQuoteOutcome({ officeId: session.officeId, inquiryId, outcome, userId: session.userId }).catch(() => null);
  }

  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard/rfq");
}

// ── Truckload desk: carrier bids + quote flywheel ───────────────────────────

export type CarrierBidPatch = {
  carrierName?: string;
  carrierId?: string; // "" clears the bench link
  equipmentType?: string;
  totalAmount?: string; // free text amount
  ratePerMile?: string;
  transitDays?: string;
  source?: string;
  status?: string;
  notes?: string;
};

type BidActionResult = { bid: CarrierBidRow } | { error: string };

function bidAmount(value: string | undefined): number | null | "invalid" {
  const trimmed = value?.trim().replace(/^\$\s*/, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : "invalid";
}

const BID_SELECT = {
  id: true,
  inquiryId: true,
  carrierId: true,
  carrierName: true,
  equipmentType: true,
  totalAmount: true,
  ratePerMile: true,
  transitDays: true,
  source: true,
  status: true,
  notes: true,
  createdAt: true,
  carrier: { select: { vettingStatus: true } },
} as const;

// Prisma-compatible shape for the writable bid columns.
type BidData = Partial<{
  carrierName: string;
  equipmentType: string | null;
  totalAmount: number | null;
  ratePerMile: number | null;
  transitDays: number | null;
  source: string;
  status: string;
  notes: string | null;
}>;

function buildBidData(patch: CarrierBidPatch): BidData | { error: string } {
  const data: BidData = {};
  if (patch.carrierName !== undefined) {
    const name = patch.carrierName.trim();
    if (!name) return { error: "Carrier name is required." };
    data.carrierName = name.slice(0, 160);
  }
  if (patch.equipmentType !== undefined) data.equipmentType = patch.equipmentType.trim().toUpperCase() || null;
  if (patch.totalAmount !== undefined) {
    const amount = bidAmount(patch.totalAmount);
    if (amount === "invalid") return { error: "Bid amount must be a number." };
    data.totalAmount = amount;
  }
  if (patch.ratePerMile !== undefined) {
    const rate = bidAmount(patch.ratePerMile);
    if (rate === "invalid") return { error: "Rate per mile must be a number." };
    data.ratePerMile = rate;
  }
  if (patch.transitDays !== undefined) {
    const days = patch.transitDays.trim() ? Number(patch.transitDays.trim()) : null;
    if (days !== null && (!Number.isInteger(days) || days < 0)) return { error: "Transit days must be a whole number." };
    data.transitDays = days;
  }
  if (patch.source !== undefined) {
    const source = patch.source.trim().toUpperCase();
    if (!CARRIER_BID_SOURCE_VALUES.includes(source as never)) return { error: "Unknown bid source." };
    data.source = source;
  }
  if (patch.status !== undefined) {
    const status = patch.status.trim().toUpperCase();
    if (!CARRIER_BID_STATUS_VALUES.includes(status as never)) return { error: "Unknown bid status." };
    data.status = status;
  }
  if (patch.notes !== undefined) data.notes = patch.notes.trim() || null;
  return data;
}

export async function createCarrierBidAction(inquiryId: string, patch: CarrierBidPatch): Promise<BidActionResult> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    select: { id: true, job: { select: { id: true } } },
  });
  if (!inquiry) return { error: "RFQ not found." };

  const data = buildBidData(patch);
  if ("error" in data) return data;
  const carrierName = data.carrierName;
  if (!carrierName) return { error: "Carrier name is required." };

  // Bench link: exact office-scoped name match keeps the vetting badge honest.
  const bench = await prisma.carrier.findFirst({
    where: { officeId: session.officeId, name: { equals: carrierName, mode: "insensitive" } },
    select: { id: true },
  });

  const bid = await prisma.carrierBid.create({
    data: {
      ...data,
      carrierName,
      officeId: session.officeId,
      inquiryId,
      jobId: inquiry.job?.id ?? null,
      carrierId: bench?.id ?? null,
    },
    select: BID_SELECT,
  });
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  return { bid: toCarrierBidRow(bid) };
}

export async function updateCarrierBidAction(bidId: string, patch: CarrierBidPatch): Promise<BidActionResult> {
  const session = await requireSession();
  const data = buildBidData(patch);
  if ("error" in data) return data;

  const updated = await prisma.carrierBid.updateMany({
    where: { id: bidId, officeId: session.officeId },
    data,
  });
  if (updated.count === 0) return { error: "Bid not found." };

  const bid = await prisma.carrierBid.findFirst({ where: { id: bidId, officeId: session.officeId }, select: BID_SELECT });
  if (!bid) return { error: "Bid not found." };
  if (bid.inquiryId) revalidatePath(`/dashboard/rfq/${bid.inquiryId}`);
  return { bid: toCarrierBidRow(bid) };
}

export async function deleteCarrierBidAction(bidId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const deleted = await prisma.carrierBid.deleteMany({ where: { id: bidId, officeId: session.officeId } });
  if (deleted.count === 0) return { error: "Bid not found." };
  return { ok: true };
}

// Selecting a bid: single SELECTED per inquiry, buy side lands on the linked
// job's cost, and pending flywheel quotes pick up the carrier + buy.
export async function selectCarrierBidAction(bidId: string): Promise<BidActionResult> {
  const session = await requireSession();
  const bid = await prisma.carrierBid.findFirst({
    where: { id: bidId, officeId: session.officeId },
    select: { id: true, inquiryId: true, jobId: true, carrierId: true, totalAmount: true },
  });
  if (!bid) return { error: "Bid not found." };

  if (bid.inquiryId) {
    await prisma.carrierBid.updateMany({
      where: { officeId: session.officeId, inquiryId: bid.inquiryId, status: "SELECTED", id: { not: bid.id } },
      data: { status: "RECEIVED" },
    });
  }
  await prisma.carrierBid.update({ where: { id: bid.id, officeId: session.officeId }, data: { status: "SELECTED" } });

  if (bid.jobId && bid.totalAmount != null) {
    await prisma.job.updateMany({
      where: { id: bid.jobId, officeId: session.officeId },
      data: { cost: bid.totalAmount },
    });
  }

  if (bid.inquiryId) {
    const pending = await prisma.truckloadQuote.findMany({
      where: { officeId: session.officeId, inquiryId: bid.inquiryId, outcome: "PENDING" },
      select: { id: true, sellAmount: true, miles: true },
    });
    await Promise.allSettled(
      pending.map((quote) => {
        const economics = quoteEconomics({ buyAmount: bid.totalAmount, sellAmount: quote.sellAmount, miles: quote.miles });
        return prisma.truckloadQuote.updateMany({
          where: { id: quote.id, officeId: session.officeId },
          data: {
            buyAmount: bid.totalAmount,
            buySource: "carrier_bid",
            carrierBidId: bid.id,
            carrierId: bid.carrierId,
            grossProfit: economics.grossProfit,
            marginPct: economics.marginPct,
          },
        });
      }),
    );
  }

  const fresh = await prisma.carrierBid.findFirst({ where: { id: bid.id, officeId: session.officeId }, select: BID_SELECT });
  if (!fresh) return { error: "Bid not found." };
  if (bid.inquiryId) revalidatePath(`/dashboard/rfq/${bid.inquiryId}`);
  if (bid.jobId) revalidatePath(`/dashboard/jobs/${bid.jobId}`);
  return { bid: toCarrierBidRow(fresh) };
}

export type RecordedQuoteRow = {
  id: string;
  createdAt: string;
  sellAmount: number | null;
  buyAmount: number | null;
  grossProfit: number | null;
  marginPct: number | null;
  outcome: string;
  outcomeReason: string | null;
  sentVia: string | null;
};

// Snapshot the current domestic draft economics into the flywheel. One row
// per press — each is a quote version; outcomes settle via RFQ status.
export async function recordTruckloadQuoteAction(
  inquiryId: string,
): Promise<{ quote: RecordedQuoteRow } | { error: string }> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: { company: { select: { id: true, name: true } }, job: { select: { id: true } } },
  });
  if (!inquiry) return { error: "RFQ not found." };

  const assessment = assessDomesticTruckingPricing(inquiry);
  if (!assessment.eligible) return { error: "Not a US domestic trucking RFQ — nothing to record." };
  const draft = assessment.quoteDraft;
  const selectedBid = await prisma.carrierBid.findFirst({
    where: { officeId: session.officeId, inquiryId, status: "SELECTED" },
    select: { id: true, carrierId: true, totalAmount: true },
  });
  const buyAmount = selectedBid?.totalAmount ?? draft.buyPrice?.amount ?? null;
  const buySource = selectedBid ? "carrier_bid" : draft.selectedOptionProvenance ?? (draft.buyPrice ? "mock" : null);

  const created = await recordTruckloadQuote({
    officeId: session.officeId,
    inquiryId,
    jobId: inquiry.job?.id ?? null,
    companyId: inquiry.company?.id ?? null,
    origin: inquiry.origin,
    destination: inquiry.destination,
    mode: assessment.rateRequest.mode,
    equipmentType: assessment.rateRequest.equipmentType,
    commodityCategory: inquiry.commodityCategory,
    securityTier: inquiry.securityTier,
    declaredValue: inquiry.declaredValue,
    buyAmount,
    buySource,
    carrierBidId: selectedBid?.id ?? null,
    carrierId: selectedBid?.carrierId ?? null,
    sellAmount: draft.sellPrice?.amount ?? null,
    currency: draft.sellPrice?.currency ?? "USD",
    sentVia: "NONE",
    rfqReceivedAt: inquiry.receivedAt,
  });

  const quote = await prisma.truckloadQuote.findFirst({
    where: { id: created.id, officeId: session.officeId },
    select: {
      id: true, createdAt: true, sellAmount: true, buyAmount: true, grossProfit: true,
      marginPct: true, outcome: true, outcomeReason: true, sentVia: true,
    },
  });
  if (!quote) return { error: "Quote not recorded." };
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  return { quote: { ...quote, createdAt: quote.createdAt.toISOString() } };
}

export async function updateQuoteOutcomeReasonAction(
  quoteId: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const value = reason.trim() || null;
  if (value && !QUOTE_OUTCOME_REASON_VALUES.includes(value as never)) return { error: "Unknown outcome reason." };
  const updated = await prisma.truckloadQuote.updateMany({
    where: { id: quoteId, officeId: session.officeId },
    data: { outcomeReason: value },
  });
  if (updated.count === 0) return { error: "Quote not found." };
  return { ok: true };
}

export async function parseRFQWithAI(inquiryId: string): Promise<void> {
  const session = await requireSession();

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry || !inquiry.rawEmailBody) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Extract freight details from this email. Return ONLY valid JSON, no explanation.

Fields to extract (use null if not found):
- origin: string (city, country code)
- destination: string (city, country code)
- mode: one of SEA-FCL, SEA-LCL, AIR, ROAD, COURIER, or null
- containerCount: number or null
- containerType: one of 20GP, 40GP, 40HC, LCL, or null
- stackable: YES, NO, UNKNOWN, or null
- topLoad: YES, NO, UNKNOWN, or null
- dangerousGoods: YES, NO, UNKNOWN, or null
- customsBy: US, CUSTOMER, FORWARDER, UNKNOWN, or null
- incoterms: standard incoterms code or null
- commodity: string or null
- weight: number in kg or null
- volume: number in cbm or null
- targetPrice: number or null
- targetCurrency: USD, EUR, TRY, GBP, or null
- targetPriceStatus: PROVIDED, NO_TARGET, UNKNOWN, or null
- targetPriceSource: short text or null
- cargoReadyDate: ISO date string or null

Email:
${inquiry.rawEmailBody.slice(0, 2000)}`,
    }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : null;
  if (!text) return;

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return;
  }

  const data = {
    origin:        parsed.origin as string ?? inquiry.origin,
    destination:   parsed.destination as string ?? inquiry.destination,
    mode:          parsed.mode as string ?? inquiry.mode,
    containerCount: parsed.containerCount != null ? Number(parsed.containerCount) : inquiry.containerCount,
    containerType: parsed.containerType as string ?? inquiry.containerType,
    dimensions:    parsed.dimensions as string ?? inquiry.dimensions,
    stackable:     parsed.stackable as string ?? inquiry.stackable,
    topLoad:       parsed.topLoad as string ?? inquiry.topLoad,
    dangerousGoods: parsed.dangerousGoods as string ?? inquiry.dangerousGoods,
    customsBy:     parsed.customsBy as string ?? inquiry.customsBy,
    incoterms:     parsed.incoterms as string ?? inquiry.incoterms,
    commodity:     parsed.commodity as string ?? inquiry.commodity,
    weight:        parsed.weight != null ? Number(parsed.weight) : inquiry.weight,
    volume:        parsed.volume != null ? Number(parsed.volume) : inquiry.volume,
    targetPrice:   parsed.targetPrice != null ? Number(parsed.targetPrice) : inquiry.targetPrice,
    targetCurrency: parsed.targetCurrency as string ?? inquiry.targetCurrency,
    targetPriceStatus: parsed.targetPriceStatus as string ?? inquiry.targetPriceStatus,
    targetPriceSource: parsed.targetPriceSource as string ?? inquiry.targetPriceSource,
    cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate as string) : inquiry.cargoReadyDate,
  };
  const qualification = qualificationFor(data);

  const updated = await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: {
      ...data,
      // Same guard as updateInquiryField: never demote an operator-set status.
      status: ["INGESTED", "PARSED"].includes(inquiry.status)
        ? qualification.isMature ? "PARSED" : "INGESTED"
        : inquiry.status,
      parsedData: JSON.stringify({ ...parsed, qualification }),
    },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "INQUIRY",
    sourceExternalId: `inquiry:${inquiryId}`,
    eventType: "inquiry.ai_parsed",
    entityType: "inquiry",
    entityId: inquiryId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: { inquiryId, parsed, qualification, status: updated.status },
    provenance: {
      source: "inquiry",
      operation: "ai_parse",
      path: "src/app/dashboard/rfq/[inquiryId]/actions.ts",
      function: "parseRFQWithAI",
      sourceRecordId: inquiryId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiryId}:ai_parsed:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);

  if (targetPriceChanged(inquiry, data)) {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      createdByUserId: session.userId,
      amount: data.targetPrice,
      currency: data.targetCurrency,
      status: data.targetPriceStatus,
      source: data.targetPriceSource,
      note: "AI RFQ parse.",
    });
  }

  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard/rfq");
}

export async function draftMissingInfoEmail(inquiryId: string) {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    select: {
      id: true,
      subject: true,
      fromEmail: true,
      origin: true,
      destination: true,
      mode: true,
      commodity: true,
      containerCount: true,
      containerType: true,
      dimensions: true,
      stackable: true,
      topLoad: true,
      dangerousGoods: true,
      customsBy: true,
      incoterms: true,
      weight: true,
      volume: true,
      targetPrice: true,
      targetPriceStatus: true,
      parsedData: true,
    },
  });
  if (!inquiry) return { ok: false, error: "Inquiry not found." };

  const qualification = qualificationFor(inquiry);
  if (qualification.isMature) {
    return { ok: false, error: "This RFQ is already mature. No missing-info email is needed." };
  }

  const strategyRun = await assessInquiryStrategy(session.officeId, inquiryId).catch(() => null);
  const draft = buildMissingInfoDraft({
    ...inquiry,
    qualification,
    blockerResolutionPlan: strategyRun?.strategy.blockerResolutionPlan,
  });

  return {
    ok: true,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
  };
}
