// Automated first-touch for US Meta leads, run after every lead-sheet sync
// (hourly cron and the manual button). Policy per Mert (2026-07-20): only
// GOOD-tier leads get an automatic email — the smart customer email
// (received-confirmation when complete, missing-info request otherwise).
// Review/Weak leads are deliberately left untouched: a wrong auto-decline
// to a mislabeled real customer costs more than silence.
//
// Safety rails: per-kind CAS send stamps (never double-sends, and skips
// anything the desk already emailed manually), open-status only, strict
// single-address recipient, per-run cap, and DERYA_LEAD_AUTO_REPLY=off as
// the kill switch.

import { prisma } from "./prisma";
import { openInquiryStatusFilter } from "./inquiry-status";
import { US_LEAD_PARSED_MARKER } from "./meta-leads";
import { assessLeadQuality } from "./lead-quality";
import {
  buildLeadCustomerEmail,
  claimInquirySendStamp,
  clearInquirySendStamp,
  isSingleEmailAddress,
  rfqMailConfigured,
  sendRfqMail,
} from "./rfq-mail";
import { recordMemoryEvent } from "./memory/record-event";

export type AutoReplySummary = {
  sent: number;
  skipped: number;
  failed: number;
  warnings: string[];
};

// One cron tick's worth of sends; the hourly cadence drains any backlog.
const AUTO_REPLY_CAP = 25;

function autoReplyEnabled(): boolean {
  return (process.env.DERYA_LEAD_AUTO_REPLY ?? "us").toLowerCase() !== "off";
}

function parsedOf(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function autoReplyToUsLeads(officeId: string): Promise<AutoReplySummary> {
  const summary: AutoReplySummary = { sent: 0, skipped: 0, failed: 0, warnings: [] };
  if (!autoReplyEnabled()) return summary;
  if (!rfqMailConfigured()) {
    summary.warnings.push("Auto-reply skipped: RFQ mail is not configured.");
    return summary;
  }

  // Oldest first so the backlog drains in arrival order under the cap.
  const candidates = await prisma.inquiry.findMany({
    where: {
      officeId,
      parsedData: { contains: US_LEAD_PARSED_MARKER },
      status: openInquiryStatusFilter(),
    },
    orderBy: { receivedAt: "asc" },
    take: 400,
  });

  for (const inquiry of candidates) {
    if (summary.sent >= AUTO_REPLY_CAP) break;

    const parsed = parsedOf(inquiry.parsedData);
    // Anything already emailed — by the desk or a previous run — is done.
    if (parsed.confirmationSentAt || parsed.infoRequestSentAt || parsed.autoRepliedAt) continue;
    if (!isSingleEmailAddress(inquiry.fromEmail)) {
      summary.skipped++;
      continue;
    }
    if (assessLeadQuality(inquiry).tier !== "GOOD") continue;

    const email = buildLeadCustomerEmail(inquiry);
    const stampKey = email.kind === "info-request" ? "infoRequestSentAt" : "confirmationSentAt";
    const claim = await claimInquirySendStamp(inquiry.id, stampKey);
    if (claim !== "claimed") {
      summary.skipped++;
      continue;
    }

    const result = await sendRfqMail({
      officeId,
      inquiryId: inquiry.id,
      to: inquiry.fromEmail,
      cc: email.cc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
    });
    if ("error" in result) {
      await clearInquirySendStamp(inquiry.id, stampKey);
      summary.failed++;
      if (summary.warnings.length === 0) summary.warnings.push(`Auto-reply: ${result.error}`);
      continue;
    }

    summary.sent++;
    // Mark the send as automated (audit + "don't retry" marker even if the
    // kind stamp were ever cleared by hand).
    await claimInquirySendStamp(inquiry.id, "autoRepliedAt").catch(() => null);
    await recordMemoryEvent({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId: `meta_leads_auto_reply:${inquiry.id}`,
      sourceLabel: "Meta leads auto-reply",
      eventType: "meta_leads.auto_reply.sent",
      entityType: "inquiry",
      entityId: inquiry.id,
      actorType: "system",
      occurredAt: new Date(),
      payloadVersion: 1,
      payload: { inquiryId: inquiry.id, kind: email.kind, to: inquiry.fromEmail, subject: email.subject },
      provenance: {
        source: "google_sheets",
        operation: "auto_reply_us_lead",
        path: "src/lib/lead-auto-reply.ts",
        function: "autoReplyToUsLeads",
        sourceRecordId: inquiry.id,
      },
      idempotencyKey: `meta_leads_auto_reply:${inquiry.id}:${stampKey}`,
    }).catch(() => null);
  }

  return summary;
}
