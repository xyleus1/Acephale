"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { createJobWithReference } from "@/lib/job-actions";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { recordAuditLog } from "@/lib/audit";
import Anthropic from "@anthropic-ai/sdk";

// Decision: parse an inbound RFQ with Claude
export async function approveParse(inquiryId: string): Promise<void> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry || !inquiry.rawEmailBody) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
      await prisma.inquiry.updateMany({
        where: { id: inquiryId, officeId: session.officeId },
        data: {
        notes: [
          inquiry.notes,
          "RFQ parsing blocked: ANTHROPIC_API_KEY is not configured.",
        ].filter(Boolean).join("\n"),
      },
    });
    revalidatePath("/dashboard");
    return;
  }

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Extract freight details from this email. Return ONLY valid JSON, no explanation. Use null when missing and never guess.

Fields: origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerCount, containerType (20GP|40GP|40HC|LCL), stackable (YES|NO|UNKNOWN), topLoad (YES|NO|UNKNOWN), dangerousGoods (YES|NO|UNKNOWN), customsBy (US|CUSTOMER|FORWARDER|UNKNOWN), incoterms, commodity, weight (kg), volume (cbm), targetPrice, targetCurrency (USD|EUR|TRY|GBP), targetPriceStatus (PROVIDED|NO_TARGET|UNKNOWN), targetPriceSource, cargoReadyDate (ISO).

Email:
${inquiry.rawEmailBody.slice(0, 2000)}`,
    }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : null;
  if (!text) return;

  let parsed: Record<string, unknown> = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {}

  const nextData = {
    origin:        parsed.origin as string ?? inquiry.origin,
    destination:   parsed.destination as string ?? inquiry.destination,
    mode:          parsed.mode as string ?? inquiry.mode,
    containerCount: parsed.containerCount != null ? Number(parsed.containerCount) : inquiry.containerCount,
    containerType: parsed.containerType as string ?? inquiry.containerType,
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
  const qualification = qualifyRfq(nextData);

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      ...nextData,
      status: qualification.isMature ? "PARSED" : "INGESTED",
      parsedData: JSON.stringify({ ...parsed, qualification }),
    },
  });
  if (targetPriceChanged(inquiry, nextData)) {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      createdByUserId: session.userId,
      amount: nextData.targetPrice,
      currency: nextData.targetCurrency,
      status: nextData.targetPriceStatus,
      source: nextData.targetPriceSource,
      note: "Queue RFQ parse.",
    });
  }
  revalidatePath("/dashboard");
}

function missingForForwarder(inquiry: {
  origin: string | null;
  destination: string | null;
  mode: string | null;
  containerCount: number | null;
  containerType: string | null;
  dimensions: string | null;
  weight: number | null;
  volume: number | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  stackable: string | null;
  topLoad: string | null;
  targetPrice: number | null;
  targetPriceStatus: string | null;
}) {
  return qualifyRfq(inquiry).followUpQuestions;
}

export async function approveSendRateRequest(inquiryId: string): Promise<void> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry) return;

  const missing = missingForForwarder(inquiry);
  if (missing.length > 0) {
    await prisma.inquiry.updateMany({
      where: { id: inquiryId, officeId: session.officeId },
      data: {
        notes: [
          inquiry.notes,
          `Blocked forwarder request: missing ${missing.join(", ")}.`,
        ].filter(Boolean).join("\n"),
      },
    });
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/rfq/${inquiryId}`);
    return;
  }

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      notes: [
        inquiry.notes,
        "Forwarder send blocked: configure sender inbox, signature, and real forwarder emails/API details before outbound requests can be created.",
      ].filter(Boolean).join("\n"),
    },
  });
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
}

// Decision: convert RFQ to Job (uses best of available carrier quotes for cost)
export async function approveConvertWithBestRate(inquiryId: string): Promise<void> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: { carrierQuotes: { where: { status: "RECEIVED" } } },
  });
  if (!inquiry) return;
  const qualification = qualifyRfq(inquiry);
  if (!qualification.isMature) {
    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        notes: [
          inquiry.notes,
          `Blocked job conversion: missing ${qualification.followUpQuestions.join(" ")}`,
        ].filter(Boolean).join("\n"),
      },
    });
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/rfq/${inquiryId}`);
    return;
  }

  const ranked = inquiry.carrierQuotes
    .map((q) => ({ q, total: q.total40HC ?? q.total40 ?? q.total20 ?? Infinity }))
    .sort((a, b) => a.total - b.total);
  const best = ranked[0]?.q;
  const cost = best ? (best.total40HC ?? best.total40 ?? best.total20) : null;

  const job = await createJobWithReference(session.officeId, (reference) => prisma.job.create({
    data: {
      officeId: session.officeId,
      companyId: inquiry.companyId ?? null,
      inquiryId,
      reference,
      status: "QUOTED",
      mode: inquiry.mode ?? "",
      origin: inquiry.origin ?? "",
      destination: inquiry.destination ?? "",
      commodity: inquiry.commodity ?? "",
      incoterms: inquiry.incoterms ?? "",
      weight: inquiry.weight,
      volume: inquiry.volume,
      dimensions: inquiry.dimensions,
      stackable: inquiry.stackable,
      topLoad: inquiry.topLoad,
      dangerousGoods: inquiry.dangerousGoods,
      customsBy: inquiry.customsBy,
      containerCount: inquiry.containerCount,
      containerType: inquiry.containerType,
      targetPrice: inquiry.targetPrice,
      targetCurrency: inquiry.targetCurrency,
      targetPriceStatus: inquiry.targetPriceStatus,
      targetPriceSource: inquiry.targetPriceSource,
      cost: cost ?? null,
      revenue: cost ? Math.round(cost * 1.18) : null, // suggested 18% margin
      currency: "USD",
      // Loads start unassigned: taken from the board or assigned by an admin.
      quoteLines: best ? `Ocean Freight (${best.carrier})|${cost}|USD` : null,
    },
  }));
  await recordAuditLog({
    officeId: session.officeId,
    actorUserId: session.userId,
    actorEmail: session.email,
    action: "load.created",
    entityId: job.id,
    entityRef: job.reference,
    summary: "Created this load from an RFQ (best-rate conversion)",
  });

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { status: "QUOTED" },
  });
  if (inquiry.targetPrice != null || inquiry.targetPriceStatus === "NO_TARGET") {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      jobId: job.id,
      createdByUserId: session.userId,
      amount: inquiry.targetPrice,
      currency: inquiry.targetCurrency,
      status: inquiry.targetPriceStatus,
      source: inquiry.targetPriceSource,
      note: "Carried from queue conversion.",
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${job.id}`);
}

// Decision: select a specific carrier rate (manual override)
export async function approveCarrierSelection(jobId: string, carrierQuoteId: string): Promise<void> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: { inquiry: { include: { carrierQuotes: true } } },
  });
  if (!job) return;
  const cq = job.inquiry?.carrierQuotes.find((q) => q.id === carrierQuoteId);
  if (!cq) return;
  const cost = cq.total40HC ?? cq.total40 ?? cq.total20 ?? null;

  await prisma.job.updateMany({
    where: { id: jobId, officeId: session.officeId },
    data: {
      cost: cost,
      revenue: cost ? Math.round(cost * 1.18) : job.revenue,
      notes: `Ocean Freight (${cq.carrier})|${cost}|USD`,
    },
  });
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/jobs/${jobId}`);
}
