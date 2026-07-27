"use server";

import Gpt56Client from "./gpt56-client";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";
import type { StageHint, DraftResult } from "./job-email-types";

async function buildJobContext(jobId: string, officeId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { name: true } },
      inquiry: { include: { carrierQuotes: { where: { status: "RECEIVED" } } } },
      milestones: true,
    },
  });
  if (!job) return null;
  const margin = job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%` : "-";
  const quotes = job.inquiry?.carrierQuotes.map((q) => `${q.carrier}: $${(q.total40HC ?? q.total40 ?? q.total20 ?? 0).toLocaleString()} (${q.transitDays ?? "?"}d)`).join("; ") ?? "";
  return {
    job,
    summary: `Reference: ${job.reference}\nCustomer: ${job.company?.name ?? "-"}\nRoute: ${job.origin ?? "?"} → ${job.destination ?? "?"}\nMode: ${job.mode ?? "-"}\nIncoterms: ${job.incoterms ?? "-"}\nCommodity: ${job.commodity ?? "-"}\nWeight: ${job.weight ?? "?"}kg, Volume: ${job.volume ?? "?"}cbm\nStatus: ${job.status}\nTarget price: ${job.targetPrice != null ? `${job.targetCurrency ?? "USD"} ${job.targetPrice.toLocaleString()}` : job.targetPriceStatus === "NO_TARGET" ? "No target" : "Ask customer"}\nRevenue: ${job.revenue ? `$${job.revenue.toLocaleString()}` : "-"}, Cost: ${job.cost ? `$${job.cost.toLocaleString()}` : "-"}, Margin: ${margin}\nCarrier rates received: ${quotes || "(none)"}`,
  };
}

export async function draftStageEmail(jobId: string, stageHint: StageHint): Promise<DraftResult | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "Set OPENAI_API_KEY to draft emails." };
  const ctx = await buildJobContext(jobId, session.officeId);
  if (!ctx) return { error: "Job not found." };

  const promptByHint: Record<StageHint, string> = {
    "INQUIRY-CARRIER-RFQ":         `Draft a freight RFQ email to a carrier requesting rates for this shipment. Be terse, professional, no fluff. Include: route, mode, container/cargo details, incoterms, cargo-ready date, request for rate per container size, transit time, validity, and contact for confirmation.`,
    "INQUIRY-CUSTOMER-CLARIFY":    `Draft an email to the customer asking for missing shipment details. Identify what's missing from the brief above (e.g., commodity, weight, ready date, incoterms). Be polite but direct.`,
    "QUOTED-CUSTOMER-QUOTE":       `Draft an email to the customer presenting our freight quote. State revenue/total, key terms (transit, validity), and a clear next step ("confirm to proceed with booking").`,
    "QUOTED-CUSTOMER-FOLLOWUP":    `Draft a polite follow-up email to the customer asking if they have a decision on the quote. Reference the quote details and offer to discuss.`,
    "BOOKED-CARRIER-CONFIRM":      `Draft a booking confirmation email to the carrier locking in the rate they offered. Include reference, route, container/cargo, cargo-ready coordination, and next steps for booking documents.`,
    "BOOKED-CUSTOMER-CONFIRM":     `Draft a booking confirmation email to the customer. State that we've booked with the chosen carrier and outline next steps for cargo readiness and document submission.`,
    "IN_TRANSIT-CUSTOMER-UPDATE":  `Draft a status update email to the customer. State current status, last milestone confirmed, next expected milestone with date, and any alerts.`,
    "CUSTOMS-BROKER-DOCS":         `Draft an email to the customs broker requesting clearance. Attach reference numbers, expected docs (BL, invoice, packing list, COO), and target release date.`,
    "DELIVERED-CUSTOMER-POD":      `Draft a delivery confirmation email to the customer with proof-of-delivery details, final billing summary, and a thank-you closer.`,
  };

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 600,
    system: `You are drafting freight forwarding emails on behalf of Derya Freight OS. Output ONLY a JSON object: {"subject": "...", "body": "..."}. No markdown, no commentary. Body should be plain text with line breaks. Sign off with "Best, Derya Operations". No emojis. Never use the em dash character in your output; use a comma, colon, period, or plain hyphen instead.`,
    messages: [{
      role: "user",
      content: `JOB CONTEXT:\n${ctx.summary}\n\nINSTRUCTION:\n${promptByHint[stageHint]}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "Could not parse AI response." };
  try {
    const parsed = JSON.parse(m[0]);
    return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
  } catch {
    return { error: "Could not parse AI response." };
  }
}

// Draft a polite counter-offer email to a specific carrier asking for a sharper rate.
export async function draftCounterOffer(
  jobId: string,
  carrierQuoteId: string,
  targetReductionPct: number = 5,
): Promise<DraftResult | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "Set OPENAI_API_KEY to draft emails." };

  const cq = await prisma.carrierQuote.findFirst({
    where: { id: carrierQuoteId, inquiry: { officeId: session.officeId } },
    include: { inquiry: { include: { company: { select: { name: true } } } } },
  });
  if (!cq || !cq.inquiry) return { error: "Carrier quote not found." };

  const total = cq.total40HC ?? cq.total40 ?? cq.total20;
  if (!total) return { error: "Carrier rate has no total." };

  const target = Math.round(total * (1 - targetReductionPct / 100));
  const ctx = await buildJobContext(jobId, session.officeId);
  if (!ctx) return { error: "Job not found." };

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 500,
    system: `You are drafting carrier rate negotiation emails on behalf of Derya Freight OS. Output ONLY a JSON object: {"subject": "...", "body": "..."}. No markdown, no commentary. Body in plain text. Sign off with "Best, Derya Operations". Be polite, direct, professional. No fluff. No emojis. Acknowledge their rate, mention competing pressure or volume, ask for a specific target rate. Don't be aggressive. Never use the em dash character in your output; use a comma, colon, period, or plain hyphen instead.`,
    messages: [{
      role: "user",
      content: `JOB CONTEXT:\n${ctx.summary}\n\nCARRIER OFFER:\n- Carrier: ${cq.carrier}\n- Quoted total: $${total.toLocaleString()}\n- Transit: ${cq.transitDays ?? "?"}d\n- Service: ${cq.service ?? "-"}\n- Validity: ${cq.validity ?? "-"}\n\nTASK:\nDraft a counter-offer email to ${cq.carrier} asking them to sharpen the rate. Target $${target.toLocaleString()} (about ${targetReductionPct}% lower). Reference the lane and mode. Keep it under 120 words.`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "Could not parse AI response." };
  try {
    const parsed = JSON.parse(m[0]);
    return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
  } catch {
    return { error: "Could not parse AI response." };
  }
}

export async function logOutboundEmail(
  jobId: string,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const toEmail = String(formData.get("toEmail") ?? "").trim();
  const toLabel = String(formData.get("toLabel") ?? "").trim();
  if (!subject || !body) return { error: "Subject and body are required." };

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
  });
  if (!job) return { error: "Job not found." };

  // Find or create a thread
  let thread = await prisma.emailThread.findFirst({
    where: { jobId, subject },
    orderBy: { lastMessageAt: "desc" },
  });
  const participants = JSON.stringify(toEmail ? [toEmail, session.email] : [session.email]);
  if (!thread) {
    thread = await prisma.emailThread.create({
      data: {
        jobId,
        officeId: session.officeId,
        subject,
        participants,
        lastMessageAt: new Date(),
      },
    });
  }
  await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      direction: "OUTBOUND",
      fromEmail: session.email,
      toEmails: JSON.stringify(toEmail ? [toEmail] : []),
      subject,
      bodyText: body,
      sentAt: new Date(),
    },
  });
  await prisma.emailThread.updateMany({
    where: { id: thread.id, officeId: session.officeId },
    data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true };
}
