"use server";

import Gpt56Client from "./gpt56-client";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createJobWithReference } from "./job-actions";

// Award a supplier as the winner of a SOURCING inquiry. Marks that thread,
// un-awards any other thread on the same inquiry, advances the linked Job to
// BOOKED ("Awarded" in procurement labels), pulls supplier price into Job.cost,
// and drafts a confirmation email to the supplier.
export async function awardSupplier(threadId: string): Promise<
  | { ok: true; jobId: string | null; childForwardingJobId: string | null; emailDraft: string }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;

  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, officeId: session.officeId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      inquiry: { include: { job: true } },
    },
  });
  if (!thread) return { error: "Thread not found" };
  if (!thread.inquiry) return { error: "Thread is not linked to a sourcing inquiry" };
  if (thread.inquiry.type !== "SOURCING") return { error: "Award action only applies to SOURCING inquiries" };

  let offer: Record<string, unknown> = {};
  if (thread.supplierOffer) {
    try { offer = JSON.parse(thread.supplierOffer); } catch {}
  }

  // Unaward all other threads on this inquiry, then award this one.
  await prisma.emailThread.updateMany({
    where: { inquiryId: thread.inquiry.id, officeId: session.officeId, NOT: { id: thread.id } },
    data: { awardedAt: null },
  });
  await prisma.emailThread.updateMany({
    where: { id: thread.id, officeId: session.officeId },
    data: { awardedAt: new Date() },
  });
  // Invalidate cached supplier-offers summary on this inquiry.
  await prisma.inquiry.updateMany({
    where: { id: thread.inquiry.id, officeId: session.officeId },
    data: { summaryCache: null, summaryCacheAt: null },
  }).catch(() => {});

  // Advance job to BOOKED ("Awarded") and stash supplier cost.
  let jobId: string | null = null;
  if (thread.inquiry.job) {
    jobId = thread.inquiry.job.id;
    const updateData: Record<string, unknown> = { status: "BOOKED" };
    const price = typeof offer.pricePerUnit === "number" ? offer.pricePerUnit : null;
    if (price != null && (thread.inquiry.job.cost == null || thread.inquiry.job.cost === 0)) {
      // Cost = price * qty if qty parses, else just unit price (operator can correct).
      updateData.cost = price;
      if (typeof offer.currency === "string") updateData.currency = offer.currency;
    }
    await prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });
  }
  await prisma.inquiry.update({
    where: { id: thread.inquiry.id },
    data: { status: "WON" },
  });

  // Spin up a child FORWARDING job for the actual shipment from supplier →
  // customer destination. Idempotent: if a child already exists for this
  // procurement job + supplier thread, reuse it.
  let childForwardingJobId: string | null = null;
  if (jobId) {
    const procurement = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true, officeId: true, companyId: true, destination: true,
        commodity: true, weight: true, volume: true, packages: true,
        children: { select: { id: true, type: true } },
      },
    });
    if (procurement) {
      const existingChild = procurement.children.find((c) => c.type === "FORWARDING");
      if (existingChild) {
        childForwardingJobId = existingChild.id;
      } else {
        const supplierOrigin = typeof offer.origin === "string" ? offer.origin : null;
        const supplierIncoterms = typeof offer.incoterms === "string" ? offer.incoterms : null;
        const created = await createJobWithReference(procurement.officeId, (reference) => prisma.job.create({
          data: {
            officeId: procurement.officeId,
            companyId: procurement.companyId ?? null,
            parentJobId: procurement.id,
            reference,
            status: "PROPOSED",
            type: "FORWARDING",
            origin: supplierOrigin,                 // supplier's port/country
            destination: procurement.destination,   // buyer's destination
            commodity: procurement.commodity,
            incoterms: supplierIncoterms,
            weight: procurement.weight,
            volume: procurement.volume,
            packages: procurement.packages,
            currency: "USD",
            notes: `Auto-created from procurement job ${jobId} on ${new Date().toISOString().split("T")[0]} (supplier: ${offer.supplierName ?? "?"}). Confirm details and request carrier rates.`,
          },
        }));
        childForwardingJobId = created.id;
      }
    }
  }

  // Draft a confirmation email to the supplier with GPT-5.6.
  let emailDraft = `Dear ${offer.supplierName ?? thread.messages.find((m) => m.direction === "INBOUND")?.fromName ?? "supplier"},\n\nWe are pleased to confirm we are moving forward with your offer for ${thread.inquiry.commodity ?? "the discussed commodity"}. Please send your pro forma invoice and contract for our review.\n\nKind regards,\nDerya Maritime Inc.`;

  if (apiKey) {
    try {
      const transcript = thread.messages.slice(-6).map((m) => {
        const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
        return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`;
      }).join("\n\n────\n\n").slice(0, 6000);

      const client = new Gpt56Client({ apiKey });
      const result = await client.messages.create({
        model: "gpt-5.6",
        max_tokens: 400,
        system: `You draft a short, professional supplier-award email from a freight/procurement office to a supplier whose offer we just accepted. Keep it under 120 words. Reference the commodity, accept their terms, ask for pro forma invoice + draft contract. No emojis, no markdown. Sign as "Derya Maritime Inc."`,
        messages: [{
          role: "user",
          content: `Commodity: ${thread.inquiry.commodity ?? "-"}\nSupplier: ${offer.supplierName ?? "(unknown)"}\nAgreed price: ${offer.pricePerUnit ?? "-"} ${offer.currency ?? ""}/${offer.unit ?? ""}\nIncoterms: ${offer.incoterms ?? "-"}\nPayment terms: ${offer.paymentTerms ?? "-"}\n\nLAST MESSAGES:\n${transcript}`,
        }],
      });
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      if (text.trim()) emailDraft = text.trim();
    } catch { /* fallback used */ }
  }

  revalidatePath(`/dashboard/rfq/${thread.inquiry.id}`);
  if (jobId) revalidatePath(`/dashboard/jobs/${jobId}`);
  if (childForwardingJobId) revalidatePath(`/dashboard/jobs/${childForwardingJobId}`);
  revalidatePath("/dashboard/jobs");

  return { ok: true, jobId, childForwardingJobId, emailDraft };
}

// Drafts an AI counter-offer reply to a supplier on a SOURCING thread.
// Operator passes a target price (or "X% under best", or "match cheapest", etc).
// Output goes into the same DraftModal - copy or send.
export async function draftCounterOffer(args: {
  threadId: string;
  target: string;  // free-form: "$480/MT", "5% under best", "match BEST", "ask for sample"
}): Promise<{ ok: true; draft: string; replyTo: string | null } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  const thread = await prisma.emailThread.findFirst({
    where: { id: args.threadId, officeId: session.officeId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      inquiry: {
        include: {
          emailThreads: { select: { supplierOffer: true } },
        },
      },
    },
  });
  if (!thread) return { error: "Thread not found" };
  if (!thread.inquiry) return { error: "Thread is not linked to a sourcing inquiry" };

  // Build market context from sibling supplier offers on the same inquiry.
  const offers: Array<{ supplier?: string; price?: number; currency?: string; unit?: string; incoterms?: string }> = [];
  for (const sib of thread.inquiry.emailThreads) {
    if (!sib.supplierOffer) continue;
    try {
      const o = JSON.parse(sib.supplierOffer);
      offers.push({
        supplier: o.supplierName,
        price: typeof o.pricePerUnit === "number" ? o.pricePerUnit : undefined,
        currency: o.currency,
        unit: o.unit,
        incoterms: o.incoterms,
      });
    } catch {}
  }
  const priced = offers.filter((o) => o.price != null).sort((a, b) => (a.price! - b.price!));
  const best = priced[0];

  let mySupplier: typeof offers[number] | null = null;
  if (thread.supplierOffer) {
    try {
      const o = JSON.parse(thread.supplierOffer);
      mySupplier = {
        supplier: o.supplierName,
        price: typeof o.pricePerUnit === "number" ? o.pricePerUnit : undefined,
        currency: o.currency,
        unit: o.unit,
        incoterms: o.incoterms,
      };
    } catch {}
  }

  const transcript = thread.messages.slice(-6).map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`;
  }).join("\n\n────\n\n").slice(0, 6000);

  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 450,
    system: `You draft a polite, professional COUNTER-OFFER email from a freight/procurement office to a supplier whose price is too high. Keep under 130 words. No emojis, no markdown headers. Tone: respectful, firm, value-anchored. Reference what they last quoted, state the target price clearly, hint that we have other offers but never name a competing supplier or expose another supplier's exact number. Ask them to come back with a revised offer by a specific date (today + 3 business days). End with "Looking forward to your revised pricing." or similar. Sign as "Derya Maritime Inc." (no specific person name). Output ONLY the email body, ready to send.`,
    messages: [{
      role: "user",
      content: `Commodity: ${thread.inquiry.commodity ?? "-"}
This supplier (${mySupplier?.supplier ?? "?"}): last priced ${mySupplier?.price ?? "?"} ${mySupplier?.currency ?? ""}/${mySupplier?.unit ?? ""} ${mySupplier?.incoterms ?? ""}
Best comparable offer in our basket: ${best?.price ?? "?"} ${best?.currency ?? ""}/${best?.unit ?? ""}
Operator target: ${args.target}
Today: ${new Date().toISOString().split("T")[0]}

Recent thread:
${transcript}

Draft the counter-offer email body to send back to this supplier.`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  if (!text.trim()) return { error: "AI returned empty draft" };
  return { ok: true, draft: text.trim(), replyTo: lastInbound?.fromEmail ?? null };
}

// Drafts an AI reply to a specific email message (or the latest in a thread)
// without sending. Returns the draft text the operator can copy / edit / send.
export async function draftReplyToMessage(args: {
  messageId?: string;
  threadId?: string;
  intent?: string;  // optional operator hint: "counter at $X", "ask for sample", "accept"
}): Promise<
  | { ok: true; draft: string; replyTo: string | null; channel: "email" | "whatsapp" }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  let thread;
  let target;
  if (args.messageId) {
    target = await prisma.emailMessage.findFirst({
      where: { id: args.messageId, account: { officeId: session.officeId } },
      include: { thread: { include: { messages: { orderBy: { sentAt: "asc" } }, inquiry: true } } },
    });
    if (!target) return { error: "Message not found" };
    thread = target.thread;
  } else if (args.threadId) {
    thread = await prisma.emailThread.findFirst({
      where: { id: args.threadId, officeId: session.officeId },
      include: { messages: { orderBy: { sentAt: "asc" } }, inquiry: true },
    });
    if (!thread) return { error: "Thread not found" };
    target = [...thread.messages].reverse().find((m) => m.direction === "INBOUND") ?? thread.messages[thread.messages.length - 1];
  } else {
    return { error: "messageId or threadId required" };
  }

  const transcript = thread.messages.map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`;
  }).join("\n\n────\n\n").slice(0, 8000);

  const inquiryCtx = thread.inquiry
    ? `Linked inquiry: type=${thread.inquiry.type}, commodity=${thread.inquiry.commodity ?? "-"}, route=${thread.inquiry.origin ?? "?"}→${thread.inquiry.destination ?? "?"}, incoterms=${thread.inquiry.incoterms ?? "-"}.`
    : "Not linked to a job/inquiry yet.";

  // WhatsApp threads get a WhatsApp-shaped draft: short, no subject/signature,
  // in the conversation's language (usually Turkish for Derya's lanes).
  const isWhatsApp =
    Boolean(thread.externalThreadId?.startsWith("whatsapp:")) ||
    thread.messages.some((m) => m.fromEmail.startsWith("whatsapp:"));

  const emailSystem = `You draft short, professional email replies for a freight forwarding & procurement office (Derya Maritime Inc., Istanbul-based). Keep under 150 words. No emojis, no markdown headers, no preamble like "Here's the draft:" - output ONLY the email body, ready to send. Sign as the user (don't add a placeholder name - the user has their own signature). Match the tone of the most recent inbound message.`;
  const whatsAppSystem = `You draft WhatsApp replies for a freight forwarding & procurement office (Derya Lojistik, Istanbul-based). Reply in the language of the conversation (usually Turkish). Keep it short - under 80 words, like a real WhatsApp message: no subject line, no formal letter opening, no signature block, no markdown. Warm but professional; no emojis unless the counterparty uses them. Output ONLY the message text, ready to send.`;

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 500,
    system: isWhatsApp ? whatsAppSystem : emailSystem,
    messages: [{
      role: "user",
      content: `${inquiryCtx}\n\n${args.intent ? `OPERATOR INTENT FOR THIS REPLY: ${args.intent}\n\n` : ""}${isWhatsApp ? "WHATSAPP CONVERSATION" : "THREAD"}:\n\n${transcript}\n\n----\nDraft a reply to: ${target.fromName ?? target.fromEmail}`,
    }],
  });
  const text = result.content[0].type === "text" ? result.content[0].text : "";
  if (!text.trim()) return { error: "AI returned empty draft" };

  return {
    ok: true,
    draft: text.trim(),
    replyTo: target.fromEmail,
    channel: isWhatsApp ? "whatsapp" : "email",
  };
}
