"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { createJobWithReference } from "@/lib/job-actions";
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
    // No API key — just bump status so the demo still flows
    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status: "PARSED" },
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
      content: `Extract freight details from this email. Return ONLY valid JSON, no explanation. Fields (use null if missing): origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerType (20GP|40GP|40HC|LCL), incoterms, commodity, weight (kg), volume (cbm), cargoReadyDate (ISO).\n\nEmail:\n${inquiry.rawEmailBody.slice(0, 2000)}`,
    }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : null;
  if (!text) return;

  let parsed: Record<string, unknown> = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {}

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      origin:        parsed.origin as string ?? inquiry.origin,
      destination:   parsed.destination as string ?? inquiry.destination,
      mode:          parsed.mode as string ?? inquiry.mode,
      containerType: parsed.containerType as string ?? inquiry.containerType,
      incoterms:     parsed.incoterms as string ?? inquiry.incoterms,
      commodity:     parsed.commodity as string ?? inquiry.commodity,
      weight:        parsed.weight != null ? Number(parsed.weight) : inquiry.weight,
      volume:        parsed.volume != null ? Number(parsed.volume) : inquiry.volume,
      cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate as string) : inquiry.cargoReadyDate,
      status: "PARSED",
      parsedData: JSON.stringify(parsed),
    },
  });
  revalidatePath("/dashboard");
}

// Decision: send rate requests to a default fan-out of suppliers (stubbed)
const DEFAULT_CARRIERS_BY_MODE: Record<string, string[]> = {
  "SEA-FCL":  ["Maersk", "MSC", "CMA CGM", "Hapag-Lloyd", "ONE"],
  "SEA-LCL":  ["DSV", "Kuehne+Nagel", "Expeditors", "DB Schenker"],
  "AIR":      ["Lufthansa Cargo", "Turkish Cargo", "Emirates SkyCargo", "Qatar Airways Cargo"],
  "ROAD":     ["DSV Road", "DB Schenker", "Kuehne+Nagel", "Geodis", "Trans-Eurasia"],
  "COURIER":  ["DHL", "FedEx", "UPS", "TNT"],
};

export async function approveSendRateRequest(inquiryId: string): Promise<void> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry) return;

  const carriers = DEFAULT_CARRIERS_BY_MODE[inquiry.mode ?? "SEA-FCL"] ?? DEFAULT_CARRIERS_BY_MODE["SEA-FCL"];

  await prisma.$transaction([
    ...carriers.map((c) =>
      prisma.carrierQuote.create({
        data: {
          inquiryId,
          carrier: c,
          quoteType: "EMAIL",
          status: "PENDING",
        },
      })
    ),
    prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status: "PRICED" },
    }),
  ]);
  revalidatePath("/dashboard");
}

// Decision: convert RFQ to Job (uses best of available carrier quotes for cost)
export async function approveConvertWithBestRate(inquiryId: string): Promise<void> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: { carrierQuotes: { where: { status: "RECEIVED" } } },
  });
  if (!inquiry) return;

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
      cost: cost ?? null,
      revenue: cost ? Math.round(cost * 1.18) : null, // suggested 18% margin
      currency: "USD",
      assignedToUserId: session.userId,
      quoteLines: best ? `Ocean Freight (${best.carrier})|${cost}|USD` : null,
    },
  }));

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { status: "QUOTED" },
  });

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

  await prisma.job.update({
    where: { id: jobId },
    data: {
      cost: cost,
      revenue: cost ? Math.round(cost * 1.18) : job.revenue,
      notes: `Ocean Freight (${cq.carrier})|${cost}|USD`,
    },
  });
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/jobs/${jobId}`);
}
