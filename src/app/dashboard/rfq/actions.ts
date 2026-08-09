"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  buildDeskForwardEmail,
  buildLeadCustomerEmail,
  buildLeadFollowUpEmail,
  claimInquirySendStamp,
  clearInquirySendStamp,
  isSingleEmailAddress,
  isUnforwarded,
  pendingDeskForwardWhere,
  sendRfqMail,
  type SendStampKey,
} from "@/lib/rfq-mail";
import { deriveOutreachState, nextOutreachSend } from "@/lib/lead-outreach";
import { assessLeadQuality } from "@/lib/lead-quality";
import { buildWhatsAppInquiry, waDigitsFromWhatsAppAddress, waPhoneDigits } from "@/lib/rfq-whatsapp";
import { metaLeadMarketOf, type MetaLeadMarket } from "@/lib/meta-leads";
import { logOutboundWhatsAppMessage, sendWhatsAppText, whatsAppSendConfigured } from "@/lib/whatsapp";
import { canonicalInquiryStatus, normalizeInquiryStatusInput } from "@/lib/inquiry-status";
import { parseForwardedTo } from "@/lib/forwarder-partners";
import { deriveSecurityTier } from "@/lib/security-sop";
import { applyQuoteOutcome } from "@/lib/truckload-quotes";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { recordMemoryEvent } from "@/lib/memory/record-event";

const INQUIRY_MAIL_INCLUDE = {
  company: { select: { name: true } },
  emailThreads: {
    take: 1,
    select: {
      messages: {
        take: 1,
        select: { account: { select: { email: true, provider: true } } },
      },
    },
  },
} as const;

async function loadInquiry(inquiryId: string) {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: INQUIRY_MAIL_INCLUDE,
  });
  return { session, inquiry };
}

// A stamp failure after a delivered email must NOT surface as an error -
// the operator would retry and the recipient would get a duplicate.
async function stampAfterSend(inquiryId: string, key: SendStampKey): Promise<void> {
  try {
    await claimInquirySendStamp(inquiryId, key);
  } catch {
    // Sent-state will simply show as unsent; preferable to a duplicate send.
  }
}

export async function sendDeskForwardAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };

  const email = buildDeskForwardEmail(inquiry);
  const result = await sendRfqMail({
    officeId: session.officeId,
    inquiryId: inquiry.id,
    to: email.to,
    cc: email.cc,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
  });
  if ("error" in result) return result;

  await stampAfterSend(inquiry.id, "deskForwardedAt");
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

// Sends the lead's customer email, rebuilt server-side: a confirmation when
// the lead's details are complete, a missing-info request otherwise - the
// same email the sheet previews. Each kind carries its own sent-stamp, so
// an info-request send doesn't mark the (later) confirmation as sent.
export async function sendLeadConfirmationAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };
  if (!isSingleEmailAddress(inquiry.fromEmail)) {
    return { error: "Sender email is missing or not a single valid address - fix it on the RFQ first." };
  }

  const email = buildLeadCustomerEmail(inquiry);
  const result = await sendRfqMail({
    officeId: session.officeId,
    inquiryId: inquiry.id,
    to: inquiry.fromEmail,
    cc: email.cc,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
    // The outreach follow-ups thread onto this send.
    rememberLeadMessageId: true,
  });
  if ("error" in result) return result;

  await stampAfterSend(inquiry.id, email.kind === "info-request" ? "infoRequestSentAt" : "confirmationSentAt");
  // Lead info-requests include the scope/customs questions, so the auto
  // follow-up must not re-ask them.
  if (email.kind === "info-request") await stampAfterSend(inquiry.id, "scopeAskedAt");
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

// The operator's "send next email now" on a lead card: whatever the outreach
// sequence would send next (first touch or follow-up N), sent immediately -
// the cadence and the business-hours window are cron concerns, not operator
// ones. Refuses states where sending makes no sense (replied/dropped/closed).
export async function sendNextOutreachAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };
  if (!isSingleEmailAddress(inquiry.fromEmail)) {
    return { error: "Sender email is missing or not a single valid address - fix it on the RFQ first." };
  }
  let parsed: Record<string, unknown> = {};
  try {
    const value = inquiry.parsedData ? JSON.parse(inquiry.parsedData) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
  } catch {
    return { error: "This RFQ has legacy data that the sequence cannot stamp - send from the email drafts instead." };
  }
  if (parsed.source !== "meta-leads") return { error: "The outreach sequence only applies to lead rows." };

  const state = deriveOutreachState({
    parsed,
    tier: assessLeadQuality(inquiry).tier,
    status: canonicalInquiryStatus(inquiry.status),
    hasValidEmail: true,
    now: new Date(),
  });
  const next = nextOutreachSend(state);
  if (!next) return { error: `Nothing to send: ${state.label}.` };
  if (next.type === "first-touch") return sendLeadConfirmationAction(inquiryId);

  const email = buildLeadFollowUpEmail(inquiry, next.step);
  const stampKey: SendStampKey = `followUp${next.step}SentAt`;
  const claim = await claimInquirySendStamp(inquiry.id, stampKey);
  if (claim === "already") return { error: `Follow-up ${next.step} was already sent.` };
  if (claim !== "claimed") return { error: "Could not claim the send - reload and try again." };

  const result = await sendRfqMail({
    officeId: session.officeId,
    inquiryId: inquiry.id,
    to: inquiry.fromEmail,
    cc: email.cc,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
    inReplyTo: email.inReplyTo,
    rememberLeadMessageId: true,
  });
  if ("error" in result) {
    await clearInquirySendStamp(inquiry.id, stampKey);
    return result;
  }
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

// Pause / resume the automated sequence for one lead. Paused leads keep
// their history and reply detection; they just stop getting emails.
export async function toggleLeadSequenceAction(
  inquiryId: string,
  stop: boolean,
): Promise<{ ok: true } | { error: string }> {
  const { inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };
  if (stop) {
    const claim = await claimInquirySendStamp(inquiry.id, "sequenceStoppedAt");
    if (claim === "legacy") return { error: "This RFQ has legacy data that the sequence cannot stamp." };
  } else {
    await clearInquirySendStamp(inquiry.id, "sequenceStoppedAt");
  }
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

// Send the WhatsApp inquiry draft (Turkish for TR leads, English for US
// ones) to the lead through the CRM's WhatsApp Cloud API number, and log it
// into the matching inbox thread. The draft is rebuilt server-side - same
// text the sheet previews.
export async function sendWhatsAppInquiryAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };
  if (!whatsAppSendConfigured()) {
    return { error: "CRM WhatsApp sending is not configured - set WHATSAPP_SEND_ENABLED and the Cloud API credentials." };
  }

  let parsedPhone: string | null = null;
  let market: MetaLeadMarket = "TR";
  try {
    const parsed = inquiry.parsedData ? JSON.parse(inquiry.parsedData) : {};
    parsedPhone = parsed && typeof parsed === "object" && typeof parsed.phone === "string" ? parsed.phone : null;
    if (parsed && typeof parsed === "object") market = metaLeadMarketOf(parsed);
  } catch {
    parsedPhone = null;
  }
  // Same market rules as the preview's wa.me link - the number the operator
  // saw is the number the Cloud API send goes to. The operator-entered
  // contactPhone column outranks the lead form's number.
  const digits = waPhoneDigits(inquiry.contactPhone, market)
    ?? waPhoneDigits(parsedPhone, market)
    ?? waDigitsFromWhatsAppAddress(inquiry.fromEmail);
  if (!digits) return { error: "No usable phone number on this RFQ - add one to the lead first." };

  const draft = buildWhatsAppInquiry(inquiry);
  const sent = await sendWhatsAppText({ to: digits, body: draft.text });
  if ("error" in sent) return sent;

  try {
    await logOutboundWhatsAppMessage({
      officeId: session.officeId,
      to: digits,
      body: draft.text,
      providerMessageId: sent.providerMessageId,
    });
  } catch {
    // The message already left our hands; a logging failure must not
    // surface as "not sent" or the operator would send a duplicate.
  }
  await stampAfterSend(inquiry.id, "whatsappSentAt");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}

// Forward every open Meta-lead RFQ that has not been sent to the desk yet.
// Each row is claimed (CAS on the stamp) before sending, so overlapping
// invocations or a mid-batch per-row send skip instead of double-sending.
// Capped per invocation so one click can't hold the request open for minutes.
const SEND_ALL_CAP = 60;

export async function sendAllDeskForwardsAction(): Promise<
  { ok: true; sent: number; failed: number; skipped: number; remaining: number } | { error: string }
> {
  const session = await requireSession();
  const candidates = await prisma.inquiry.findMany({
    where: pendingDeskForwardWhere(session.officeId),
    include: INQUIRY_MAIL_INCLUDE,
    orderBy: { receivedAt: "desc" },
    take: 500,
  });

  const pending = candidates.filter(isUnforwarded);
  const batch = pending.slice(0, SEND_ALL_CAP);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let firstError: string | null = null;

  for (const inquiry of batch) {
    try {
      const claim = await claimInquirySendStamp(inquiry.id, "deskForwardedAt");
      if (claim !== "claimed") {
        skipped++;
        continue;
      }

      const email = buildDeskForwardEmail(inquiry);
      const result = await sendRfqMail({
        officeId: session.officeId,
        inquiryId: inquiry.id,
        to: email.to,
        cc: email.cc,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
      });
      if ("error" in result) {
        await clearInquirySendStamp(inquiry.id, "deskForwardedAt");
        failed++;
        firstError = firstError ?? result.error;
        continue;
      }
      sent++;
    } catch (e) {
      failed++;
      firstError = firstError ?? (e instanceof Error ? e.message : String(e));
    }
  }

  revalidatePath("/dashboard/rfq");
  if (sent === 0 && failed > 0) return { error: firstError ?? "All sends failed." };
  return { ok: true, sent, failed, skipped, remaining: pending.length - batch.length };
}

// ── Inline sheet edits on /dashboard/rfq ────────────────────────────────────

export type InquiryRowPatch = {
  subject?: string;
  fromCompany?: string;
  fromEmail?: string;
  origin?: string;
  destination?: string;
  mode?: string;
  status?: string;
  // Free text like "USD 1200", "1200", "no target" or "" (= ask).
  target?: string;
  // Security tier value from src/lib/security-sop.ts (or "" to clear).
  securityTier?: string;
  // Free-text amount like "250000" or "$250,000"; "" clears.
  declaredValue?: string;
  // User id of the assignee; "" unassigns. Anyone on the office can assign.
  assignedToUserId?: string;
};

type RowActionResult = { ok: true } | { error: string };

function trimmedOrNull(value: string, max: number): string | null {
  const text = value.trim().slice(0, max);
  return text ? text : null;
}

// "1,200" and "1.200" are both thousands; "1200,50" and "1200.50" are both
// decimals; "1.234.567,89" (Turkish/European) and "1,234,567.89" both work.
function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later separator is the decimal point.
    s = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = s.split(sep);
    const isGrouping = parts.length > 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3);
    if (isGrouping) s = parts.join("");
    else if (parts.length === 2) s = `${parts[0]}.${parts[1]}`;
    else return null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTargetInput(input: string, fallbackCurrency: string | null):
  | { targetPrice: number | null; targetCurrency: string | null; targetPriceStatus: string; targetPriceSource: string | null }
  | { error: string } {
  const text = input.trim();
  if (!text) {
    return { targetPrice: null, targetCurrency: fallbackCurrency, targetPriceStatus: "UNKNOWN", targetPriceSource: null };
  }
  if (/^no\s*target$/i.test(text)) {
    return { targetPrice: null, targetCurrency: fallbackCurrency, targetPriceStatus: "NO_TARGET", targetPriceSource: "manual" };
  }
  const match = text.match(/^(?:([A-Za-z]{3})\s*|\$\s*)?([\d][\d,.\s]*)$/);
  const amount = match ? parseAmount(match[2]) : null;
  if (amount == null) return { error: 'Target price should look like "USD 1200", "1200", "no target" - or be empty.' };
  const currency = match![1] ? match![1].toUpperCase() : text.startsWith("$") ? "USD" : fallbackCurrency ?? "USD";
  return { targetPrice: amount, targetCurrency: currency, targetPriceStatus: "PROVIDED", targetPriceSource: "manual" };
}

export async function updateInquiryRowAction(
  inquiryId: string,
  patch: InquiryRowPatch,
): Promise<RowActionResult> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry) return { error: "RFQ not found." };

  const data: Record<string, string | number | null> = {};

  if (patch.subject !== undefined) {
    const subject = trimmedOrNull(patch.subject, 300);
    if (!subject) return { error: "Subject is required." };
    data.subject = subject;
  }
  if (patch.fromCompany !== undefined) data.fromCompany = trimmedOrNull(patch.fromCompany, 160);
  if (patch.fromEmail !== undefined) {
    const email = trimmedOrNull(patch.fromEmail, 200);
    if (email && !isSingleEmailAddress(email)) {
      return { error: "Sender email must be a single valid address (or empty)." };
    }
    data.fromEmail = email;
  }
  if (patch.origin !== undefined) data.origin = trimmedOrNull(patch.origin, 120);
  if (patch.destination !== undefined) data.destination = trimmedOrNull(patch.destination, 120);
  if (patch.mode !== undefined) data.mode = trimmedOrNull(patch.mode, 24)?.toUpperCase() ?? null;
  if (patch.status !== undefined) {
    const status = normalizeInquiryStatusInput(patch.status.slice(0, 40));
    if (!status) return { error: "Status is required." };
    // These would collide with the filter-tab keys on /dashboard/rfq.
    if (["ALL", "OPEN"].includes(status.toUpperCase())) {
      return { error: `“${status}” is a reserved name - pick another status.` };
    }
    data.status = status;
  }
  if (patch.target !== undefined) {
    const target = parseTargetInput(patch.target, inquiry.targetCurrency);
    if ("error" in target) return target;
    Object.assign(data, target);
  }
  if (patch.securityTier !== undefined) {
    data.securityTier = trimmedOrNull(patch.securityTier, 24)?.toLowerCase() ?? null;
  }
  if (patch.assignedToUserId !== undefined) {
    const userId = patch.assignedToUserId.trim();
    if (!userId) {
      data.assignedToUserId = null;
    } else {
      const assignee = await prisma.user.findFirst({
        where: { id: userId, officeId: session.officeId, isActive: true },
        select: { id: true },
      });
      if (!assignee) return { error: "That user is not on this office (or is deactivated)." };
      data.assignedToUserId = assignee.id;
    }
  }
  if (patch.declaredValue !== undefined) {
    const raw = patch.declaredValue.trim().replace(/^\$\s*/, "");
    if (!raw) {
      data.declaredValue = null;
    } else {
      const amount = parseAmount(raw);
      if (amount == null) return { error: 'Declared value should be a number like "250000" - or empty.' };
      data.declaredValue = amount;
      if (!inquiry.declaredValueCurrency) data.declaredValueCurrency = "USD";
    }
    // Suggest a tier when the operator hasn't set one - visible in the sheet
    // and overridable; an explicit tier (even in this same patch) wins.
    if (patch.securityTier === undefined && !inquiry.securityTier) {
      const suggested = deriveSecurityTier({
        declaredValue: typeof data.declaredValue === "number" ? data.declaredValue : null,
        commodityCategory: inquiry.commodityCategory,
      });
      if (suggested) data.securityTier = suggested;
    }
  }
  if (Object.keys(data).length === 0) return { ok: true };

  const updated = await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data,
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
    payload: { inquiryId, changedFields: Object.keys(data), status: updated.status },
    provenance: {
      source: "inquiry",
      operation: "sheet_update",
      path: "src/app/dashboard/rfq/actions.ts",
      function: "updateInquiryRowAction",
      sourceRecordId: inquiryId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiryId}:updated:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);

  if (patch.target !== undefined && targetPriceChanged(inquiry, updated)) {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      createdByUserId: session.userId,
      amount: updated.targetPrice,
      currency: updated.targetCurrency,
      status: updated.targetPriceStatus,
      source: updated.targetPriceSource,
      note: "RFQ sheet edit.",
    }).catch(() => null);
  }

  // Settle pending truckload quotes on terminal statuses - best-effort, the
  // Quote-history updates must never block a sheet edit.
  if (typeof data.status === "string" && data.status !== inquiry.status) {
    const outcome = data.status === "BOOKED" ? "WON" : data.status === "MISSED" ? "LOST" : null;
    if (outcome) {
      await applyQuoteOutcome({
        officeId: session.officeId,
        inquiryId,
        outcome,
        userId: session.userId,
      }).catch(() => null);
    }
  }

  revalidatePath("/dashboard/rfq");
  // The assignee/status selects also mount on the RFQ detail hero.
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  return { ok: true };
}

// Toggle one partner forwarder on Inquiry.forwardedTo (JSON string[]) - the
// "İlettiğimiz forwarderlar" chips on the RFQ detail page.
export async function toggleForwardedToAction(
  inquiryId: string,
  partner: string,
): Promise<{ ok: true; forwardedTo: string[] } | { error: string }> {
  const session = await requireSession();
  const name = partner.trim().toUpperCase().slice(0, 40);
  if (!name) return { error: "Forwarder name is required." };

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    select: { id: true, forwardedTo: true },
  });
  if (!inquiry) return { error: "RFQ not found." };

  const current = parseForwardedTo(inquiry.forwardedTo);
  const next = current.includes(name)
    ? current.filter((p) => p !== name)
    : [...current, name];

  await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: { forwardedTo: next.length > 0 ? JSON.stringify(next) : null },
  });

  revalidatePath("/dashboard/rfq");
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  return { ok: true, forwardedTo: next };
}

// Bulk status change from the sheet's multi-select - one office-scoped
// updateMany, then the same memory event the single-row edit records, per row.
// Capped at the sheet's page size; ids beyond it are silently impossible to
// select in the UI anyway.
const BULK_STATUS_CAP = 200;

export async function bulkUpdateInquiryStatusAction(
  inquiryIds: string[],
  statusInput: string,
): Promise<{ ok: true; updated: number } | { error: string }> {
  const session = await requireSession();
  const ids = [...new Set(inquiryIds.filter((id) => typeof id === "string" && id))]
    .slice(0, BULK_STATUS_CAP);
  if (ids.length === 0) return { error: "No RFQs selected." };

  const status = normalizeInquiryStatusInput(statusInput.slice(0, 40));
  if (!status) return { error: "Status is required." };
  // These would collide with the filter-tab keys on /dashboard/rfq.
  if (["ALL", "OPEN"].includes(status.toUpperCase())) {
    return { error: `“${status}” is a reserved name - pick another status.` };
  }

  const result = await prisma.inquiry.updateMany({
    where: { id: { in: ids }, officeId: session.officeId },
    data: { status },
  });
  if (result.count === 0) return { error: "No matching RFQs found." };

  // Settle pending truckload quotes on terminal statuses - best-effort.
  const bulkOutcome = status === "BOOKED" ? "WON" : status === "MISSED" ? "LOST" : null;
  if (bulkOutcome) {
    await Promise.allSettled(
      ids.map((id) =>
        applyQuoteOutcome({ officeId: session.officeId, inquiryId: id, outcome: bulkOutcome, userId: session.userId })
      ),
    );
  }

  const updatedRows = await prisma.inquiry.findMany({
    where: { id: { in: ids }, officeId: session.officeId },
    select: { id: true, status: true, updatedAt: true },
  });
  await Promise.allSettled(
    updatedRows.map((row) =>
      recordMemoryEvent({
        officeId: session.officeId,
        sourceType: "INQUIRY",
        sourceExternalId: `inquiry:${row.id}`,
        eventType: "inquiry.updated",
        entityType: "inquiry",
        entityId: row.id,
        actorType: "user",
        actorId: session.userId,
        occurredAt: row.updatedAt,
        payloadVersion: 1,
        payload: {
          inquiryId: row.id,
          changedFields: ["status"],
          status: row.status,
          bulk: true,
          batchSize: result.count,
        },
        provenance: {
          source: "inquiry",
          operation: "sheet_bulk_status",
          path: "src/app/dashboard/rfq/actions.ts",
          function: "bulkUpdateInquiryStatusAction",
          sourceRecordId: row.id,
          actorType: "user",
          actorId: session.userId,
        },
        idempotencyKey: `inquiry:${row.id}:updated:${row.updatedAt.toISOString()}`,
      }),
    ),
  );

  revalidatePath("/dashboard/rfq");
  return { ok: true, updated: result.count };
}

export async function deleteInquiryRowAction(inquiryId: string): Promise<RowActionResult> {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    select: { id: true, job: { select: { id: true, reference: true, status: true } } },
  });
  if (!inquiry) return { error: "RFQ not found." };
  if (inquiry.job && inquiry.job.status !== "PROPOSED") {
    return { error: `This RFQ is linked to load ${inquiry.job.reference} - delete the load first, or set the RFQ to Ignored instead.` };
  }
  // An auto-created PROPOSED shell load goes with its RFQ.
  if (inquiry.job) {
    await prisma.job.deleteMany({
      where: { id: inquiry.job.id, officeId: session.officeId, status: "PROPOSED" },
    });
  }
  const deleted = await prisma.inquiry.deleteMany({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (deleted.count === 0) return { error: "RFQ not found." };
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}
