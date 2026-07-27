"use server";

import Gpt56Client from "./gpt56-client";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";
import { createWithFileReference } from "./references";
import { openInquiryStatusFilter } from "./inquiry-status";
import { createPendingBulkHideThreadsProposal } from "./agent-proposals";
import { recordMemoryEvent } from "./memory/record-event";
import { DERYA_RFQ_SOURCE_EMAILS, isDeryaRfqSourceSender } from "./derya-inboxes";
import { relinkThreadTouches } from "./crm/email-touch";
import { seedWhatsAppLeadFields } from "./rfq-whatsapp";

function deryaRfqSourceSignal(messages: { direction: string; fromEmail: string }[]) {
  const hasDeryaRfqSourceSender = messages.some((m) =>
    m.direction === "INBOUND" && isDeryaRfqSourceSender(m.fromEmail)
  );
  return hasDeryaRfqSourceSender
    ? `\nSource signal: at least one inbound message came from configured Derya RFQ source address ${DERYA_RFQ_SOURCE_EMAILS.join(", ")}. Treat this as strong freight/RFQ evidence. Prefer LINK or CREATE; only SKIP if the content is obviously not a freight request.\n`
    : "";
}

// WhatsApp RFQs read differently from email ones: short Turkish messages,
// no subject line, sender identified by phone. Tell the extractor so it stops
// treating them like thin emails and applies the right defaults.
function whatsAppSourceSignal(messages: { direction: string; fromEmail: string }[]) {
  const wa = messages.find((m) => m.direction === "INBOUND" && m.fromEmail.startsWith("whatsapp:"));
  return wa
    ? `\nSource signal: this is a WhatsApp conversation (counterparty ${wa.fromEmail}), not email. WhatsApp inquiries are usually short Turkish messages about trucking; for Turkish domestic city-to-city loads prefer mode "ROAD", and prices mentioned in lira mean targetCurrency "TRY". Treat as strong freight/RFQ evidence: prefer LINK or CREATE; only SKIP when clearly not freight (bare greetings, spam).\n`
    : "";
}

// Inquiries created from a WhatsApp thread get parsedData.phone/fullName from
// the sender address, so the RFQ sheet's WhatsApp draft has a recipient.
function seedIfWhatsApp(
  parsed: Record<string, unknown>,
  messages: Array<{ direction: string; fromEmail: string; fromName: string | null }>,
): Record<string, unknown> {
  const wa = messages.find((m) => m.direction === "INBOUND" && m.fromEmail.startsWith("whatsapp:"));
  return wa ? seedWhatsAppLeadFields(parsed, wa) : parsed;
}

export async function createInquiryFromThread(threadId: string): Promise<{ ok: true; inquiryId: string } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, officeId: session.officeId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) return { error: "Thread not found" };
  if (thread.inquiryId) return { error: "Thread already linked to an inquiry" };
  if (thread.messages.length === 0) return { error: "No messages in thread" };

  // Build a chronological transcript for the AI
  const transcript = thread.messages.map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\nSubject: ${m.subject ?? "(none)"}\n\n${m.bodyText ?? ""}`.trim();
  }).join("\n\n────\n\n");
  const sourceSignal = deryaRfqSourceSignal(thread.messages) + whatsAppSourceSignal(thread.messages);

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 700,
    system: `You are a freight forwarding office assistant. The user wants to create a single Inquiry record from a thread of emails that are all related to one shipment. Read the entire thread (multiple sent + received messages) and extract a consolidated inquiry.

CRITICAL - distinguish job type:
- "SOURCING" = the office is helping the customer FIND/BUY a commodity from a supplier (negotiating with sellers, asking about price-per-ton, contract terms, payment, sample quality). The conversation is about purchasing the goods, not just moving them.
- "FORWARDING" = the office is moving cargo the customer already owns from A to B (booking carriers, container quotes, BL, customs clearance, ETA tracking).

Output ONLY a JSON object, no markdown:
{
  "type": "SOURCING" | "FORWARDING",
  "subject": string,                      // clean subject summarizing the shipment/deal
  "fromEmail": string | null,             // customer/sender email if identifiable
  "fromCompany": string | null,           // sender company name if identifiable
  "summary": string,                      // 1-2 sentences describing the deal AND its current stage
  "origin": string | null,                // city + country if known (e.g. "Ashgabat, TM")
  "destination": string | null,
  "mode": "SEA-FCL" | "SEA-LCL" | "AIR" | "ROAD" | "COURIER" | null,
  "containerCount": number | null,
  "containerType": "20GP" | "40GP" | "40HC" | "LCL" | null,
  "stackable": "YES" | "NO" | "UNKNOWN" | null,
  "topLoad": "YES" | "NO" | "UNKNOWN" | null,
  "dangerousGoods": "YES" | "NO" | "UNKNOWN" | null,
  "customsBy": "US" | "CUSTOMER" | "FORWARDER" | "UNKNOWN" | null,
  "incoterms": string | null,             // e.g. "FOB", "CIF"
  "commodity": string | null,             // e.g. "Soybean meal 46-47% protein"
  "weight": number | null,                // kg
  "volume": number | null,                // cbm
  "targetPrice": number | null,
  "targetCurrency": "USD" | "EUR" | "TRY" | "GBP" | null,
  "targetPriceStatus": "PROVIDED" | "NO_TARGET" | "UNKNOWN" | null,
  "targetPriceSource": string | null,
  "cargoReadyDate": string | null         // ISO date
}

Be conservative - null is better than guessing. If a thread has BOTH sourcing and forwarding aspects, choose the dominant one (whichever stage the conversation is currently in).`,
    messages: [{
      role: "user",
      content: `${sourceSignal}EMAIL THREAD (subject: "${thread.subject}", ${thread.messages.length} messages):\n\n${transcript.slice(0, 12000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  // Aggregate raw email body for the Inquiry's record
  const rawBody = thread.messages.map((m) =>
    `--- ${m.direction} from ${m.fromEmail} on ${m.sentAt.toISOString().split("T")[0]} ---\n${m.bodyText ?? ""}`
  ).join("\n\n").slice(0, 20000);

  const inquiry = await createWithFileReference(session.officeId, (reference) => prisma.inquiry.create({
    data: {
      officeId: session.officeId,
      reference,
      subject: parsed.subject ?? thread.subject ?? "Email thread",
      fromEmail: parsed.fromEmail ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromEmail ?? null,
      fromCompany: parsed.fromCompany ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromName ?? null,
      type: parsed.type === "SOURCING" ? "SOURCING" : "FORWARDING",
      status: "PARSED",
      rawEmailBody: rawBody,
      parsedData: JSON.stringify({ ...seedIfWhatsApp(parsed, thread.messages), source: "thread", threadId }),
      origin: parsed.origin ?? null,
      destination: parsed.destination ?? null,
      mode: parsed.mode ?? null,
      containerCount: parsed.containerCount != null ? Number(parsed.containerCount) : null,
      containerType: parsed.containerType ?? null,
      stackable: parsed.stackable ?? null,
      topLoad: parsed.topLoad ?? null,
      dangerousGoods: parsed.dangerousGoods ?? null,
      customsBy: parsed.customsBy ?? null,
      incoterms: parsed.incoterms ?? null,
      commodity: parsed.commodity ?? null,
      weight: parsed.weight != null ? Number(parsed.weight) : null,
      volume: parsed.volume != null ? Number(parsed.volume) : null,
      targetPrice: parsed.targetPrice != null ? Number(parsed.targetPrice) : null,
      targetCurrency: parsed.targetCurrency ?? null,
      targetPriceStatus: parsed.targetPriceStatus ?? null,
      targetPriceSource: parsed.targetPriceSource ?? null,
      cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate) : null,
      notes: parsed.summary ?? null,
      receivedAt: thread.messages[0].sentAt,
    },
  }));
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: thread.externalThreadId?.startsWith("whatsapp:") ? "WHATSAPP" : "GMAIL",
    sourceExternalId: thread.externalThreadId ?? `email_thread:${thread.id}`,
    eventType: "inquiry.created_from_thread",
    entityType: "inquiry",
    entityId: inquiry.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: inquiry.createdAt,
    payloadVersion: 1,
    payload: {
      inquiryId: inquiry.id,
      threadId,
      subject: inquiry.subject,
      fromEmail: inquiry.fromEmail,
      fromCompany: inquiry.fromCompany,
      type: inquiry.type,
      status: inquiry.status,
      parsed,
    },
    provenance: {
      source: thread.externalThreadId?.startsWith("whatsapp:") ? "whatsapp" : "gmail",
      operation: "manual_thread_to_inquiry",
      path: "src/lib/thread-actions.ts",
      function: "createInquiryFromThread",
      sourceRecordId: threadId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiry.id}:created_from_thread`,
  }).catch(() => null);

  // Link the thread (and all its messages by extension) to the new inquiry
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { inquiryId: inquiry.id },
  });

  // Re-resolve the thread's CRM counterparty now that it has an inquiry link
  // and log any missing EMAIL activities. Never throws.
  await relinkThreadTouches(threadId);

  // Re-classify all unclassified / other / related-note inbound messages on this thread
  await prisma.emailMessage.updateMany({
    where: {
      threadId,
      thread: { officeId: session.officeId },
      direction: "INBOUND",
      OR: [{ classification: null }, { classification: "OTHER" }, { classification: "RELATED_NOTE" }],
    },
    data: { classification: "RELATED_NOTE", classificationReason: "Attached when thread was promoted to Inquiry", classificationAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return { ok: true, inquiryId: inquiry.id };
}

// Auto-version: same as createInquiryFromThread, but lets the AI return
// `{ skip: true, reason: "..." }` if the thread isn't freight-related, and
// records an attempt so we don't keep re-asking on every sync. Used by the
// post-sync auto-link pass - silent on failure, no redirects, no auth check
// (caller must have already verified office ownership of the thread).
export async function autoCreateInquiryFromThread(threadId: string): Promise<
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; inquiryId: string }
  | { ok: true; created: false; linkedInquiryId: string }
  | { ok: true; created: false; linkedJobId: string }
  | { error: string }
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) return { error: "Thread not found" };
  if (thread.jobId || thread.inquiryId) {
    await prisma.emailThread.updateMany({
      where: { id: threadId, officeId: thread.officeId },
      data: { autoLinkedAt: new Date() },
    });
    return { ok: true, created: false, reason: "already linked" };
  }
  if (thread.messages.length === 0) return { error: "No messages in thread" };

  // Pull open inquiries + active jobs in this office so the AI can match an
  // existing record instead of creating a duplicate.
  const [openInquiries, activeJobs] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: thread.officeId, status: openInquiryStatusFilter() },
      select: { id: true, subject: true, type: true, fromEmail: true, fromCompany: true, commodity: true, origin: true, destination: true, mode: true, notes: true, company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 80,
    }),
    prisma.job.findMany({
      where: { officeId: thread.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { id: true, reference: true, type: true, origin: true, destination: true, mode: true, company: { select: { name: true } }, inquiry: { select: { fromEmail: true, commodity: true, notes: true } } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);

  const summarize = (s: string | null | undefined) =>
    s ? ` | summary: ${s.replace(/\s+/g, " ").trim().slice(0, 240)}` : "";

  const inquiryHints = openInquiries.map((i) =>
    `${i.id} | ${i.type} | "${i.subject}" | ${i.fromEmail ?? i.fromCompany ?? "?"} | ${i.company?.name ?? "-"} | commodity: ${i.commodity ?? "-"} | ${i.origin ?? "?"} → ${i.destination ?? "?"} | ${i.mode ?? "-"}${summarize(i.notes)}`
  ).join("\n");
  const jobHints = activeJobs.map((j) =>
    `${j.id} | ${j.reference} | ${j.type} | ${j.company?.name ?? "-"} | ${j.inquiry?.fromEmail ?? "-"} | commodity: ${j.inquiry?.commodity ?? "-"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.mode ?? "-"}${summarize(j.inquiry?.notes)}`
  ).join("\n");

  const transcript = thread.messages.map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\nSubject: ${m.subject ?? "(none)"}\n\n${m.bodyText ?? ""}`.trim();
  }).join("\n\n────\n\n");
  const sourceSignal = deryaRfqSourceSignal(thread.messages) + whatsAppSourceSignal(thread.messages);

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 800,
    system: `You are a freight forwarding office assistant. For an email thread, decide ONE of:

(a) SKIP - thread is not freight-related (newsletter, security alert, calendar, banking, marketing, personal, generic platform notification):
    { "action": "skip", "reason": "<short sentence>" }

(b) LINK - thread is about a deal we ALREADY track. **STRONGLY prefer linking over creating.** Multiple suppliers / multiple negotiations / multiple email threads about the SAME commodity-and-buyer typically belong to ONE deal. Examples:
    - Five different "Re: Soybean Meal" threads from five different suppliers → ALL link to the SAME existing soybean inquiry.
    - "Re: Quotation for Corn Gluten Meal" + "Corn Gluten Meal Sample" + "CGM lead time" → ALL link to one corn-gluten-meal sourcing inquiry.
    - Carrier reply threads about the same booking → link to the existing job.

  { "action": "link", "linkInquiryId": "<id>" | null, "linkJobId": "<id>" | null, "reason": "<short sentence>" }

(c) CREATE - thread is freight-related and is genuinely a NEW commodity/route/buyer not represented in the lists. Only choose this when no candidate is plausible.
    { "action": "create", "type": "SOURCING" | "FORWARDING", "subject": string, "fromEmail": string|null, "fromCompany": string|null, "summary": string, "origin": string|null, "destination": string|null, "mode": "SEA-FCL"|"SEA-LCL"|"AIR"|"ROAD"|"COURIER"|null, "containerCount": number|null, "containerType": "20GP"|"40GP"|"40HC"|"LCL"|null, "stackable": "YES"|"NO"|"UNKNOWN"|null, "topLoad": "YES"|"NO"|"UNKNOWN"|null, "dangerousGoods": "YES"|"NO"|"UNKNOWN"|null, "customsBy": "US"|"CUSTOMER"|"FORWARDER"|"UNKNOWN"|null, "incoterms": string|null, "commodity": string|null, "weight": number|null, "volume": number|null, "targetPrice": number|null, "targetCurrency": "USD"|"EUR"|"TRY"|"GBP"|null, "targetPriceStatus": "PROVIDED"|"NO_TARGET"|"UNKNOWN"|null, "targetPriceSource": string|null, "cargoReadyDate": string|null }

SOURCING = office helps customer FIND/BUY a commodity (price-per-ton talk, contracts, samples). For SOURCING, ONE inquiry usually has MANY supplier-conversation threads - link, don't duplicate.
FORWARDING = office moves cargo customer already owns (carriers, BL, customs, ETA).

Strong LINK signals (ANY one is enough - be aggressive):
- The commodity keyword in the thread matches an existing inquiry's commodity field, even loosely (e.g. "soybean", "soybean meal", "SBM", "animal feed soybean" all match a "Soybean Meal" inquiry).
- Sender email matches an inquiry's fromEmail OR sender domain matches the customer/contact domain on any open record.
- Same origin or destination country combined with same commodity family.
- Reply chains, Re:/Fwd: subject lines whose stem matches an existing subject.
- Shared booking/BL/container reference number.
- The candidate's "summary" field mentions the thread's commodity, origin, destination, or buyer - even if the top-level fields don't (e.g. a "multi-destination" inquiry whose summary lists Portugal will match a new Portugal-bound thread).

When in doubt between LINK and CREATE: choose LINK. Duplicate inquiries are worse than over-linking - the operator can split later.

Output ONLY the JSON object, no markdown.

OPEN INQUIRIES (id | type | subject | sender | customer | commodity | route | mode):
${inquiryHints || "(none)"}

ACTIVE JOBS (id | ref | type | customer | source-email | commodity | route | mode):
${jobHints || "(none)"}`,
    messages: [{
      role: "user",
      content: `${sourceSignal}EMAIL THREAD (subject: "${thread.subject}", ${thread.messages.length} messages):\n\n${transcript.slice(0, 12000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    await prisma.emailThread.updateMany({
      where: { id: threadId, officeId: thread.officeId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI returned no JSON" },
    });
    return { ok: true, created: false, reason: "AI returned no JSON" };
  }
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch {
    await prisma.emailThread.updateMany({
      where: { id: threadId, officeId: thread.officeId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI JSON parse failed" },
    });
    return { ok: true, created: false, reason: "JSON parse failed" };
  }

  // Back-compat: older prompt used `skip: true`.
  const action: string = parsed.action ?? (parsed.skip ? "skip" : "create");

  if (action === "skip") {
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 240) : "not freight related";
    await prisma.emailThread.updateMany({
      where: { id: threadId, officeId: thread.officeId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: reason },
    });
    return { ok: true, created: false, reason };
  }

  if (action === "link") {
    const linkInquiryId = typeof parsed.linkInquiryId === "string" ? parsed.linkInquiryId : null;
    const linkJobId = typeof parsed.linkJobId === "string" ? parsed.linkJobId : null;

    // Verify the id exists in this office before linking.
    if (linkInquiryId) {
      const inq = await prisma.inquiry.findFirst({ where: { id: linkInquiryId, officeId: thread.officeId }, select: { id: true } });
      if (inq) {
        await prisma.emailThread.updateMany({
          where: { id: threadId, officeId: thread.officeId },
          data: { inquiryId: inq.id, autoLinkedAt: new Date() },
        });
        await prisma.emailMessage.updateMany({
          where: {
            threadId,
            thread: { officeId: thread.officeId },
            direction: "INBOUND",
            OR: [{ classification: null }, { classification: "OTHER" }],
          },
          data: { classification: "RELATED_NOTE", classificationReason: "Auto-linked to existing inquiry", classificationAt: new Date() },
        });
        // Re-resolve the thread's CRM counterparty now that it's inquiry-linked.
        await relinkThreadTouches(threadId);
        return { ok: true, created: false, linkedInquiryId: inq.id };
      }
    }
    if (linkJobId) {
      const job = await prisma.job.findFirst({ where: { id: linkJobId, officeId: thread.officeId }, select: { id: true } });
      if (job) {
        await prisma.emailThread.updateMany({
          where: { id: threadId, officeId: thread.officeId },
          data: { jobId: job.id, autoLinkedAt: new Date() },
        });
        await prisma.emailMessage.updateMany({
          where: {
            threadId,
            thread: { officeId: thread.officeId },
            direction: "INBOUND",
            OR: [{ classification: null }, { classification: "OTHER" }],
          },
          data: { classification: "RELATED_NOTE", classificationReason: "Auto-linked to existing job", classificationAt: new Date() },
        });
        // Re-resolve the thread's CRM counterparty now that it's job-linked.
        await relinkThreadTouches(threadId);
        return { ok: true, created: false, linkedJobId: job.id };
      }
    }
    // AI said link but didn't give a valid id - fall through to skip.
    await prisma.emailThread.updateMany({
      where: { id: threadId, officeId: thread.officeId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI proposed link but id not found" },
    });
    return { ok: true, created: false, reason: "AI proposed link but id not found" };
  }

  // CREATE path
  const rawBody = thread.messages.map((mm) =>
    `--- ${mm.direction} from ${mm.fromEmail} on ${mm.sentAt.toISOString().split("T")[0]} ---\n${mm.bodyText ?? ""}`
  ).join("\n\n").slice(0, 20000);

  const inquiry = await createWithFileReference(thread.officeId, (reference) => prisma.inquiry.create({
    data: {
      officeId: thread.officeId,
      reference,
      subject: parsed.subject ?? thread.subject ?? "Email thread",
      fromEmail: parsed.fromEmail ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromEmail ?? null,
      fromCompany: parsed.fromCompany ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromName ?? null,
      type: parsed.type === "SOURCING" ? "SOURCING" : "FORWARDING",
      status: "PARSED",
      rawEmailBody: rawBody,
      parsedData: JSON.stringify({ ...seedIfWhatsApp(parsed, thread.messages), source: "thread-auto", threadId }),
      origin: parsed.origin ?? null,
      destination: parsed.destination ?? null,
      mode: parsed.mode ?? null,
      containerCount: parsed.containerCount != null ? Number(parsed.containerCount) : null,
      containerType: parsed.containerType ?? null,
      stackable: parsed.stackable ?? null,
      topLoad: parsed.topLoad ?? null,
      dangerousGoods: parsed.dangerousGoods ?? null,
      customsBy: parsed.customsBy ?? null,
      incoterms: parsed.incoterms ?? null,
      commodity: parsed.commodity ?? null,
      weight: parsed.weight != null ? Number(parsed.weight) : null,
      volume: parsed.volume != null ? Number(parsed.volume) : null,
      targetPrice: parsed.targetPrice != null ? Number(parsed.targetPrice) : null,
      targetCurrency: parsed.targetCurrency ?? null,
      targetPriceStatus: parsed.targetPriceStatus ?? null,
      targetPriceSource: parsed.targetPriceSource ?? null,
      cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate) : null,
      notes: parsed.summary ?? null,
      receivedAt: thread.messages[0].sentAt,
    },
  }));
  await recordMemoryEvent({
    officeId: thread.officeId,
    sourceType: thread.externalThreadId?.startsWith("whatsapp:") ? "WHATSAPP" : "GMAIL",
    sourceExternalId: thread.externalThreadId ?? `email_thread:${thread.id}`,
    eventType: "inquiry.auto_created_from_thread",
    entityType: "inquiry",
    entityId: inquiry.id,
    occurredAt: inquiry.createdAt,
    payloadVersion: 1,
    payload: {
      inquiryId: inquiry.id,
      threadId,
      subject: inquiry.subject,
      fromEmail: inquiry.fromEmail,
      fromCompany: inquiry.fromCompany,
      type: inquiry.type,
      status: inquiry.status,
      parsed,
    },
    provenance: {
      source: thread.externalThreadId?.startsWith("whatsapp:") ? "whatsapp" : "gmail",
      operation: "auto_thread_to_inquiry",
      path: "src/lib/thread-actions.ts",
      function: "autoCreateInquiryFromThread",
      sourceRecordId: threadId,
    },
    idempotencyKey: `inquiry:${inquiry.id}:auto_created_from_thread`,
  }).catch(() => null);

  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: thread.officeId },
    data: { inquiryId: inquiry.id, autoLinkedAt: new Date() },
  });

  // Re-resolve the thread's CRM counterparty now that it has an inquiry link
  // and log any missing EMAIL activities. Never throws.
  await relinkThreadTouches(threadId);

  await prisma.emailMessage.updateMany({
    where: {
      threadId,
      thread: { officeId: thread.officeId },
      direction: "INBOUND",
      OR: [{ classification: null }, { classification: "OTHER" }],
    },
    data: { classification: "RELATED_NOTE", classificationReason: "Attached when thread was auto-promoted to Inquiry", classificationAt: new Date() },
  });

  return { ok: true, created: true, inquiryId: inquiry.id };
}

export async function attachThreadToJob(threadId: string, jobId: string): Promise<void> {
  const session = await requireSession();
  // Verify both belong to this office
  const [thread, job] = await Promise.all([
    prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } }),
    prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId }, select: { id: true } }),
  ]);
  if (!thread || !job) return;
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { jobId, inquiryId: null },
  });
  revalidatePath("/dashboard/inbox");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

export async function markThreadUnrelated(threadId: string): Promise<void> {
  const session = await requireSession();
  const found = await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  if (!found) return;
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { jobId: null, inquiryId: null, hiddenAt: new Date() },
  });
  await prisma.emailMessage.updateMany({
    where: { threadId, thread: { officeId: session.officeId } },
    data: { classification: "OTHER", classificationReason: "Manually marked unrelated" },
  });
  revalidatePath("/dashboard/inbox");
}

export async function hideThread(threadId: string): Promise<void> {
  const session = await requireSession();
  const found = await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  if (!found) return;
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { hiddenAt: new Date() },
  });
  revalidatePath("/dashboard/inbox");
}

export async function unhideThread(threadId: string): Promise<void> {
  const session = await requireSession();
  const found = await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  if (!found) return;
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { hiddenAt: null },
  });
  revalidatePath("/dashboard/inbox");
}

export async function snoozeThread(threadId: string, until: "4h" | "tomorrow" | "monday" | string): Promise<void> {
  const session = await requireSession();
  const found = await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  if (!found) return;
  let dt: Date;
  const now = new Date();
  if (until === "4h") {
    dt = new Date(now.getTime() + 4 * 3600 * 1000);
  } else if (until === "tomorrow") {
    dt = new Date(now); dt.setDate(dt.getDate() + 1); dt.setHours(9, 0, 0, 0);
  } else if (until === "monday") {
    dt = new Date(now);
    const daysToMon = (1 - dt.getDay() + 7) % 7 || 7;
    dt.setDate(dt.getDate() + daysToMon); dt.setHours(9, 0, 0, 0);
  } else {
    const parsed = new Date(until);
    dt = isNaN(parsed.getTime()) ? new Date(now.getTime() + 24 * 3600 * 1000) : parsed;
  }
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { snoozedUntil: dt },
  });
  revalidatePath("/dashboard/inbox");
}

export async function bulkHideThreads(threadIds: string[]): Promise<{ hidden: number }> {
  const session = await requireSession();
  if (threadIds.length === 0) return { hidden: 0 };
  const r = await prisma.emailThread.updateMany({
    where: { id: { in: threadIds }, officeId: session.officeId },
    data: { hiddenAt: new Date() },
  });
  revalidatePath("/dashboard/inbox");
  return { hidden: r.count };
}

export async function proposeBulkHideThreads(threadIds: string[]): Promise<
  | { ok: true; proposalId: string; message: string }
  | { error: string }
> {
  const session = await requireSession();
  const result = await createPendingBulkHideThreadsProposal({
    officeId: session.officeId,
    userId: session.userId,
    threadIds,
    kind: "BULK_HIDE_THREADS",
    sourceType: "INBOX_BULK_ACTION",
  });
  return result.ok
    ? { ok: true, proposalId: result.proposalId, message: result.message }
    : { error: result.error };
}

export async function bulkSnoozeThreads(threadIds: string[], until: "4h" | "tomorrow" | "monday"): Promise<{ snoozed: number }> {
  const session = await requireSession();
  if (threadIds.length === 0) return { snoozed: 0 };
  const now = new Date();
  let dt = new Date(now);
  if (until === "4h") dt = new Date(now.getTime() + 4 * 3600 * 1000);
  else if (until === "tomorrow") { dt.setDate(dt.getDate() + 1); dt.setHours(9, 0, 0, 0); }
  else if (until === "monday") {
    const daysToMon = (1 - dt.getDay() + 7) % 7 || 7;
    dt.setDate(dt.getDate() + daysToMon); dt.setHours(9, 0, 0, 0);
  }
  const r = await prisma.emailThread.updateMany({
    where: { id: { in: threadIds }, officeId: session.officeId },
    data: { snoozedUntil: dt },
  });
  revalidatePath("/dashboard/inbox");
  return { snoozed: r.count };
}

export async function bulkLinkThreadsToInquiry(threadIds: string[], inquiryId: string): Promise<{ linked: number }> {
  const session = await requireSession();
  if (threadIds.length === 0) return { linked: 0 };
  const inq = await prisma.inquiry.findFirst({ where: { id: inquiryId, officeId: session.officeId }, select: { id: true } });
  if (!inq) return { linked: 0 };
  const r = await prisma.emailThread.updateMany({
    where: { id: { in: threadIds }, officeId: session.officeId },
    data: { inquiryId: inq.id, autoLinkedAt: new Date() },
  });
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/jobs");
  return { linked: r.count };
}

export async function unsnoozeThread(threadId: string): Promise<void> {
  const session = await requireSession();
  const found = await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  if (!found) return;
  await prisma.emailThread.updateMany({
    where: { id: threadId, officeId: session.officeId },
    data: { snoozedUntil: null },
  });
  revalidatePath("/dashboard/inbox");
}
