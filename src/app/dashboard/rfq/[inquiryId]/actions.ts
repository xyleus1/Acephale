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
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard/rfq");
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
